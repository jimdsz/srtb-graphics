import {useEffect,useRef,useState} from 'react';
import {ArrowRight,RefreshCw,Save,Undo2} from 'lucide-react';
import type {Member} from './domain';
import {canApprove} from './domain';
import {normalized,plannerKinds,plannerLabels,programmeIdentity} from './day-planner-model';
import type {Plan,PlannerRecord,PlannerRow,ProgrammeRule} from './day-planner-model';
import {plannerAPI} from './day-planner-api';
import {plannerRuleQuery} from './planner-rules';
import {applyRecipeChanges} from './planner-recipes';
import type {RecipeChange} from './planner-recipes';
import {createPlannerBatchMemory} from './planner-media-workflow';
import {searchRead} from './planner-team-search';
import {activeChannelId} from './channel-context';
import {canonicalRecipe,editedRecipeChange,explicitRecipeMemory,recipeEditorContext,sameRecipe} from './planner-recipe-editor-model';
import type {RecipeHabitObservation,RecipeScope} from './planner-recipe-editor-model';
import {plannerRecoveryFingerprint as fingerprint} from './planner-local-recovery-model';
import NewProjectDialog from './NewProjectDialog';
import './planner-recipe-editor.css';

type Props={plan:Plan;rows:PlannerRow[];initialRowId:string;member:Member;observation?:RecipeHabitObservation;onChange:(plan:Plan)=>void;onApplied?:(change:RecipeChange|null)=>void;onClose:()=>void};
type Review=ReturnType<typeof explicitRecipeMemory>&{id:string;revision:number;row:PlannerRow;scope:RecipeScope;kinds:PlannerRow['kinds']};
const labels=(kinds:PlannerRow['kinds'])=>canonicalRecipe(kinds).map(kind=>plannerLabels[kind]).join(' · ')||'Aucun nouvel habillage';
const errorMessage=(cause:unknown)=>cause instanceof Error?cause.message:'La recette n’a pas pu être vérifiée.';

