import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowRight,Check,Link2,Tv} from 'lucide-react';
import {api} from './api';
import {activeChannelId} from './channel-context';
import NewProjectDialog from './NewProjectDialog';
import {plannerLabels} from './day-planner-model';
import type {Plan,PlannerRow} from './day-planner-model';
import type {Programme} from './channel-model';
import {plannerProgrammeSchedule} from './planner-programme-label';
import {applyProgrammeBatch,currentProgrammeBatch,groupProgrammeBatch,readProgrammeCatalogue,refreshProgrammeBatch,reviewProgrammeBatch} from './planner-programme-batch';
import type {ProgrammeBatchGroup,ProgrammeBatchMatch,ProgrammeBatchMode,ProgrammeBatchSkipped} from './planner-programme-batch';
import './planner-programme-batch.css';

const recipe=(row:PlannerRow)=>row.kinds.map(kind=>plannerLabels[kind]).join(' · ')||'Aucun nouveau livrable';
const rowChoice=(match:ProgrammeBatchMatch)=>'Choisir '+match.rowTitle+' · '+plannerProgrammeSchedule(match.before)+(match.before.subtitle?' · '+match.before.subtitle:'');
function GroupChoice({group,selected,disabled,onChange}:{group:ProgrammeBatchGroup;selected:Set<string>;disabled:boolean;onChange:(ids:string[],checked:boolean)=>void}){
 const ref=useRef<HTMLInputElement>(null),ids=group.matches.filter(match=>match.status==='ready').map(match=>match.rowId),count=ids.filter(id=>selected.has(id)).length;
 useEffect(()=>{if(ref.current)ref.current.indeterminate=count>0&&count<ids.length;},[count,ids.length]);
 return <label className="programme-batch-group-choice"><input ref={ref} type="checkbox" aria-label={'Sélectionner '+group.programme.name} disabled={disabled||!ids.length} checked={!!ids.length&&count===ids.length} onChange={event=>onChange(ids,event.target.checked)}/><span><strong>{group.programme.name}</strong><small>Révision {group.programme.revision} · {group.matches.length} ligne{group.matches.length>1?'s':''}{!ids.length?' · Déjà à jour':''}</small></span></label>;
}
function Occurrence({match,mode,selecting,selected,disabled,onChange}:{match:ProgrammeBatchMatch;mode:ProgrammeBatchMode;selecting:boolean;selected:boolean;disabled:boolean;onChange:(checked:boolean)=>void}){
 const row=match.before,after=match.after!;
 const Line=selecting?'label':'div';
 return <li className="programme-batch-occurrence">
  <Line className="programme-batch-line">
   {selecting?<input type="checkbox" aria-label={rowChoice(match)} checked={selected} disabled={disabled||match.status!=='ready'} onChange={event=>onChange(event.target.checked)}/>:<Check size={16} aria-hidden="true"/>}
   <span className="programme-batch-schedule">{plannerProgrammeSchedule(row)}{!row.included?<small>Ligne écartée · reste écartée</small>:null}</span>
   <span className="programme-batch-description"><strong>{row.title}</strong><small>{row.subtitle||'Sans sous-titre / épisode'}{match.status==='unchanged'?' · Déjà à jour':''}</small></span>
  </Line>
  {mode==='copy'?<div className="programme-batch-delta"><div><small>Avant</small><strong>{row.title}</strong><span>{row.category||'Sans catégorie'}</span><span>{recipe(row)}</span></div><ArrowRight size={16} aria-hidden="true"/><div><small>Après reprise</small><strong>{after.title}</strong><span>{after.category||'Sans catégorie'}</span><span>{recipe(after)}</span></div></div>:null}
 </li>;
}
function Skipped({items}:{items:ProgrammeBatchSkipped[]}){
 if(!items.length)return null;
 return <details className="programme-batch-skipped" open><summary>{items.length} ligne{items.length>1?'s':''} non appliquée{items.length>1?'s':''}</summary><ul>{items.map(item=><li key={item.rowId}><strong>{item.rowTitle}</strong><span>{item.reason}</span></li>)}</ul></details>;
}

