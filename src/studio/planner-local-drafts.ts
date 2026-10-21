import {z} from 'zod';
import {planSchema,plannerRowSchema} from './day-planner-model';
import type {Plan,PlannerRecord} from './day-planner-model';

export type PlannerDraftScope={owner:string;channel:string};
export interface PlannerLocalDraft extends PlannerDraftScope {
 schema:1;id:string;draftId:string;sequence:number;savedAt:number;
 base:PlannerRecord<Plan>|null;plan:Plan;
}
export type PlannerDraftOptions={signal?:AbortSignal;factory?:IDBFactory;timeoutMs?:number};
export const MAX_LOCAL_PLANNER_DRAFTS=20;
export const MAX_LOCAL_PLANNER_DRAFT_BYTES=4*1024**2;
const MAX_SCOPE_BYTES=24*1024**2;
const scopeSchema=z.object({owner:z.email().max(254),channel:z.string().regex(/^[a-z0-9-]{1,64}$/)}).strict();
// Local recovery must retain an unfinished title, not restore an earlier valid
// value. Server validation remains unchanged and still applies when saving.
const editableRow=plannerRowSchema.safeExtend({title:z.string().max(200)});
const editablePlan=planSchema.safeExtend({name:z.string().max(120),rows:z.array(editableRow).min(1).max(600).refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length)});
const baseSchema=z.object({id:z.uuid(),revision:z.number().int().positive(),data:planSchema,createdBy:z.string().max(254),updatedBy:z.string().max(254),updatedAt:z.string().max(100),archived:z.boolean()}).strict();
const draftSchema=z.object({schema:z.literal(1),id:z.uuid(),draftId:z.uuid(),sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),savedAt:z.number().int().nonnegative().max(8_640_000_000_000_000),owner:scopeSchema.shape.owner,channel:scopeSchema.shape.channel,base:baseSchema.nullable(),plan:editablePlan}).strict()
 .refine(draft=>!draft.base||draft.base.id===draft.draftId,'La copie ne correspond pas à la préparation.');
const budgetSchema=z.object({owner:scopeSchema.shape.owner,channel:scopeSchema.shape.channel,id:z.uuid(),draftId:z.uuid(),sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),bytes:z.number().int().positive().max(MAX_LOCAL_PLANNER_DRAFT_BYTES)}).strict();
const byteLength=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function plannerDraftScope(email:string,channel:string):PlannerDraftScope{
 return scopeSchema.parse({owner:email.trim().toLowerCase(),channel});
}
function checkedScope(scope:PlannerDraftScope){
 const next=scopeSchema.parse(scope);
 if(next.owner!==next.owner.trim().toLowerCase())throw Error('Le compte de la copie locale est invalide.');
 return next;
}
function parseDraft(value:unknown,scope:PlannerDraftScope):PlannerLocalDraft{
 // Bound the value before walking the complete plan. No bytes, handles, tokens
 // or temporary blob URLs are accepted by the strict nested media schemas.
 if(byteLength(value)>MAX_LOCAL_PLANNER_DRAFT_BYTES)throw Error('La préparation est trop volumineuse pour la copie locale. Enregistrez-la sur Graphics.');
 const result=draftSchema.safeParse(value);
 if(!result.success)throw Error('La copie locale n’est pas lisible. La préparation ouverte reste intacte.');
 if(result.data.owner!==scope.owner||result.data.channel!==scope.channel)throw Error('Cette copie appartient à un autre compte ou à une autre chaîne.');
 return result.data;
}
export function makePlannerLocalDraft(scope:PlannerDraftScope,input:Pick<PlannerLocalDraft,'id'|'draftId'|'sequence'|'base'|'plan'>,now=Date.now()):PlannerLocalDraft{
 return parseDraft({...input,...checkedScope(scope),schema:1,savedAt:now},scope);
}

/** No background networking or permission requests. Every promise settles on
 * commit, abort, blocked storage or timeout; request success alone is not a save. */
