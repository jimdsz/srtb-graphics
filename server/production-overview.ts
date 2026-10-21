import {z} from 'zod';
import type {Member} from '../src/studio/domain';
import {dateSchema,plannerTaskChoice,taskKey} from '../src/studio/day-planner-model';
import type {ProductionOverviewItem,ProductionOverviewPage,ProductionOverviewState} from '../src/studio/production-overview-model';
import {HttpError,json} from './http';
import {requestChannel} from './channel-access';
import {projectAccessSql} from './project-access';

const inputSchema=z.object({view:z.enum(['mine','missing-media','review']),date:dateSchema,cursor:z.string().max(4000).optional()}).strict();
const cursorSchema=z.object({channel:z.string().max(64),view:inputSchema.shape.view,date:dateSchema,plan:z.uuid(),key:z.string().max(1000)}).strict();
const pageSize=30;
type RowSummary={id:string;title:string;date:string;broadcastDate:string;time:string;included:number;removed:number;kinds:string[];formats:string[]};
type StoredItem={planId:string;planName:string;planRevision:number;key:string;rowId?:string;title?:string;date?:string;broadcastDate?:string;time?:string;ownerName?:string;state?:string;projectId?:string|null;rows?:string;weekly?:string|null};
const states=new Set<string>(['assigned','draft','submitted','approved','rejected','archived']);
// Return only editorial row metadata. File names, paths, raw conductor text,
// private project titles and private identifiers never enter this response.
const rowsMetadata=`(SELECT json_group_array(json_object('id',json_extract(r.value,'$.id'),'title',json_extract(r.value,'$.title'),'date',json_extract(r.value,'$.airDate'),'broadcastDate',json_extract(r.value,'$.broadcastDate'),'time',json_extract(r.value,'$.time'),'included',json_extract(r.value,'$.included'),'removed',COALESCE(json_extract(r.value,'$.sourceRemoved'),0),'kinds',json(json_extract(r.value,'$.kinds')),'formats',json(json_extract(r.value,'$.formats')))) FROM json_each(d.data_json,'$.rows') r)`;