export default function PlannerProgrammeReview({plan,onApply,onClose}:{plan:Plan;onApply:(plan:Plan,changed:number)=>void;onClose:()=>void}){
 const [snapshot,setSnapshot]=useState(()=>structuredClone(plan));
 const latest=useRef(plan),channel=useRef(activeChannelId()),request=useRef<AbortController|null>(null),heading=useRef<HTMLHeadingElement>(null),closeRef=useRef(onClose),applied=useRef(false);
 latest.current=plan;closeRef.current=onClose;
 const [programmes,setProgrammes]=useState<Programme[]|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[busy,setBusy]=useState(false);
 const [mode,setMode]=useState<ProgrammeBatchMode>('link'),[selected,setSelected]=useState<string[]>([]);
 const [review,setReview]=useState<{matches:ProgrammeBatchMatch[];skipped:ProgrammeBatchSkipped[]}|null>(null);
 const [notice,setNotice]=useState('');
 const matches=useMemo(()=>programmes?reviewProgrammeBatch(snapshot,programmes,mode):[],[snapshot,programmes,mode]);
 const groups=groupProgrammeBatch(review?.matches??matches),ready=matches.filter(match=>match.status==='ready');
 const selectedSet=new Set(selected),count=review?review.matches.length:selected.length;
 const excluded=matches.filter(match=>!['ready','unchanged'].includes(match.status));

 function close(){request.current?.abort();closeRef.current();}
 useEffect(()=>{
  const changed=()=>{request.current?.abort();closeRef.current();};
  window.addEventListener('srtb-channel-change',changed);
  return()=>{request.current?.abort();window.removeEventListener('srtb-channel-change',changed);};
 },[]);
 useEffect(()=>{
  const controller=new AbortController();request.current=controller;setSnapshot(structuredClone(latest.current));
  setBusy(true);setError('');setProgrammes(null);setSelected([]);setReview(null);setNotice('');
  void readProgrammeCatalogue(api.programmePage,controller.signal,channel.current,activeChannelId).then(rows=>{
   if(!controller.signal.aborted)setProgrammes(rows);
  }).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Les fiches émission ne peuvent pas être chargées.');}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[attempt]);
 const reviewing=review!==null;
 useEffect(()=>{
  heading.current?.focus({preventScroll:true});
  // The selection action is below a long list. Start the new review at its
  // heading, not at the old scroll position beside the confirmation button.
  heading.current?.closest('dialog')?.scrollTo({top:0});
 },[reviewing]);

 function choose(ids:string[],checked:boolean){setSelected(previous=>checked?[...new Set([...previous,...ids])]:previous.filter(id=>!ids.includes(id)));}
 function changeMode(value:ProgrammeBatchMode){setMode(value);setSelected([]);setNotice('Le mode a changé. Sélectionnez les lignes à revoir.');}
 async function prepareReview(){
  if(busy||!selected.length||!programmes)return;
  const controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true);setError('');setNotice('');
  try{
   const fresh=await readProgrammeCatalogue(api.programmePage,controller.signal,channel.current,activeChannelId);
   if(controller.signal.aborted)return;
   setReview(refreshProgrammeBatch(latest.current,matches,selected,fresh,mode));
  }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'La relecture des fiches n’a pas abouti. Rien n’a été appliqué.');}
  finally{if(!controller.signal.aborted)setBusy(false);}
 }
 function apply(){
  if(!review||busy||applied.current||activeChannelId()!==channel.current)return;
  const checked=currentProgrammeBatch(latest.current,review.matches);
  if(checked.skipped.length){
   setReview({matches:checked.matches,skipped:[...review.skipped,...checked.skipped]});
   setNotice('Des lignes ont changé. Elles sont écartées ; relisez les lignes restantes avant de confirmer.');
   return;
  }
  if(!checked.matches.length)return;
  const result=applyProgrammeBatch(latest.current,checked.matches);
  applied.current=true;
  onApply(result.plan,result.changed);
 }

 return <NewProjectDialog busy={false} labelledBy="planner-programmes-title" onClose={close}>
  <div className="programme-batch" aria-busy={busy}>
   <header className="programme-batch-heading"><Tv size={22} aria-hidden="true"/><div><h2 id="planner-programmes-title" ref={heading} data-dialog-autofocus tabIndex={-1}>{review?'Confirmer les rapprochements':'Fiches émission'}</h2><p>{review?'Toutes les lignes ci-dessous ont été relues.':'Tout le conducteur · correspondances exactes uniquement.'}</p></div></header>
   <p className="programme-batch-safety"><strong>Modifie la préparation, pas les projets existants.</strong> Horaires, épisodes, médias, logos, voix et retouches de passage restent inchangés. Aucune sauvegarde ni génération automatique.</p>
   {error?<div className="notice error" role="alert"><p>{error}</p>{!programmes?<button onClick={()=>setAttempt(value=>value+1)}>Réessayer</button>:<p>Votre sélection est conservée. Relancez la revue quand la connexion est disponible.</p>}</div>:null}
   {busy?<p className="programme-batch-progress" role="status">{programmes?'Relecture de toutes les fiches avant confirmation…':'Lecture de toutes les fiches émission…'}</p>:null}
   {notice?<p className="programme-batch-notice" role="status">{notice}</p>:null}
   {programmes&&!review?<>
    <fieldset className="programme-batch-modes" disabled={busy}><legend>Ce qui sera repris</legend>
     <label><input type="radio" name="programme-batch-mode" checked={mode==='link'} onChange={()=>changeMode('link')}/><span>Lier les fiches, conserver mes textes et recettes<small>Seuls le lien et la révision de la fiche changent.</small></span></label>
     <label><input type="radio" name="programme-batch-mode" checked={mode==='copy'} onChange={()=>changeMode('copy')}/><span>Reprendre les titres et recettes des fiches<small>Remplace aussi les catégories renseignées. Le détail avant/après est affiché pour chaque ligne.</small></span></label>
    </fieldset>
    <div className="programme-batch-tools"><span>{ready.length} ligne{ready.length>1?'s':''} à rapprocher · {matches.filter(match=>match.status==='unchanged').length} déjà à jour</span><div><button disabled={busy||!ready.length} onClick={()=>setSelected(ready.map(match=>match.rowId))}>Sélectionner les correspondances exactes</button><button className="quiet" disabled={busy||!selected.length} onClick={()=>setSelected([])}>Tout décocher</button></div></div>
   </>:null}
   {review?<p className="programme-batch-mode-summary"><Link2 size={16} aria-hidden="true"/>{mode==='link'?'Liaisons uniquement · vos textes et recettes sont conservés.':'Reprise volontaire des titres, catégories renseignées et recettes affichés ci-dessous.'}</p>:null}
   <div className="programme-batch-groups">{groups.map(group=><section className="programme-batch-group" key={group.programme.id} aria-label={group.programme.name}>
    <header>{review?<div className="programme-batch-group-title"><h3>{group.programme.name}</h3><span>Révision {group.programme.revision} · {group.matches.length} ligne{group.matches.length>1?'s':''}</span></div>:<GroupChoice group={group} selected={selectedSet} disabled={busy} onChange={choose}/>}</header>
    <ul>{group.matches.map(match=><Occurrence key={match.rowId} match={match} mode={mode} selecting={!review} selected={selectedSet.has(match.rowId)} disabled={busy} onChange={checked=>choose([match.rowId],checked)}/>)}</ul>
   </section>)}</div>
   {!busy&&programmes&&!groups.length?<p className="programme-batch-empty">{review?'Aucune ligne ne peut être confirmée dans cette revue. Votre préparation reste inchangée.':'Aucune correspondance exploitable. Vérifiez les titres et les variantes dans Émissions.'}</p>:null}
   {review?<Skipped items={review.skipped}/>:excluded.length?<details className="programme-batch-excluded"><summary>{excluded.length} ligne{excluded.length>1?'s':''} sans rapprochement certain</summary><ul>{excluded.map(match=><li key={match.rowId}><strong>{match.rowTitle}</strong><span>{plannerProgrammeSchedule(match.before)} · {match.reason}</span>{match.candidates.length>1?<span>Fiches : {match.candidates.map(candidate=>candidate.name).join(' · ')}</span>:null}</li>)}</ul></details>:null}
   <footer className="programme-batch-footer">
    <div><button className="primary" disabled={busy||!count||!programmes} onClick={()=>review?apply():void prepareReview()}>{review?<Check size={17} aria-hidden="true"/>:<ArrowRight size={17} aria-hidden="true"/>}{review?'Confirmer':'Revoir'} {count} ligne{count>1?'s':''}</button><button disabled={false} onClick={close}>Annuler</button></div>
    {review?<div><button className="quiet" onClick={()=>{setReview(null);setNotice('');setError('');}}>Revenir à la sélection</button>{review.skipped.length?<button className="quiet" onClick={()=>setAttempt(value=>value+1)}>Relancer les correspondances</button>:null}</div>:null}
   </footer>
  </div>
 </NewProjectDialog>;
}
