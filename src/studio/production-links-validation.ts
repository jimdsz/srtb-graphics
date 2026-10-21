import {z} from 'zod';
import {dateSchema,plannerFormats,plannerKinds,timeSchema} from './day-planner-model';
import {productionLinksSections} from './production-links-model';
import type {ProductionLinksPage} from './production-links-model';

const text=(max:number)=>z.string().max(max),status=z.enum(['draft','submitted','approved','rejected']);
const linkage=z.enum(['same-programme','line-only','different-programme','undocumented','missing-history']);
const occurrence=z.object({rowId:text(100).min(1),title:text(200),subtitle:text(400),airDate:dateSchema,broadcastDate:dateSchema,time:z.union([timeSchema,z.literal('')]),included:z.boolean(),sourceRemoved:z.boolean(),programmeRevision:z.number().int().positive().nullable()}).strict();
const project=z.object({id:z.uuid(),title:text(120),templateId:text(120).min(1),templateVersion:text(80).min(1),libraryVersion:text(80).min(1),revision:z.number().int().positive(),status,archived:z.boolean(),format:z.enum(plannerFormats).nullable()}).strict();
const projectItem=z.object({type:z.literal('project'),id:z.uuid(),relation:z.enum(['direct','weekly','derived']),taskKey:text(6500).min(1),kind:z.enum([...plannerKinds,'weekly']),format:z.enum(plannerFormats),sourceRevision:z.number().int().positive(),edition:z.number().int().min(2).nullable(),linkage,
  origins:z.array(z.object({rowId:text(100).min(1),linkage,occurrence:occurrence.nullable()}).strict()).min(1).max(7),project,
  derivation:z.object({batchId:z.uuid(),batchName:text(120),sourceProject:project,sourceRevision:z.number().int().positive(),targetKey:text(80),label:text(300),announcement:z.object({key:text(30),day:text(30),time:text(8),format:z.enum(plannerFormats)}).strict().nullable()}).strict().optional(),
}).strict().refine(item=>item.id===item.project.id&&(item.relation==='derived')===!!item.derivation,'Origine de projet incohérente.');
const occurrenceItem=z.object({type:z.literal('occurrence'),id:text(100).min(1),occurrence,
  coordination:z.array(z.object({key:text(6500),kind:z.enum([...plannerKinds,'weekly']),format:z.enum(plannerFormats),ownerName:text(200),state:z.enum(['draft','submitted','approved','rejected','archived','assigned','unknown'])}).strict()).max(15),
}).strict().refine(item=>item.id===item.occurrence.rowId,'Identité de ligne incohérente.');
export const productionLinksPageSchema=z.object({
  context:z.object({channelId:text(64).min(1),planId:z.uuid(),planRevision:z.number().int().positive(),planName:text(120),rowId:text(100).min(1),scope:z.enum(['programme','line']),programmeId:z.uuid().nullable(),title:text(200),snapshot:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  section:z.enum(productionLinksSections),items:z.array(z.union([occurrenceItem,projectItem])).max(30),next:text(4096).nullable(),
}).strict().superRefine((page,ctx)=>{
  if((page.context.scope==='programme')!==!!page.context.programmeId)ctx.addIssue({code:'custom',message:'Portée incohérente.'});
  if(new Set(page.items.map(item=>item.id)).size!==page.items.length)ctx.addIssue({code:'custom',message:'Page dupliquée.'});
  for(const item of page.items)if(page.section==='occurrences'?item.type!=='occurrence':item.type!=='project'||item.relation!==({deliverables:'direct',weekly:'weekly',derivations:'derived'} as const)[page.section])ctx.addIssue({code:'custom',message:'Section incohérente.'});
}) satisfies z.ZodType<ProductionLinksPage>;

/** Validate the allowlisted, bounded transport, never a raw project snapshot. */
export function validateProductionLinksPage(value:unknown):ProductionLinksPage{
  const raw=JSON.stringify(value);if(!raw||new TextEncoder().encode(raw).byteLength>1024*1024)throw Error('La réponse du dossier dépasse la limite de lecture.');
  const parsed=productionLinksPageSchema.safeParse(value);if(!parsed.success)throw Error('La réponse du dossier est incohérente. Actualisez sa première page.');return parsed.data;
}
