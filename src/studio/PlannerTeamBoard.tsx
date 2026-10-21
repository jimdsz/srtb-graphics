import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,Check,ChevronDown,RefreshCw,UserRound,Users} from 'lucide-react';
import {request} from './api';
import {canApprove} from './domain';
import type {Member} from './domain';
import {plannerLabels} from './day-planner-model';
import type {Plan,PlannerRecord,PlannerTaskChoice} from './day-planner-model';
import {assignmentChoices,assignmentRows} from './planner-team';
import {canChangeTaskOwner,defaultTaskFilter,taskStateLabels} from './planner-task-presentation';
import type {TaskFilter,TeamTask} from './planner-task-presentation';
import './task-workflow.css';

export type {TeamTask} from './planner-task-presentation';
type Person={email:string;name:string};
type AssignmentPage={tasks:TeamTask[];members:Person[]};

export default function PlannerTeamBoard({record,member,onOpenTask,disabled=false,hasUnsavedChanges=false,initiallyOpen=true}:{
 record:PlannerRecord<Plan>|null;member:Member;onOpenTask?:(choice:PlannerTaskChoice)=>void;disabled?:boolean;hasUnsavedChanges?:boolean;initiallyOpen?:boolean;
}){
 const [result,setResult]=useState<{scope:string;page:AssignmentPage}|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [loading,setLoading]=useState(false),[writingKey,setWritingKey]=useState<string|null>(null),[filter,setFilter]=useState<TaskFilter|null>(null),[limit,setLimit]=useState(6);
 const scope=`${record?.id}:${record?.revision}:${member.email}:${member.role}`;
 const currentScope=useRef(scope);currentScope.current=scope;
 const read=useRef<AbortController|null>(null),mounted=useRef(true),writing=useRef(false);
 const heading=useId(),description=useId();
 const page=result?.scope===scope?result.page:null;
 const tasks=page?.tasks??[],people=page?.members??[];
 const manager=canApprove(member.role);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;read.current?.abort();};},[]);
 const load=useCallback(async(keepError=false)=>{
  if(!record)return false;
  read.current?.abort();const controller=new AbortController();read.current=controller;setLoading(true);if(!keepError)setError('');
  try{
   const next=await request<AssignmentPage>(`/planner/${record.id}/assignments`,{signal:controller.signal});
   if(controller.signal.aborted||!mounted.current||currentScope.current!==scope)return false;
   setResult({scope,page:next});return true;
  }catch(cause){if(!controller.signal.aborted&&mounted.current&&currentScope.current===scope)setError(cause instanceof Error?cause.message:'Les tâches sont indisponibles. Réessayez.');return false;}
  finally{if(read.current===controller){read.current=null;if(mounted.current&&!controller.signal.aborted&&currentScope.current===scope)setLoading(false);}}
 },[record?.id,scope]);
 useEffect(()=>{
  setFilter(null);setLimit(6);setMessage('');setError('');setResult(null);void load();
  return()=>{read.current?.abort();read.current=null;};
 },[load]);
 if(!record)return null;
 const byKey=new Map(tasks.map(task=>[task.key,task])),choices=assignmentChoices(record.data);
 const rows=assignmentRows(record.data).map((row,index)=>({...row,choice:choices[index]}));
 const mine=rows.filter(row=>byKey.get(row.key)?.owner===member.email).length,free=rows.filter(row=>!byKey.has(row.key)).length;
 const selected=filter??defaultTaskFilter(member.role,mine);
 const filtered=rows.filter(row=>selected==='all'||selected==='mine'&&byKey.get(row.key)?.owner===member.email||selected==='free'&&!byKey.has(row.key));
 const locked=disabled||loading||writingKey!==null||!page||hasUnsavedChanges;
 async function assign(key:string,owner:string|null,label:string){
  if(!record||locked||writing.current)return;
  writing.current=true;setWritingKey(key);setError('');setMessage('');read.current?.abort();
  try{
   await request(`/planner/${record.id}/assignments`,{method:'POST',body:JSON.stringify({key,owner,revision:byKey.get(key)?.revision??0,planRevision:record.revision})});
   if(!mounted.current||currentScope.current!==scope)return;
   const refreshed=await load();
   if(!mounted.current||currentScope.current!==scope)return;
   if(refreshed){
    if(!manager&&owner===member.email)setFilter('mine');
    setMessage(owner?`${label} : ${owner===member.email?'vous êtes responsable':`attribué à ${people.find(person=>person.email===owner)?.name||owner}`}.`:`${label} est de nouveau à attribuer.`);
   }
  }catch(cause){
   if(!mounted.current||currentScope.current!==scope)return;
   setError(cause instanceof Error?cause.message:'Attribution non confirmée. Actualisez les tâches avant de réessayer.');
   // Read back ownership after a competing claim or lost reply. Never replay a write.
   await load(true);
  }finally{writing.current=false;if(mounted.current)setWritingKey(null);}
 }
 return <details className="planner-team-board task-board" open={initiallyOpen}>
  <summary id={heading}><Users size={18} aria-hidden="true"/><strong>Tâches de l’équipe</strong><span>{page?`${mine} pour moi · ${free} à attribuer`:'Répartition du travail'}</span><ChevronDown className="task-board-chevron" size={16} aria-hidden="true"/></summary>
  <div className="task-board-content" aria-labelledby={heading}>
   <div className="task-board-toolbar"><div className="task-board-filters" role="group" aria-label="Afficher les tâches">{([{id:'mine',label:'Mes tâches',count:mine},{id:'free',label:'À attribuer',count:free},{id:'all',label:'Équipe',count:rows.length}] as const).map(view=><button type="button" key={view.id} aria-pressed={selected===view.id} onClick={()=>{setFilter(view.id);setLimit(6);}}>{view.label}{page?<span>{view.count}</span>:null}</button>)}</div><button type="button" className="icon-button" aria-label="Actualiser les tâches" disabled={loading||writingKey!==null||disabled} onClick={()=>{setMessage('');void load();}}><RefreshCw size={16} aria-hidden="true"/></button></div>
   <p id={description} className="task-board-guidance">{selected==='free'?(manager?'Choisissez un responsable pour chaque tâche.':'Prenez une tâche, puis ouvrez sa préparation.'):selected==='mine'?'Ouvrez une tâche pour préparer ses habillages.':'Chaque tâche indique son responsable et son avancement.'}</p>
   {hasUnsavedChanges?<p className="task-board-help" role="status">Enregistrez la préparation pour mettre les tâches à jour.</p>:null}
   {error?<div className="task-board-feedback notice error" role="alert"><p>{error}</p><button type="button" disabled={loading||writingKey!==null} onClick={()=>void load()}>Actualiser les tâches</button></div>:null}
   {message?<p className="task-board-confirmation" role="status"><Check size={16} aria-hidden="true"/>{message}</p>:null}
   {loading&&!page?<p className="task-board-empty" role="status">Chargement des tâches…</p>:null}
   {page?<><ul className="planner-team-list task-board-list" aria-label="Tâches de la préparation" aria-describedby={description} aria-busy={loading||writingKey!==null}>{filtered.slice(0,limit).map(row=>{
    const task=byKey.get(row.key),choice=row.choice,source=record.data.rows.find(item=>item.id===choice.rowIds[0]);
    const title=choice.kind==='weekly'?'Semainier':source?.title||row.label;
    const detail=`${choice.kind==='weekly'?'7 programmes':plannerLabels[choice.kind]} · ${choice.format==='tv'?'TV · 16:9':choice.format==='portrait'?'Portrait · 4:5':'Vertical · 9:16'}`;
    const state=task?.state??'unassigned',stateLabel=task?taskStateLabels[task.state]||'État à vérifier':'À attribuer';
    const canChange=canChangeTaskOwner(member,task);
    return <li key={row.key}>
     <time className="task-board-time">{row.time.slice(0,5)||'7 jours'}</time>
     <div className="task-board-task"><strong>{title}</strong><small>{detail}</small><span className={`task-board-status task-state-${Object.hasOwn(taskStateLabels,state)?state:'unassigned'}`}>{stateLabel}</span></div>
     <div className="task-board-responsible">{manager&&canChange?<label><span>Responsable</span><select aria-label={`Responsable · ${row.label}`} value={task?.owner||''} disabled={locked} onChange={event=>void assign(row.key,event.target.value||null,title)}><option value="">À attribuer</option>{task&&!people.some(person=>person.email===task.owner)?<option value={task.owner}>{task.ownerName}</option>:null}{people.map(person=><option key={person.email} value={person.email}>{person.name}{person.email===member.email?' · moi':''}</option>)}</select></label>:<><small>Responsable</small><span>{task?<><UserRound size={14} aria-hidden="true"/>{task.owner===member.email?'Moi':task.ownerName}</>:<span className="muted">Personne pour le moment</span>}</span></>}</div>
     <div className="task-board-actions">{!manager&&!task?<button type="button" className="primary" disabled={locked} onClick={()=>void assign(row.key,member.email,title)}>{writingKey===row.key?'Attribution…':'Prendre la tâche'}</button>:null}{onOpenTask?<button type="button" className={task?.owner===member.email?'task-board-open':'quiet task-board-open'} disabled={disabled||writingKey!==null} aria-label={`Ouvrir la préparation · ${row.label}`} onClick={()=>onOpenTask(choice)}>Préparer<ArrowRight size={15} aria-hidden="true"/></button>:null}{!manager&&task&&canChange?<button type="button" className="quiet task-board-release" disabled={locked} aria-label={`Libérer la tâche · ${row.label}`} onClick={()=>void assign(row.key,null,title)}>Libérer</button>:null}</div>
    </li>;
   })}</ul>{!filtered.length?<div className="task-board-empty" role="status"><strong>{selected==='mine'?'Vous n’avez pas de tâche attribuée.':selected==='free'?'Toutes les tâches ont un responsable.':'Aucune tâche à préparer pour le moment.'}</strong><p>{selected==='mine'&&free?'Choisissez une tâche disponible pour commencer.':selected==='all'?'Ajoutez des habillages à vos programmes et enregistrez la préparation.':'Vous pouvez consulter l’avancement de l’équipe.'}</p>{selected==='mine'&&free?<button type="button" onClick={()=>{setFilter('free');setLimit(6);}}>Voir les tâches à attribuer<ArrowRight size={15} aria-hidden="true"/></button>:null}</div>:null}{filtered.length>limit?<button type="button" className="task-board-more" onClick={()=>setLimit(value=>value+12)}>Afficher la suite · {filtered.length-limit} restante{filtered.length-limit>1?'s':''}</button>:null}</>:null}
   <p className="task-board-footnote">Une tâche commencée garde son responsable. Le partage de son projet se règle dans le projet.</p>
  </div>
 </details>;
}