function transact<T>(mode:IDBTransactionMode,options:PlannerDraftOptions,work:(store:IDBObjectStore,budget:IDBObjectStore,set:(value:T)=>void,fail:(error:unknown)=>void)=>void):Promise<T>{
 return new Promise((resolve,reject)=>{
  let settled=false,db:IDBDatabase|undefined,tx:IDBTransaction|undefined,value:T;
  const finish=(error?:unknown)=>{
   if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
   if(error){try{tx?.abort();}catch{/* The transaction may already be complete. */}}
   db?.close();if(error)reject(error);else resolve(value);
  };
  const abort=()=>finish(new DOMException('Copie locale interrompue.','AbortError'));
  const timer=setTimeout(()=>finish(Error('La mémoire locale ne répond pas. Vos retouches restent ouvertes ; réessayez.')),options.timeoutMs??5000);
  if(options.signal?.aborted){abort();return;}options.signal?.addEventListener('abort',abort,{once:true});
  try{
   const request=(options.factory??globalThis.indexedDB).open('srtb-planner-drafts',1);
   request.onerror=()=>finish(Error('La mémoire locale est indisponible. Vos retouches restent ouvertes.'));
   request.onblocked=()=>finish(Error('La mémoire locale est bloquée par un autre onglet. Réessayez.'));
   request.onupgradeneeded=()=>{
    if(settled){request.transaction?.abort();return;}
    try{
     for(const name of ['drafts','budget']){
      const store=request.result.createObjectStore(name,{keyPath:['owner','channel','id']});
      store.createIndex('scope',['owner','channel']);
     }
    }catch{try{request.transaction?.abort();}catch{/* Already aborted. */}finish(Error('La mémoire locale n’a pas pu être préparée.'));}
   };
   request.onsuccess=()=>{
    db=request.result;if(settled){db.close();return;}
    db.onversionchange=()=>finish(Error('La mémoire locale a changé dans un autre onglet. Réessayez.'));
    try{
     tx=db.transaction(['drafts','budget'],mode);
     tx.oncomplete=()=>finish();
     tx.onerror=tx.onabort=()=>finish(Error('La copie locale n’a pas été confirmée. Vos retouches restent ouvertes.'));
     work(tx.objectStore('drafts'),tx.objectStore('budget'),next=>{value=next;},finish);
    }catch{finish(Error('La mémoire locale est indisponible. Vos retouches restent ouvertes.'));}
   };
  }catch{finish(Error('La mémoire locale est indisponible. Vos retouches restent ouvertes.'));}
 });
}
function scopedRows(store:IDBObjectStore,scope:PlannerDraftScope,fail:(error:unknown)=>void,done:(rows:PlannerLocalDraft[])=>void){
 const request=store.index('scope').getAll([scope.owner,scope.channel],MAX_LOCAL_PLANNER_DRAFTS+1);
 request.onerror=()=>fail(Error('Les copies locales n’ont pas pu être relues.'));
 request.onsuccess=()=>{
  try{
   if(!Array.isArray(request.result)||request.result.length>MAX_LOCAL_PLANNER_DRAFTS)throw Error('Trop de copies locales. Aucune copie n’a été remplacée.');
   done(request.result.map(value=>parseDraft(value,scope)));
  }catch(error){fail(error);}
 };
}
export function listPlannerLocalDrafts(scope:PlannerDraftScope,options:PlannerDraftOptions={}):Promise<PlannerLocalDraft[]>{
 const safe=checkedScope(scope);
 return transact('readonly',options,(store,_budget,set,fail)=>scopedRows(store,safe,fail,rows=>set(rows.sort((a,b)=>b.savedAt-a.savedAt||a.id.localeCompare(b.id)))));
}
export function writePlannerLocalDraft(scope:PlannerDraftScope,value:PlannerLocalDraft,options:PlannerDraftOptions={}):Promise<boolean>{
 const safe=checkedScope(scope),draft=parseDraft(value,safe);
 return transact('readwrite',options,(store,budget,set,fail)=>{
  // Read only tiny metadata on each edit, never all 24 MiB of other plans.
  // Metadata and content commit atomically in the same two-store transaction.
  const inventory=budget.index('scope').getAll([safe.owner,safe.channel],MAX_LOCAL_PLANNER_DRAFTS+1);
  inventory.onerror=()=>fail(Error('La mémoire locale n’a pas pu être relue.'));
  inventory.onsuccess=()=>{
   try{
    const parsed=z.array(budgetSchema).max(MAX_LOCAL_PLANNER_DRAFTS).safeParse(inventory.result);
    if(!parsed.success||parsed.data.some(row=>row.owner!==safe.owner||row.channel!==safe.channel)||new Set(parsed.data.map(row=>row.id)).size!==parsed.data.length)throw Error('L’inventaire des copies locales est illisible. Vos retouches restent ouvertes.');
    const rows=parsed.data,previous=rows.find(row=>row.id===draft.id);
    if(previous&&previous.sequence>=draft.sequence){set(false);return;}
    if(previous&&previous.draftId!==draft.draftId)throw Error('Cette copie locale est déjà liée à une autre préparation.');
    if(!previous&&rows.length>=MAX_LOCAL_PLANNER_DRAFTS)throw Error('Vingt copies locales sont conservées. Supprimez explicitement une copie devenue inutile, ou enregistrez sur Graphics ; aucune copie n’a été effacée.');
    const bytes=byteLength(draft);
    if(rows.reduce((total,row)=>total+(row.id===draft.id?0:row.bytes),bytes)>MAX_SCOPE_BYTES)throw Error('La mémoire des préparations est pleine. Vos autres copies sont conservées.');
    const request=store.put(draft),size=budget.put({owner:safe.owner,channel:safe.channel,id:draft.id,draftId:draft.draftId,sequence:draft.sequence,bytes});
    request.onerror=size.onerror=()=>fail(Error('La copie locale n’a pas pu être conservée. Vérifiez l’espace disponible et réessayez.'));
    request.onsuccess=()=>set(true);
   }catch(error){fail(error);}
  };
 });
}
/** Compare-and-delete prevents an old save/discard acknowledgement from
 * deleting a newer edit. Other copies/people/channels are never touched. */
export function removePlannerLocalDraft(scope:PlannerDraftScope,id:string,expectedSequence:number,options:PlannerDraftOptions={}):Promise<boolean>{
 const safe=checkedScope(scope);z.uuid().parse(id);z.number().int().positive().parse(expectedSequence);
 return transact('readwrite',options,(store,budget,set,fail)=>{
  const key=[safe.owner,safe.channel,id],request=store.get(key);
  request.onerror=()=>fail(Error('La copie locale n’a pas pu être relue.'));
  request.onsuccess=()=>{
   try{
    if(request.result===undefined){set(false);return;}
    const current=parseDraft(request.result,safe);
    if(current.sequence!==expectedSequence){set(false);return;}
    const removal=store.delete(key),size=budget.delete(key);
    removal.onerror=size.onerror=()=>fail(Error('La copie locale reste conservée. Réessayez.'));
    removal.onsuccess=()=>set(true);
   }catch(error){fail(error);}
  };
 });
}
