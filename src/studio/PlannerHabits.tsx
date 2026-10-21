import {useEffect,useRef,useState} from 'react';
import {BookmarkCheck,Check,ChevronDown,RefreshCw} from 'lucide-react';
import {request} from './api';
import {canApprove} from './domain';
import type {Member} from './domain';
import {normalized,plannerLabels} from './day-planner-model';
import type {Plan,PlannerRecord} from './day-planner-model';
import type {RecipeHabitObservation as Suggestion} from './planner-recipe-editor-model';
import {activeChannelId} from './channel-context';
import {searchRead} from './planner-team-search';

const errorMessage=(error:unknown)=>error instanceof Error?error.message:'Action non confirmée.';
/** One bounded write; cancellation or missing acknowledgement never retries it. */
async function habitWrite<T>(path:string,body:unknown,signal:AbortSignal):Promise<T>{
 signal.throwIfAborted();
 const c=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
 try{return await Promise.race([
  request<T>(path,{method:'POST',signal:c.signal,body:JSON.stringify(body)}),
  new Promise<never>((_,reject)=>{
   abort=()=>{c.abort();reject(signal.reason??new DOMException('Action interrompue.','AbortError'));};
   signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
   timer=setTimeout(()=>{c.abort();reject(Error('La décision n’est pas confirmée. Relisez les habitudes avant de réessayer.'));},15000);
  }),
 ]);}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}

