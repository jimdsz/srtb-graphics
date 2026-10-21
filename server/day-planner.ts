import {z} from 'zod';
import type {Member} from '../src/studio/domain';
import type {PlannerTask} from '../src/studio/day-planner-model';
import {canApprove} from '../src/studio/domain';
import {plannerDocumentSchema,taskRequestSchema,taskKey,plannerTaskBaseKey} from '../src/studio/day-planner-model';
import {plannerProject} from '../src/studio/day-planner-project';
import {plannerVoiceAssets} from '../src/studio/planner-voice';
import {HttpError,json,readJson} from './http';
import {validateProfileAssets,presetAssetUses} from './preparation-profile-assets';
import {requestChannel} from './channel-access';

type Row={id:string;kind:string;name:string;data_json:string;revision:number;archived:number;created_by:string;updated_by:string;updated_at:string};
const encode=(r:Row)=>({id:r.id,revision:r.revision,data:JSON.parse(r.data_json),archived:!!r.archived,createdBy:r.created_by,updatedBy:r.updated_by,updatedAt:r.updated_at});
const putSchema=z.object({revision:z.number().int().nonnegative(),data:plannerDocumentSchema}).strict();
// Keep the semantic uniqueness check inside the write, not in a preceding read:
// different clients create different UUIDs for the same programme.
const noOtherRule="NOT EXISTS(SELECT 1 FROM planner_documents AS other WHERE other.kind='rule' AND other.archived=0 AND other.id<>? AND json_extract(other.data_json,'$.programme')=? AND other.channel_id=?)";
const ruleConflict='Une association existe déjà ou a changé pour ce programme. Actualisez les associations avant de mémoriser votre choix. Les médias de votre préparation restent conservés.';
async function find(db:D1Database,id:string){const row=await db.prepare('SELECT * FROM planner_documents WHERE id=?').bind(id).first<Row>();if(!row)throw new HttpError(404,'Préparation introuvable.');return row;}
async function tasks(db:D1Database,id:string,member:Member,keys?:string[]){
  const rows=await db.prepare(`SELECT t.task_key AS key,t.project_id AS projectId,t.source_revision AS sourceRevision,p.title,p.status,p.archived FROM planner_personal_tasks t JOIN projects p ON p.id=t.project_id WHERE t.plan_id=? AND t.actor=? ${keys?'AND t.task_key IN (SELECT value FROM json_each(?))':''} ORDER BY t.task_key LIMIT 2000`).bind(id,member.email,...(keys?[JSON.stringify(keys)]:[])).all<Omit<PlannerTask,'archived'>&{archived:number}>();
  return rows.results.map(row=>({...row,archived:!!row.archived}));
}
export async function dayPlannerRoutes(request:Request,env:Env,member:Member):Promise<Response|null>{
  const url=new URL(request.url),path=url.pathname,channel=requestChannel(request);
  if(path==='/api/planner-summary'&&request.method==='GET')return json(await env.DB.prepare("SELECT COUNT(*) AS plans,MAX(updated_at) AS updatedAt FROM planner_documents WHERE channel_id=? AND kind='plan' AND archived=0").bind(channel).first());
  if(path!=='/api/planner'&&!path.startsWith('/api/planner/'))return null;
  if(member.active!==1||!['admin','designer','broadcaster'].includes(member.role))throw new HttpError(403,'Compte de préparation actif nécessaire.');
  if(path==='/api/planner/rules'){
    if(request.method!=='POST')throw new HttpError(405,'Action non disponible.');
    const input=z.object({programmes:z.array(z.string().min(1).max(600)).max(600),families:z.array(z.string().min(1).max(200)).max(600).optional()}).strict().parse(await readJson(request,512*1024));
    const rows=await env.DB.prepare("SELECT * FROM planner_documents WHERE channel_id=? AND kind='rule' AND archived=0 AND (json_extract(data_json,'$.programme') IN (SELECT value FROM json_each(?)) OR json_extract(data_json,'$.family') IN (SELECT value FROM json_each(?))) ORDER BY updated_at DESC,id LIMIT 2000").bind(channel,JSON.stringify([...new Set(input.programmes)]),JSON.stringify([...new Set(input.families||[])])).all<Row>();
    // Preserve historical ambiguity for explicit review. Choosing the newest
    // record here concealed conflicting team decisions from the clients.
    return json({rules:rows.results.map(encode)});
  }
  if(path==='/api/planner'){
    if(request.method!=='GET')throw new HttpError(405,'Action non disponible.');
    const input=z.object({kind:z.enum(['plan','directory','rule']),programme:z.string().min(1).max(600).optional(),offset:z.coerce.number().int().min(0).max(2000).default(0)}).strict().parse(Object.fromEntries(url.searchParams));
    if(input.programme&&input.kind!=='rule')throw new HttpError(400,'Filtre réservé aux associations programme.');
    const rows=await env.DB.prepare(`SELECT id,kind,name,revision,updated_at AS updatedAt,archived FROM planner_documents WHERE channel_id=? AND kind=? AND archived=0 ${input.programme?"AND json_extract(data_json,'$.programme')=?":''} ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?`).bind(channel,input.kind,...(input.programme?[input.programme]:[]),input.offset).all();
    return json({documents:rows.results.slice(0,50),next:rows.results.length>50?input.offset+50:null});
  }
  const route=path.match(/^\/api\/planner\/([a-f\d-]+)(?:\/(tasks|archive))?$/);
  if(!route||!z.uuid().safeParse(route[1]).success)throw new HttpError(404,'Préparation introuvable.');
  const [,id,action]=route;
  if(!action&&request.method==='PUT'){
    const input=putSchema.parse(await readJson(request,1024*1024)),serialized=JSON.stringify(input.data);
    const isRule=input.data.kind==='rule',ruleParams=input.data.kind==='rule'?[id,input.data.programme,channel]:[];
    if(isRule&&!canApprove(member.role))throw new HttpError(403,'Une règle partagée doit être approuvée par un administrateur ou un diffuseur.');
    if(input.data.kind==='plan')for(let i=0;i<input.data.rows.length;i+=25)await validateProfileAssets(env.DB,input.data.rows.slice(i,i+25).flatMap(row=>[
      ...(row.media?[{value:row.media,kind:'visual' as const}]:[]),...(row.logo?[{value:row.logo,kind:'image' as const}]:[]),
    ]));
    if(input.data.kind==='plan'){
      const voices=plannerVoiceAssets(input.data);
      for(let i=0;i<voices.length;i+=50)await validateProfileAssets(env.DB,voices.slice(i,i+50));
    }
    if(input.revision===0){
      const inserted=await env.DB.prepare(`INSERT INTO planner_documents(id,kind,name,data_json,created_by,updated_by,channel_id) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM planner_documents)<2000 ${isRule?`AND ${noOtherRule}`:''} ON CONFLICT(id) DO NOTHING RETURNING *`).bind(id,input.data.kind,input.data.name,serialized,member.email,member.email,channel,...ruleParams).first<Row>();
      if(inserted)return json(encode(inserted),201);
      const existing=await env.DB.prepare('SELECT * FROM planner_documents WHERE id=?').bind(id).first<Row>();
      if(existing?.revision===1&&existing.created_by===member.email&&existing.data_json===serialized)return json(encode(existing));
      throw new HttpError(409,isRule?ruleConflict:'Création déjà réalisée ou limite de 2 000 préparations atteinte. Actualisez la liste.');
    }
    const saved=await env.DB.prepare(`UPDATE planner_documents SET name=?,data_json=?,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=? AND kind=? AND archived=0 ${isRule?`AND ${noOtherRule}`:''} RETURNING *`).bind(input.data.name,serialized,member.email,id,input.revision,input.data.kind,...ruleParams).first<Row>();
    if(!saved)throw new HttpError(409,isRule?ruleConflict:'Un collègue a modifié ou archivé cette préparation. Rechargez sa version avant de continuer.');
    return json(encode(saved));
  }
  const row=await find(env.DB,id);
  if(!action&&request.method==='GET')return json(encode(row));
  if(action==='archive'&&request.method==='POST'){
    if(row.created_by!==member.email&&!canApprove(member.role))throw new HttpError(403,'Archivage réservé à l’auteur ou au diffuseur.');
    const input=z.object({revision:z.number().int().positive(),archived:z.boolean()}).strict().parse(await readJson(request));
    const restoringRule=!input.archived&&row.kind==='rule';
    if(row.kind==='rule'&&!canApprove(member.role))throw new HttpError(403,'Gestion des règles partagées réservée à un administrateur ou diffuseur.');
    const saved=await env.DB.prepare(`UPDATE planner_documents SET archived=?,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=? ${restoringRule?`AND ${noOtherRule}`:''} RETURNING *`).bind(Number(input.archived),member.email,id,input.revision,...(restoringRule?[id,JSON.parse(row.data_json).programme,channel]:[])).first<Row>();
    if(!saved)throw new HttpError(409,restoringRule?ruleConflict:'Préparation modifiée par un collègue. Actualisez.');return json(encode(saved));
  }
  if(action==='tasks'&&row.kind==='plan'){
    if(request.method==='GET')return json({tasks:await tasks(env.DB,id,member)});
    if(request.method==='POST'){
      if(channel!=='benin-tv')throw new HttpError(422,'Cette chaîne ne dispose pas encore de modèles approuvés.');
      const input=taskRequestSchema.parse(await readJson(request)),plan=plannerDocumentSchema.parse(JSON.parse(row.data_json));
      if(row.archived||row.revision!==input.revision||plan.kind!=='plan')throw new HttpError(409,'Préparation modifiée ou archivée. Rechargez avant de créer les projets.');
      if(new Set(input.tasks.map(taskKey)).size!==input.tasks.length)throw new HttpError(400,'Un même habillage est demandé deux fois.');
      // Existing personal drafts are immutable here, even if the shared plan's
      // date/voice/source has since changed. Revalidate only genuinely new work.
      const personal=await tasks(env.DB,id,member,input.tasks.some(choice=>choice.edition!==undefined)?undefined:input.tasks.map(taskKey));
      const existing=new Set(personal.map(task=>task.key));
      for(const choice of input.tasks){
        const edition=choice.edition;if(edition===undefined)continue;
        if(edition!==row.revision)throw new HttpError(409,'La version actualisée doit utiliser la révision actuelle de la préparation. Rechargez avant de continuer.');
        const base=taskKey({...choice,edition:undefined});
        if(!personal.some(task=>task.sourceRevision<edition&&(task.key===base||task.key.startsWith(base+':r'))&&plannerTaskBaseKey(task.key)===base))throw new HttpError(409,'Créez d’abord votre brouillon pour cet habillage. Une version actualisée nécessite un projet personnel issu d’une révision antérieure.');
      }
      const statements:D1PreparedStatement[]=[];
      for(const choice of input.tasks){
        if(existing.has(taskKey(choice)))continue;
        const proposed=plannerProject(plan,choice),key=taskKey(choice),projectId=crypto.randomUUID();
        const baseKey=taskKey({...choice,edition:undefined});
        const claimed=await env.DB.prepare('SELECT owner FROM planner_assignments WHERE plan_id=? AND task_key=?').bind(id,baseKey).first<{owner:string}>();
        if(claimed&&claimed.owner!==member.email)throw new HttpError(409,'Un collègue est responsable de cet habillage. Actualisez les attributions de la préparation.');
        const prior=await env.DB.prepare('SELECT actor FROM planner_personal_tasks WHERE plan_id=? AND task_key=? AND actor<>? LIMIT 1').bind(id,key,member.email).first();
        if(prior)throw new HttpError(409,'Cet habillage possède déjà un brouillon privé chez un collègue. Demandez-lui de le partager ; aucun doublon n’a été créé.');
        await validateProfileAssets(env.DB,presetAssetUses(proposed.template,proposed.data));
        statements.push(env.DB.prepare('INSERT INTO planner_assignments(plan_id,task_key,owner,updated_by) VALUES(?,?,?,?) ON CONFLICT(plan_id,task_key) DO NOTHING').bind(id,baseKey,member.email,member.email));
        statements.push(env.DB.prepare("INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM planner_personal_tasks WHERE plan_id=? AND task_key=? AND actor=?)")
          .bind(projectId,proposed.title,proposed.template.id,proposed.template.version,proposed.template.libraryVersion,JSON.stringify(proposed.data),member.email,member.email,id,key,member.email));
        statements.push(env.DB.prepare('INSERT INTO planner_personal_tasks(plan_id,task_key,project_id,source_revision,actor) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=?)').bind(id,key,projectId,row.revision,member.email,projectId));
      }
      try{if(statements.length)await env.DB.batch(statements);}catch(error){const message=String(error)+(error instanceof Error?String(error.cause):'');if(/planner_changed|planner_actor_inactive|planner_task_limit|planner_assignment|UNIQUE constraint/.test(message))throw new HttpError(409,'La préparation ou son attribution a changé. Actualisez : aucun projet partiel n’a été créé.');throw error;}
      // Old clients expect the complete personal ledger. New clients merge only
      // the requested (at most eight) rows, avoiding a growing response per batch.
      return json({tasks:await tasks(env.DB,id,member,input.response==='requested'?input.tasks.map(taskKey):undefined)});
    }
  }
  throw new HttpError(405,'Action non disponible.');
}
