import {lazy,Suspense,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {ArrowLeft,ArrowUpRight,Layers,RefreshCw} from 'lucide-react';
import type {BroadcastTemplate,Project,ProjectData} from './domain';
import {getTemplate,statusLabels} from './domain';
import {ApiError} from './api';
import {derivations} from './derivation-api';
import {derivationChoices,deriveProjects,canDerive} from './derivation-model';
import type {DerivationRequest,DerivationTarget,DerivationAnnouncement,DerivedProject} from './derivation-model';
import type {DerivationBatch,DerivationPage} from './derivation-types';
import {defaultDerivationOptions,derivationIntent} from './derivation-workbench';
import {localMediaSnapshot,stableLocalData,subscribeLocalMedia} from './local-media';
import {createDerivationExportQueue} from './derivation-export-queue';
import type {DerivationExportQueue,DerivationExportState} from './derivation-export-queue';
import type {VideoOptions} from './video/export';
import {ExportReport} from './VideoExport';
import {NATIVE_ONLY_EXPORT} from './video/release-profile';
import {dimensions} from './presentation';
import NewProjectDialog from './NewProjectDialog';
import LocalMedia from './LocalMedia';
import Activity from './Activity';
import SurfaceTransition from './ui/SurfaceTransition';
import DerivationAnnouncements from './DerivationAnnouncements';
import AnnouncementLocalVoices from './AnnouncementLocalVoices';
import {announcementVoiceSelectionKey,announcementVoicesReady} from './announcement-local-voices';
import type {AnnouncementVoiceSources} from './announcement-local-voices';
import DerivationArchiveDownload from './DerivationArchiveDownload';
import {createDerivationArchiveTask,initialDerivationArchiveState,planDerivationArchive} from './derivation-archive';
import type {DerivationArchiveTask,DerivationArchiveDownloadLink} from './derivation-archive';
import {hasDerivationArchivePicker,openDerivationArchive} from './derivation-archive-save';
import {bindVideoSession} from './video-snapshot';
import {sessionState} from './session-state';
import './derivations.css';

const ExportReview=lazy(()=>import('./ExportReview'));
const errorText=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
const statuses={pending:'En attente',preflight:'Vérification',ready:'Prêt',rendering:'Calcul en cours',completed:'Terminé',failed:'À reprendre',cancelled:'Annulé'};
type Props={open:boolean;onClose:()=>void;project:Project;template:BroadcastTemplate;title:string;data:ProjectData;dirty:boolean;disabled:boolean;onOpenProject:(project:Project)=>void;onCreated:(project:Project)=>void;onRunningChange:(running:boolean)=>void};
type Attempt={intent:DerivationRequest;export:boolean;options:Record<string,VideoOptions>};

function FormatChoice({label,data,options,onChange,disabled}:{label:string;data:ProjectData;options:VideoOptions;onChange:(value:VideoOptions)=>void;disabled:boolean}){
  return <div className="derivation-format"><label>Fichier · {label}<select disabled={disabled} value={options.format} onChange={event=>onChange({...options,format:event.target.value as VideoOptions['format']})}><option value="mp4">MP4 · fond opaque</option><option value="mov">MOV · ProRes 4444 + alpha</option><option value="png">PNG · séquence alpha (.zip)</option><option value="alpha">WebM · VP9 + alpha</option></select></label>{data._out_mode==='manual'?<label>OUT après (s)<input disabled={disabled} type="number" min={0} max={590} step={.04} value={options.manualOut} onChange={event=>onChange({...options,manualOut:Number(event.target.value)})}/></label>:null}</div>;
}

/** Private in-memory intent and results. Closing the dialog hides it, but does
 * not recreate projects, discard downloads or change the source Workspace. */
export default function DerivationPanel({open,onClose,project,template,title,data,dirty,disabled,onOpenProject,onCreated,onRunningChange}:Props){
  useSyncExternalStore(subscribeLocalMedia,localMediaSnapshot,localMediaSnapshot);
  const canCreate=canDerive(template.id)&&!project.archived;
  const [view,setView]=useState<'create'|'sets'|'detail'>(canCreate?'create':'sets');
  const [name,setName]=useState(()=>`${title.slice(0,100)} — déclinaisons`);
  const [selected,setSelected]=useState<DerivationTarget[]>(()=>derivationChoices(data,template.id).filter(value=>value.selected).map(value=>value.key));
  const [replayUrl,setReplayUrl]=useState(''),[options,setOptions]=useState<Record<string,VideoOptions>>({});
  const [announcements,setAnnouncements]=useState<DerivationAnnouncement[]>([]),[announcementFormat,setAnnouncementFormat]=useState<VideoOptions['format']>('mp4'),[withoutVoice,setWithoutVoice]=useState<string[]>([]);
  const [validVoicePlacement,setValidVoicePlacement]=useState(true);
  const [voiceSources,setVoiceSources]=useState<AnnouncementVoiceSources|null>(null);
  const [voiceRetry,setVoiceRetry]=useState(0);
  const [page,setPage]=useState<DerivationPage>({batches:[],next:null}),[batch,setBatch]=useState<DerivationBatch|null>(null);
  const [loading,setLoading]=useState(false),[working,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [attempt,setAttempt]=useState<Attempt|null>(null),[uncertain,setUncertain]=useState(false);
  const [chosenChildren,setChosenChildren]=useState<string[]>([]),[queueState,setQueueState]=useState<DerivationExportState|null>(null),[review,setReview]=useState<string|null>(null);
  const [downloads,setDownloads]=useState<Record<string,{url:string;filename:string}>>({});
  const [archiveState,setArchiveState]=useState(initialDerivationArchiveState),[archiveDownload,setArchiveDownload]=useState<DerivationArchiveDownloadLink|null>(null);
  const archive=useRef<DerivationArchiveTask|null>(null),archiveUrl=useRef<string|null>(null);
  const busy=working||archiveState.running;
  const queue=useRef<DerivationExportQueue|null>(null),urls=useRef(new Map<string,{blob:Blob;url:string}>()),locked=useRef(false),mounted=useRef(true);
  const panel=useRef<HTMLDivElement|null>(null),scrollToReceipt=useRef(false);
  const runningCallback=useRef(onRunningChange);runningCallback.current=onRunningChange;
  const running=!!queueState?.running,hasQueue=!!queueState?.items.length;
  useEffect(()=>{mounted.current=true;return()=>{
    mounted.current=false;
    // Capture this mount's owners before awaiting; StrictMode can mount again.
    const oldArchive=archive.current,oldQueue=queue.current,oldUrls=urls.current,oldArchiveUrl=archiveUrl.current;
    archive.current=null;queue.current=null;urls.current=new Map();archiveUrl.current=null;
    void (async()=>{try{await oldArchive?.dispose();await oldQueue?.dispose();}finally{for(const value of oldUrls.values())URL.revokeObjectURL(value.url);oldUrls.clear();if(oldArchiveUrl)URL.revokeObjectURL(oldArchiveUrl);}})().catch(()=>undefined);
  };},[]);
  useEffect(()=>{runningCallback.current(busy||running);},[busy,running]);
  useEffect(()=>{if(!open)archive.current?.cancel();},[open]);
  useEffect(()=>{if(open&&view==='detail'&&batch&&scrollToReceipt.current){panel.current?.closest('dialog')?.scrollTo({top:0,left:0});scrollToReceipt.current=false;}},[open,view,batch]);
  useEffect(()=>{if(!running&&!busy)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[running,busy]);
  useEffect(()=>{if(!open||view!=='sets')return;const task=new AbortController();setLoading(true);setError('');void derivations.list(project.id,null,task.signal).then(setPage).catch(cause=>{if(!task.signal.aborted)setError(errorText(cause));}).finally(()=>{if(!task.signal.aborted)setLoading(false);});return()=>task.abort();},[open,view,project.id]);
  const plan=useMemo(()=>{
    try{const stable=stableLocalData(template,data),source={templateId:template.id,templateVersion:project.template_version,libraryVersion:project.library_version,title,data:stable};
      let announced:DerivedProject[]=[],announcementError='';try{if(announcements.length)announced=deriveProjects(source,[],'',announcements);}catch(cause){announcementError=errorText(cause);}
      return {stable,error:'',announced,announcementError,choices:derivationChoices(stable,template.id).map(choice=>{try{return {...choice,derived:deriveProjects(source,[choice.key],replayUrl)[0],error:''};}catch(cause){return {...choice,derived:null,error:errorText(cause)};}})};
    }catch(cause){return {stable:null,error:errorText(cause),choices:[],announced:[],announcementError:''};}
  },[template,project.template_version,project.library_version,title,data,replayUrl,announcements]);
  const picked=plan.choices.filter(choice=>selected.includes(choice.key));
  const total=picked.length+announcements.reduce((count,item)=>count+item.formats.length,0),pendingVoice=announcements.some(item=>item.voice.mode==='pending');
  const localVoicesReady=announcementVoicesReady(announcements,voiceSources),currentVoiceSources=voiceSources?.key===announcementVoiceSelectionKey(announcements)?voiceSources:null;
  const invalid=!!plan.error||!!plan.announcementError||!validVoicePlacement||!total||total>8||picked.some(choice=>!choice.derived)||!name.trim()||!title.trim();
  const chosenVoicePending=!!batch?.children.some(child=>chosenChildren.includes(child.project.id)&&child.announcement?.voice.status==='pending'&&!child.project.data._audio_voice_enabled&&!withoutVoice.includes(`${child.project.id}:${child.project.revision}`));
  function observe(state:DerivationExportState){
    if(!mounted.current)return;
    const files:Record<string,{url:string;filename:string}>={};
    for(const item of state.items)if(item.result){let saved=urls.current.get(item.key);if(!saved||saved.blob!==item.result.blob){if(saved)URL.revokeObjectURL(saved.url);saved={blob:item.result.blob,url:URL.createObjectURL(item.result.blob)};urls.current.set(item.key,saved);}files[item.key]={url:saved.url,filename:item.result.filename};}
    setDownloads(files);setQueueState(state);
  }
  async function clearQueue():Promise<boolean>{
    if(archive.current?.running()||queue.current?.snapshot().running)return false;
    if(urls.current.size&&!window.confirm('Fermer cette file ? Téléchargez les fichiers à conserver : les liens de cet onglet seront libérés. Les projets enregistrés restent disponibles.'))return false;
    await archive.current?.dispose();archive.current=null;setArchiveState(initialDerivationArchiveState);if(archiveUrl.current)URL.revokeObjectURL(archiveUrl.current);archiveUrl.current=null;setArchiveDownload(null);
    await queue.current?.dispose();queue.current=null;for(const value of urls.current.values())URL.revokeObjectURL(value.url);urls.current.clear();setDownloads({});setQueueState(null);setReview(null);return true;
  }
  async function run(action:()=>Promise<void>){if(locked.current||archive.current?.running())return;locked.current=true;setBusy(true);setError('');try{await action();}catch(cause){if(mounted.current)setError(errorText(cause));}finally{locked.current=false;if(mounted.current)setBusy(false);}}
  async function downloadArchive(){
    if(disabled||locked.current||archive.current?.running()||!queue.current)return;
    try{
      const prepared=planDerivationArchive(queue.current.snapshot()),permitted=sessionState.permission();
      if(!archive.current){const next=createDerivationArchiveTask({bindSession:bindVideoSession,onChange:state=>{if(mounted.current&&archive.current===next)setArchiveState(state);}});archive.current=next;}
      const task=archive.current,filename=`SRTB_ensemble_${batch?.id??project.id}_${prepared.files.length}sur${prepared.requestedCount}.zip`;
      const result=await task.run(prepared,signal=>openDerivationArchive(prepared,filename,signal));
      if(!result?.blob||!mounted.current||archive.current!==task||!permitted())return;
      const url=URL.createObjectURL(result.blob),previous=archiveUrl.current;archiveUrl.current=url;setArchiveDownload({url,filename,count:result.count,requestedCount:result.requestedCount,complete:result.complete});
      // A single explicit bundle download, never one synthetic click per file.
      const link=document.createElement('a');link.href=url;link.download=filename;link.click();if(previous)URL.revokeObjectURL(previous);
    }catch(cause){if(mounted.current)setError(errorText(cause));}
  }
  function childOptions(child:DerivationBatch['children'][number],settings=options){return settings[child.targetKey]??defaultDerivationOptions(child.project);}
  async function startExports(value:DerivationBatch,ids:string[],settings=options){
    const children=value.children.filter(child=>ids.includes(child.project.id));
    if(!children.length)throw Error('Choisissez au moins une déclinaison active.');
    if(children.some(child=>child.project.archived))throw Error('Un projet est archivé : restaurez-le avant de l’exporter.');
    if(children.some(child=>child.announcement?.voice.status==='pending'&&!child.project.data._audio_voice_enabled&&!withoutVoice.includes(`${child.project.id}:${child.project.revision}`)))throw Error('Une annonce attend sa voix. Associez-la dans le projet ou choisissez explicitement « Sans voix off » pour cet export.');
    if(queue.current&&!await clearQueue())return;
    const next=createDerivationExportQueue({onChange:observe});queue.current=next;
    next.configure(children.map(child=>({key:child.project.id,project:child.project,options:childOptions(child,settings),revisionSource:'current'})));
    await next.run();
  }
  function accept(value:DerivationBatch){scrollToReceipt.current=true;setBatch(value);setChosenChildren(value.children.filter(child=>!child.project.archived).map(child=>child.project.id));setView('detail');setMessage('Ensemble enregistré. Les variantes sont indépendantes ; le projet source n’a pas été enregistré ni modifié.');for(const child of value.children)onCreated(child.project);}
  async function submit(exportNow:boolean){
    if(disabled||!canCreate||locked.current)return;
    await run(async()=>{
      if(exportNow&&!announcementVoicesReady(announcements,voiceSources))throw Error('Reconnectez les fichiers des voix choisies avant l’export. Vos choix et leurs révisions sont conservés ; la préparation des brouillons reste possible.');
      let current=attempt;
      if(!current){
        if(invalid||!plan.stable)throw Error('Complétez les sorties choisies avant de préparer l’ensemble.');
        if(exportNow&&pendingVoice)throw Error('Choisissez les voix ou « Sans voix off » avant le calcul. La préparation des brouillons reste disponible.');
        const settings={...options};for(const item of plan.announced)settings[item.targetKey]={...defaultDerivationOptions({template_id:item.templateId,data:item.data}),format:announcementFormat};
        current={intent:derivationIntent(template,project,title,plan.stable,name,picked.map(choice=>choice.key),replayUrl,crypto.randomUUID(),announcements),export:exportNow,options:structuredClone(settings)};
        setAttempt(current);
      }
      let value:DerivationBatch;
      try{value=await derivations.create(project.id,current.intent);}catch(cause){setUncertain(!(cause instanceof ApiError)||cause.status===0||cause.status>=500);throw cause;}
      setUncertain(false);setAttempt(null);setOptions(current.options);accept(value);
      if(current.export){
        if(value.children.length!==value.childCount||value.children.some(child=>child.project.archived||child.project.revision!==1)){setMessage('Demande retrouvée sans doublon. Des variantes ont évolué : choisissez explicitement les révisions affichées avant de les exporter.');return;}
        await startExports(value,value.children.map(child=>child.project.id),current.options);
      }
    });
  }
  function openProject(value:Project){if(running||busy||archive.current?.running())return;onClose();onOpenProject(value);}
  const currentItem=queueState?.items.find(item=>item.key===queueState.currentKey);
  const archiveOffer=useMemo(()=>{try{return {plan:queueState?planDerivationArchive(queueState):null,reason:''};}catch(cause){return {plan:null,reason:errorText(cause)};}},[queueState]);
  if(!open)return null;
  return <NewProjectDialog labelledBy="derivations-heading" busy={busy&&!running} onClose={onClose}><div className="derivation-panel" ref={panel}>
    <div className="preparation-heading"><div><p className="eyebrow">Un projet · plusieurs formats</p><h2 id="derivations-heading">{view==='detail'&&batch?batch.name:'Créer les déclinaisons'}</h2><p>Des brouillons liés, modifiables séparément. Aucun envoi à l’antenne.</p></div><Layers size={27} aria-hidden="true"/></div>
    <nav className="derivation-tabs" aria-label="Déclinaisons"><button disabled={busy||running||!canCreate} aria-current={view==='create'?'page':undefined} onClick={()=>void run(async()=>{if(await clearQueue())setView('create');})}>Nouvel ensemble</button><button disabled={busy||running} aria-current={view==='sets'?'page':undefined} onClick={()=>setView('sets')}>Ensembles liés</button>{hasQueue?<button disabled={busy&&!running} aria-current={view==='detail'?'page':undefined} onClick={()=>setView('detail')}>File d’exports{running?' · en cours':''}</button>:null}</nav>
    {error?<p className="notice error" role="alert">{error}</p>:null}{message?<p className="notice" role="status">{message}</p>:null}
    <SurfaceTransition identity={view}>
    {view==='create'?<><p className="notice">Les déclinaisons reprennent vos réglages affichés{dirty?' non enregistrés':''} ; le projet source reste inchangé. Source enregistrée : <strong>r{project.revision}</strong>. Les nouveaux projets sont privés ; leur partage reste votre choix.</p>
      {attempt?<div className="notice warning"><p>Demande conservée. « Réessayer la même demande » retrouve le même ensemble sans créer de doublon ; vos choix sont figés pendant cette reprise.</p>{uncertain?<p>La réponse n’est pas confirmée. Réessayez avant de préparer une autre demande, ou consultez les ensembles liés.</p>:<button disabled={busy} onClick={()=>{setAttempt(null);setError('');}}>Corriger les choix</button>}<button className="primary" disabled={busy||disabled||attempt.export&&!localVoicesReady} onClick={()=>void submit(attempt.export)}>Réessayer la même demande</button></div>:null}
      <fieldset disabled={busy||disabled||!!attempt}><legend>1 · Choisir les éléments</legend><label>Nom de l’ensemble<input maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label>
        {template.id==='BTV_BA_1P'?<DerivationAnnouncements data={data} value={announcements} onChange={setAnnouncements} onFive={()=>setSelected([])} disabled={busy||disabled||!!attempt} fileFormat={announcementFormat} onFileFormat={setAnnouncementFormat} onPlacementValidity={setValidVoicePlacement} onVoiceSources={setVoiceSources} voiceRetry={voiceRetry}/>:<p>Recette du modèle : les textes et médias sont repris dans les formats choisis. Vous gardez le choix des éléments à créer.</p>}
        {plan.announcementError?<p className="notice warning" role="status">{plan.announcementError}</p>:null}
        {plan.error?<p className="notice warning" role="status">{plan.error} Aucun fichier n’est envoyé.</p>:null}
        <details className="derivation-additional" open={!announcements.length}><summary>Formats et éléments liés · {picked.length} sélectionné(s)</summary><p className="small">{template.id==='BTV_BA_1P'?'Ces éléments reprennent la BA affichée, indépendamment des cinq variantes ci-dessus.':'Ces éléments reprennent le projet affiché. Chaque déclinaison peut ensuite être ajustée séparément.'}</p><div className="derivation-choices">{plan.choices.map(choice=>{const checked=selected.includes(choice.key),unavailable=!choice.derived&&choice.key!=='replay',settings=options[choice.key]??defaultDerivationOptions({template_id:choice.derived?.templateId??'BTV_Passerelle_Replay',data:choice.derived?.data??{}});
          return <article className={`derivation-choice${checked?' selected':''}`} key={choice.key}><label className="derivation-choice-label"><input type="checkbox" disabled={unavailable&&!checked} checked={checked} onChange={event=>setSelected(current=>event.target.checked?[...current,choice.key]:current.filter(key=>key!==choice.key))}/><span><strong>{choice.label}</strong><small>{choice.description}</small></span></label>{unavailable?<p className="notice warning">Indisponible : {choice.error}</p>:null}{checked&&choice.key==='replay'?<label>Adresse HTTPS pour le QR code<input type="url" value={replayUrl} maxLength={200} placeholder="https://…" onChange={event=>setReplayUrl(event.target.value)}/></label>:null}{checked&&choice.error&&!unavailable?<p className="small" role="status">{choice.error}</p>:null}{checked&&choice.derived?<><p className="small derivation-title">{choice.derived.title}</p><FormatChoice label={choice.label} data={choice.derived.data} options={settings} disabled={busy||!!attempt} onChange={value=>setOptions(current=>({...current,[choice.key]:value}))}/><details><summary>Ce qui est repris · points à contrôler</summary><ul>{choice.derived.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></details></>:null}</article>;
        })}</div></details>
      </fieldset>
      {currentVoiceSources?<AnnouncementLocalVoices key={currentVoiceSources.key} sources={currentVoiceSources} disabled={busy||disabled}/>:!localVoicesReady?<p className="notice warning" role="status">Vérification des références des voix choisies avant export… La préparation des brouillons reste possible.</p>:null}
      {currentVoiceSources?.unresolved?<button type="button" disabled={busy||disabled} onClick={()=>setVoiceRetry(value=>value+1)}>Réessayer les révisions de voix épinglées</button>:null}
      <section className="derivation-decision"><h3>2 · Que souhaitez-vous faire ?</h3><p><strong>{total} sortie(s) sélectionnée(s) / 8 maximum</strong> · médias locaux conservés sur le poste.</p>{total>8?<p className="notice warning">Ce lot accepte au maximum 8 sorties. Réduisez les annonces ou les formats ; aucune sélection ne sera retirée automatiquement.</p>:null}{plan.announced.length?<details><summary>Récapitulatif des {total} sorties</summary><ul>{[...plan.announced,...picked.flatMap(item=>item.derived?[item.derived]:[])].map(item=><li key={item.targetKey}>{item.title}</li>)}</ul></details>:null}{pendingVoice?<p className="notice">Voix à associer : vous pouvez préparer les brouillons maintenant. Pour calculer les fichiers, choisissez une voix attestée ou « Sans voix off » explicitement.</p>:null}<div><button disabled={busy||disabled||invalid||!!attempt} onClick={()=>void submit(false)}><strong>Préparer les projets</strong><span>Créer les brouillons pour les ajuster. Aucun calcul vidéo.</span></button><button className="primary" disabled={busy||disabled||invalid||!!attempt||pendingVoice||!localVoicesReady} onClick={()=>void submit(true)}><strong>Préparer et exporter</strong><span>Créer les mêmes brouillons, puis calculer les formats choisis ci-dessus.</span></button></div></section>
      <p className="small muted">MOV, PNG et WebM conservent l’alpha ; MP4 est opaque.{NATIVE_ONLY_EXPORT?' MP4 natif : cible 50 Mb/s, plancher 30 Mb/s non garanti ; mesures après calcul.':''} Pour les pop-ups et le petit élément TDS distinct, le son de la BA n’est pas transféré. Les cinq annonces BA, dont « Tout de suite », conservent leur corps et leur musique. Contrôlez chaque composition avant utilisation.</p>
    </>:null}
    {view==='sets'?<section aria-label="Ensembles liés à ce projet"><div className="row wrap"><h3>Ensembles retrouvables</h3><button className="icon-button" aria-label="Actualiser les ensembles" disabled={loading||busy} onClick={()=>void run(async()=>setPage(await derivations.list(project.id)))}><RefreshCw size={16}/></button></div>{loading?<Activity label="Chargement des ensembles"/>:!page.batches.length?<p className="empty">Aucun ensemble lié à ce projet pour le moment.</p>:<div className="derivation-sets">{page.batches.map(value=><button key={value.id} disabled={busy||running} onClick={()=>void run(async()=>{if(batch?.id!==value.id&&!await clearQueue())return;const full=await derivations.get(value.id);setBatch(full);setChosenChildren(full.children.filter(child=>!child.project.archived).map(child=>child.project.id));setView('detail');setMessage('');})}><span><strong>{value.name}</strong><small>{value.childCount} déclinaisons · source r{value.sourceRevision} · {new Date(value.createdAt).toLocaleDateString('fr-FR')}</small></span><ArrowUpRight size={17}/></button>)}</div>}{page.next?<button disabled={busy} onClick={()=>void run(async()=>{const next=await derivations.list(project.id,page.next);setPage(current=>({batches:[...current.batches,...next.batches.filter(value=>!current.batches.some(old=>old.id===value.id))],next:next.next}));})}>Charger la suite</button>:null}</section>:null}
    {view==='detail'&&batch?<section aria-label="Ensemble et exports"><button className="quiet" disabled={busy||running} onClick={()=>setView('sets')}><ArrowLeft size={16}/>Retour aux ensembles</button><div className="derivation-receipt"><strong>{batch.childCount} brouillons liés · source r{batch.sourceRevision}</strong><p>{batch.sourceSnapshot.title} · {new Date(batch.createdAt).toLocaleString('fr-FR')}</p><details><summary>Reçu et provenance</summary><p className="small">Ensemble {batch.id}<br/>Snapshot SHA-256 : {batch.sourceSnapshotSha256}<br/>Mapping {batch.mappingVersion} · bibliothèque {batch.sourceLibraryVersion}</p><p className="small">Le reçu conserve les réglages de départ, y compris les modifications non enregistrées de la source. Chaque variante évolue indépendamment.</p></details></div>
      {batch.children.length<batch.childCount?<p className="notice warning">{batch.childCount-batch.children.length} élément(s) ne sont plus accessibles. Aucun projet de remplacement ne sera créé automatiquement.</p>:null}
      {hasQueue?<DerivationArchiveDownload plan={archiveOffer.plan} reason={archiveOffer.reason} state={archiveState} directSave={hasDerivationArchivePicker()} disabled={busy||running||disabled} onDownload={()=>void downloadArchive()} onCancel={()=>archive.current?.cancel()} download={archiveDownload}/>:null}
      {hasQueue?<p className="notice">La file utilise les révisions affichées lors de son lancement. Vos modifications ultérieures et celles des collègues ne changent pas un calcul déjà lancé.</p>:<p className="small">Versions enregistrées chargées ci-dessous. Choisissez les éléments à exporter ; chaque révision affichée sera figée au lancement.</p>}
      <div className="derivation-children">{batch.children.map(child=>{const job=queueState?.items.find(item=>item.key===child.project.id),download=downloads[child.project.id],settings=childOptions(child);return <article key={child.project.id} className="derivation-child"><div className="derivation-child-heading"><label><input type="checkbox" disabled={busy||running||hasQueue||!!child.project.archived} checked={!child.project.archived&&chosenChildren.includes(child.project.id)} onChange={event=>setChosenChildren(current=>event.target.checked?[...current,child.project.id]:current.filter(id=>id!==child.project.id))}/><span><strong>{child.label}</strong><small>{child.project.title}</small></span></label><button disabled={busy||running} onClick={()=>openProject(child.project)}>Ouvrir le projet <ArrowUpRight size={15}/></button></div><p className="small muted">{dimensions(child.project.data).label} · r{child.project.revision}{child.project.revision!==1?' (modifiée depuis la création r1)':''} · {child.project.archived?'archivé — export désactivé':statusLabels[child.project.status]}</p>
        {!hasQueue&&!child.project.archived?<FormatChoice label={child.label} data={child.project.data} options={settings} disabled={busy||running} onChange={value=>setOptions(current=>({...current,[child.targetKey]:value}))}/>:null}
        {child.announcement?<p className="small">Annonce : <strong>{child.announcement.day}{child.announcement.time?' · '+child.announcement.time:''}</strong> · {child.announcement.voice.status==='resolved'?`Voix attestée ${child.announcement.voice.label} · r${child.announcement.voice.revision}`:child.announcement.voice.status==='none'?'Sans voix off · choix explicite':'Voix à associer à la création'}</p>:null}
        {child.announcement?.voice.status==='pending'&&!child.project.data._audio_voice_enabled&&!hasQueue&&!child.project.archived?<label className="announcement-no-voice"><input type="checkbox" disabled={busy} checked={withoutVoice.includes(`${child.project.id}:${child.project.revision}`)} onChange={event=>setWithoutVoice(current=>event.target.checked?[...current,`${child.project.id}:${child.project.revision}`]:current.filter(value=>value!==`${child.project.id}:${child.project.revision}`))}/>Sans voix off pour cet export · la musique reste selon les réglages</label>:null}
        <details><summary>Points à contrôler</summary><ul>{child.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></details>
        {!child.project.archived?<LocalMedia template={getTemplate(child.project.template_id)} data={child.project.data}/>:null}
        {job?<div className="derivation-job"><strong>{statuses[job.status]} · {job.options.format.toUpperCase()} · snapshot r{job.project.revision}</strong>{job.error?<p className="notice error" role="alert">{job.error}</p>:null}{download?<a className="button-link primary" href={download.url} download={download.filename}>Télécharger {job.options.format==='png'?'la séquence PNG':job.options.format.toUpperCase()}</a>:null}{job.result?<details><summary>Rapport mesuré</summary><ExportReport report={job.result.report}/></details>:null}{job.result&&job.options.format!=='png'?<><button onClick={()=>setReview(review===job.key?null:job.key)}>{review===job.key?'Fermer le contrôle':'Contrôler les images et l’alpha'}</button>{review===job.key?<Suspense fallback={<Activity label="Ouverture du contrôle"/>}><ExportReview blob={job.result.blob} duration={job.result.report.duration}/></Suspense>:null}</>:null}{!running&&!busy&&['failed','cancelled','pending'].includes(job.status)?<button onClick={()=>void run(async()=>{await queue.current?.run([job.key]);})}>Réessayer ce fichier</button>:null}</div>:null}</article>;})}</div>
      {chosenVoicePending&&!hasQueue?<p className="notice" id="derivation-pending-voice" role="status">Une annonce sélectionnée attend sa voix. Associez-la dans le projet ou cochez « Sans voix off pour cet export » avant de lancer le calcul.</p>:null}
      {running?<section className="derivation-progress" aria-live="polite"><h3>{queueState.phase==='preflight'?'Vérification de toutes les sorties':'Calcul séquentiel'} · {queueState.selectedKeys.indexOf(queueState.currentKey||'')+1}/{queueState.selectedKeys.length}</h3><Activity label={currentItem?.progress.message||'Préparation…'} percent={queueState.phase==='rendering'?currentItem?.progress.percent:undefined}/><button onClick={()=>queue.current?.cancel()}>Annuler la file — garder les fichiers terminés</button></section>:hasQueue?<div className="row wrap"><button disabled={busy||!queueState.items.some(item=>item.status!=='completed')} onClick={()=>void run(async()=>{await queue.current?.run();})}>Reprendre les fichiers non terminés</button><button disabled={busy} onClick={()=>void run(async()=>{await clearQueue();})}>Préparer une nouvelle file</button></div>:<div className="row wrap"><button className="primary" disabled={busy||disabled||!chosenChildren.length||chosenVoicePending} aria-describedby={chosenVoicePending?'derivation-pending-voice':undefined} onClick={()=>void run(async()=>startExports(batch,chosenChildren))}>Exporter les {chosenChildren.length} versions affichées</button><button disabled={busy} onClick={()=>void run(async()=>{const next=await derivations.get(batch.id);setBatch(next);setChosenChildren(next.children.filter(child=>!child.project.archived).map(child=>child.project.id));setMessage('Versions enregistrées actualisées. Vérifiez les numéros de révision avant de lancer les exports.');})}>Actualiser les révisions</button></div>}
      <p className="small muted">Calcul local et séquentiel, sans transfert des médias. Téléchargez les fichiers à conserver avant de quitter le projet ou cet onglet. L’annulation ne supprime aucun brouillon. Aucun export ne valide la diffusion.</p>
    </section>:null}
    </SurfaceTransition>
  </div></NewProjectDialog>;
}
