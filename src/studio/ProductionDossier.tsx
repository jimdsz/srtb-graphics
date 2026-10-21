import {useId,useMemo,useState} from 'react';
import {ArrowRight,ChevronDown,Layers3} from 'lucide-react';
import type {PlannerRow,PlannerTask} from './day-planner-model';
import {dossierFormatLabels,dossierTaskState,productionDossier} from './production-dossier';
import type {DossierVariant} from './production-dossier';
import './production-dossier.css';

export interface ProductionDossierProps {
  row:PlannerRow;
  /** Only use the authorized personal ledger returned by plannerAPI.tasks. */
  tasks:readonly PlannerTask[];
  sourceRevision?:number;
  hasUnsavedChanges?:boolean;
  disabled?:boolean;
  onPrepare:()=>void;
  /** Navigation only. The parent must recheck access and guard dirty state. */
  onOpenProject:(projectId:string,target:'settings'|'exports')=>void;
  /** Read-only saved-preparation dossier; absent on a new unsaved import. */
  onOpenProgramme?:()=>void;
}
function DossierProject({task,variant,kindLabel,disabled,onOpenProject}:{task:PlannerTask;variant:DossierVariant;kindLabel:string;disabled:boolean;onOpenProject:ProductionDossierProps['onOpenProject']}){
  const status=dossierTaskState(task),context=`${kindLabel} · ${dossierFormatLabels[variant.format]} · ${task.title} · origine r${task.sourceRevision}`;
  return <div className="dossier-project">
    <div className="dossier-project-copy"><div><strong>{dossierFormatLabels[variant.format]}</strong><span className={`dossier-status is-${status.key}`}>{status.label}</span></div><p title={task.title}>{task.title}</p><small>Créé depuis la liste r{task.sourceRevision}</small></div>
    <div className="dossier-project-actions"><button type="button" disabled={disabled} aria-label={`Réglages · ${context}`} onClick={()=>onOpenProject(task.projectId,'settings')}>Réglages</button><button type="button" disabled={disabled} aria-label={`Exporter · ${context}`} onClick={()=>onOpenProject(task.projectId,'exports')}>Exporter…</button></div>
  </div>;
}
function OtherVersions({variant,kindLabel,disabled,onOpenProject}:{variant:DossierVariant;kindLabel:string;disabled:boolean;onOpenProject:ProductionDossierProps['onOpenProject']}){
  const [opened,setOpened]=useState(false),[limit,setLimit]=useState(10);
  return <details className="dossier-other-versions" onToggle={event=>setOpened(event.currentTarget.open)}><summary><ChevronDown size={14} aria-hidden="true"/>Autres versions liées · {variant.otherVersions.length}</summary>
    {opened?<>{variant.otherVersions.slice(0,limit).map(task=><DossierProject key={`${task.key}:${task.projectId}`} task={task} variant={variant} kindLabel={kindLabel} disabled={disabled} onOpenProject={onOpenProject}/>)}{variant.otherVersions.length>limit?<button type="button" className="dossier-more" disabled={disabled} onClick={()=>setLimit(count=>count+10)}>Afficher 10 autres versions</button>:null}</>:null}
  </details>;
}

export default function ProductionDossier({row,tasks,sourceRevision,hasUnsavedChanges=false,disabled=false,onPrepare,onOpenProject,onOpenProgramme}:ProductionDossierProps){
  const heading=useId(),{groups,projectCount}=useMemo(()=>productionDossier(row.id,tasks),[row.id,tasks]);
  const canPrepare=row.included&&!row.sourceRemoved&&row.kinds.length>0&&row.formats.length>0;
  const unavailable=row.sourceRemoved?'Ligne retirée du conducteur : vérifiez-la avant toute nouvelle préparation.':!row.included?'Retenez cette ligne pour préparer de nouveaux livrables.':'Choisissez les habillages à préparer dans les réglages de cette ligne.';
  return <section className="production-dossier" aria-labelledby={heading}>
    <header className="dossier-heading"><div><h3 id={heading}>Dossier de production</h3><p>{projectCount?`${projectCount} projet${projectCount>1?'s':''} lié${projectCount>1?'s':''} à votre compte`:'Vos projets liés à cette ligne'}</p></div><button type="button" className="primary" disabled={disabled||!canPrepare} onClick={onPrepare}><Layers3 size={16} aria-hidden="true"/>Préparer les livrables<ArrowRight size={16} aria-hidden="true"/></button></header>
    {onOpenProgramme?<button type="button" disabled={disabled} onClick={onOpenProgramme}>Voir le dossier de l’émission<ArrowRight size={15} aria-hidden="true"/></button>:null}
    {!canPrepare?<p className="dossier-note">{unavailable}</p>:null}
    {groups.length?<div className="dossier-groups">{groups.map(group=><section className="dossier-kind" key={group.kind} aria-labelledby={`${heading}-${group.kind}`}><h4 id={`${heading}-${group.kind}`}>{group.label}</h4>{group.variants.map(variant=><div className="dossier-variant" key={variant.key}><DossierProject task={variant.project} variant={variant} kindLabel={group.label} disabled={disabled} onOpenProject={onOpenProject}/>{variant.otherVersions.length?<OtherVersions variant={variant} kindLabel={group.label} disabled={disabled} onOpenProject={onOpenProject}/>:null}</div>)}</section>)}</div>:<p className="dossier-empty">Aucun projet lié visible dans votre registre. Les projets privés des collègues ne sont pas listés.</p>}
    <div className="dossier-notes"><p>Préparer ouvre une confirmation de brouillons. Exporter ouvre le panneau du projet, sans lancer de rendu.</p><p>Les états indiquent la validation, pas un export terminé. Les semainiers restent dans « Le semainier ».</p>{hasUnsavedChanges?<p>Les modifications non enregistrées de cette liste ne changent pas les projets déjà créés.</p>:sourceRevision!==undefined?<p>Liste actuelle r{sourceRevision}. La révision d’origine ne décrit pas les retouches du projet.</p>:null}</div>
  </section>;
}