export async function productionOverviewRoutes(request:Request,env:Env,member:Member):Promise<Response|null>{
  const url=new URL(request.url);if(url.pathname!=='/api/planner/overview')return null;
  if(request.method!=='GET')throw new HttpError(405,'Action non disponible.');
  const input=inputSchema.parse(Object.fromEntries(url.searchParams)),channel=requestChannel(request);
  let afterPlan='',afterKey='';
  if(input.cursor){
    try{const cursor=cursorSchema.parse(JSON.parse(decodeURIComponent(input.cursor)));if(cursor.channel!==channel||cursor.view!==input.view||cursor.date!==input.date)throw Error();afterPlan=cursor.plan;afterKey=cursor.key;}
    catch{throw new HttpError(400,'La vue a changé. Actualisez sa première page.');}
  }
  let candidates:StoredItem[];
  if(input.view==='missing-media'){
    // A saved location is a media choice even when this browser has not granted
    // access yet. Availability is checked locally when opening the preparation.
    candidates=(await env.DB.prepare(`SELECT d.id AS planId,d.name AS planName,d.revision AS planRevision,json_extract(r.value,'$.id') AS key,json_extract(r.value,'$.id') AS rowId,json_extract(r.value,'$.title') AS title,json_extract(r.value,'$.airDate') AS date,json_extract(r.value,'$.broadcastDate') AS broadcastDate,json_extract(r.value,'$.time') AS time
      FROM planner_documents d,json_each(d.data_json,'$.rows') r
      WHERE d.channel_id=? AND d.kind='plan' AND d.archived=0 AND json_extract(r.value,'$.included')=1 AND COALESCE(json_extract(r.value,'$.sourceRemoved'),0)=0
      AND json_extract(r.value,'$.broadcastDate')=? AND json_extract(r.value,'$.media') IS NULL AND json_extract(r.value,'$.location') IS NULL
      AND (json_array_length(r.value,'$.kinds')>0 OR EXISTS(SELECT 1 FROM json_each(d.data_json,'$.weekly.rowIds') w WHERE w.value=json_extract(r.value,'$.id')))
      AND (d.id>? OR (d.id=? AND json_extract(r.value,'$.id')>?))
      ORDER BY d.id,json_extract(r.value,'$.id') LIMIT ?`).bind(channel,input.date,afterPlan,afterPlan,afterKey,pageSize+1).all<StoredItem>()).results;
  }else{
    const access=projectAccessSql(member,'p');
    // One newest edition per assigned task. The task key prefix is compared
    // literally, not via LIKE (row IDs may contain percent or underscores).
    candidates=(await env.DB.prepare(`SELECT d.id AS planId,d.name AS planName,d.revision AS planRevision,a.task_key AS key,m.name AS ownerName,
      CASE WHEN p.archived=1 THEN 'archived' ELSE COALESCE(p.status,'assigned') END AS state,
      CASE WHEN p.channel_id=d.channel_id AND ${access.sql} THEN p.id ELSE NULL END AS projectId,
      ${rowsMetadata} AS rows,json_extract(d.data_json,'$.weekly') AS weekly
      FROM planner_assignments a JOIN planner_documents d ON d.id=a.plan_id JOIN members m ON m.email=a.owner
      LEFT JOIN projects p ON p.id=(SELECT t.project_id FROM planner_personal_tasks t WHERE t.plan_id=a.plan_id AND t.actor=a.owner AND (t.task_key=a.task_key OR substr(t.task_key,1,length(a.task_key)+2)=a.task_key||':r') ORDER BY t.source_revision DESC,length(t.task_key) DESC,t.task_key DESC LIMIT 1) AND p.channel_id=d.channel_id
      WHERE d.channel_id=? AND d.kind='plan' AND d.archived=0
      AND EXISTS(SELECT 1 FROM json_each(d.data_json,'$.rows') dayrow WHERE json_extract(dayrow.value,'$.broadcastDate')=?)
      AND ${input.view==='mine'?'a.owner=?':`p.status='submitted' AND p.archived=0 AND ${access.sql}`}
      AND (d.id>? OR (d.id=? AND a.task_key>?)) ORDER BY d.id,a.task_key LIMIT ?`).bind(...access.values,channel,input.date,...(input.view==='mine'?[member.email]:access.values),afterPlan,afterPlan,afterKey,pageSize+1).all<StoredItem>()).results;
  }
  const consumed=candidates.slice(0,pageSize),items:ProductionOverviewItem[]=[];
  for(const candidate of consumed){
    const base={id:`${candidate.planId}:${candidate.key}`,planId:candidate.planId,planName:candidate.planName,planRevision:candidate.planRevision};
    if(input.view==='missing-media'){
      items.push({...base,rowId:candidate.rowId!,title:candidate.title!,date:candidate.date!,broadcastDate:candidate.broadcastDate!,time:candidate.time!,kind:null,format:null,ownerName:null,state:'missing-media'});continue;
    }
    const choice=plannerTaskChoice(candidate);if(!choice||choice.edition!==undefined)continue;
    const rows:RowSummary[]=JSON.parse(candidate.rows||'[]'),selected=choice.rowIds.map(id=>rows.find(row=>row.id===id));
    if(selected.some(row=>!row||row.included!==1||row.removed===1))continue;
    const first=selected[0]!;
    if(choice.kind==='weekly'){
      const weekly=candidate.weekly?JSON.parse(candidate.weekly):null;
      if(!weekly||taskKey({kind:'weekly',format:choice.format,rowIds:weekly.rowIds})!==candidate.key||!weekly.formats.includes(choice.format)||!selected.some(row=>row?.broadcastDate===input.date))continue;
    }else if(first.broadcastDate!==input.date||!first.kinds.includes(choice.kind)||!first.formats.includes(choice.format))continue;
    const focus=choice.kind==='weekly'?selected.find(row=>row?.broadcastDate===input.date)!:first;
    items.push({...base,rowId:focus.id,title:choice.kind==='weekly'?'Semainier':first.title,date:focus.date,broadcastDate:focus.broadcastDate,time:choice.kind==='weekly'?'':focus.time,kind:choice.kind,format:choice.format,ownerName:candidate.ownerName||null,state:(states.has(candidate.state||'')?candidate.state:'assigned') as ProductionOverviewState,...(candidate.projectId?{projectId:candidate.projectId}:{})});
  }
  const last=consumed.at(-1),next=candidates.length>pageSize&&last?encodeURIComponent(JSON.stringify({channel,view:input.view,date:input.date,plan:last.planId,key:last.key})):null;
  const page:ProductionOverviewPage={items,next,view:input.view,date:input.date};
  return json(page);
}
