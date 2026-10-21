import {z} from 'zod';
import type {Member,ProjectStatus} from '../src/studio/domain';
import {canApprove} from '../src/studio/domain';
import {dateSchema,plannerFormats,plannerKinds,plannerTaskChoice} from '../src/studio/day-planner-model';
import type {PlannerTaskChoice} from '../src/studio/day-planner-model';
import {productionLinksSections} from '../src/studio/production-links-model';
import type {ProductionCoordination,ProductionHistoricalOccurrence,ProductionLinkage,ProductionLinksItem,ProductionLinksPage,ProductionOccurrence,ProductionProjectItem,ProductionVisibleProject} from '../src/studio/production-links-model';
import {validateProductionLinksPage} from '../src/studio/production-links-validation';
import {authorizeChannel,requestChannel} from './channel-access';
import {projectAccessSql} from './project-access';
import {HttpError,json} from './http';

const PAGE=30,MAX_VISIBLE=2000,MAX_JSON=1024*1024;
const inputSchema=z.object({rowId:z.string().min(1).max(100),revision:z.coerce.number().int().positive(),section:z.enum(productionLinksSections),cursor:z.string().max(4096).optional()}).strict();
const cursorSchema=z.object({v:z.literal(1),channel:z.string().max(64),actor:z.string().max(254),plan:z.uuid(),revision:z.number().int().positive(),row:z.string().max(100),section:z.enum(productionLinksSections),snapshot:z.string().regex(/^[a-f0-9]{64}$/),after:z.string().max(100)}).strict();
const rowSchema=z.object({rowId:z.string().min(1).max(100),title:z.string().max(200),subtitle:z.string().max(400),airDate:dateSchema,broadcastDate:dateSchema,time:z.string().max(8),included:z.number().int().min(0).max(1),sourceRemoved:z.number().int().min(0).max(1),programmeId:z.uuid().nullable(),programmeRevision:z.number().int().positive().nullable(),kinds:z.array(z.enum(plannerKinds)).max(5),formats:z.array(z.enum(plannerFormats)).max(3)}).strict();
type Row=z.infer<typeof rowSchema>;
type PlanProjection={id:string;revision:number;name:string;bytes:number;rowCount:number;rows:string|null};
type Candidate={id:string;taskKey:string;sourceRevision:number;title:string;templateId:string;templateVersion:string;libraryVersion:string;revision:number;status:ProjectStatus;archived:number;format:string|null;rootId:string;rootTitle:string;rootTemplateId:string;rootTemplateVersion:string;rootLibraryVersion:string;rootRevision:number;rootStatus:ProjectStatus;rootArchived:number;rootFormat:string|null;batchId:string|null;batchName:string|null;batchSourceRevision:number|null;targetKey:string|null;label:string|null;announcement:string|null};
type Marker={id:string;revision:number;status:string;archived:number;title:string;format:string|null;taskKey:string;sourceRevision:number;rootId:string;rootRevision:number;rootStatus:string;rootArchived:number;batchId:string|null};
type Historical={revision:number;rowId:string;historyBytes:number|null;historyRows:number|null;historyExists:number;row:string|null};
type Coordination={key:string;ownerName:string;state:string;revision:number};
const changed=()=>new HttpError(409,'Le dossier a changé. Actualisez sa première page ; vos retouches restent conservées.');
function parseBounded<T>(raw:string,schema:z.ZodType<T>):T{
  if(new TextEncoder().encode(raw).byteLength>MAX_JSON)throw new HttpError(413,'Ce dossier dépasse la limite de lecture. Aucune liste partielle n’est présentée.');
  try{return schema.parse(JSON.parse(raw));}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(409,'Les références du dossier sont incohérentes. Rechargez la préparation ou contactez l’administration.');}
}
async function digest(value:unknown){
  const raw=JSON.stringify(value);if(new TextEncoder().encode(raw).byteLength>MAX_JSON)throw new HttpError(413,'Ce dossier dépasse la limite de lecture. Aucune liste partielle n’est présentée.');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),b=>b.toString(16).padStart(2,'0')).join('');
}
// Explicit metadata only, including inside SQL: no project or conductor media,
// raw text, paths, voice metadata, snapshots or data_json crosses this boundary.
const rowMetadata=(alias:string)=>`json_object('rowId',json_extract(${alias}.value,'$.id'),'title',json_extract(${alias}.value,'$.title'),'subtitle',json_extract(${alias}.value,'$.subtitle'),'airDate',json_extract(${alias}.value,'$.airDate'),'broadcastDate',json_extract(${alias}.value,'$.broadcastDate'),'time',json_extract(${alias}.value,'$.time'),'included',json_extract(${alias}.value,'$.included'),'sourceRemoved',COALESCE(json_extract(${alias}.value,'$.sourceRemoved'),0),'programmeId',json_extract(${alias}.value,'$.programmeId'),'programmeRevision',json_extract(${alias}.value,'$.programmeRevision'),'kinds',json(json_extract(${alias}.value,'$.kinds')),'formats',json(json_extract(${alias}.value,'$.formats')))`;
const occurrence=(row:Row):ProductionOccurrence=>({rowId:row.rowId,title:row.title,subtitle:row.subtitle,airDate:row.airDate,broadcastDate:row.broadcastDate,time:row.time,included:row.included===1,sourceRemoved:row.sourceRemoved===1,programmeRevision:row.programmeRevision});
const format=(value:string|null)=>plannerFormats.find(item=>item===value)??null;
function project(row:Candidate,root=false):ProductionVisibleProject{
  return root?{id:row.rootId,title:row.rootTitle,templateId:row.rootTemplateId,templateVersion:row.rootTemplateVersion,libraryVersion:row.rootLibraryVersion,revision:row.rootRevision,status:row.rootStatus,archived:!!row.rootArchived,format:format(row.rootFormat)}:
    {id:row.id,title:row.title,templateId:row.templateId,templateVersion:row.templateVersion,libraryVersion:row.libraryVersion,revision:row.revision,status:row.status,archived:!!row.archived,format:format(row.format)};
}
const announcementSchema=z.object({key:z.string().max(30),day:z.string().max(30),time:z.string().max(8),format:z.enum(plannerFormats)}).strict();

