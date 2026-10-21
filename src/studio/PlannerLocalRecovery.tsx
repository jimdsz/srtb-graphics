import {useEffect,useRef,useState} from 'react';
import {ChevronDown,HardDrive,RefreshCw,Trash2} from 'lucide-react';
import type {Plan,PlannerRecord,PlannerTask} from './day-planner-model';
import type {PlannerLocalDraft} from './planner-local-drafts';
import type {usePlannerLocalDrafts} from './usePlannerLocalDrafts';
import {plannerAPI} from './day-planner-api';
import {loadPlannerPreparation} from './planner-resume';
import {activeChannelId} from './channel-context';
import NewProjectDialog from './NewProjectDialog';
import {plannerRecoveryFingerprint} from './planner-local-recovery-model';
import './planner-local-recovery.css';

export type PlannerRecovery={source:PlannerLocalDraft;draftId:string;plan:Plan;record:PlannerRecord<Plan>|null;tasks:PlannerTask[]};
type Props={local:ReturnType<typeof usePlannerLocalDrafts>;contextKey:string;channel:string;hasPlan:boolean;disabled:boolean;onRequest:(action:()=>void)=>void;onRestore:(value:PlannerRecovery)=>void};
const stamp=new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const title=(draft:PlannerLocalDraft)=>draft.plan.name.trim()||'Préparation sans titre';
const sameBase=(draft:PlannerLocalDraft,record:PlannerRecord<Plan>)=>!!draft.base&&draft.base.revision===record.revision&&plannerRecoveryFingerprint(draft.base.data)===plannerRecoveryFingerprint(record.data);

