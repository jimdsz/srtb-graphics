import {useId} from 'react';
import {Check,CheckCheck,MessageSquare,Send} from 'lucide-react';
import {canApprove} from './domain';
import type {Member,Project} from './domain';
import './task-workflow.css';

export interface ProjectApprovalPanelProps{
 project:Pick<Project,'status'|'revision'|'archived'>;member:Member;disabled:boolean;dirty:boolean;missingLocal:boolean;previewReady:boolean;
 onSubmit:()=>void;onApprove:()=>void;onReject:()=>void;onComments?:()=>void;onArchive?:()=>void;busy?:boolean;
}

export default function ProjectApprovalPanel({project,member,disabled,dirty,missingLocal,previewReady,onSubmit,onApprove,onReject,onComments,onArchive,busy=false}:ProjectApprovalPanelProps){
 const heading=useId(),help=useId(),issue=useId(),manager=canApprove(member.role),archived=!!project.archived;
 const reviewing=project.status==='submitted',approved=project.status==='approved';
 const status=archived?'Projet archivé':dirty?'Modifications à enregistrer':reviewing?'En attente de validation':approved?'Version validée':project.status==='rejected'?'Corrections demandées':'Prêt à soumettre';
 const guidance=archived?'Restaurez le projet pour reprendre la préparation.':dirty?'Enregistrez vos changements avant de soumettre ou de valider cette version.':reviewing?(manager?'Contrôlez l’image et le son dans l’aperçu, puis validez ou demandez une correction.':'Le diffuseur peut maintenant relire cette version et vous faire un retour.'):approved?'Cette version est validée. Toute modification enregistrée repassera le projet en brouillon.':project.status==='rejected'?'Consultez les commentaires, apportez les corrections, puis soumettez à nouveau.':'Envoyez cette version au diffuseur pour qu’il la relise.';
 const validationIssue=reviewing&&manager&&!dirty&&!archived?(missingLocal?'Reconnectez les médias locaux pour contrôler l’aperçu avant de valider.':!previewReady?'Attendez que l’aperçu soit prêt, puis contrôlez l’image et le son.':''):'';
 return <section className="project-approval" aria-labelledby={heading}>
  <header><div className="project-approval-title"><CheckCheck size={19} aria-hidden="true"/><h2 id={heading}>Validation pour la diffusion</h2></div><span className="project-approval-version">Version {project.revision}</span></header>
  <p className={`project-approval-state ${approved&&!dirty&&!archived?'is-approved':''}`}><span aria-hidden="true"/>{status}</p>
  <p id={help} className="project-approval-guidance">{guidance}</p>
  {validationIssue?<p id={issue} className="project-approval-help" role="status">{validationIssue}</p>:null}
  <div className="project-approval-actions">
   {!archived&&!reviewing&&!approved?<button type="button" className="primary" disabled={disabled||dirty} aria-describedby={help} onClick={onSubmit}><Send size={16} aria-hidden="true"/>Soumettre au diffuseur</button>:null}
   {!archived&&reviewing&&manager?<><button type="button" className="primary" disabled={disabled||dirty||missingLocal||!previewReady} aria-describedby={validationIssue?`${help} ${issue}`:help} onClick={onApprove}><Check size={16} aria-hidden="true"/>Valider cette révision</button><button type="button" disabled={disabled||dirty} aria-describedby={help} onClick={onReject}>Demander une correction</button></>:null}
   {onComments?<button type="button" className="quiet" disabled={busy} onClick={onComments}><MessageSquare size={16} aria-hidden="true"/>Commentaires</button>:null}
  </div>
  <footer><small>La validation ne lance ni diffusion ni export. Vous pouvez exporter à chaque étape.</small>{onArchive?<button type="button" className="quiet" disabled={busy||dirty} onClick={onArchive}>{archived?'Restaurer':'Archiver'}</button>:null}</footer>
 </section>;
}