export default function PlannerRecipeEditor({plan,rows,initialRowId,member,observation,onChange,onApplied,onClose}:Props){
 const [channel]=useState(activeChannelId),[owner]=useState(member.email);
 const [sourceHash]=useState(plan.sourceHash);
 const eligible=rows.filter(row=>row.included&&!row.sourceRemoved&&normalized(row.title)&&(!observation||normalized(row.title)===observation.programme));
 const [rowId,setRowId]=useState(initialRowId),row=plan.rows.find(item=>item.id===rowId);
 const [before,setBefore]=useState<PlannerRow|null>(()=>row?structuredClone(row):null);
 const [kinds,setKinds]=useState<PlannerRow['kinds']>(()=>observation?.candidate.kinds??row?.kinds??[]),[scope,setScope]=useState<RecipeScope>('episode');
 const [catalogue,setCatalogue]=useState<PlannerRecord<ProgrammeRule>[]|null>(null),[reading,setReading]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[review,setReview]=useState<Review|null>(null),[last,setLast]=useState<RecipeChange|null>(null),[invalidContext,setInvalidContext]=useState(false);
 const [observationRule,setObservationRule]=useState<PlannerRecord<ProgrammeRule>|null>(null);
 const control=useRef<AbortController|null>(null),mounted=useRef(false),generation=useRef(0),edited=useRef(false),locked=useRef(false),newId=useRef(crypto.randomUUID());
 const latest=useRef({plan,rowId,member,onChange});latest.current={plan,rowId,member,onChange};
 const [memory]=useState(()=>createPlannerBatchMemory(plannerAPI));
 const heading=useRef<HTMLHeadingElement|null>(null);
 const live=(c:AbortController,epoch:number)=>mounted.current&&!c.signal.aborted&&generation.current===epoch&&activeChannelId()===channel&&latest.current.member.email===owner&&latest.current.rowId===rowId&&latest.current.plan.sourceHash===sourceHash;
 useEffect(()=>{mounted.current=true;const changed=()=>{control.current?.abort();setBusy(false);setReading(false);locked.current=false;setInvalidContext(true);setReview(null);setError('La chaîne a changé. Fermez cette revue pour conserver le contexte de vos choix.');};window.addEventListener('srtb-channel-change',changed);return()=>{mounted.current=false;generation.current++;control.current?.abort();window.removeEventListener('srtb-channel-change',changed);};},[]);
 useEffect(()=>{if(member.email!==owner||plan.sourceHash!==sourceHash){generation.current++;control.current?.abort();setBusy(false);setReading(false);locked.current=false;setInvalidContext(true);setReview(null);}},[member.email,owner,plan.sourceHash,sourceHash]);
 async function readRules(target:PlannerRow,signal:AbortSignal){
  const query=plannerRuleQuery([target]),result=await searchRead(s=>plannerAPI.rules(query.programmes,s,query.families),signal,12000,'Les recettes d’équipe ne répondent pas. Vos choix restent conservés.');
  signal.throwIfAborted();recipeEditorContext(target,result.rules);return result.rules;
 }
 async function refresh(initial=false){
  if(!row||locked.current||invalidContext)return;
  control.current?.abort();const c=new AbortController(),epoch=++generation.current;control.current=c;setReading(true);setError('');setReview(null);
  try{
   const [rules,origin]=await Promise.all([readRules(row,c.signal),observation?.ruleId?searchRead(s=>plannerAPI.get<ProgrammeRule>(observation.ruleId!,s),c.signal,12000):Promise.resolve(null)]);if(!live(c,epoch))return;
   if(origin&&(origin.id!==observation?.ruleId||origin.data.kind!=='rule'))throw Error('La règle liée à cette observation ne peut pas être vérifiée.');
   setObservationRule(origin);
   setCatalogue(rules);memory.refreshed();
   if(initial&&!edited.current&&!observation){const resolved=recipeEditorContext(row,rules).resolved;if(resolved.data&&!resolved.conflict)setKinds(canonicalRecipe(resolved.data.kinds));}
   if(!initial)setNotice('Recettes relues. Vos types d’habillage restent conservés ; vérifiez l’avant/après.');
  }catch(cause){if(live(c,epoch))setError(errorMessage(cause));}
  finally{if(live(c,epoch))setReading(false);}
 }
 useEffect(()=>{
  generation.current++;control.current?.abort();edited.current=false;newId.current=crypto.randomUUID();setCatalogue(null);setReview(null);setLast(null);setNotice('');setError('');setScope('episode');
  const current=latest.current.plan.rows.find(item=>item.id===rowId);setBefore(current?structuredClone(current):null);setKinds(canonicalRecipe(observation?.candidate.kinds??current?.kinds??[]));
  void refresh(true);
  return()=>{generation.current++;control.current?.abort();};
  // Row selection starts a new review. Retouches elsewhere never reset it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[rowId]);
 useEffect(()=>{if(review){const dialog=heading.current?.closest('dialog');if(dialog)dialog.scrollTop=0;heading.current?.focus({preventScroll:true});}},[review]);
 const current=plan.rows.find(item=>item.id===rowId),stale=!before||!current||before.id!==current.id||!current.included||!!current.sourceRemoved||programmeIdentity(current)!==programmeIdentity(before)||(!last&&!sameRecipe(current.kinds,before.kinds));
 let resolved:ReturnType<typeof recipeEditorContext>['resolved']|null=null;
 if(before&&catalogue)resolved=recipeEditorContext(before,catalogue).resolved;
 const source=resolved?.exact;
 const canShare=canApprove(member.role),contextInvalid=invalidContext||member.email!==owner||activeChannelId()!==channel||plan.sourceHash!==sourceHash;
 function localApply(){
  if(!before||stale||contextInvalid)return;
  edited.current=true;const change=editedRecipeChange(before,kinds),result=applyRecipeChanges(latest.current.plan,[change]);
  if(!result.applied.length){setError('La ligne a changé. Relisez-la avant d’appliquer vos types.');return;}
  latest.current.onChange(result.plan);onApplied?.(change);setLast(change);setReview(null);setNotice('Types appliqués à cette ligne uniquement. Aucun projet ni règle d’équipe n’a changé.');
 }
 function undo(){
  if(!last||contextInvalid)return;const result=applyRecipeChanges(latest.current.plan,[last],true);
  if(!result.applied.length){setError('Cette ligne a été retouchée depuis. Vos nouveaux choix sont conservés.');return;}
  latest.current.onChange(result.plan);onApplied?.(null);setLast(null);setNotice('Application annulée. Les autres retouches restent intactes.');
 }
 async function prepare(){
  if(!before||!canShare||locked.current||stale||contextInvalid||reading||memory.needsRefresh)return;
  control.current?.abort();const c=new AbortController(),epoch=++generation.current;control.current=c;locked.current=true;setBusy(true);setError('');setNotice('');
  try{
   const rules=await readRules(before,c.signal);if(!live(c,epoch))return;
   const previous=catalogue?recipeEditorContext(before,catalogue).key:null,next=recipeEditorContext(before,rules).key;
   setCatalogue(rules);
   if(previous!==next){setError('Les recettes ont évolué depuis leur ouverture. Vos choix sont conservés ; relisez l’origine puis préparez à nouveau la mémorisation.');return;}
   const proposed=explicitRecipeMemory(before,kinds,scope,rules);
   if(proposed.prior){
    const checked=await searchRead(s=>plannerAPI.get<ProgrammeRule>(proposed.prior!.id,s),c.signal,12000);if(!live(c,epoch))return;
    if(checked.id!==proposed.prior.id||checked.archived||checked.revision!==proposed.prior.revision||fingerprint(checked.data)!==fingerprint(proposed.prior.data))throw Error('La règle a changé pendant sa relecture. Actualisez avant de confirmer.');
    if(fingerprint(checked.data)===fingerprint(proposed.data)){setNotice(`Ces choix sont déjà mémorisés dans la règle r${checked.revision}. Aucun nouvel enregistrement n’est nécessaire.`);return;}
   }
   setReview({...proposed,id:proposed.prior?.id??newId.current,revision:proposed.prior?.revision??0,row:structuredClone(before),scope,kinds:[...kinds]});
  }catch(cause){if(live(c,epoch))setError(errorMessage(cause));}
  finally{if(live(c,epoch))setBusy(false);locked.current=false;}
 }
 async function remember(){
  if(!review||!canShare||locked.current||contextInvalid||stale||memory.needsRefresh)return;
  const inspected=review;control.current?.abort();const c=new AbortController(),epoch=++generation.current;control.current=c;locked.current=true;setBusy(true);setError('');setNotice('');
  try{
   const rules=await readRules(inspected.row,c.signal);if(!live(c,epoch))return;
   const fresh=explicitRecipeMemory(inspected.row,inspected.kinds,inspected.scope,rules);
   if(fresh.contextKey!==inspected.contextKey||fingerprint(fresh.data)!==fingerprint(inspected.data))throw Error('La recette partagée a changé pendant votre revue. Actualisez avant de la mémoriser ; vos choix sont conservés.');
   const currentRow=latest.current.plan.rows.find(item=>item.id===inspected.row.id);
   if(!canApprove(latest.current.member.role)||latest.current.member.active!==1)throw Error('Votre autorisation de mémoriser une règle doit être revérifiée.');
   if(!currentRow||!currentRow.included||currentRow.sourceRemoved||programmeIdentity(currentRow)!==programmeIdentity(inspected.row)||!sameRecipe(currentRow.kinds,last?.after??inspected.row.kinds))throw Error('La ligne a changé pendant votre revue. Aucune mémorisation n’a été envoyée.');
   const result=await memory.remember(inspected.id,inspected.revision,inspected.data,c.signal);if(!live(c,epoch))return;
   const saved=result.saved;
   if(!saved)throw Error('La mémorisation n’est pas confirmée. Relisez les recettes avant toute nouvelle tentative.');
   if(saved.id!==inspected.id||saved.revision!==inspected.revision+1||saved.archived||fingerprint(saved.data)!==fingerprint(inspected.data))throw Error('La réponse ne confirme pas la recette revue. Relisez les recettes avant toute nouvelle tentative.');
   setCatalogue(rules.filter(item=>item.id!==saved.id).concat(saved));setReview(null);
   if(observationRule?.id===saved.id)setObservationRule(saved);
   setNotice(`Règle manuelle enregistrée · révision ${saved.revision}. Elle sera proposée à l’équipe, sans modifier cette préparation ni les projets existants. Les observations d’habitude restent inchangées.`);
  }catch(cause){if(live(c,epoch)){setError(errorMessage(cause));setReview(null);}}
  finally{if(live(c,epoch))setBusy(false);locked.current=false;}
 }
 return <NewProjectDialog labelledBy="planner-recipe-editor-title" busy={busy} onClose={onClose}>
  <div className="planner-recipe-editor">
   <h2 id="planner-recipe-editor-title" ref={heading} tabIndex={-1}>{review?'Confirmer la recette d’équipe':'Adapter une recette'}</h2>
   <p className="planner-recipe-context">Chaîne : {channel}. Aucune règle générale à toutes les émissions.</p>
   {error?<p className="notice error" role="alert">{error}</p>:null}{notice?<p className="notice" role="status">{notice}</p>:null}
   {contextInvalid?<p role="alert">Le compte ou la chaîne a changé. Fermez cette revue.</p>:null}
   {review?<>
    <p><strong>{review.row.title}</strong>{review.row.subtitle?` · ${review.row.subtitle}`:''}</p>
    <p>Portée : {review.scope==='episode'?'ce titre / épisode':'les prochains épisodes de cette émission'}. {review.prior?`Règle r${review.revision} → r${review.revision+1}`:'Nouvelle règle manuelle'}.</p>
    <p className="small muted">Identité de la règle : {review.data.programme}.</p>
    <div className="planner-recipe-comparison"><div><small>Règle actuelle</small><strong>{review.prior?labels(review.prior.data.kinds):'Aucune règle à remplacer'}</strong></div><ArrowRight size={18} aria-hidden="true"/><div><small>Après mémorisation</small><strong>{labels(review.data.kinds)}</strong></div></div>
    {review.narrows?<p className="notice warning">La proposition aux prochains épisodes sera retirée de cette règle. Les autres règles et projets resteront intacts.</p>:null}
    {review.exactRemainsPrior?<p className="notice warning">La règle exacte de cet épisode reste prioritaire. Cette mémorisation modifie la recette de l’émission ; elle ne remplace pas les exceptions déjà définies pour un épisode.</p>:null}
    <p>Le dossier et l’association de fichier existants restent inchangés. Aucun fichier d’un autre épisode n’est repris. Modifie les prochaines propositions, pas les projets existants.</p>
    {observation?<p className="small muted">Les {observation.confirmations} confirmations concernent seulement les choix observés d’origine. Cette modification est une décision manuelle distincte.</p>:null}
    <div className="row"><button type="button" className="primary" disabled={busy||stale||contextInvalid} onClick={()=>void remember()}><Save size={16} aria-hidden="true"/>Mémoriser pour l’équipe</button><button type="button" disabled={busy} onClick={()=>setReview(null)}>Revenir aux choix</button></div>
   </>:<>
    <fieldset disabled={busy||contextInvalid}>
     <label>Programme / épisode<select value={rowId} onChange={event=>setRowId(event.target.value)}>{eligible.map(item=><option key={item.id} value={item.id}>{item.title}{item.subtitle?` · ${item.subtitle}`:''} · {item.airDate} {item.time.slice(0,5)}</option>)}</select></label>
     <div className="planner-recipe-origin"><strong>Origine</strong><span>{observation?`Habitude observée · ${observation.confirmations} conducteurs distincts${observation.revision?` · décision r${observation.revision}`:''}`:source?`Règle de ce titre / épisode · r${source.revision}`:resolved?.inherited?'Règle héritée de cette émission':reading?'Lecture des recettes…':'Choix actuels de cette préparation'}</span>{resolved?.inherited&&catalogue?<span>{recipeEditorContext(before!,catalogue).families.map(item=>`r${item.revision}`).join(' · ')}</span>:null}{observation?<span>Choix observés : {labels(observation.candidate.kinds)}. Ils ne sont pas réécrits.</span>:null}{observation&&source?<span>Recette actuelle de ce titre / épisode : r{source.revision}{source.id!==observation.ruleId?' · règle distincte de l’observation':''}.</span>:null}{observationRule?<span>{observationRule.archived?'Règle liée désactivée':observation?.ruleRevision!=null&&observationRule.revision!==observation.ruleRevision?'Règle modifiée manuellement':'Règle liée actuelle'} · r{observationRule.revision}{observation?.ruleRevision!=null?` · version liée à la décision précédente : r${observation.ruleRevision}`:''}. {observation?.state!=='approved'?'Cette proposition affichée n’est pas approuvée.':'L’approbation concerne les choix observés, pas vos modifications.'}</span>:null}</div>
     <fieldset className="planner-recipe-kinds"><legend>Types d’habillage proposés</legend>{plannerKinds.map(kind=><label className="check" key={kind}><input type="checkbox" checked={kinds.includes(kind)} onChange={event=>{edited.current=true;setReview(null);setKinds(current=>event.target.checked?canonicalRecipe([...current,kind]):current.filter(item=>item!==kind));}}/>{plannerLabels[kind]}</label>)}</fieldset>
     <p className="small muted">Tout décocher signifie « Aucun nouvel habillage ». Les projets existants restent disponibles.</p>
     <div className="planner-recipe-comparison"><div><small>Cette ligne actuellement</small><strong>{labels(current?.kinds??[])}</strong></div><ArrowRight size={18} aria-hidden="true"/><div><small>Après application</small><strong>{labels(kinds)}</strong></div></div>
     {stale?<p className="notice warning" role="status">La ligne a été modifiée ou retirée. Fermez cette revue puis rouvrez-la ; vos retouches actuelles sont conservées.</p>:null}
     <div className="row"><button type="button" className="primary" disabled={stale||!!last||sameRecipe(current?.kinds??[],kinds)} onClick={localApply}>Appliquer à cette ligne</button>{last?<button type="button" onClick={undo}><Undo2 size={16} aria-hidden="true"/>Annuler l’application</button>:null}</div>
     <p className="small muted">Modifie la préparation, pas les projets existants. Textes, épisodes, horaires, formats, médias, logos et voix sont conservés.</p>
     {canShare?<section className="planner-recipe-memory"><h3>Prochaines propositions pour l’équipe</h3><label className="check"><input type="radio" name="recipe-scope" checked={scope==='episode'} onChange={()=>setScope('episode')}/>Ce titre / épisode</label><label className="check"><input type="radio" name="recipe-scope" checked={scope==='programme'} onChange={()=>setScope('programme')}/>Les prochains épisodes de cette émission</label>{!before?.subtitle?<p className="small muted">Sans sous-titre, la portée exacte reconnaît ce titre sans épisode renseigné ; ce n’est pas une date de diffusion unique.</p>:null}<p className="small muted">Mémorisation manuelle distincte. Le dossier et les références existants ne sont pas modifiés.</p><button type="button" disabled={reading||stale||catalogue===null||memory.needsRefresh||!!error} onClick={()=>void prepare()}>Préparer la mémorisation</button></section>:<p className="small muted">La mémorisation pour l’équipe est réservée à un administrateur ou diffuseur.</p>}
    </fieldset>
    <div className="planner-recipe-editor-footer"><button type="button" disabled={busy||reading||contextInvalid} onClick={()=>void refresh()}><RefreshCw size={16} aria-hidden="true"/>Relire les recettes</button><button type="button" disabled={busy} onClick={onClose}>Fermer</button></div>
   </>}
  </div>
 </NewProjectDialog>;
}
