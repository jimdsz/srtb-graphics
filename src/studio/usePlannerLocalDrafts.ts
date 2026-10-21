import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {Plan,PlannerRecord} from './day-planner-model';
import {activeChannelId} from './channel-context';
import {listPlannerLocalDrafts,makePlannerLocalDraft,plannerDraftScope,removePlannerLocalDraft,writePlannerLocalDraft} from './planner-local-drafts';
import type {PlannerDraftScope,PlannerLocalDraft} from './planner-local-drafts';
import {plannerRecoveryFingerprint} from './planner-local-recovery-model';

type Input={plan:Plan|null;base:PlannerRecord<Plan>|null;draftId:string;dirty:boolean};
type Session={id:string;draftId:string;sequence:number;requested:string;receipt:PlannerLocalDraft|null;source:PlannerLocalDraft|null};
type Job={input:Input;target:Session;scope:PlannerDraftScope;valid:()=>boolean;waiters:{resolve:(draft:PlannerLocalDraft)=>void;reject:(cause:unknown)=>void}[]};
const signature=(input:Pick<Input,'plan'|'base'>)=>plannerRecoveryFingerprint([input.base,input.plan]);
const message=(cause:unknown)=>cause instanceof Error?cause.message:'La copie locale est indisponible. Vos retouches restent ouvertes.';

