import {z} from 'zod';
import {profileAssetSchema} from './preparation-profile-model';
import {scoreMedia} from './media-match-score';
import {plannerVoicesSchema,plannerVoiceSchema} from './planner-voice-model';

export const PLANNER_VERSION='planning-1';
// Keep aligned with the per-person guard in migration 0006.
export const MAX_PLANNER_TASKS=2000;
export const plannerKinds=['ba','popup','tds','renvoi','event'] as const;
export const plannerLabels:Record<typeof plannerKinds[number],string>={ba:'Bande-annonce',popup:'Pop-up',tds:'Tout de suite',renvoi:'Renvoi',event:'Événement'};
export const plannerFormats=['tv','portrait','vertical'] as const;
const text=(max:number)=>z.string().max(max);
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const date=new Date(v+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===v;},'Date invalide.');
export const timeSchema=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
export const relativePathSchema=text(500).min(1).refine(v=>!v.startsWith('/')&&!v.includes('\\')&&!v.includes(':')&&!/[\x00-\x1f]/.test(v)&&v.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Chemin relatif invalide.');
export const indexedMediaSchema=z.object({path:relativePathSchema,name:text(200).min(1),size:z.number().int().positive().max(64*1024**3),modified:z.number().int().nonnegative()}).strict();
export type IndexedMedia=z.infer<typeof indexedMediaSchema>;
export const mediaLocationSchema=z.object({directoryId:z.uuid(),path:relativePathSchema,size:z.number().int().positive(),modified:z.number().int().nonnegative()}).strict();
export const plannerExcerptSchema=z.object({source:z.string().max(200),start:z.number().finite().min(0).max(86400),end:z.number().finite().positive().max(86400),duration:z.number().finite().positive()}).strict()
  .refine(v=>v.end-v.start>=.04-1e-7&&v.end<=v.duration+1e-7,'Le passage doit tenir dans le fichier et durer au moins une image.');
export type PlannerExcerpt=z.infer<typeof plannerExcerptSchema>;
export const plannerRowSchema=z.object({
  id:text(100).min(1),sheet:text(100),cell:text(30),raw:text(2000),
  broadcastDate:dateSchema,airDate:dateSchema,time:z.union([timeSchema,z.literal('')]),duration:z.number().nonnegative().max(86400).nullable(),
  title:text(200).min(1),subtitle:text(400),category:text(80),included:z.boolean(),
  issues:z.array(text(240)).max(15),kinds:z.array(z.enum(plannerKinds)).max(5),formats:z.array(z.enum(plannerFormats)).min(1).max(3),
  media:profileAssetSchema.nullable(),location:mediaLocationSchema.nullable(),
  logo:profileAssetSchema.refine(value=>['image/png','image/jpeg','image/webp'].includes(value.mimeType),'Choisissez un logo PNG, JPEG ou WebP.').nullable().optional(),
  excerpt:plannerExcerptSchema.nullable().optional(),
  voices:plannerVoicesSchema.optional(),
  programmeId:z.uuid().optional(),programmeRevision:z.number().int().positive().optional(),sourceRemoved:z.boolean().optional(),
}).strict().refine(v=>!v.excerpt||v.media?.mimeType.startsWith('video/')&&v.excerpt.source===v.media.url,'Le passage ne correspond pas au média sélectionné.');
export type PlannerRow=z.infer<typeof plannerRowSchema>;
export function patchPlannerRow(row:PlannerRow,patch:Partial<PlannerRow>):PlannerRow{
  const next={...row,...patch};
  if(Object.hasOwn(patch,'media')&&(next.media?.url!==row.media?.url||!next.media?.mimeType.startsWith('video/')))next.excerpt=null;
  return next;
}
export const plannerWeeklySchema=z.object({
  startDate:dateSchema.refine(v=>v<='9999-12-25','La période doit contenir sept dates valides.').optional(),
  voice:plannerVoiceSchema.optional(),
  rowIds:z.array(text(100).min(1)).max(7).refine(ids=>new Set(ids).size===ids.length,'Un programme ne peut apparaître deux fois dans le semainier.'),
  formats:z.array(z.enum(plannerFormats)).min(1).max(3).refine(formats=>new Set(formats).size===formats.length,'Chaque format doit être unique.'),
}).strict();
export type PlannerWeekly=z.infer<typeof plannerWeeklySchema>;
export const planSchema=z.object({kind:z.literal('plan'),name:text(120).min(1),source:text(200),sourceHash:z.string().regex(/^[a-f\d]{64}$/),
  rows:z.array(plannerRowSchema).min(1).max(600).refine(r=>new Set(r.map(i=>i.id)).size===r.length),
  sourceRows:z.array(plannerRowSchema).max(600).optional(),
  weekly:plannerWeeklySchema.optional(),
}).strict().refine(plan=>!plan.weekly||plan.weekly.rowIds.every(id=>plan.rows.some(row=>row.id===id&&row.included)),'Le semainier doit utiliser des programmes retenus dans cette préparation.');
export const directorySchema=z.object({kind:z.literal('directory'),name:text(120).min(1),files:z.array(indexedMediaSchema).max(1000).refine(r=>new Set(r.map(i=>i.path)).size===r.length),scannedAt:z.iso.datetime(),partial:z.boolean()}).strict();
// An empty recipe is intentional (for example, a programme kept only in a
// semainier). Remember it exactly, not as a request for default graphics.
export const ruleSchema=z.object({kind:z.literal('rule'),name:text(120).min(1),programme:text(600).min(1),keywords:text(200),directoryId:z.uuid().nullable(),preferredPath:relativePathSchema.nullable(),kinds:z.array(z.enum(plannerKinds)).max(5),family:text(200).min(1).refine(v=>normalized(v)===v).optional()}).strict();
export const plannerDocumentSchema=z.discriminatedUnion('kind',[planSchema,directorySchema,ruleSchema]);
export type Plan=z.infer<typeof planSchema>;
export type DirectoryIndex=z.infer<typeof directorySchema>;
export type ProgrammeRule=z.infer<typeof ruleSchema>;
export type PlannerDocument=z.infer<typeof plannerDocumentSchema>;
export type PlannerRecord<T extends PlannerDocument=PlannerDocument>={id:string;revision:number;data:T;createdBy:string;updatedBy:string;updatedAt:string;archived:boolean};
export type PlannerSummary={id:string;revision:number;kind:PlannerDocument['kind'];name:string;updatedAt:string;archived:boolean};
export type PlannerTask={key:string;projectId:string;title:string;status:string;archived:boolean;sourceRevision:number};
const taskChoiceSchema=z.object({rowIds:z.array(text(100).min(1)).min(1).max(7),kind:z.enum([...plannerKinds,'weekly']),format:z.enum(plannerFormats),signature:z.boolean().optional(),edition:z.number().int().min(2).max(Number.MAX_SAFE_INTEGER).optional()}).strict();
export const taskRequestSchema=z.object({revision:z.number().int().positive(),response:z.literal('requested').optional(),tasks:z.array(taskChoiceSchema).min(1).max(8)}).strict();
export type PlannerTaskChoice=z.infer<typeof taskRequestSchema>['tasks'][number];
export const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/g,' ').trim();
export const addDays=(date:string,days:number)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
export const frenchDay=(date:string)=>new Intl.DateTimeFormat('fr-FR',{weekday:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
export function programmeIdentity(row:Pick<PlannerRow,'title'|'subtitle'>){return normalized(row.title+' '+row.subtitle);}
export function rankMedia(row:PlannerRow,directory:PlannerRecord<DirectoryIndex>,rule?:ProgrammeRule){
  return directory.data.files.map(file=>scoreMedia(row,directory.id,file,rule)).filter(v=>v.score>=40).sort((a,b)=>b.score-a.score||a.file.path.localeCompare(b.file.path,'fr')).slice(0,5);
}
export function taskKey(choice:PlannerTaskChoice){return `${choice.kind}:${choice.format}:${choice.rowIds.map(encodeURIComponent).join(',')}${choice.edition===undefined?'':`:r${choice.edition}`}`;}

/** Parse only keys that the creation protocol can produce; encoded IDs cannot
 * impersonate an edition, another row, or a non-canonical historical key. */
export function plannerTaskChoice(task:Pick<PlannerTask,'key'>):PlannerTaskChoice|undefined{
  const parts=task.key.split(':');
  if(parts.length!==3&&parts.length!==4)return;
  if(parts.length===4&&!/^r[1-9]\d*$/.test(parts[3]))return;
  try{
    const parsed=taskChoiceSchema.safeParse({kind:parts[0],format:parts[1],rowIds:parts[2].split(',').map(decodeURIComponent),...(parts.length===4?{edition:Number(parts[3].slice(1))}:{})});
    if(!parsed.success)return;
    const choice=parsed.data;
    if(choice.rowIds.length!==(choice.kind==='weekly'?7:1)||new Set(choice.rowIds).size!==choice.rowIds.length||taskKey(choice)!==task.key)return;
    return choice;
  }catch{return;}
}
export function plannerTaskBaseKey(key:string):string|undefined{
  const choice=plannerTaskChoice({key});
  return choice?taskKey({...choice,edition:undefined}):undefined;
}
/** Source revisions describe creation, not whether a user-edited project is
 * outdated. Keep archived projects and let the UI offer their existing link. */
export function latestPlannerTask(choice:PlannerTaskChoice,tasks:readonly PlannerTask[]):PlannerTask|undefined{
  const base=taskKey({...choice,edition:undefined});let latest:PlannerTask|undefined,edition=0;
  for(const task of tasks){
    if(task.key!==base&&!task.key.startsWith(base+':r'))continue;
    const parsed=plannerTaskChoice(task);
    if(!parsed||taskKey({...parsed,edition:undefined})!==base)continue;
    if(!latest||task.sourceRevision>latest.sourceRevision||task.sourceRevision===latest.sourceRevision&&(parsed.edition??0)>edition){latest=task;edition=parsed.edition??0;}
  }
  return latest;
}

/** Existing drafts stay accessible even after the operator changes the recipe/formats. */
export function linkedTasksForRow(rowId:string,tasks:readonly PlannerTask[]){
  const keys=new Set(plannerKinds.flatMap(kind=>plannerFormats.map(format=>taskKey({kind,format,rowIds:[rowId]}))));
  return tasks.filter(task=>{const base=plannerTaskBaseKey(task.key);return base!==undefined&&keys.has(base);});
}
