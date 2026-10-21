import { lazy,Suspense,useEffect, useImperativeHandle, useRef, useState,useSyncExternalStore } from 'react';
import type {Ref} from 'react';
import {canDerive} from './derivation-model';
import type { Member, MediaAsset, Project, Revision } from './domain';
import { canApprove,getTemplate,statusLabels,validateProjectData } from './domain';
import { api,ApiError,downloadJson } from './api';
import type { Comment } from './api';
import Preview from './Preview';
import Fields from './Fields';
import ExportPanel from './ExportPanel';
import LocalMedia from './LocalMedia';
import NewProjectDialog from './NewProjectDialog';
import {connectedLocal,localMediaSnapshot,localReferences,subscribeLocalMedia,promoteVerifiedLocalData,pendingLocalReferences,stableLocalData,cancelUnusedLocalFingerprints} from './local-media';
import {projectTemplateName} from './presentation';
import {applyPreparation,undoPreparation} from './preparation-proposal';
import type {AppliedPreparation,PreparationProposal} from './preparation-proposal';
import {DERIVATIONS_ENABLED} from './derivation-feature';
import {foreignLibraryFields,foreignReuseNotice} from './derivation-workbench';
import type {DerivationOrigin} from './derivation-types';
import type {PreparationKind} from './preparation-profile-model';
import type {overlayLogoGeometry} from './logo-model';
import {ArrowLeft,ArrowUpRight,Check,Copy,Download,FolderHeart,History,Layers,Save,SlidersHorizontal,Undo2} from 'lucide-react';
import Activity from './Activity';
import BusyIndicator from './ui/BusyIndicator';
import {draftTextIssue,recordDraftChange,undoDraftChange} from './draft-recovery';
import type {DraftChange} from './draft-recovery';
import './operator-workspace.css';
import ProjectApprovalPanel from './ProjectApprovalPanel';
import {savedVersionMessage} from './validation-workflow';
import {HelpBubble} from './GraphicsHelp';
import {inactiveTDSSignature} from './signature-sound';

const PreparationPanel=lazy(()=>import('./PreparationPanel'));
const DerivationPanel=DERIVATIONS_ENABLED?lazy(()=>import('./DerivationPanel')):null;

