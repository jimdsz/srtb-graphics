import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowRight,Check,ListChecks,RefreshCw,Save,Undo2} from 'lucide-react';
import {plannerAPI} from './day-planner-api';
import {plannerLabels} from './day-planner-model';
import type {Plan,PlannerRecord,PlannerRow,ProgrammeRule} from './day-planner-model';
import {applyRecipeChanges,recipeMemoryCandidates,recipeMemoryRule,recipeProposals} from './planner-recipes';
import type {RecipeChange} from './planner-recipes';
import {plannerRuleQuery,programmeRules,resolveProgrammeRule} from './planner-rules';
import {createPlannerBatchMemory} from './planner-media-workflow';
import NewProjectDialog from './NewProjectDialog';
import {canApprove} from './domain';
import type {Member} from './domain';

export default function PlannerRecipes({plan,rows,member,onChange,onAdapt}:{plan:Plan;rows:PlannerRow[];member?:Member;onChange:(plan:Plan)=>void;onAdapt?:(rowId:string)=>void}){
  const canLearn=!!member&&canApprove(member.role);
  const key=JSON.stringify(plannerRuleQuery(rows.filter(row=>row.included)));
  const [catalogue,setCatalogue]=useState<{key:string;rules:PlannerRecord<ProgrammeRule>[]}|null>(null),[refresh,setRefresh]=useState(0);
  const [error,setError]=useState(''),[open,setOpen]=useState(false),[omitted,setOmitted]=useState<string[]>([]),[last,setLast]=useState<RecipeChange[]>([]),[notice,setNotice]=useState(''),[limit,setLimit]=useState(20);
  const [memoryOpen,setMemoryOpen]=useState(false),[memoryChoices,setMemoryChoices]=useState<string[]>([]),[memoryBusy,setMemoryBusy]=useState(false),[shareFamily,setShareFamily]=useState(false);
  const [memory]=useState(()=>createPlannerBatchMemory(plannerAPI)),memoryControl=useRef<AbortController|null>(null);
  useEffect(()=>()=>memoryControl.current?.abort(),[]);
  useEffect(()=>{
    const controller=new AbortController();setError('');
    const {programmes,families}=JSON.parse(key) as ReturnType<typeof plannerRuleQuery>;
    if(!programmes.length){setCatalogue({key,rules:[]});return()=>controller.abort();}
    const timer=setTimeout(()=>{
      void plannerAPI.rules(programmes,AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),families).then(result=>{if(!controller.signal.aborted){setCatalogue({key,rules:result.rules});memory.refreshed();}}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Recettes indisponibles.');});
    },300);
    return()=>{clearTimeout(timer);controller.abort();};
  },[key,refresh,memory]);
  const pending=catalogue?.key!==key&&!error,proposals=useMemo(()=>recipeProposals(rows,catalogue?.key===key?catalogue.rules:[]),[rows,catalogue,key]);
  const conflicts=useMemo(()=>{const index=programmeRules(catalogue?.key===key?catalogue.rules:[]);return rows.filter(row=>row.included&&resolveProgrammeRule(row,index).conflict).length;},[catalogue,key,rows]);
  const chosen=proposals.filter(item=>!omitted.includes(item.rowId));
  const memoryCandidates=useMemo(()=>recipeMemoryCandidates(rows,catalogue?.key===key?catalogue.rules:[]),[rows,catalogue,key]);
  const remembered=memoryCandidates.filter(item=>memoryChoices.includes(item.programme)&&!item.conflict);
  const rowsById=new Map(plan.rows.map(row=>[row.id,row]));
  function apply(){const result=applyRecipeChanges(plan,chosen);onChange(result.plan);setLast(result.applied);setNotice(`${result.applied.length} programme(s) ajusté(s) dans cette préparation.`);setOpen(false);}
  function undo(){const result=applyRecipeChanges(plan,last,true);onChange(result.plan);setLast([]);setNotice(`${result.applied.length} programme(s) rétabli(s). Les modifications faites ensuite restent conservées.`);}
  async function remember(){
    if(!canLearn||memoryControl.current||pending||error||memory.needsRefresh||!remembered.length)return;
    const controller=new AbortController();memoryControl.current=controller;setMemoryBusy(true);setError('');setNotice('');let count=0;
    try{
      for(const item of remembered){
        const data=recipeMemoryRule(item.row,item.known,shareFamily),result=await memory.remember(item.prior?.id||crypto.randomUUID(),item.prior?.revision||0,data,controller.signal);
        controller.signal.throwIfAborted();
        if(!result.saved)throw Error('La mémorisation n’est pas confirmée. Actualisez les recettes d’équipe avant de réessayer.');
        const saved=result.saved;count++;
        setCatalogue(current=>current?.key===key?{key,rules:[...current.rules.filter(rule=>rule.id!==saved.id),saved]}:current);
        setMemoryChoices(current=>current.filter(programme=>programme!==item.programme));
      }
      setMemoryOpen(false);
    }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'La mémorisation n’est pas confirmée. Actualisez les recettes d’équipe.');}
    finally{if(!controller.signal.aborted){setNotice(`${count} recette(s) mémorisée(s) pour l’équipe. Les prochaines préparations proposeront ces choix.`);setMemoryBusy(false);}memoryControl.current=null;}
  }
  return <section className="planner-recipes" aria-label="Recettes de l’équipe">
    <ListChecks size={21} aria-hidden="true"/>
    <div><strong>{pending?'Recherche des recettes d’équipe…':proposals.length?`${proposals.length} programme(s) : recettes d’équipe disponibles`:'Recettes de l’équipe'}</strong>
      <small>{error?'Lecture impossible. Vos choix et médias restent inchangés.':proposals.length?'Retrouver les types d’habillage déjà choisis pour ces émissions.':pending?'La préparation reste utilisable.':'Aucun changement proposé pour cette vue.'}</small>
      {notice?<small role="status">{notice}</small>:null}
      {conflicts?<small role="status">{conflicts} programme(s) avec des associations contradictoires : vos choix actuels sont conservés.</small>:null}
      {!canLearn?<small>Confirmez vos préparations dans « Habitudes proposées ». Les règles d’équipe sont validées par la diffusion ou l’administration.</small>:null}
    </div>
    {proposals.length?<button onClick={()=>{setOmitted([]);setLimit(20);setOpen(true);}}>Voir les propositions<ArrowRight size={16} aria-hidden="true"/></button>:null}
    {onAdapt&&rows.some(row=>row.included&&!row.sourceRemoved)?<button onClick={()=>onAdapt(rows.find(row=>row.included&&!row.sourceRemoved)!.id)}>Adapter une recette</button>:null}
    {canLearn&&memoryCandidates.length?<button disabled={pending||!!error||memoryBusy||memory.needsRefresh} onClick={()=>{setMemoryChoices([]);setShareFamily(false);setLimit(20);setMemoryOpen(true);}}><Save size={16} aria-hidden="true"/>Mémoriser mes recettes</button>:null}
    {last.length?<button onClick={undo}><Undo2 size={16} aria-hidden="true"/>Annuler l’application</button>:null}
    <button className="icon-button" disabled={pending||memoryBusy} aria-label="Actualiser les recettes d’équipe" title="Actualiser les recettes d’équipe" onClick={()=>{setCatalogue(null);setRefresh(n=>n+1);}}><RefreshCw size={17} aria-hidden="true"/></button>
    {error?<details><summary>Détail du problème</summary><p>{error}</p></details>:null}
    {open?<NewProjectDialog labelledBy="planner-recipes-title" busy={false} onClose={()=>setOpen(false)}>
      <h2 id="planner-recipes-title">Reprendre les recettes de l’équipe</h2>
      <p>Seuls les types d’habillage changent. Médias, passages, textes, horaires et formats sont conservés. Aucun projet déjà créé n’est modifié.</p>
      <div className="planner-recipe-list">{proposals.slice(0,limit).map(item=><div className="planner-recipe-edit-item" key={item.rowId}><label className="planner-recipe-proposal">
        <input type="checkbox" checked={!omitted.includes(item.rowId)} onChange={e=>setOmitted(ids=>e.target.checked?ids.filter(id=>id!==item.rowId):[...ids,item.rowId])}/>
        <span><strong>{item.title}</strong><small>{rowsById.get(item.rowId)?.time.slice(0,5)} · {rowsById.get(item.rowId)?.airDate}</small>
          {item.inherited?<small>Recette de l’émission · nouvel épisode</small>:null}
          <span className="planner-recipe-before">Actuel : {item.before.map(kind=>plannerLabels[kind]).join(' · ')||'Aucun habillage individuel'}</span>
          <span className="planner-recipe-after"><ArrowRight size={15} aria-hidden="true"/>Proposé : {item.after.map(kind=>plannerLabels[kind]).join(' · ')||'Aucun habillage individuel'}</span>
        </span>
      </label>{onAdapt?<button type="button" onClick={()=>{setOpen(false);onAdapt(item.rowId);}}>Adapter cette proposition</button>:null}</div>)}</div>
      {limit<proposals.length?<button className="quiet" onClick={()=>setLimit(n=>n+20)}>Voir les suivants · {limit} / {proposals.length}</button>:null}
      <div className="row"><button className="primary" disabled={!chosen.length} onClick={apply}><Check size={17} aria-hidden="true"/>Appliquer à {chosen.length} programme(s)</button><button onClick={()=>setOpen(false)}>Garder mes choix</button></div>
    </NewProjectDialog>:null}
    {canLearn&&memoryOpen?<NewProjectDialog labelledBy="planner-memory-title" busy={memoryBusy} onClose={()=>setMemoryOpen(false)}>
      <h2 id="planner-memory-title">Mémoriser les choix d’habillage</h2>
      <p>Choisissez les programmes dont la recette doit être proposée à l’équipe dans les prochaines préparations. « Aucun nouvel habillage » permet de garder un rendez-vous récurrent à vérifier ou à réutiliser. Vous pourrez toujours choisir de nouveaux habillages.</p>
      <div className="planner-recipe-list">{memoryCandidates.slice(0,limit).map(item=><label className="planner-recipe-proposal" key={item.programme}>
        <input type="checkbox" disabled={memoryBusy||item.conflict} checked={memoryChoices.includes(item.programme)} onChange={e=>setMemoryChoices(current=>e.target.checked?[...current,item.programme]:current.filter(value=>value!==item.programme))}/>
        <span><strong>{item.row.title}</strong>{item.row.subtitle?<small>{item.row.subtitle}</small>:null}<span>{item.row.kinds.map(kind=>plannerLabels[kind]).join(' · ')||'Aucun nouvel habillage · vérifier l’existant'}</span>{item.conflict?<small>Choix contradictoires pour ce programme : harmonisez les recettes avant de mémoriser.</small>:item.prior?.data.family?<small>Recette déjà partagée avec les prochains épisodes</small>:null}</span>
      </label>)}</div>
      {limit<memoryCandidates.length?<button className="quiet" disabled={memoryBusy} onClick={()=>setLimit(n=>n+20)}>Voir les suivants · {limit} / {memoryCandidates.length}</button>:null}
      <label className="check"><input type="checkbox" disabled={memoryBusy} checked={shareFamily} onChange={e=>setShareFamily(e.target.checked)}/>Proposer aussi ces recettes pour les prochains épisodes de ces émissions</label>
      <p className="small muted">Seuls les types d’habillage sont mémorisés. Les associations de médias existantes sont conservées. Aucun fichier ni projet n’est créé par cette action.</p>
      {error?<p className="notice error" role="alert">{error}</p>:null}{memoryBusy?<p role="status">Mémorisation des recettes…</p>:null}
      <div className="row"><button className="primary" disabled={memoryBusy||pending||!!error||memory.needsRefresh||!remembered.length} onClick={()=>void remember()}><Save size={17} aria-hidden="true"/>Mémoriser {remembered.length} recette(s) pour l’équipe</button><button disabled={memoryBusy} onClick={()=>setMemoryOpen(false)}>Fermer</button></div>
    </NewProjectDialog>:null}
  </section>;
}