export default function PlannerHabits({record,member,hasUnsavedChanges=false,plan,onAdapt}:{record:PlannerRecord<Plan>|null;member:Member;hasUnsavedChanges?:boolean;plan?:Plan;onAdapt?:(observation:Suggestion)=>void}){
 const context=JSON.stringify([member.email,activeChannelId(),record?.id,record?.revision]);
 const current=useRef(context);current.current=context;
 const [items,setItems]=useState<Suggestion[]>([]),[itemsContext,setItemsContext]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const locked=useRef(false),control=useRef<AbortController|null>(null),mounted=useRef(false),generation=useRef(0);
 const loaded=itemsContext===context,visibleItems=loaded?items:[];
 const valid=(c:AbortController,epoch:number,expected:string)=>mounted.current&&!c.signal.aborted&&generation.current===epoch&&current.current===expected;
 async function refresh(c:AbortController,epoch:number,expected:string){
  const result=await searchRead(signal=>{if(!valid(c,epoch,expected))throw new DOMException('Contexte modifié.','AbortError');return request<{suggestions:Suggestion[]}>('/habits',{signal});},c.signal,12000,'Les habitudes ne répondent pas. Réessayez leur lecture.');
  if(valid(c,epoch,expected)){setItems(result.suggestions);setItemsContext(expected);setUncertain(false);}
 }
 useEffect(()=>{
  mounted.current=true;const c=new AbortController(),epoch=++generation.current;control.current?.abort();control.current=c;locked.current=false;setBusy(false);setError('');setNotice('');
  const changed=()=>{generation.current++;control.current?.abort();locked.current=false;setBusy(false);setItemsContext('');};
  window.addEventListener('srtb-channel-change',changed);
  void refresh(c,epoch,context).catch(cause=>{if(valid(c,epoch,context))setError(errorMessage(cause));});
  return()=>{mounted.current=false;generation.current++;c.abort();control.current?.abort();window.removeEventListener('srtb-channel-change',changed);};
  // Context changes must invalidate both reads and write acknowledgements.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[context]);
 async function run(work?:(signal:AbortSignal)=>Promise<string>){
  if(locked.current||work&&uncertain)return;
  control.current?.abort();const c=new AbortController(),epoch=++generation.current,expected=context;control.current=c;locked.current=true;setBusy(true);setError('');setNotice('');
  if(work)setUncertain(true);
  try{
   if(work){const message=await work(c.signal);if(!valid(c,epoch,expected))return;setNotice(message);}
   if(valid(c,epoch,expected))await refresh(c,epoch,expected);
  }catch(cause){if(valid(c,epoch,expected))setError(errorMessage(cause));}
  finally{if(valid(c,epoch,expected))setBusy(false);if(control.current===c)locked.current=false;}
 }
 async function confirm(){
  if(!record||hasUnsavedChanges)return;
  await run(async signal=>{
   const result=await habitWrite<{confirmed:number;ambiguous:number}>('/habits/confirm',{planId:record.id,revision:record.revision},signal);
   return result.confirmed+' choix confirmés dans la version enregistrée.'+(result.ambiguous?' '+result.ambiguous+' choix ambigus ignorés.':'')+' Aucune règle appliquée.';
  });
 }
 async function decide(item:Suggestion,action:'approve'|'disable'|'forget'){
  if(!canApprove(member.role))return;
  if(action==='forget'&&!window.confirm('Oublier ces observations et désactiver la règle correspondante ? Les projets restent conservés.'))return;
  await run(async signal=>{
   await habitWrite('/habits/decide',{programme:item.programme,candidate:item.candidate,revision:item.revision||0,action},signal);
   return action==='approve'?'Observation approuvée. Les prochaines préparations proposeront cette recette.':action==='disable'?'Habitude désactivée. Les projets restent conservés.':'Observations oubliées. Les projets restent conservés.';
  });
 }
 const pending=visibleItems.filter(item=>!item.state).length;
 return <details className="planner-habits"><summary><BookmarkCheck size={18} aria-hidden="true"/><span>Habitudes proposées</span>{loaded?<span className="planner-habits-count">{pending} à examiner</span>:null}<ChevronDown size={16} aria-hidden="true"/></summary>
  <div className="planner-habits-content">{busy?<p className="small muted" role="status">{uncertain?'Décision en cours…':'Lecture des habitudes…'}</p>:null}<p className="small muted">Après trois conducteurs distincts confirmés, Graphics peut proposer une recette ou un dossier pour une émission. Une approbation reste nécessaire. Aucun fichier d’épisode ne devient un média permanent.</p>
   {error?<p className="notice error" role="alert">{error}</p>:null}{notice?<p className="notice" role="status">{notice}</p>:null}{uncertain&&!busy?<p className="small muted">Action non confirmée : actualisez les habitudes avant toute nouvelle décision. Aucun nouvel envoi automatique.</p>:null}
   <div className="row"><button disabled={busy||uncertain||!record||hasUnsavedChanges} onClick={()=>void confirm()}><Check size={16} aria-hidden="true"/>Confirmer les choix enregistrés</button><button className="icon-button" disabled={busy} onClick={()=>void run()} aria-label="Actualiser les habitudes"><RefreshCw size={16} aria-hidden="true"/></button></div>
   {hasUnsavedChanges||!record?<p className="small muted">Enregistrez la préparation avant de confirmer ses choix.</p>:<p className="small muted">Cette confirmation concerne la révision {record.revision}. Elle ne modifie ni les fichiers ni les projets.</p>}
   {!loaded&&!error?<p className="small muted" role="status">Chargement des propositions…</p>:null}
   <ul>{visibleItems.map((item,index)=><li key={`${item.programme}:${index}`}><div className="planner-habit-heading"><strong>{item.candidate.name}</strong><span className="badge">{item.state==='approved'?'Observation approuvée':item.state==='disabled'?'Désactivée':'À examiner'}</span></div><p>{item.candidate.kinds.map(kind=>plannerLabels[kind]).join(' · ')||'Réutiliser l’habillage existant'}{item.candidate.directoryId?' · Dossier habituel':''}</p>
    <details><summary>Pourquoi cette proposition ?<ChevronDown size={15} aria-hidden="true"/></summary><p>{item.confirmations} conducteurs distincts ont les mêmes choix confirmés. Portée : cette émission, dans cette chaîne. Les textes, horaires, fichiers et projets ne sont pas modifiés.</p></details>
    {item.ruleId?<p className="small muted">Cette décision concerne les observations d’origine. La règle courante est relue séparément dans l’adaptation.</p>:null}
    {onAdapt?<button disabled={busy||!plan?.rows.some(row=>row.included&&!row.sourceRemoved&&normalized(row.title)===item.programme)} onClick={()=>onAdapt(item)}>Adapter cette proposition</button>:null}
    {canApprove(member.role)?<div className="row"><button disabled={busy||uncertain||item.state==='approved'} onClick={()=>void decide(item,'approve')}>Approuver</button><button disabled={busy||uncertain||!item.state||item.state==='disabled'} onClick={()=>void decide(item,'disable')}>Désactiver</button><button className="quiet" disabled={busy||uncertain} onClick={()=>void decide(item,'forget')}>Oublier</button></div>:<p className="small muted">À approuver par un administrateur ou un diffuseur.</p>}
   </li>)}</ul>{loaded&&!visibleItems.length?<p className="small muted">Aucune habitude à proposer pour le moment.</p>:null}
  </div>
 </details>;
}