export default function PlannerLocalRecovery({local,contextKey,channel,hasPlan,disabled,onRequest,onRestore}:Props){
 const [open,setOpen]=useState(!hasPlan),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const [conflict,setConflict]=useState<PlannerLocalDraft|null>(null),[discard,setDiscard]=useState<PlannerLocalDraft|null>(null);
 const request=useRef<AbortController|null>(null),mounted=useRef(false),latest=useRef(contextKey);latest.current=contextKey;
 const discardContext=useRef(''),generation=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;request.current?.abort();};},[]);
 useEffect(()=>{if(hasPlan)setOpen(false);},[hasPlan]);
 useEffect(()=>{if(disabled){request.current?.abort();setBusy('');setConflict(null);}},[disabled]);
 useEffect(()=>{generation.current++;request.current?.abort();setBusy('');setConflict(null);setDiscard(null);setError('');},[contextKey,channel]);
 function current(c:AbortController,key:string){return mounted.current&&!c.signal.aborted&&latest.current===key&&activeChannelId()===channel;}
 async function resume(draft:PlannerLocalDraft,independent=false){
  request.current?.abort();const c=new AbortController();request.current=c;const key=latest.current;
  setBusy(draft.id);setError('');setConflict(null);
  try{
   if(!draft.base){
    if(current(c,key)){onRestore({source:draft,draftId:draft.draftId,plan:draft.plan,record:null,tasks:[]});setOpen(false);}
    return;
   }
   // Every shared recovery, including an independent copy, first verifies
   // current rights and document availability. Never infer rights from IDB.
   const server=await loadPlannerPreparation(draft.draftId,plannerAPI,c.signal);
   if(!current(c,key))return;
   if(!independent&&!sameBase(draft,server.record)){setConflict(draft);return;}
   onRestore({source:draft,draftId:independent?crypto.randomUUID():draft.draftId,plan:draft.plan,record:independent?null:server.record,tasks:independent?[]:server.tasks});setOpen(false);
  }catch(cause){
   if(!current(c,key))return;
   const status=typeof cause==='object'&&cause!==null&&'status' in cause?cause.status:null;
   setError(status===401||status===403?'Vos droits doivent être revérifiés. Reconnectez-vous ou contactez un administrateur ; aucune copie de cette préparation partagée ne peut être ouverte ici.':status===404?'Cette préparation partagée est introuvable. La copie locale est conservée, sans reprise.':cause instanceof Error?cause.message:'La vérification a échoué. La copie locale et votre préparation restent intactes.');
  }finally{if(current(c,key))setBusy('');}
 }
 async function remove(){
  if(!discard||discardContext.current!==latest.current||activeChannelId()!==channel)return;
  const draft=discard,epoch=generation.current,key=latest.current;
  const valid=()=>mounted.current&&generation.current===epoch&&latest.current===key&&activeChannelId()===channel;
  setBusy(draft.id);setError('');
  try{const removed=await local.remove(draft);if(valid()){setDiscard(null);if(!removed)setError('Cette copie a changé dans un autre onglet. Relisez sa version actuelle avant de la supprimer.');}}
  catch(cause){if(valid())setError(cause instanceof Error?cause.message:'La copie reste conservée. Réessayez.');}
  finally{if(valid())setBusy('');}
 }
 return <details className="planner-local-recovery" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary><HardDrive size={16} aria-hidden="true"/><span>Copies sur ce poste</span>{local.copies.length?<span className="planner-local-count">{local.copies.length}</span>:null}<ChevronDown size={15} aria-hidden="true"/></summary>
  <div className="planner-local-body">
   <p>Copies personnelles pour ce compte et cette chaîne, sans partage. Aucun média ni projet n’est relancé. Les fichiers locaux peuvent être à reconnecter.</p>
   <div className="planner-local-tools"><span>À conserver sur un poste de confiance.</span><button type="button" className="quiet" disabled={local.loading||!!busy||disabled} onClick={()=>void local.refresh()}><RefreshCw size={14} aria-hidden="true"/>Relire les copies</button></div>
   {local.loading?<p role="status">Lecture des copies locales…</p>:null}
   {local.listError?<p className="notice error" role="alert">{local.listError}</p>:null}
   {!local.loading&&!local.listError&&!local.copies.length?<p className="planner-local-empty">Aucune copie locale conservée.</p>:null}
   {error?<p className="notice error" role="alert">{error}</p>:null}
   {busy&&!discard?<div className="planner-local-tools" role="status"><span>Vérification de la préparation…</span><button type="button" onClick={()=>{request.current?.abort();setBusy('');}}>Annuler la vérification</button></div>:null}
   {conflict?<div className="planner-local-conflict" role="status"><strong>La préparation partagée a changé.</strong><p>Vos retouches de « {title(conflict)} » ne remplaceront pas la version de l’équipe. Vous pouvez les reprendre dans une préparation indépendante, sans tâches ni projets liés.</p><div className="row"><button type="button" disabled={disabled||!!busy} onClick={()=>onRequest(()=>void resume(conflict,true))}>Créer une copie indépendante</button><button type="button" className="quiet" onClick={()=>setConflict(null)}>Annuler</button></div></div>:null}
   {local.copies.length?<ul className="planner-local-list">{local.copies.map(draft=><li key={draft.id}><div><strong>{title(draft)}</strong><span>{draft.base?`Révision ${draft.base.revision} · vérification de l’équipe requise`:'Préparation non partagée'} · {stamp.format(draft.savedAt)}</span><small>{draft.plan.rows.length} lignes · {draft.plan.source}</small></div><div className="planner-local-actions"><button type="button" disabled={disabled||!!busy} onClick={()=>onRequest(()=>void resume(draft))}>Reprendre</button><button type="button" className="quiet" aria-label={`Supprimer cette copie : ${title(draft)}`} disabled={disabled||!!busy} onClick={()=>{setError('');discardContext.current=latest.current;setDiscard(draft);}}><Trash2 size={16} aria-hidden="true"/><span>Supprimer cette copie</span></button></div></li>)}</ul>:null}
  </div>
  {discard?<NewProjectDialog labelledBy="planner-local-discard-title" busy={!!busy} onClose={()=>setDiscard(null)}><h2 id="planner-local-discard-title">Supprimer cette copie locale ?</h2><p>« {title(discard)} » · {stamp.format(discard.savedAt)}. Seule cette copie sur ce poste sera supprimée. La préparation ouverte, les autres copies et le travail de l’équipe restent intacts.</p>{error?<p className="notice error" role="alert">{error}</p>:null}<div className="row"><button type="button" disabled={!!busy} onClick={()=>void remove()}>Supprimer cette copie</button><button type="button" disabled={!!busy} onClick={()=>setDiscard(null)}>Conserver la copie</button></div></NewProjectDialog>:null}
 </details>;
}

export function PlannerLocalStatus({local}:{local:ReturnType<typeof usePlannerLocalDrafts>}){
 return <div className={`planner-local-status${local.writeError?' has-error':''}`}><span role="status">{local.writeError?'Copie locale indisponible':local.cleanupError?'Copie locale conservée':local.pending?'Copie locale en cours…':local.upToDate?'Copie sur ce poste à jour':'Retouches conservées en mémoire'}</span>{local.writeError?<><span>{local.writeError}</span><button type="button" className="quiet" onClick={()=>void local.flush().catch(()=>undefined)}>Réessayer la copie</button></>:null}{local.cleanupError?<span>{local.cleanupError}</span>:null}</div>;
}
