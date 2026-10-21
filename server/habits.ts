import {z} from 'zod';
import type {Member} from '../src/studio/domain';
import {canApprove} from '../src/studio/domain';
import {normalized,planSchema,plannerKinds} from '../src/studio/day-planner-model';
import {requestChannel} from './channel-access';
import {HttpError,json,readJson} from './http';
const candidateSchema=z.object({name:z.string().max(200),kinds:z.array(z.enum(plannerKinds)).max(5),directoryId:z.uuid().nullable()}).strict();
export async function habitRoutes(request:Request,env:Env,member:Member){
 const path=new URL(request.url).pathname;if(!path.startsWith('/api/habits'))return null;const channel=requestChannel(request);
 if(path==='/api/habits/confirm'&&request.method==='POST'){
  const input=z.object({planId:z.uuid(),revision:z.number().int().positive()}).strict().parse(await readJson(request));
  const record=await env.DB.prepare("SELECT data_json,revision FROM planner_documents WHERE id=? AND channel_id=? AND kind='plan' AND archived=0").bind(input.planId,channel).first<{data_json:string;revision:number}>();
  if(!record||record.revision!==input.revision)throw new HttpError(409,'Enregistrez la préparation actuelle avant de confirmer vos habitudes.');
  const plan=planSchema.parse(JSON.parse(record.data_json)),candidates=new Map<string,{candidate:string;conflict:boolean}>();
  for(const row of plan.rows.filter(r=>r.included&&!r.sourceRemoved)){
   const programme=normalized(row.title);if(!programme)continue;
   const candidate=JSON.stringify({name:row.title.toLocaleUpperCase('fr'),kinds:[...new Set(row.kinds)].sort(),directoryId:row.location?.directoryId??null}),old=candidates.get(programme);
   candidates.set(programme,{candidate,conflict:!!old&&(old.conflict||old.candidate!==candidate)});
  }
  const items=[...candidates].filter(([,item])=>!item.conflict);if(items.length>600)throw new HttpError(413,'Trop de programmes.');
  for(let offset=0;offset<items.length;offset+=50){
   const batch=items.slice(offset,offset+50),results=await env.DB.batch(batch.map(([programme,{candidate}])=>env.DB.prepare("INSERT INTO habit_observations(channel_id,programme,source_hash,plan_id,plan_revision,candidate,actor) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM planner_documents WHERE id=? AND revision=? AND archived=0) ON CONFLICT(channel_id,programme,source_hash) DO UPDATE SET plan_id=excluded.plan_id,plan_revision=excluded.plan_revision,candidate=excluded.candidate,actor=excluded.actor,confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(channel,programme,plan.sourceHash,input.planId,input.revision,candidate,member.email,input.planId,input.revision)));
   if(results.some(result=>!result.meta.changes))throw new HttpError(409,'La préparation a changé pendant la confirmation. Actualisez avant de confirmer la nouvelle version.');
  }
  return json({confirmed:items.length,ambiguous:candidates.size-items.length});
 }
 if(path==='/api/habits'&&request.method==='GET'){
  const rows=await env.DB.prepare(`SELECT o.programme,o.candidate,COUNT(DISTINCT o.source_hash) AS confirmations,d.id AS decisionId,d.revision,CASE WHEN d.candidate=o.candidate THEN d.state ELSE NULL END AS state,d.rule_id AS ruleId,d.rule_revision AS ruleRevision
   FROM habit_observations o LEFT JOIN habit_decisions d ON d.channel_id=o.channel_id AND d.programme=o.programme
   WHERE o.channel_id=? GROUP BY o.programme,o.candidate HAVING COUNT(DISTINCT o.source_hash)>=3 ORDER BY o.programme LIMIT 200`).bind(channel).all<{programme:string;candidate:string;confirmations:number;decisionId:string|null;revision:number|null;state:string|null;ruleId:string|null;ruleRevision:number|null}>();
  return json({suggestions:rows.results.map(r=>({...r,candidate:JSON.parse(r.candidate)}))});
 }
 if(path==='/api/habits/decide'&&request.method==='POST'){
  if(!canApprove(member.role))throw new HttpError(403,'L’approbation des habitudes partagées est réservée aux administrateurs et diffuseurs.');
  const input=z.object({programme:z.string().min(1).max(200),candidate:candidateSchema,revision:z.number().int().nonnegative(),action:z.enum(['approve','disable','forget'])}).strict().parse(await readJson(request));
  const prior=await env.DB.prepare('SELECT id,revision,rule_id,rule_revision,candidate FROM habit_decisions WHERE channel_id=? AND programme=?').bind(channel,input.programme).first<{id:string;revision:number;rule_id:string|null;rule_revision:number|null;candidate:string}>();
  if((prior?.revision??0)!==input.revision)throw new HttpError(409,'Cette habitude a changé. Actualisez.');
  const candidate=JSON.stringify(input.candidate),decisionId=prior?.id||crypto.randomUUID(),statements:D1PreparedStatement[]=[],guards:string[]=[];let ruleId=prior?.rule_id||null,ruleRevision=prior?.rule_revision??null;
  if(ruleId){
   const rule=await env.DB.prepare("SELECT revision FROM planner_documents WHERE id=? AND channel_id=? AND kind='rule'").bind(ruleId,channel).first<{revision:number}>();
   if(!rule||rule.revision!==ruleRevision)throw new HttpError(409,'Cette règle a été modifiée manuellement. Retrouvez-la dans les recettes pour conserver ces choix.');
  }
  function assertWrite(){const id=crypto.randomUUID();guards.push(id);return env.DB.prepare('INSERT INTO habit_write_guards(id,matched) VALUES(?,changes())').bind(id);}
  if(input.action==='approve'){
   const count=await env.DB.prepare('SELECT COUNT(DISTINCT source_hash) AS n FROM habit_observations WHERE channel_id=? AND programme=? AND candidate=?').bind(channel,input.programme,candidate).first<{n:number}>();
   if((count?.n??0)<3)throw new HttpError(409,'Cette proposition n’a pas trois confirmations cohérentes.');
   if(!ruleId&&await env.DB.prepare("SELECT 1 FROM planner_documents WHERE channel_id=? AND kind='rule' AND archived=0 AND (json_extract(data_json,'$.programme')=? OR json_extract(data_json,'$.family')=?)").bind(channel,input.programme,input.programme).first())throw new HttpError(409,'Une règle existe déjà pour cette émission. Modifiez cette règle explicitement.');
   const data=JSON.stringify({kind:'rule',name:input.candidate.name.slice(0,120),programme:input.programme,family:input.programme,keywords:input.candidate.name,directoryId:input.candidate.directoryId,preferredPath:null,kinds:input.candidate.kinds});
   // Only recipes/folders generalise. No episode filename is ever learned here.
   if(ruleId)statements.push(env.DB.prepare("UPDATE planner_documents SET name=?,data_json=?,archived=0,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND channel_id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM planner_documents WHERE channel_id=? AND id<>? AND kind='rule' AND archived=0 AND (json_extract(data_json,'$.programme')=? OR json_extract(data_json,'$.family')=?))").bind(input.candidate.name.slice(0,120),data,member.email,ruleId,channel,ruleRevision,channel,ruleId,input.programme,input.programme));
   else{ruleId=crypto.randomUUID();statements.push(env.DB.prepare("INSERT INTO planner_documents(id,channel_id,kind,name,data_json,created_by,updated_by) SELECT ?,?,'rule',?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM planner_documents WHERE channel_id=? AND kind='rule' AND archived=0 AND (json_extract(data_json,'$.programme')=? OR json_extract(data_json,'$.family')=?))").bind(ruleId,channel,input.candidate.name.slice(0,120),data,member.email,member.email,channel,input.programme,input.programme));}
   statements.push(assertWrite());ruleRevision=(ruleRevision??0)+1;
  }else if(ruleId){statements.push(env.DB.prepare("UPDATE planner_documents SET archived=1,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND channel_id=? AND revision=?").bind(member.email,ruleId,channel,ruleRevision),assertWrite());ruleRevision=(ruleRevision??0)+1;}
  const state=input.action==='approve'?'approved':input.action==='disable'?'disabled':'forgotten';
  // A conditional decision write plus an assertion keeps the accompanying rule
  // transaction atomic if two reviewers act on the same revision.
  statements.push(prior?env.DB.prepare("UPDATE habit_decisions SET candidate=?,state=?,rule_id=?,rule_revision=?,revision=revision+1,actor=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=?").bind(candidate,state,ruleId,ruleRevision,member.email,decisionId,input.revision):env.DB.prepare('INSERT INTO habit_decisions(id,channel_id,programme,candidate,state,rule_id,rule_revision,actor) VALUES(?,?,?,?,?,?,?,?)').bind(decisionId,channel,input.programme,candidate,state,ruleId,ruleRevision,member.email),assertWrite());
  if(input.action==='forget')statements.push(env.DB.prepare('DELETE FROM habit_observations WHERE channel_id=? AND programme=?').bind(channel,input.programme));
  statements.push(...guards.map(id=>env.DB.prepare('DELETE FROM habit_write_guards WHERE id=?').bind(id)));
  try{await env.DB.batch(statements);}catch(error){if(/CHECK constraint|UNIQUE constraint/.test(String(error)))throw new HttpError(409,'Cette habitude a changé. Actualisez ; aucune règle partielle n’a été enregistrée.');throw error;}
  return json({ok:true});
 }
 throw new HttpError(405,'Action non disponible.');
}
