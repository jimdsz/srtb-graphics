import { z } from 'zod';
import { broadcastTemplates, canApprove, getTemplate, templateDefaults, validateProjectData } from '../src/studio/domain';
import type { BroadcastTemplate, Member, Project, ProjectData } from '../src/studio/domain';
import { HttpError, json, readJson } from './http';
import { deliveryPlan } from './delivery';
import { sharedMediaReferences } from './media-references';
import { readyMedia } from './ready-media';
import {assertProjectAccess,projectAccessSql} from './project-access';
import {requestChannel} from './channel-access';

interface ProjectRow extends Omit<Project, 'data'> { data_json: string }
const titleSchema = z.string().trim().min(1).max(120);
const createSchema = z.object({ title: titleSchema, templateId: z.string(), data: z.record(z.string(),z.unknown()).optional() }).strict();
const saveSchema = z.object({ title: titleSchema, revision: z.number().int().positive(), data: z.record(z.string(),z.unknown()) }).strict();
const statusSchema = z.object({ revision: z.number().int().positive(), status: z.enum(['draft','submitted','approved','rejected']) }).strict();
const rowJson = (row: ProjectRow) => { const {data_json,...rest} = row; return {...rest,data:JSON.parse(data_json)}; };
const idValid = (id: string) => /^[a-f\d-]{36}$/.test(id);
export async function findProject(db: D1Database, id: string, member:Member, request?:Request) {
  if (!idValid(id)) throw new HttpError(404,'Projet introuvable.');
  let clientProjection='';
  if(typeof __SRTB_DERIVATIONS__!=='undefined'&&__SRTB_DERIVATIONS__&&request){
    const {projectClientProjection}=await import('./derivation-client');clientProjection=projectClientProjection(request);
  }
  const row = await db.prepare(`SELECT *${clientProjection} FROM projects WHERE id=? AND EXISTS(SELECT 1 FROM channels c WHERE c.id=projects.channel_id AND c.archived=0 AND (?=1 OR EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id=c.id AND cm.email=?)))`).bind(id,Number(member.role==='admin'),member.email).first<ProjectRow&{_client_requires_derivations?:number}>();
  if (!row) throw new HttpError(404,'Projet introuvable.');
  if(request&&row.channel_id!==requestChannel(request))throw new HttpError(404,'Projet introuvable dans cette chaîne.');
  assertProjectAccess(member,row);
  if(typeof __SRTB_DERIVATIONS__!=='undefined'&&__SRTB_DERIVATIONS__&&request&&row._client_requires_derivations){
    const {requireDerivationClient}=await import('./derivation-client');requireDerivationClient(request);
  }
  const {_client_requires_derivations,...project}=row;return project;
}
async function mediaReady(db: D1Database, template: BroadcastTemplate, data: ProjectData) {
  const references = sharedMediaReferences(template,data);
  if ((await readyMedia(db,references)).length !== references.length) throw new HttpError(422,'Un média partagé manque ou son transfert n’est pas terminé.');
}
export async function projectRoutes(request: Request, env: Env, member: Member): Promise<Response | null> {
  if(member.active!==1)throw new HttpError(403,'Compte inactif.');
  const url = new URL(request.url), pathname = url.pathname;
  const channel=requestChannel(request);
  if (pathname === '/api/templates' && request.method === 'GET') return json(channel==='benin-tv'?broadcastTemplates:[]);
  if (pathname === '/api/projects') {
    if (request.method === 'GET') {
      const archived = url.searchParams.get('archived') === '1' ? 1 : 0;
      const before = url.searchParams.get('before') ?? '9999';
      const afterId = url.searchParams.get('afterId') ?? '';
      let clientFilter='';
      if(typeof __SRTB_DERIVATIONS__!=='undefined'&&__SRTB_DERIVATIONS__){
        const {legacyProjectFilter}=await import('./derivation-client');clientFilter=legacyProjectFilter(request);
      }
      const access=projectAccessSql(member);
      const scope=url.searchParams.get('scope');
      const scopeSql=scope==='mine'?' AND created_by=? COLLATE NOCASE':scope==='team'?" AND visibility='team'":'';
      const rawStatus=url.searchParams.get('status');
      const status=rawStatus===null?null:z.enum(['draft','submitted','approved','rejected']).parse(rawStatus);
      const rows = await env.DB.prepare(`SELECT * FROM projects WHERE channel_id=? AND archived=?${clientFilter} AND ${access.sql}${scopeSql}${status?' AND status=?':''} AND (updated_at < ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at DESC,id LIMIT 101`).bind(channel,archived,...access.values,...(scope==='mine'?[member.email]:[]),...(status?[status]:[]),before,before,afterId).all<ProjectRow>();
      const page = rows.results.slice(0,100);
      const last=page.at(-1);
      return json({projects:page.map(rowJson), next:rows.results.length>100 && last ? {before:last.updated_at,afterId:last.id} : null});
    }
    if (request.method === 'POST') {
      if(channel!=='benin-tv')throw new HttpError(422,'Ajoutez des modèles approuvés pour cette chaîne avant de créer un projet.');
      const input = createSchema.parse(await readJson(request));
      const template = getTemplate(input.templateId);
      const data = validateProjectData(template,{...templateDefaults(template),...input.data});
      await mediaReady(env.DB,template,data);
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by,channel_id) VALUES(?,?,?,?,?,?,?,?,?)')
        .bind(id,input.title,template.id,template.version,template.libraryVersion,JSON.stringify(data),member.email,member.email,channel).run();
      return json(rowJson(await findProject(env.DB,id,member)),201);
    }
  }
  const route = pathname.match(/^\/api\/projects\/([^/]+)(?:\/(revisions|status|archive|comments|delivery|export|sharing))?$/);
  if (!route) return null;
  const [,id,action] = route, row = await findProject(env.DB,id,member,request);
  if(action==='sharing'&&request.method==='POST'){
    if(row.created_by.toLowerCase()!==member.email.toLowerCase()&&!canApprove(member.role))throw new HttpError(403,'Seul l’auteur, un administrateur ou un diffuseur peut changer le partage.');
    const input=z.object({revision:z.number().int().positive(),visibility:z.enum(['private','team'])}).strict().parse(await readJson(request));
    const changed=await env.DB.prepare("UPDATE projects SET visibility=?,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=? RETURNING *").bind(input.visibility,member.email,id,input.revision).first<ProjectRow>();
    if(!changed)throw new HttpError(409,'Le projet a changé. Rechargez avant de modifier son partage.');
    return json(rowJson(changed));
  }
  if (!action && request.method === 'GET') return json(rowJson(row));
  if (!action && request.method === 'PUT') {
    if (row.archived) throw new HttpError(409,'Restaurer le projet avant modification.');
    const input = saveSchema.parse(await readJson(request));
    const template = getTemplate(row.template_id);
    if (template.version !== row.template_version || template.libraryVersion !== row.library_version) throw new HttpError(409,'Cette version du modèle doit rester disponible pour modifier ce projet.');
    const data = validateProjectData(template,input.data); await mediaReady(env.DB,template,data);
    const changed = await env.DB.prepare("UPDATE projects SET title=?,data_json=?,status='draft',revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=? AND archived=0 RETURNING *")
      .bind(input.title,JSON.stringify(data),member.email,id,input.revision).first<ProjectRow>();
    if (!changed) throw new HttpError(409,'Un collègue a modifié ce projet. Rechargez sa version avant de fusionner vos changements.');
    return json(rowJson(changed));
  }
  if (action === 'status' && request.method === 'POST') {
    if (row.archived) throw new HttpError(409,'Projet archivé.');
    const input = statusSchema.parse(await readJson(request));
    if (['approved','rejected'].includes(input.status) && !canApprove(member.role)) throw new HttpError(403,'Seul un diffuseur ou administrateur peut valider/rejeter.');
    if (input.revision !== row.revision) throw new HttpError(409,'La version a changé. Rechargez avant de valider.');
    if (['approved','rejected'].includes(input.status) && row.status !== 'submitted') throw new HttpError(409,'Le projet doit être soumis avant décision.');
    if (input.status === 'submitted' || input.status === 'approved') {
      const template=getTemplate(row.template_id),data=validateProjectData(template,JSON.parse(row.data_json));
      await mediaReady(env.DB,template,data);
      if (row.template_id === 'BTV_Passerelle_Replay' && !data._replay_url) throw new HttpError(422,'Renseignez le lien du QR code avant soumission.');
    }
    const changed = await env.DB.prepare("UPDATE projects SET status=?,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=? AND archived=0 RETURNING *")
      .bind(input.status,member.email,id,input.revision).first<ProjectRow>();
    if (!changed) throw new HttpError(409,'La version a changé. Rechargez avant de valider.');
    return json(rowJson(changed));
  }
  if (action === 'archive' && request.method === 'POST') {
    const input = z.object({revision:z.number().int().positive(),archived:z.boolean()}).strict().parse(await readJson(request));
    if (!canApprove(member.role) && row.created_by !== member.email) throw new HttpError(403,'Archivage réservé à l’auteur ou au diffuseur.');
    const changed = await env.DB.prepare("UPDATE projects SET archived=?,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=? RETURNING *")
      .bind(input.archived?1:0,member.email,id,input.revision).first<ProjectRow>();
    if (!changed) throw new HttpError(409,'Le projet a changé. Rechargez.');
    return json(rowJson(changed));
  }
  if (action === 'revisions' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT revision,title,status,data_json,actor,created_at FROM revisions WHERE project_id=? ORDER BY revision DESC LIMIT 100').bind(id).all<{revision:number;title:string;status:string;data_json:string;actor:string;created_at:string}>();
    return json(rows.results.map(({data_json,...r})=>({...r,data:JSON.parse(data_json)})));
  }
  if (action === 'comments') {
    if (request.method === 'GET') return json((await env.DB.prepare('SELECT id,revision,author,body,created_at FROM comments WHERE project_id=? ORDER BY created_at DESC LIMIT 100').bind(id).all()).results);
    if (request.method === 'POST') {
      const input = z.object({body:z.string().trim().min(1).max(2000),revision:z.number().int().positive()}).strict().parse(await readJson(request));
      if (input.revision !== row.revision) throw new HttpError(409,'Le projet a changé. Rechargez avant de commenter.');
      await env.DB.prepare('INSERT INTO comments(id,project_id,revision,author,body) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,row.revision,member.email,input.body).run();
      return json({ok:true},201);
    }
  }
  // A personal download is a snapshot, not an approval or a shared-project write.
  // Keep the separate, approved delivery endpoint for broadcast workflows.
  if (action === 'export' && request.method === 'POST') {
    const input = saveSchema.parse(await readJson(request));
    if(input.revision>row.revision)throw new HttpError(409,'Révision de départ inconnue. Rouvrez le projet.');
    const data=validateProjectData(getTemplate(row.template_id),input.data);
    await mediaReady(env.DB,getTemplate(row.template_id),data);
    try {
      const plan=await deliveryPlan({...rowJson(row),title:input.title,revision:input.revision,data},env.DB);
      const snapshot={id:crypto.randomUUID(),createdAt:new Date().toISOString(),purpose:'working-copy' as const};
      return json({...plan,snapshot,filename:`${row.template_id}_${id}_export_${snapshot.id.slice(0,8)}.zip`});
    } catch(error) { throw new HttpError(422,error instanceof Error?error.message:'Export incomplet.'); }
  }
  if (action === 'delivery' && request.method === 'GET') {
    if (!canApprove(member.role) || row.status !== 'approved' || row.archived) throw new HttpError(403,'Une livraison nécessite une version validée et un compte diffuseur.');
    if(Number(url.searchParams.get('revision'))!==row.revision)throw new HttpError(409,'La version du projet a changé. Rechargez avant de préparer le paquet.');
    await mediaReady(env.DB,getTemplate(row.template_id),JSON.parse(row.data_json));
    try{return json(await deliveryPlan(rowJson(row),env.DB));}catch(error){throw new HttpError(422,error instanceof Error?error.message:'Livraison incomplète.');}
  }
  throw new HttpError(405,'Action non disponible.');
}