export interface WorkspaceNavigation {leave:(next:()=>void)=>void}
export default function Workspace({project:initial,member,media,onBack,onChanged,onOpenProject,navigationRef,initialTab='settings',backLabel='Projets'}:{project:Project;member:Member;media:MediaAsset[];onBack:()=>void;onChanged:(p:Project)=>void;onOpenProject?:(p:Project)=>void;navigationRef?:Ref<WorkspaceNavigation>;initialTab?:'settings'|'exports';backLabel?:string}) {
  const [project,setProject]=useState(initial),[title,setTitle]=useState(initial.title),[data,setData]=useState(initial.data);
  const currentData=useRef(data);currentData.current=data;
  const [draftHistory,setDraftHistory]=useState<DraftChange[]>([]);
  function editData(next:typeof data){const before=currentData.current;setDraftHistory(history=>recordDraftChange(history,before,next,Date.now()));currentData.current=next;setData(next);}
  function undoEdit(){const change=draftHistory.at(-1);if(!change)return;const next=undoDraftChange(currentData.current,change);currentData.current=next;setData(next);setDraftHistory(history=>history.slice(0,-1));setError('');setMessage('Dernière modification annulée dans le brouillon.');}
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
  const [revisions,setRevisions]=useState<Revision[]>([]),[comments,setComments]=useState<Comment[]>([]),[comment,setComment]=useState('');
  const [tab,setTab]=useState<'settings'|'history'|'exports'>(initialTab);
  const [exportOpened,setExportOpened]=useState(initialTab==='exports'),[exportRunning,setExportRunning]=useState(false);
  const [derivationOpen,setDerivationOpen]=useState(false),[derivationOpened,setDerivationOpened]=useState(false),[derivationRunning,setDerivationRunning]=useState(false);
  const [derivationOrigin,setDerivationOrigin]=useState<DerivationOrigin|null>(null),[originLoaded,setOriginLoaded]=useState(!DERIVATIONS_ENABLED),[originError,setOriginError]=useState(''),[originRetry,setOriginRetry]=useState(0);
  useEffect(()=>{if(!DERIVATIONS_ENABLED)return;const task=new AbortController();setOriginLoaded(false);setOriginError('');void import('./derivation-api').then(({derivations})=>derivations.origin(initial.id,task.signal)).then(origin=>{if(!task.signal.aborted){setDerivationOrigin(origin);setOriginLoaded(true);}}).catch(cause=>{if(task.signal.aborted)return;if(cause instanceof ApiError&&cause.status===404){setDerivationOrigin(null);setOriginLoaded(true);}else setOriginError(cause instanceof Error?cause.message:String(cause));});return()=>task.abort();},[initial.id,originRetry]);
  const voicePending=derivationOrigin?.announcement?.voice.status==='pending'&&!data._audio_voice_enabled;
  const anyExportRunning=exportRunning||derivationRunning;
  const [pendingLeave,setPendingLeave]=useState<{next:()=>void}|null>(null);
  const [previewReady,setPreviewReady]=useState(false);
  const [selectedElement,setSelectedElement]=useState<{field:string;serial:number}>();
  const [logoLayout,setLogoLayout]=useState<ReturnType<typeof overlayLogoGeometry>>();
  const [preparationOpen,setPreparationOpen]=useState(false),[preparationOpened,setPreparationOpened]=useState(false),[preparationUndo,setPreparationUndo]=useState<AppliedPreparation|null>(null);
  const [preparationKind,setPreparationKind]=useState<PreparationKind|undefined>();
  const exportPane=useRef<HTMLDivElement|null>(null);
  const template=getTemplate(project.template_id);
  const silentSignature=inactiveTDSSignature(template,data);
  const previousMediaData=useRef(data);
  useEffect(()=>{cancelUnusedLocalFingerprints(template,previousMediaData.current,data);previousMediaData.current=data;},[template,data]);
  const localVersion=useSyncExternalStore(subscribeLocalMedia,localMediaSnapshot);
  useEffect(()=>{setData(current=>promoteVerifiedLocalData(template,current));},[localVersion,template]);
  const checkingLocal=pendingLocalReferences(template,data).length>0;
  const savedData=()=>{const issue=draftTextIssue(template,data);if(issue)throw Error(issue);return validateProjectData(template,stableLocalData(template,data));};
  const missingLocal=localReferences(template,data).some(ref=>!connectedLocal(ref.url));
  const foreignReuse=DERIVATIONS_ENABLED&&foreignLibraryFields(template,data).length>0;
  const dirty=title!==project.title||JSON.stringify(data)!==JSON.stringify(project.data);
  function leave(next:()=>void){if(dirty||busy||anyExportRunning)setPendingLeave({next});else next();}
  useImperativeHandle(navigationRef,()=>({leave}));
  function showExports(){setExportOpened(true);setTab('exports');requestAnimationFrame(()=>exportPane.current?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'}));}
  useEffect(()=>{let leaving=false;const guard=(e:BeforeUnloadEvent)=>{if(dirty&&!leaving){e.preventDefault();e.returnValue='';}};const logout=(e:Event)=>{if(dirty&&!window.confirm('Se déconnecter sans enregistrer ces modifications ?'))e.preventDefault();else leaving=true;};window.addEventListener('beforeunload',guard);window.addEventListener('srtb-before-logout',logout);return()=>{window.removeEventListener('beforeunload',guard);window.removeEventListener('srtb-before-logout',logout);};},[dirty]);
  async function run(fn:()=>Promise<void>) {
    if(busy)return;setBusy(true);setError('');setMessage('');
    try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));if(e instanceof ApiError&&e.status===409)setConflict(true);}finally{setBusy(false);}
  }
  function accept(next:Project){setProject(next);setTitle(next.title);setData(next.data);setDraftHistory([]);setConflict(false);setPreparationUndo(null);onChanged(next);}
  function applyProposal(proposal:PreparationProposal){const before=currentData.current,next=applyPreparation(before,proposal,project.status,!!project.archived);setPreparationUndo({before,patch:proposal.patch});setData(next);setMessage('Préparation appliquée au brouillon, sans enregistrement. Contrôlez l’image et le son dans l’aperçu.');setError('');}
  function openPreparation(kind?:PreparationKind){if(preparationOpen)return;setPreparationKind(kind);setPreparationOpened(true);setPreparationOpen(true);}
  function undoProposal(){if(!preparationUndo)return;try{setData(undoPreparation(data,preparationUndo,project.status,!!project.archived));setPreparationUndo(null);setMessage('Préparation annulée. Les autres réglages ont été conservés.');}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}}
  function backup(){try{downloadJson(`${project.id}-brouillon.json`,{format:'srtb-project-backup',version:1,project:{...project,title,data:savedData()},notice:'Sauvegarde de paramètres. Les médias locaux doivent être reconnectés ; les médias partagés restent privés. Ce fichier n’est pas une livraison autonome.'});}catch(error){setError(error instanceof Error?error.message:String(error));}}
  async function history(){const [r,c]=await Promise.all([api.revisions(project.id),api.comments(project.id)]);setRevisions(r);setComments(c);setTab('history');}
  const disabled=busy||!!project.archived;
  return <div className="workspace">
    <div className="workspace-top"><button type="button" className="quiet workspace-back" onClick={()=>leave(onBack)}><ArrowLeft size={17} aria-hidden="true"/>{backLabel}</button><div className="workspace-actions" aria-label="Actions du projet">
      <button type="button" disabled={disabled||anyExportRunning||!draftHistory.length} onClick={undoEdit}><Undo2 size={16} aria-hidden="true"/>Annuler la modification</button>
      <button type="button" disabled={busy||anyExportRunning||checkingLocal||foreignReuse} title={foreignReuse?foreignReuseNotice:undefined} onClick={()=>void run(async()=>{if(foreignReuse)throw Error(foreignReuseNotice);const copy=await api.create(project.template_id,`${title.slice(0,100)} — copie`,savedData());onBack();onChanged(copy);})}><Copy size={16} aria-hidden="true"/>Dupliquer</button>
      <button type="button" className="primary workspace-save" aria-label={busy?'Opération en cours':checkingLocal?'Contrôle local en cours':dirty?'Enregistrer les modifications':'Projet enregistré'} disabled={disabled||!dirty||checkingLocal} onClick={()=>void run(async()=>{accept(await api.save(project,title,savedData()));setMessage(savedVersionMessage(project.status));})}>{busy||checkingLocal?<BusyIndicator size={16}/>:dirty?<Save size={16} aria-hidden="true"/>:<Check size={16} aria-hidden="true"/>}{busy?'En cours…':checkingLocal?'Vérification…':dirty?'Enregistrer':'Enregistré'}</button>
      <button type="button" className="workspace-export" onClick={showExports}>{exportRunning?<BusyIndicator size={16}/>:<Download size={16} aria-hidden="true"/>}Exporter{exportRunning?' · en cours':''}</button>
    </div></div>
    <header className="workspace-heading">
      <label className="project-title-label"><span className="sr-only">Nom du projet</span><input className="project-title" aria-label="Nom du projet" value={title} disabled={disabled} maxLength={120} onChange={e=>setTitle(e.target.value)}/></label>
      <div className="workspace-metadata"><span className={`badge ${project.status}`}>{statusLabels[project.status]}</span><span>{projectTemplateName(template,data)}</span><span>{project.archived?'Archivé · ':''}Révision {project.revision} · modèle {template.version}</span><span className="workspace-author" title={`Modifié par ${project.updated_by}`}>{project.updated_by}</span></div>
      <div className="workspace-save-state" role="status">{dirty?<><span className="unsaved-dot" aria-hidden="true"/>Modifications non enregistrées</>:<><Check size={13} aria-hidden="true"/>Toutes les modifications sont enregistrées</>}</div>
    </header>
    <div className="workspace-tools" aria-label="Préparation du projet">
      <HelpBubble section="editor" role={member.role}/>
      <button type="button" disabled={busy||dirty||anyExportRunning||project.created_by!==member.email&&!canApprove(member.role)} title="Privé : auteur, administrateurs et diffuseurs. Partagé : les infographistes peuvent aussi ouvrir et modifier ce projet." onClick={()=>{const visibility=project.visibility==='team'?'private':'team';if(window.confirm(visibility==='team'?'Partager ce projet avec les infographistes de l’équipe ? Ils pourront le consulter et le modifier. Les autres projets restent privés.':'Retirer ce projet de l’espace de l’équipe ? L’auteur, les administrateurs et les diffuseurs conserveront leur accès.'))void run(async()=>accept(await api.sharing(project,visibility)));}}>{project.visibility==='team'?'Partagé avec l’équipe':'Privé · partager'}</button>
      <button type="button" aria-label="Ouvrir les fiches de préparation et favoris" disabled={busy||exportRunning} onClick={()=>openPreparation()}><FolderHeart size={17} aria-hidden="true"/><span>Préparation & favoris</span><ArrowUpRight size={14} aria-hidden="true"/></button>
      {DERIVATIONS_ENABLED?<><button type="button" disabled={busy||exportRunning} onClick={()=>{setDerivationOpened(true);setDerivationOpen(true);}}>{derivationRunning?<BusyIndicator size={17}/>:<Layers size={17} aria-hidden="true"/>}<span>{derivationRunning?'Voir la file en cours':canDerive(template.id)?'Créer les déclinaisons':'Déclinaisons liées'}</span><ArrowUpRight size={14} aria-hidden="true"/></button><HelpBubble section="derivations" role={member.role}/></>:null}
      {preparationUndo?<button type="button" disabled={disabled} onClick={undoProposal}><Undo2 size={16} aria-hidden="true"/>Annuler la préparation</button>:null}
    </div>
    {foreignReuse?<p className="notice warning">{foreignReuseNotice}</p>:null}
    {DERIVATIONS_ENABLED&&canDerive(template.id)&&!project.archived?<aside className="notice recipe-suggestion"><strong>À partir de cet habillage</strong><p>{template.id==='BTV_BA_1P'?'Préparez les annonces par jour, les versions sociales, les pop-ups et le Tout de suite dédié.':template.id==='BTV_Semainier'?'Préparez les versions 9:16 et 4:5 du semainier avec les mêmes sept programmes.':'Préparez les versions 9:16 et 4:5, ainsi qu’un pop-up reprenant le titre et le média.'} Chaque proposition reste à votre choix ; les projets créés sont ajustables séparément.</p><button disabled={busy||exportRunning} onClick={()=>{setDerivationOpened(true);setDerivationOpen(true);}}>Voir les éléments proposés</button></aside>:null}
    {derivationOrigin?.announcement?<p className={`notice${voicePending?' warning':''}`}>{voicePending?'Voix à associer. Ce brouillon a été préparé sans annonce vocale. Choisissez une voix attestée dans Préparation & favoris, ou confirmez « Sans voix off » dans Exporter.':derivationOrigin.announcement.voice.status==='none'?'Variante préparée sans voix off, par choix explicite. Les modifications suivantes restent indépendantes.':`Variante liée à l’annonce ${derivationOrigin.announcement.day}. Contrôlez la voix et les réglages actuellement affichés avant utilisation.`}</p>:null}
    {originError?<p className="notice warning">La provenance de ce projet n’a pas pu être vérifiée : {originError}<button onClick={()=>setOriginRetry(value=>value+1)}>Réessayer la provenance</button></p>:null}
    {checkingLocal?<p className="small" role="status">Vous pouvez préparer et lire le média immédiatement. Son empreinte est vérifiée en arrière-plan avant l’enregistrement partagé ; aucun fichier n’est envoyé.</p>:null}
    {error?<div className="notice error" role="alert">{error}</div>:null}
    {message?<div className="notice" role="status">{message}</div>:null}
    {conflict?<div className="notice warning"><strong>Vos saisies sont conservées à l’écran.</strong><p>Sauvegardez-les avant de charger la version de votre collègue. Aucune fusion automatique n’est effectuée.</p><div className="row"><button onClick={backup}>Sauvegarder mon brouillon</button><button disabled={busy} onClick={()=>{if(window.confirm('Remplacer les valeurs à l’écran par la dernière version partagée ?'))void run(async()=>accept(await api.project(project.id)));}}>Charger la dernière version</button></div></div>:null}
    {silentSignature&&!project.archived?<div className="notice" aria-label="Son d’habillage"><strong>Le son d’habillage est désactivé dans ce projet.</strong><p>Retrouvez le son d’ouverture et la signature du modèle, indépendamment de la voix off.</p><button type="button" disabled={disabled||anyExportRunning} onClick={()=>{editData({...currentData.current,...silentSignature});setMessage('Son d’habillage activé. Activez le son de l’aperçu et relancez la lecture pour l’écouter, puis enregistrez.');}}>Activer le son d’habillage</button></div>:null}
    <LocalMedia template={template} data={data}/>
    <div className="editor-grid"><div className="editor-stage"><Preview key={`${project.id}:${project.template_version}`} template={template} data={data} onReadinessChange={setPreviewReady} onChange={editData} onLogoLayout={setLogoLayout} onSelectElement={field=>{setTab('settings');setSelectedElement(previous=>({field,serial:(previous?.serial||0)+1}));}} disabled={disabled}/>
      <ProjectApprovalPanel project={project} member={member} disabled={disabled} busy={busy} dirty={dirty} missingLocal={missingLocal} previewReady={previewReady}
        onSubmit={()=>void run(async()=>accept(await api.status(project,'submitted')))} onApprove={()=>void run(async()=>accept(await api.status(project,'approved')))}
        onReject={()=>void run(async()=>{accept(await api.status(project,'rejected'));await history();})} onComments={()=>void run(history)}
        onArchive={()=>{if(window.confirm(project.archived?'Restaurer ce projet ?':'Archiver ce projet sans effacer son historique ?'))void run(async()=>accept(await api.archive(project,!project.archived)));}}/>
    </div><aside className="editor-sidebar"><nav className="tabs workspace-tabs" aria-label="Panneaux de l’éditeur"><button type="button" aria-current={tab==='settings'?'page':undefined} onClick={()=>setTab('settings')}><SlidersHorizontal size={16} aria-hidden="true"/>Réglages</button><button type="button" aria-current={tab==='history'?'page':undefined} disabled={busy} onClick={()=>void run(history)}><History size={16} aria-hidden="true"/>Historique</button><button type="button" aria-current={tab==='exports'?'page':undefined} onClick={showExports}>{exportRunning?<BusyIndicator size={16}/>:<Download size={16} aria-hidden="true"/>}<span>Exporter</span>{exportRunning?<span className="sr-only"> · en cours</span>:null}</button></nav>
      {tab==='settings'?<Fields template={template} data={data} media={media} disabled={disabled} onChange={editData} onChooseTeamVoice={()=>openPreparation('voice')} teamVoiceDisabled={anyExportRunning} logoLayout={logoLayout} selectedElement={selectedElement}/>:null}
      {tab==='history'?<div className="side-content"><h2>Commentaires</h2><label>Note au diffuseur<textarea value={comment} maxLength={2000} onChange={e=>setComment(e.target.value)}/></label><button disabled={busy||!comment.trim()||dirty} onClick={()=>void run(async()=>{await api.comment(project,comment);setComment('');await history();})}>Ajouter la note</button>{comments.map(c=><article className="history-item" key={c.id}><small>{c.author} · r{c.revision}</small><p>{c.body}</p></article>)}<h2>Révisions conservées</h2>{revisions.map(r=><article className="history-item" key={r.revision}><strong>r{r.revision} · {statusLabels[r.status]}</strong><small>{r.actor} · {new Date(r.created_at).toLocaleString('fr-FR')}</small><p>{r.title}</p><button disabled={disabled} onClick={()=>{if(!dirty||window.confirm('Remplacer les saisies par cette révision ?')){setTitle(r.title);currentData.current=r.data;setData(r.data);setDraftHistory([]);setTab('settings');setMessage('Révision reprise dans le formulaire. Enregistrez pour créer une nouvelle révision ; l’historique sera conservé.');}}}>Reprendre en brouillon</button></article>)}</div>:null}
{exportOpened?<div ref={exportPane} hidden={tab!=='exports'}>{derivationRunning?<p className="notice">Une file de déclinaisons est en cours. Terminez-la ou annulez-la avant un autre export.</p>:null}{!originLoaded?<p className="small" role="status">Vérification de la provenance avant export…</p>:null}<fieldset className="export-mutex" disabled={derivationRunning||!originLoaded}><ExportPanel project={{...project,title,data}} template={template} backup={backup} voicePending={voicePending} unsaved={dirty} onRunningChange={setExportRunning}/></fieldset></div>:null}
    </aside></div>
    {preparationOpened?<Suspense fallback={<Activity label="Ouverture des fiches de préparation"/>}><PreparationPanel open={preparationOpen} initialKind={preparationKind} onClose={()=>setPreparationOpen(false)} project={project} template={template} data={data} media={media} member={member} disabled={disabled} presetBlockedReason={foreignReuse?foreignReuseNotice:undefined} onApply={applyProposal}/></Suspense>:null}
    {DerivationPanel&&derivationOpened?<Suspense fallback={<Activity label="Ouverture des déclinaisons"/>}><DerivationPanel open={derivationOpen} onClose={()=>setDerivationOpen(false)} project={project} template={template} title={title} data={data} dirty={dirty} disabled={disabled||exportRunning||checkingLocal} onOpenProject={next=>leave(()=>onOpenProject?.(next))} onCreated={onChanged} onRunningChange={setDerivationRunning}/></Suspense>:null}
    {pendingLeave?<NewProjectDialog labelledBy="leave-project-heading" busy={busy} onClose={()=>setPendingLeave(null)}><h2 id="leave-project-heading">{anyExportRunning?'Un export ou une préparation est en cours':dirty?'Conserver vos modifications ?':'Opération en cours'}</h2><p>{anyExportRunning?'Vous pouvez rester pour terminer les téléchargements. Quitter annulera le calcul en cours et libérera ses fichiers temporaires ; les projets créés restent partagés.':dirty?'Enregistrez vos réglages et continuez vers la page demandée.':'L’enregistrement se termine. Vous pourrez ensuite continuer.'}</p>{error?<p className="notice error" role="alert">{error}</p>:null}<div className="row wrap">{dirty&&!project.archived?<button className="primary" disabled={busy||checkingLocal} onClick={()=>void run(async()=>{const next=await api.save(project,title,savedData());accept(next);pendingLeave.next();setPendingLeave(null);})}>{checkingLocal?'Contrôle local en cours':anyExportRunning?'Enregistrer et quitter':'Enregistrer et continuer'}</button>:null}<button disabled={busy} onClick={()=>{pendingLeave.next();setPendingLeave(null);}}>{dirty?'Quitter sans enregistrer':anyExportRunning?'Annuler le calcul et quitter':'Continuer'}</button><button disabled={busy} onClick={()=>setPendingLeave(null)}>Rester sur le projet</button></div></NewProjectDialog>:null}
  </div>;
}
