import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,RefreshCw} from 'lucide-react';
import type {Member} from './domain';
import {broadcastTemplates} from './domain';
import NewProjectDialog from './NewProjectDialog';
import {activeChannelId} from './channel-context';
import {productionLinksAPI} from './production-links-api';
import {productionLinksSections} from './production-links-model';
import type {ProductionHistoricalOccurrence,ProductionLinksContext,ProductionLinksItem,ProductionLinksPage,ProductionLinksSection,ProductionProjectItem,ProductionVisibleProject} from './production-links-model';
import './programme-production-dossier.css';

export interface ProgrammeProductionDossierProps {
  planId:string;revision:number;rowId:string;member:Member;hasUnsavedChanges?:boolean;
  onOpenRow:(rowId:string)=>void;onOpenProject:(id:string)=>void;onClose:()=>void;
}
const sectionLabels:Record<ProductionLinksSection,string>={occurrences:'Occurrences',deliverables:'Livrables',weekly:'Semainiers',derivations:'Déclinaisons'};
const states:Record<string,string>={assigned:'À préparer',draft:'Brouillon',submitted:'À valider',approved:'Validé',rejected:'À corriger',archived:'Archivé',unknown:'État à vérifier'};
const formatLabels={tv:'TV · 16:9',portrait:'Portrait · 4:5',vertical:'Vertical · 9:16'};
const historicalLabels={differentProgramme:'Autre fiche à la création',undocumented:'Rattachement émission non documenté',missingHistory:'Historique de création indisponible'};
const linkLabel=(item:ProductionProjectItem)=>item.linkage==='different-programme'?historicalLabels.differentProgramme:item.linkage==='undocumented'?historicalLabels.undocumented:item.linkage==='missing-history'?historicalLabels.missingHistory:'';
const dateLabel=(value:string)=>{const parsed=new Date(value+'T12:00:00Z');return Number.isFinite(parsed.getTime())?new Intl.DateTimeFormat('fr-FR',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(parsed):'Date à vérifier';};

function Origins({origins,project}:{origins:ProductionHistoricalOccurrence[];project:ProductionVisibleProject}){
  return <details className="programme-dossier-origins"><summary>Origine et versions{origins.length>1?` · ${origins.length} lignes`:''}</summary><p className="programme-dossier-detail">{project.templateId} · modèle {project.templateVersion} · bibliothèque {project.libraryVersion}</p><ul>{origins.map(origin=><li key={origin.rowId}>{origin.occurrence?<><strong>{origin.occurrence.title}</strong>{origin.occurrence.subtitle?<span>{origin.occurrence.subtitle}</span>:null}<span>{dateLabel(origin.occurrence.airDate)} · {origin.occurrence.time.slice(0,5)||'Heure non précisée'}</span></>:<span>Ligne historique indisponible</span>}{origin.linkage==='different-programme'?<small>{historicalLabels.differentProgramme}</small>:origin.linkage==='undocumented'?<small>{historicalLabels.undocumented}</small>:origin.linkage==='missing-history'?<small>{historicalLabels.missingHistory}</small>:null}</li>)}</ul></details>;
}
function ProjectItem({item,onOpen,disabled}:{item:ProductionProjectItem;onOpen:(id:string)=>void;disabled:boolean}){
  const p=item.project,warning=linkLabel(item),modelLabel=p.templateId==='BTV_BA_1P'?'Bande-annonce':broadcastTemplates.find(template=>template.id===p.templateId)?.name||'Modèle enregistré';
  return <li className="programme-dossier-project" data-linkage={item.linkage}>
    <div className="programme-dossier-project-main"><div><strong>{p.title}</strong><span className="programme-dossier-status">{states[p.archived?'archived':p.status]||states.unknown}</span><p>{modelLabel} · {p.format?formatLabels[p.format]:'Format à vérifier'}</p><small>Projet r{p.revision} · Préparation d’origine r{item.sourceRevision}{item.edition?` · édition ${item.edition}`:''}</small></div><button type="button" disabled={disabled} onClick={()=>onOpen(p.id)} aria-label={`Ouvrir le projet · ${p.title}`}>Ouvrir<ArrowRight size={15} aria-hidden="true"/></button></div>
    {warning?<p className="programme-dossier-history-warning">{warning}. Ce lien n’est pas compté comme un livrable de la fiche actuelle.</p>:null}
    {item.relation==='weekly'?<p className="programme-dossier-detail">Semainier composite · un seul projet pour ses sept lignes d’origine.</p>:null}
    {item.derivation?<div className="programme-dossier-derivation"><p><strong>{item.derivation.label}</strong><span>Origine : {item.derivation.sourceProject.title} · source r{item.derivation.sourceRevision}</span></p>{item.derivation.announcement?<small>Annonce à la création : {item.derivation.announcement.day}{item.derivation.announcement.time?` · ${item.derivation.announcement.time}`:''}. Ce libellé ne détermine pas une date de diffusion.</small>:null}<small>Déclinaison directe · {item.derivation.batchName}. Les réglages actuels peuvent avoir été retouchés.</small></div>:null}
    <Origins origins={item.origins} project={p}/>
  </li>;
}
function checkPage(page:ProductionLinksPage,expected:{channel:string;planId:string;revision:number;rowId:string;section:ProductionLinksSection},previous:ProductionLinksContext|null){
  if(!page||!page.context||page.context.channelId!==expected.channel||page.context.planId!==expected.planId||page.context.planRevision!==expected.revision||page.context.rowId!==expected.rowId||page.section!==expected.section||!Array.isArray(page.items)||page.items.length>30||typeof page.context.snapshot!=='string'||!page.context.snapshot||page.next!==null&&typeof page.next!=='string'||previous&&page.context.snapshot!==previous.snapshot)throw Error('Le dossier a changé. Actualisez sa première page.');
  if(page.items.some(item=>!item||typeof item.id!=='string'||(expected.section==='occurrences'?item.type!=='occurrence':item.type!=='project'))||new Set(page.items.map(item=>item.id)).size!==page.items.length)throw Error('La page reçue est incohérente. Actualisez sa première page.');
  return page;
}
export default function ProgrammeProductionDossier({planId,revision,rowId,member,hasUnsavedChanges=false,onOpenRow,onOpenProject,onClose}:ProgrammeProductionDossierProps){
  const heading=useId(),[initial]=useState(()=>({channel:activeChannelId(),owner:member.email,role:member.role,active:member.active,planId,revision,rowId}));
  const [section,setSection]=useState<ProductionLinksSection>('occurrences'),[context,setContext]=useState<ProductionLinksContext|null>(null),[items,setItems]=useState<ProductionLinksItem[]>([]),[next,setNext]=useState<string|null>(null),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[invalid,setInvalid]=useState(false),[failedCursor,setFailedCursor]=useState<string|null>(null);
  const request=useRef<AbortController|null>(null),generation=useRef(0),mounted=useRef(true),seen=useRef(new Set<string>()),latest=useRef({context,items,section});latest.current={context,items,section};
  const contextChanged=initial.channel!==activeChannelId()||initial.owner!==member.email||initial.role!==member.role||initial.active!==member.active||member.active!==1||initial.planId!==planId||initial.revision!==revision||initial.rowId!==rowId;
  const unavailable=invalid||contextChanged;
  const read=useCallback(async(target:ProductionLinksSection,cursor:string|null=null)=>{
    if(initial.channel!==activeChannelId()||!mounted.current)return;
    request.current?.abort();const controller=new AbortController(),epoch=++generation.current;request.current=controller;
    const prior=cursor?latest.current.context:null,previousItems=cursor?latest.current.items:[];
    setBusy(true);setError('');setFailedCursor(cursor);
    if(!cursor){seen.current.clear();setContext(null);setItems([]);setNext(null);setLoaded(false);}
    const timer=setTimeout(()=>controller.abort(new Error('Lecture trop longue. Réessayez manuellement.')),12000);
    try{
      const aborted=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason??new DOMException('Lecture annulée.','AbortError')),{once:true}));
      const result=await Promise.race([productionLinksAPI.read(initial.planId,initial.rowId,initial.revision,target,cursor,controller.signal),aborted]);
      if(!mounted.current||epoch!==generation.current||controller.signal.aborted||initial.channel!==activeChannelId())return;
      const page=checkPage(result,{...initial,section:target},prior);
      if(page.next&&(page.next===cursor||seen.current.has(page.next))||page.items.some(item=>previousItems.some(old=>old.id===item.id))||previousItems.length+page.items.length>2000)throw Error('La pagination est incohérente. Actualisez sa première page ; aucune suite partielle n’est ajoutée.');
      if(cursor)seen.current.add(cursor);setContext(page.context);setItems([...previousItems,...page.items]);setNext(page.next);setLoaded(true);setFailedCursor(null);
    }catch(cause){if(mounted.current&&epoch===generation.current&&initial.channel===activeChannelId()){
      setError(cause instanceof Error?cause.message:'Lecture du dossier indisponible.');
      if(cause&&typeof cause==='object'&&'status'in cause&&[401,403,404,409].includes(Number(cause.status))){setItems([]);setContext(null);setNext(null);setLoaded(false);setFailedCursor(null);}
    }}finally{clearTimeout(timer);if(mounted.current&&epoch===generation.current)setBusy(false);}
  },[initial]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;++generation.current;request.current?.abort();};},[]);
  useEffect(()=>{if(contextChanged){++generation.current;request.current?.abort();setInvalid(true);setItems([]);setContext(null);setNext(null);setBusy(false);}},[contextChanged]);
  useEffect(()=>{const changed=()=>{++generation.current;request.current?.abort();setInvalid(true);setItems([]);setContext(null);setNext(null);setBusy(false);};window.addEventListener('srtb-channel-change',changed);return()=>window.removeEventListener('srtb-channel-change',changed);},[]);
  useEffect(()=>{if(!unavailable)void read(section);return()=>{++generation.current;request.current?.abort();};},[section,read,unavailable]);
  const projects=items.filter((item):item is ProductionProjectItem=>item.type==='project'),attached=projects.filter(item=>item.linkage==='same-programme'||item.linkage==='line-only'),historical=projects.filter(item=>item.linkage!=='same-programme'&&item.linkage!=='line-only');
  return <NewProjectDialog labelledBy={heading} busy={false} onClose={onClose}><div className="programme-production-dossier">
    <header><p className="programme-dossier-eyebrow">Lecture seule · dans cette préparation</p><h2 id={heading} tabIndex={-1} data-dialog-autofocus>Dossier de l’émission</h2><p className="programme-dossier-title">{context?.title||'Lecture de la ligne…'}</p>{context?<small>{context.planName} · r{context.planRevision}{context.scope==='line'?' · fiche émission non liée, cette ligne uniquement':''}</small>:null}</header>
    {hasUnsavedChanges?<p className="programme-dossier-notice">Vue de la préparation enregistrée. Vos retouches locales restent intactes.</p>:null}
    <nav className="programme-dossier-sections" aria-label="Sections du dossier">{productionLinksSections.map(value=><button type="button" key={value} aria-pressed={section===value} disabled={unavailable} onClick={()=>setSection(value)}>{sectionLabels[value]}</button>)}</nav>
    {unavailable?<p className="notice error" role="alert">Le compte, la chaîne ou la préparation a changé. Fermez ce dossier et ouvrez-le à nouveau.</p>:<>
      <div className="programme-dossier-toolbar"><p>{section==='occurrences'?'Les lignes explicitement liées à cette fiche.':section==='weekly'?'Les semainiers liés, comptés une seule fois.':section==='derivations'?'Déclinaisons directes des projets liés, selon vos droits.':'Projets visibles liés aux occurrences, indépendamment des choix actuels.'}</p><button type="button" disabled={busy} onClick={()=>void read(section)} aria-label="Actualiser le dossier"><RefreshCw size={15} aria-hidden="true"/><span>Actualiser</span></button></div>
      {error?<div className="notice error" role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={()=>void read(section,failedCursor)}>Réessayer la lecture</button></div>:null}
      {busy?<p role="status" className="programme-dossier-loading">Lecture du dossier…</p>:null}
      {section==='occurrences'?<ul className="programme-dossier-occurrences">{items.map(item=>item.type==='occurrence'?<li key={item.id}><div><strong>{item.occurrence.title}</strong>{item.occurrence.subtitle?<p>{item.occurrence.subtitle}</p>:null}<span>{dateLabel(item.occurrence.airDate)} · {item.occurrence.time.slice(0,5)||'Heure non précisée'}</span>{item.occurrence.airDate!==item.occurrence.broadcastDate?<small>Conducteur du {dateLabel(item.occurrence.broadcastDate)}</small>:null}{item.occurrence.sourceRemoved?<small>Ligne retirée du conducteur</small>:!item.occurrence.included?<small>Ligne écartée</small>:null}{item.coordination.length?<details><summary>Coordination · {item.coordination.length} tâches attribuées</summary><ul>{item.coordination.map(task=><li key={task.key}>{task.ownerName} · {states[task.state]||states.unknown} · {formatLabels[task.format]}</li>)}</ul><small>L’attribution ne donne pas accès aux projets privés.</small></details>:null}</div><button type="button" onClick={()=>onOpenRow(item.occurrence.rowId)} aria-label={`Ouvrir la ligne · ${item.occurrence.title} · ${item.occurrence.subtitle||item.occurrence.time}`}>Voir la ligne<ArrowRight size={15} aria-hidden="true"/></button></li>:null)}</ul>:<>
        {attached.length?<><p className="programme-dossier-count">{attached.length} lien{attached.length>1?'s':''} visible{attached.length>1?'s':''} affiché{attached.length>1?'s':''} dans ce dossier</p><ul className="programme-dossier-projects">{attached.map(item=><ProjectItem key={item.id} item={item} onOpen={onOpenProject} disabled={busy}/>)}</ul></>:null}
        {historical.length?<section className="programme-dossier-history"><h3>Historique à distinguer</h3><p>Ces liens restent consultables, sans être réaffectés à la fiche actuelle.</p><ul className="programme-dossier-projects">{historical.map(item=><ProjectItem key={item.id} item={item} onOpen={onOpenProject} disabled={busy}/>)}</ul></section>:null}
      </>}
      {loaded&&!items.length&&!busy&&!error?<p className="programme-dossier-empty">{next?'Aucun lien dans cette page. D’autres éléments autorisés restent à examiner.':section==='occurrences'?'Aucune occurrence dans cette vue.':'Aucun lien visible dans cette vue. Cela ne décrit pas les projets privés des collègues.'}</p>:null}
      {next?<button type="button" className="programme-dossier-more" disabled={busy||!!error} onClick={()=>void read(section,next)}>Afficher la suite</button>:null}
      <p className="programme-dossier-footnote">Les états indiquent la validation, pas un export ou une diffusion. Aucun média n’est chargé ici. Les révisions décrivent l’origine, pas la mise à jour des projets.</p>
    </>}
    <footer><button type="button" onClick={onClose}>Fermer le dossier</button></footer>
  </div></NewProjectDialog>;
}