/** Personal recovery only. No server writes, file access, or media decoding. */
export function usePlannerLocalDrafts(email:string,channel:string,input:Input){
 const scope=useMemo(()=>plannerDraftScope(email,channel),[email,channel]);
 const scopeKey=JSON.stringify(scope),currentScope=useRef(scopeKey);currentScope.current=scopeKey;
 const latest=useRef(input);latest.current=input;
 const mounted=useRef(false),generation=useRef(0),session=useRef<Session|null>(null);
 const jobs=useRef<Job[]>([]),worker=useRef<Promise<void>|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const [copies,setCopies]=useState<PlannerLocalDraft[]>([]),[loading,setLoading]=useState(true),[listError,setListError]=useState('');
 const [writeError,setWriteError]=useState(''),[pending,setPending]=useState(0),[receipt,setReceipt]=useState<PlannerLocalDraft|null>(null);
 const [cleanupError,setCleanupError]=useState('');
 const listRequest=useRef<AbortController|null>(null);
 const live=useCallback((epoch:number)=>mounted.current&&generation.current===epoch&&currentScope.current===scopeKey&&activeChannelId()===scope.channel,[scopeKey,scope.channel]);
 const refresh=useCallback(async()=>{
  listRequest.current?.abort();const c=new AbortController();listRequest.current=c;const epoch=generation.current;
  if(live(epoch)){setLoading(true);setListError('');}
  try{const rows=await listPlannerLocalDrafts(scope,{signal:c.signal});if(live(epoch)&&!c.signal.aborted)setCopies(rows);}
  catch(cause){if(live(epoch)&&!c.signal.aborted)setListError(message(cause));}
  finally{if(live(epoch)&&!c.signal.aborted)setLoading(false);}
 },[scope,live]);
 useEffect(()=>{
  mounted.current=true;generation.current++;session.current=null;setReceipt(null);setCopies([]);setWriteError('');setCleanupError('');setPending(0);void refresh();
  return()=>{mounted.current=false;generation.current++;listRequest.current?.abort();};
 },[refresh]);
 const begin=useCallback((draftId:string,source:PlannerLocalDraft|null=null)=>{
  if(timer.current){clearTimeout(timer.current);timer.current=null;}
  session.current={id:crypto.randomUUID(),draftId,sequence:0,requested:source?signature(source):'',receipt:source,source};
  if(mounted.current){setReceipt(source);setWriteError('');setCleanupError('');setPending(0);}
 },[]);
 const remember=useCallback((snapshot:Input,force=false):Promise<PlannerLocalDraft|null>=>{
  if(currentScope.current!==scopeKey)return Promise.reject(Error('Le compte ou la chaîne a changé. La préparation précédente reste conservée.'));
  if(!snapshot.plan||!snapshot.draftId)return Promise.resolve(null);
  let target=session.current;
  if(!target||target.draftId!==snapshot.draftId){begin(snapshot.draftId);target=session.current!;}
  const key=signature(snapshot),epoch=generation.current;
  if(!force&&target.receipt&&key===signature(target.receipt)&&!jobs.current.some(job=>job.target===target)&&!worker.current)return Promise.resolve(target.receipt);
  target.requested=key;
  // At most one not-yet-started write per editor session. Rapid typing never
  // queues a transaction for every keystroke.
  const result=new Promise<PlannerLocalDraft>((resolve,reject)=>{
   const waiting=jobs.current.find(job=>job.target===target);
   if(waiting){waiting.input=snapshot;waiting.waiters.push({resolve,reject});}
   else{
    jobs.current.push({input:snapshot,target,scope,valid:()=>live(epoch),waiters:[{resolve,reject}]});
    if(live(epoch)&&session.current===target)setPending(n=>n+1);
   }
  });
  const pump=()=>{if(!worker.current){
   worker.current=(async()=>{
    while(jobs.current.length){
     const job=jobs.current.shift()!,{target}=job;
     try{
      const draft=makePlannerLocalDraft(job.scope,{id:target.id,draftId:target.draftId,sequence:++target.sequence,base:job.input.base,plan:job.input.plan!});
      const committed=await writePlannerLocalDraft(job.scope,draft);
      if(!committed)throw Error('Une version plus récente de cette copie existe. Aucune retouche n’a été effacée.');
      target.receipt=draft;
      if(job.valid()){
       setCopies(rows=>[draft,...rows.filter(row=>row.id!==draft.id)].sort((a,b)=>b.savedAt-a.savedAt));
       if(session.current===target){setReceipt(draft);setWriteError('');}
      }
      job.waiters.forEach(waiter=>waiter.resolve(draft));
     }catch(cause){
      target.requested='';
      if(job.valid()&&session.current===target)setWriteError(message(cause));
      job.waiters.forEach(waiter=>waiter.reject(cause));
     }finally{if(job.valid()&&session.current===target)setPending(n=>Math.max(0,n-1));}
    }
   })().finally(()=>{worker.current=null;if(jobs.current.length)pump();});
  }};
  pump();
  return result;
 },[scope,scopeKey,live,begin]);
 const flush=useCallback(()=>{
  if(timer.current){clearTimeout(timer.current);timer.current=null;}
  // Recommit before navigation/save, even when this tab still holds a receipt:
  // another tab may have explicitly removed that copy since its last commit.
  return remember(latest.current,true);
 },[remember]);
 useEffect(()=>{
  if(!input.dirty)return;
  timer.current=setTimeout(()=>{timer.current=null;void remember(input).catch(()=>undefined);},600);
  return()=>{if(timer.current){clearTimeout(timer.current);timer.current=null;}};
 },[input.plan,input.base,input.draftId,input.dirty,remember]);
 useEffect(()=>{
  const attempt=()=>{if(latest.current.dirty)void flush().catch(()=>undefined);};
  const hidden=()=>{if(document.visibilityState==='hidden')attempt();};
  window.addEventListener('pagehide',attempt);document.addEventListener('visibilitychange',hidden);
  return()=>{window.removeEventListener('pagehide',attempt);document.removeEventListener('visibilitychange',hidden);attempt();};
 },[flush]);
 const remove=useCallback(async(draft:PlannerLocalDraft)=>{
  const epoch=generation.current,removed=await removePlannerLocalDraft(scope,draft.id,draft.sequence);
  if(live(epoch)){
   if(removed){
    setCopies(rows=>rows.filter(row=>row.id!==draft.id||row.sequence!==draft.sequence));
    if(session.current?.receipt?.id===draft.id&&session.current.receipt.sequence===draft.sequence){
     if(signature(latest.current)===signature(draft)&&timer.current){clearTimeout(timer.current);timer.current=null;}
     session.current.receipt=null;session.current.requested='';setReceipt(null);
    }
    if(session.current?.source?.id===draft.id&&session.current.source.sequence===draft.sequence)session.current.source=null;
   }else await refresh();
  }
  return removed;
 },[scope,live,refresh]);
 const saved=useCallback(async(draft:PlannerLocalDraft|null,submitted:Plan)=>{
  // Wait for already-queued writes before CAS; a late transaction must not
  // resurrect a copy after the server acknowledgement deletes that exact copy.
  if(!draft||plannerRecoveryFingerprint(draft.plan)!==plannerRecoveryFingerprint(submitted))return;
  const epoch=generation.current;
  if(plannerRecoveryFingerprint(latest.current.plan)===plannerRecoveryFingerprint(submitted)&&timer.current){clearTimeout(timer.current);timer.current=null;}
  try{
   while(worker.current)await worker.current;
   await remove(draft);
   // Older source copies are deliberately retained. Only the exact receipt
   // included in this save is eligible for deletion, never another session.
  }catch(cause){if(live(epoch))setCleanupError('Enregistrement partagé confirmé ; la copie locale reste conservée. '+message(cause));}
 },[remove,live]);
 const inputSignature=useMemo(()=>signature(input),[input.plan,input.base]);
 const receiptSignature=useMemo(()=>receipt?signature(receipt):null,[receipt]);
 const upToDate=!!receipt&&receiptSignature===inputSignature;
 return {copies,loading,listError,writeError,cleanupError,pending:pending>0,upToDate,receipt,refresh,begin,flush,remove,saved};
}