export async function productionLinksRoutes(request:Request,env:Env,member:Member):Promise<Response|null>{
  const url=new URL(request.url),match=url.pathname.match(/^\/api\/planner\/([a-f0-9-]{36})\/production-links$/);if(!match)return null;
  if(request.method!=='GET')throw new HttpError(405,'Le dossier de production est en lecture seule.');
  if(member.active!==1||!['admin','designer','broadcaster'].includes(member.role))throw new HttpError(403,'Compte actif nécessaire.');
  const id=z.uuid().parse(match[1]),input=inputSchema.parse(Object.fromEntries(url.searchParams)),channel=requestChannel(request);
  const currentMember=async()=>{const current=await env.DB.prepare('SELECT role,active FROM members WHERE email=? COLLATE NOCASE').bind(member.email).first<{role:string;active:number}>();if(!current||current.active!==1||current.role!==member.role)throw new HttpError(403,'Votre accès a changé. Reconnectez-vous avant de consulter ce dossier.');await authorizeChannel(env.DB,member,channel);};
  await currentMember();
  if(input.section==='derivations'&&(typeof __SRTB_DERIVATIONS__==='undefined'||!__SRTB_DERIVATIONS__))throw new HttpError(422,'Les déclinaisons ne sont pas disponibles dans cette version du Studio.');
  let cursor:z.infer<typeof cursorSchema>|undefined;
  if(input.cursor){try{cursor=cursorSchema.parse(JSON.parse(decodeURIComponent(input.cursor)));}catch{throw changed();}
    if(cursor.channel!==channel||cursor.actor!==member.email||cursor.plan!==id||cursor.revision!==input.revision||cursor.row!==input.rowId||cursor.section!==input.section)throw changed();}
  const readPlan=()=>env.DB.prepare(`SELECT d.id,d.revision,d.name,length(CAST(d.data_json AS BLOB)) AS bytes,json_array_length(d.data_json,'$.rows') AS rowCount,
    CASE WHEN length(CAST(d.data_json AS BLOB))<=? AND json_array_length(d.data_json,'$.rows') BETWEEN 1 AND 600 THEN
    (SELECT json_group_array(${rowMetadata('r')}) FROM json_each(d.data_json,'$.rows') r) ELSE NULL END AS rows
    FROM planner_documents d WHERE d.id=? AND d.channel_id=? AND d.kind='plan' AND d.archived=0`).bind(MAX_JSON,id,channel).first<PlanProjection>();
  const saved=await readPlan();if(!saved)throw new HttpError(404,'Préparation introuvable ou archivée.');
  if(saved.revision!==input.revision)throw changed();
  if(saved.bytes>MAX_JSON||saved.rowCount>600||!saved.rows)throw new HttpError(413,'Cette préparation dépasse la limite de lecture du dossier.');
  const rows=parseBounded(saved.rows,z.array(rowSchema).min(1).max(600)),anchor=rows.find(row=>row.rowId===input.rowId);if(!anchor)throw new HttpError(404,'Ligne introuvable dans cette préparation.');
  if(new Set(rows.map(row=>row.rowId)).size!==rows.length)throw changed();
  if(anchor.programmeId&&!await env.DB.prepare('SELECT id FROM programmes WHERE id=? AND channel_id=?').bind(anchor.programmeId,channel).first())throw changed();
  const selected=rows.filter(row=>anchor.programmeId?row.programmeId===anchor.programmeId:row.rowId===anchor.rowId),selectedIds=new Set(selected.map(row=>row.rowId));
  const access=projectAccessSql(member,'p'),childAccess=projectAccessSql(member,'c');
  const derived=input.section==='derivations';
  // Batch access deliberately stays as strict as the existing batch API. An
  // independently shared child never discloses a private parent or sibling.
  const cte=`WITH visible AS (SELECT ${derived?'c':'p'}.id AS id,t.task_key AS taskKey,t.source_revision AS sourceRevision,
    ${derived?'c':'p'}.title AS title,${derived?'c':'p'}.template_id AS templateId,${derived?'c':'p'}.template_version AS templateVersion,${derived?'c':'p'}.library_version AS libraryVersion,
    ${derived?'c':'p'}.revision AS revision,${derived?'c':'p'}.status AS status,${derived?'c':'p'}.archived AS archived,
    CASE WHEN json_type(${derived?'c':'p'}.data_json,'$._studio_format')='text' THEN substr(json_extract(${derived?'c':'p'}.data_json,'$._studio_format'),1,20) ELSE NULL END AS format,
    p.id AS rootId,p.title AS rootTitle,p.template_id AS rootTemplateId,p.template_version AS rootTemplateVersion,p.library_version AS rootLibraryVersion,p.revision AS rootRevision,p.status AS rootStatus,p.archived AS rootArchived,CASE WHEN json_type(p.data_json,'$._studio_format')='text' THEN substr(json_extract(p.data_json,'$._studio_format'),1,20) ELSE NULL END AS rootFormat,
    ${derived?`b.id AS batchId,b.name AS batchName,b.source_revision AS batchSourceRevision,d.target_key AS targetKey,d.label AS label,
    CASE WHEN d.announcement_json IS NOT NULL THEN json_object('key',json_extract(d.announcement_json,'$.key'),'day',json_extract(d.announcement_json,'$.day'),'time',json_extract(d.announcement_json,'$.time'),'format',json_extract(d.announcement_json,'$.format')) ELSE NULL END AS announcement`:`NULL AS batchId,NULL AS batchName,NULL AS batchSourceRevision,NULL AS targetKey,NULL AS label,NULL AS announcement`}
    FROM planner_personal_tasks t JOIN projects p ON p.id=t.project_id
    ${derived?'JOIN derivation_batches b ON b.source_project_id=p.id JOIN project_derivations d ON d.batch_id=b.id JOIN projects c ON c.id=d.project_id':''}
    WHERE t.plan_id=? AND p.channel_id=? AND ${access.sql}
    ${derived?`AND c.channel_id=? AND ${childAccess.sql} AND (b.created_by=? COLLATE NOCASE OR ?=1)`:input.section==='weekly'?"AND substr(t.task_key,1,7)='weekly:'":"AND substr(t.task_key,1,7)<>'weekly:'"})`;
  const args=[id,channel,...access.values,...(derived?[channel,...childAccess.values,member.email,Number(canApprove(member.role))]:[])];
  const markerQuery=()=>env.DB.prepare(`${cte} SELECT id,revision,status,archived,title,format,taskKey,sourceRevision,rootId,rootRevision,rootStatus,rootArchived,batchId FROM visible ORDER BY id LIMIT ?`).bind(...args,MAX_VISIBLE+1).all<Marker>();
  const coordinationQuery=()=>env.DB.prepare(`SELECT a.task_key AS key,m.name AS ownerName,a.revision,
    COALESCE((SELECT CASE WHEN p.archived=1 THEN 'archived' ELSE p.status END FROM planner_personal_tasks t JOIN projects p ON p.id=t.project_id AND p.channel_id=? WHERE t.plan_id=a.plan_id AND t.actor=a.owner AND (t.task_key=a.task_key OR substr(t.task_key,1,length(a.task_key)+2)=a.task_key||':r') ORDER BY t.source_revision DESC,length(t.task_key) DESC,t.task_key DESC LIMIT 1),'assigned') AS state
    FROM planner_assignments a JOIN members m ON m.email=a.owner WHERE a.plan_id=? ORDER BY a.task_key LIMIT ?`).bind(channel,id,MAX_VISIBLE+1).all<Coordination>();
  const evidence=input.section==='occurrences'?(await coordinationQuery()).results:(await markerQuery()).results;
  if(evidence.length>MAX_VISIBLE)throw new HttpError(413,'Plus de 2 000 éléments visibles dans cette section. Aucune liste partielle n’est présentée.');
  const snapshot=await digest({plan:saved,rows:evidence});if(cursor&&cursor.snapshot!==snapshot)throw changed();
  const items:ProductionLinksItem[]=[];let nextAfter:string|null=null;
  if(input.section==='occurrences'){
    const ordered=[...selected].sort((a,b)=>a.rowId.localeCompare(b.rowId,'en')),after=cursor?.after;
    if(after&&!ordered.some(row=>row.rowId===after))throw changed();
    const start=after?ordered.findIndex(row=>row.rowId===after)+1:0,page=ordered.slice(start,start+PAGE);
    const coordination=evidence as Coordination[];
    for(const row of page){const tasks:ProductionCoordination[]=[];
      for(const item of coordination){const choice=plannerTaskChoice(item);if(!choice||choice.edition!==undefined||choice.kind==='weekly'||choice.rowIds[0]!==row.rowId)continue;
        if(!row.included||row.sourceRemoved||!row.kinds.includes(choice.kind)||!row.formats.includes(choice.format))continue;
        const states=['draft','submitted','approved','rejected','archived','assigned'] as const;
        tasks.push({key:item.key,kind:choice.kind,format:choice.format,ownerName:item.ownerName,state:states.find(state=>state===item.state)??'unknown'});
      }
      items.push({type:'occurrence',id:row.rowId,occurrence:occurrence(row),coordination:tasks});
    }
    if(start+PAGE<ordered.length)nextAfter=page.at(-1)!.rowId;
  }else{
    if(cursor&&!evidence.some(item=>'id'in item&&item.id===cursor.after))throw changed();
    const result=await env.DB.prepare(`${cte} SELECT * FROM visible WHERE id>? ORDER BY id LIMIT ?`).bind(...args,cursor?.after??'',PAGE+1).all<Candidate>();
    const candidates=result.results.slice(0,PAGE),choices=new Map<string,PlannerTaskChoice>(),wanted=new Map<string,{revision:number;rowId:string}>();
    for(const candidate of candidates){const choice=plannerTaskChoice({key:candidate.taskKey});if(!choice)continue;choices.set(candidate.id,choice);for(const rowId of choice.rowIds)wanted.set(`${candidate.sourceRevision}:${rowId}`,{revision:candidate.sourceRevision,rowId});}
    const historical=new Map<string,Row|null>();
    if(wanted.size){
      const requested=JSON.stringify([...wanted.values()]);
      const history=await env.DB.prepare(`WITH wanted AS (SELECT json_extract(value,'$.revision') AS revision,json_extract(value,'$.rowId') AS rowId FROM json_each(?))
        SELECT w.revision,w.rowId,length(CAST(h.data_json AS BLOB)) AS historyBytes,json_array_length(h.data_json,'$.rows') AS historyRows,CASE WHEN h.document_id IS NULL THEN 0 ELSE 1 END AS historyExists,
        CASE WHEN r.value IS NULL THEN NULL ELSE ${rowMetadata('r')} END AS row
        FROM wanted w LEFT JOIN planner_revisions h ON h.document_id=? AND h.revision=w.revision
        LEFT JOIN json_each(CASE WHEN length(CAST(h.data_json AS BLOB))<=? AND json_array_length(h.data_json,'$.rows')<=600 THEN h.data_json ELSE '{"rows":[]}' END,'$.rows') r ON json_extract(r.value,'$.id')=w.rowId`).bind(requested,id,MAX_JSON).all<Historical>();
      if(history.results.length>wanted.size)throw changed();
      for(const h of history.results){if((h.historyBytes??0)>MAX_JSON||(h.historyRows??0)>600)throw new HttpError(413,'Une révision historique dépasse la limite de lecture.');historical.set(`${h.revision}:${h.rowId}`,h.row?parseBounded(h.row,rowSchema):null);}
    }
    for(const candidate of candidates){
      const choice=choices.get(candidate.id);if(!choice)continue;
      const origins:ProductionHistoricalOccurrence[]=choice.rowIds.map(rowId=>{const old=historical.get(`${candidate.sourceRevision}:${rowId}`);const linkage:ProductionLinkage=!old?'missing-history':!anchor.programmeId?'line-only':!old.programmeId?'undocumented':old.programmeId===anchor.programmeId?'same-programme':'different-programme';return {rowId,linkage,occurrence:old?occurrence(old):null};});
      // Historical membership OR a currently selected row: the latter is kept
      // separately, explicitly not reassigned to this programme after a relink.
      if(!origins.some(origin=>origin.linkage==='same-programme'||selectedIds.has(origin.rowId)))continue;
      const relevant=origins.filter(origin=>origin.linkage==='same-programme'||selectedIds.has(origin.rowId));
      const linkage:ProductionLinkage=anchor.programmeId?(relevant.some(origin=>origin.linkage==='same-programme')?'same-programme':relevant.some(origin=>origin.linkage==='missing-history')?'missing-history':relevant.some(origin=>origin.linkage==='undocumented')?'undocumented':'different-programme'):'line-only';
      const item:ProductionProjectItem={type:'project',id:candidate.id,relation:derived?'derived':choice.kind==='weekly'?'weekly':'direct',taskKey:candidate.taskKey,kind:choice.kind,format:choice.format,sourceRevision:candidate.sourceRevision,edition:choice.edition??null,origins,linkage,project:project(candidate)};
      if(derived){if(!candidate.batchId||!candidate.batchName||!candidate.targetKey||!candidate.label||!candidate.batchSourceRevision)throw changed();item.derivation={batchId:candidate.batchId,batchName:candidate.batchName,sourceProject:project(candidate,true),sourceRevision:candidate.batchSourceRevision,targetKey:candidate.targetKey,label:candidate.label,announcement:candidate.announcement?parseBounded(candidate.announcement,announcementSchema):null};}
      items.push(item);
    }
    if(result.results.length>PAGE)nextAfter=candidates.at(-1)!.id;
  }
  // Re-read both guards before returning. No partial page from a changed plan,
  // revoked sharing, edited project, newly added edition or changed assignment.
  const [fresh,freshEvidence]=await Promise.all([readPlan(),input.section==='occurrences'?coordinationQuery():markerQuery()]);
  if(!fresh||freshEvidence.results.length>MAX_VISIBLE||await digest({plan:fresh,rows:freshEvidence.results})!==snapshot)throw changed();
  await currentMember();
  const next=nextAfter?encodeURIComponent(JSON.stringify({v:1,channel,actor:member.email,plan:id,revision:input.revision,row:input.rowId,section:input.section,snapshot,after:nextAfter})):null;
  const page:ProductionLinksPage={context:{channelId:channel,planId:id,planRevision:saved.revision,planName:saved.name,rowId:anchor.rowId,scope:anchor.programmeId?'programme':'line',programmeId:anchor.programmeId,title:anchor.title,snapshot},section:input.section,items,next};
  if(new TextEncoder().encode(JSON.stringify(page)).byteLength>MAX_JSON)throw new HttpError(413,'Cette page dépasse la limite de lecture.');
  return json(validateProductionLinksPage(page));
}
