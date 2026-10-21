import {useEffect,useRef,useState} from 'react';
import {Archive,ArrowLeft,Copy,Download,History,Plus,Save,X,Mic2,Music2,ImagePlus,Type,Palette,Trash2} from 'lucide-react';
import type {MediaAsset,Member} from '../domain';
import ThemeToggle from '../ThemeToggle';
import LogoutButton from '../LogoutButton';
import CommercialDialog from './CommercialDialog';
import {createFormExitGuard} from '../form-exit-guard';
import {downloadJson} from '../api';
import {commercialApi} from './api';
import {COMMERCIAL_EXAMPLE_TITLE,prepareCommercialExample} from './example';
import type {CommercialProject,CommercialRevision,CommercialCursor} from './api';
import {commercialBodyLimit,DEFAULT_COMMERCIAL_DATA,normalizeCommercialData,validateCommercialData,commercialTextSlots,commercialSequenceTimeline,createCommercialSequences,updateCommercialTextPage} from './model';
import {COMMERCIAL_LAYOUT_LABELS} from './sequence-labels';
import type {CommercialData,CommercialAudio,CommercialLogo} from './model';
import CommercialPreview from './CommercialPreview';
import MediaChoice from './MediaChoice';
import type {SelectedCommercialMedia} from './MediaChoice';
import AudioSettings from './AudioSettings';
import DurationSettings from './DurationSettings';
import TypographySettings from './TypographySettings';
import TextPresentation,{TextDistribution} from './TextPresentation';
import {splitCommercialPages} from './readable-layout';
import LogoSettings from './LogoSettings';
import type {CommercialSelection} from './editing';
import {canonicalCommercialLogo,fitCommercialLogoToAsset} from './logo-layout';
import type {CommercialLogoSize} from './logo-layout';
import {missingCommercialMedia,newCommercialAudio,resolveCommercialMedia} from './media';
import {exportCommercialVideo} from './export';
import {probeCommercialExportCapabilities} from './encoding';
import type {CommercialProgress,CommercialReport} from './export';
import {sessionState} from '../session-state';
import {connectedLocal,localURL} from '../local-media';
import './commercial.css';
import './editor-actions.css';

const fresh=():CommercialData=>({...structuredClone(DEFAULT_COMMERCIAL_DATA),textMode:'summary',sequenceTiming:'auto',sequences:[{id:crypto.randomUUID(),layout:'central',duration:8,pages:[{title:'COMMUNIQUÉ',body:''}]}]});
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
function selectedAudio(previous:CommercialAudio|null,item:SelectedCommercialMedia|null,voice:boolean):CommercialAudio|null{
  if(!item)return null;
  if(previous&&(previous.url===item.url||previous.url===item.replacesUrl))return {...previous,url:item.url,name:item.name,duration:item.duration};
  return newCommercialAudio(item.url,item.name,item.duration,voice);
}
function selectedLogo(previous:CommercialLogo|null,item:SelectedCommercialMedia|null):CommercialLogo|null{
  if(!item)return null;
  if(previous&&(previous.url===item.url||previous.url===item.replacesUrl))return {...previous,url:item.url,name:item.name};
  return {url:item.url,name:item.name,presentation:'adaptive',crop:true,removeBackground:true,plate:'showcase',mode:'original',position:'bottom-right',scale:1,opacity:1,offsetX:0,offsetY:0,motion:'fade',delay:0};
}
interface Recovery {project:CommercialProject|null;title:string;data:CommercialData}
type InspectorTab='text'|'audio'|'logo'|'appearance';
const INSPECTOR_TABS=[['audio','Voix & musique',Mic2],['text','Textes',Type],['logo','Logo annonceur',ImagePlus],['appearance','Style',Palette]] as const;
export default function Commercial({member}:{member:Member}){
  const [projects,setProjects]=useState<CommercialProject[]>([]),[project,setProject]=useState<CommercialProject|null>(null),[title,setTitle]=useState('Nouvelle annonce'),[data,setData]=useState<CommercialData>(fresh);
  const [nextPage,setNextPage]=useState<CommercialCursor>(null);
  const [media,setMedia]=useState<MediaAsset[]>([]),[tab,setTab]=useState<InspectorTab>('audio'),[page,setPage]=useState(0),[archived,setArchived]=useState(false);
  const inspector=useRef<HTMLElement>(null);
  const [selection,setSelection]=useState<CommercialSelection|null>(null),[selectionRequest,setSelectionRequest]=useState(0);
  const [editRequest,setEditRequest]=useState(0);
  const [documentAction,setDocumentAction]=useState<'new'|'duplicate'|'delete'|null>(null),[actionTitle,setActionTitle]=useState('Nouvelle annonce'),[copyAudio,setCopyAudio]=useState(false);
  const [logoAsset,setLogoAsset]=useState<(CommercialLogoSize&{url:string})|null>(null);
  const logoSize=data.logo&&logoAsset&&connectedLocal(data.logo.url)&&logoAsset.url===localURL(data.logo.url)?logoAsset:null;
  const effectiveLogo=data.logo&&logoSize?canonicalCommercialLogo(data.logo,logoSize):data.logo;
  const [exportSupport,setExportSupport]=useState<Awaited<ReturnType<typeof probeCommercialExportCapabilities>>|null>(null);
  const [supportError,setSupportError]=useState('');
  const [busy,setBusy]=useState(false),[mediaBusy,setMediaBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[dirty,setDirty]=useState(false),[pending,setPending]=useState(false);
  const [history,setHistory]=useState<CommercialRevision[]|null>(null),[recovery,setRecovery]=useState<Recovery|null>(null),[progress,setProgress]=useState<CommercialProgress|null>(null),[result,setResult]=useState<{url:string;report:CommercialReport}|null>(null);
  const guard=useRef(createFormExitGuard(setPending)).current,abort=useRef<AbortController|null>(null),mounted=useRef(true),generation=useRef(0),resultResource=useRef<{url:string;dispose:()=>Promise<void>}|null>(null);
  const activeOperations=useRef(0);
  const mediaOwner=project?.created_by??member.email;
  const availableMedia=media.filter(item=>item.created_by.toLowerCase()===mediaOwner.toLowerCase());
  const textSlots=commercialTextSlots(data),activeText=textSlots[Math.min(page,textSlots.length-1)];
  const activeSequence=commercialSequenceTimeline(data)[activeText.sequenceIndex],activeSlots=textSlots.filter(slot=>slot.sequenceIndex===activeText.sequenceIndex);
  const recoveryKey=`srtb-commercial-draft:${member.email.toLowerCase()}`;
  async function refreshMedia(){setMedia(await commercialApi.media());}
  async function refreshList(){const result=await commercialApi.projects(archived);setProjects(result.projects);setNextPage(result.next);}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;abort.current?.abort();const r=resultResource.current;if(r){URL.revokeObjectURL(r.url);void r.dispose();}};},[]);
  useEffect(()=>{checkExportSupport();},[]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),7000);return()=>clearTimeout(timer);},[notice]);
  useEffect(()=>{let active=true;void commercialApi.projects(archived).then(items=>{if(active){setProjects(items.projects);setNextPage(items.next);}}).catch(e=>{if(active)setError(message(e));});return()=>{active=false;};},[archived]);
  useEffect(()=>{void refreshMedia().catch(e=>setError(message(e)));try{const saved=localStorage.getItem(recoveryKey);if(saved){const parsed=JSON.parse(saved) as Recovery;if(parsed.data&&!validateCommercialData(parsed.data,{draft:true}).length)setRecovery(parsed);}}catch{/* Recovery is optional; server saves stay authoritative. */}},[recoveryKey]);
  useEffect(()=>{if(!dirty)return;const timer=setTimeout(()=>{try{localStorage.setItem(recoveryKey,JSON.stringify({project,title,data}));}catch{setNotice('La récupération locale est indisponible. Enregistrez votre annonce avant de fermer.');}},400);return()=>clearTimeout(timer);},[data,title,dirty,project,recoveryKey]);
  useEffect(()=>{const leaving=(e:BeforeUnloadEvent)=>{if(dirty||busy||mediaBusy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',leaving);return()=>window.removeEventListener('beforeunload',leaving);},[dirty,busy,mediaBusy]);
  useEffect(()=>sessionState.subscribe(()=>{if(!sessionState.permitted(sessionState.snapshot().epoch))abort.current?.abort();}),[]);
  useEffect(()=>{const logout=(event:Event)=>{if(dirty||busy||mediaBusy){event.preventDefault();setNotice('Enregistrez votre annonce ou terminez l’action en cours avant de vous déconnecter.');}};window.addEventListener('srtb-before-logout',logout);return()=>window.removeEventListener('srtb-before-logout',logout);},[dirty,busy,mediaBusy]);
  function clearResult(){const old=resultResource.current;if(old){URL.revokeObjectURL(old.url);void old.dispose();resultResource.current=null;}setResult(null);}
  function checkExportSupport(){setSupportError('');setExportSupport(null);void probeCommercialExportCapabilities().then(result=>{if(mounted.current)setExportSupport(result);}).catch(()=>{if(mounted.current)setSupportError('La vérification de l’export a échoué. Vérifiez votre connexion puis réessayez.');});}
  function change(next:CommercialData){setData(next);setDirty(true);setNotice('');clearResult();}
  function receiveLogoSize(size:(CommercialLogoSize&{url:string})|null){
    setLogoAsset(size);
    const logo=data.logo;
    if(!size||!logo||logo.presentation!=='adaptive'||logo.position!=='top-right'||size.url!==localURL(logo.url))return;
    // Cropping can reveal a different aspect ratio after the control was edited.
    // Refit from the actual bitmap, keeping the explicit top-right placement.
    const next=fitCommercialLogoToAsset(logo,size);
    if(next.position!==logo.position||(['scale','offsetX','offsetY'] as const).some(key=>Math.abs((next[key]??0)-(logo[key]??0))>1e-7))change({...data,logo:next});
  }
  function changeTextMode(textMode:'summary'|'full'){
    if(data.textMode===textMode)return;
    change({...createCommercialSequences(data),textMode,sequenceTiming:data.textMode?data.sequenceTiming:'auto'});setSelection(null);setEditRequest(value=>value+1);
  }
  async function splitText(){
    const target=activeText.index,sequenceIndex=activeText.sequenceIndex;
    await run(async()=>{
      const next=await splitCommercialPages(data,{index:target});
      const before=commercialSequenceTimeline(data).length,after=commercialSequenceTimeline(next).length;
      change(next);setSelection(null);
      setPage(commercialTextSlots(next).find(slot=>slot.sequenceIndex===sequenceIndex)?.index??0);
      setEditRequest(value=>value+1);
      setNotice(after>before?`Texte réparti : ${after-before} écran${after-before>1?'s':''} ajouté${after-before>1?'s':''}. Tout le contenu est conservé. Vérifiez le déroulé avec la voix off.`:'Ce texte tient déjà dans un seul écran lisible.');
    });
  }
  function patchMedia(next:Partial<CommercialData>|((previous:CommercialData)=>Partial<CommercialData>)){setData(previous=>({...previous,...(typeof next==='function'?next(previous):next)}));setDirty(true);setNotice('');clearResult();}
  function reset(next:CommercialProject|null,nextData?:CommercialData,nextTitle?:string){generation.current++;setSelection(null);setProject(next);setData(normalizeCommercialData(nextData??next?.data??fresh()));setTitle(nextTitle??next?.title??'Nouvelle annonce');setDirty(!!nextData);setHistory(null);setError('');setNotice('');setPage(0);setTab(next?'text':'audio');clearResult();}
  function selectElement(item:CommercialSelection|null){setSelection(item);if(item){setSelectionRequest(value=>value+1);if(item.kind==='logo')setTab('logo');else{setPage(item.page);setTab('text');}}}
  function openSettings(next:InspectorTab){setTab(next);if(window.matchMedia('(max-width:950px)').matches)requestAnimationFrame(()=>inspector.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'}));}
  function navigate(action:()=>void){if(busy||mediaBusy)return;guard.request(dirty,action);}
  async function run(action:()=>Promise<void>){if(busy||mediaBusy)return;activeOperations.current++;setBusy(true);setError('');setNotice('');try{await action();}catch(e){if(mounted.current)setError(message(e));}finally{activeOperations.current--;if(mounted.current&&activeOperations.current===0)setBusy(false);}}
  function clearRecovery(){try{localStorage.removeItem(recoveryKey);}catch{}setRecovery(null);}
  async function persistCurrent(){const errors=validateCommercialData(data,{draft:true});if(errors.length)throw Error(errors.join('\n'));const saved=await commercialApi.save(project,title.trim(),data);setProject(saved);setData(saved.data);setDirty(false);clearRecovery();setNotice(`Annonce enregistrée · révision ${saved.revision}`);await refreshList();}
  async function save(){await run(persistCurrent);}
  function createExample(){navigate(()=>void run(async()=>{
    const controller=new AbortController();abort.current=controller;
    try{
      const example=await prepareCommercialExample(controller.signal);
      controller.signal.throwIfAborted();
      const saved=await commercialApi.save(null,COMMERCIAL_EXAMPLE_TITLE,example);
      clearRecovery();reset(saved);setArchived(false);
      const list=await commercialApi.projects(false);setProjects(list.projects);setNextPage(list.next);
      setNotice('Exemple créé avec quatre séquences, le logo Bénin TV, une voix de synthèse et une musique discrète. Vous pouvez le modifier ou exporter le MP4.');
      focusDocument();
    }finally{if(abort.current===controller)abort.current=null;}
  }));}
  function focusDocument(){requestAnimationFrame(()=>{const field=document.querySelector<HTMLInputElement>('[aria-label="Nom de l’annonce"]');field?.scrollIntoView({block:'start'});field?.focus({preventScroll:true});field?.select();});}
  function requestDocumentAction(action:'new'|'duplicate'|'delete'){const show=()=>{setError('');setActionTitle(action==='duplicate'?`${title} — copie`.slice(0,120):'Nouvelle annonce');setCopyAudio(false);setDocumentAction(action);};if(action==='delete')show();else navigate(show);}
  async function confirmDocumentAction(){await run(async()=>{
    if(documentAction==='delete'){if(!project)return;await commercialApi.remove(project);clearRecovery();reset(null);setDocumentAction(null);await refreshList();setNotice('Annonce supprimée. Les fichiers de votre bibliothèque sont conservés.');focusDocument();return;}
    const copy=documentAction==='duplicate',next=copy?structuredClone(data):fresh();
    if(copy&&!copyAudio){next.voice=null;next.music=null;next.durationMode='manual';}
    if(copy&&mediaOwner.toLowerCase()!==member.email.toLowerCase())for(const key of ['voice','music','logo'] as const)if(next[key]?.url.startsWith('/api/commercial/media/'))next[key]=null;
    const saved=await commercialApi.save(null,actionTitle.trim(),next);clearRecovery();reset(saved);setDocumentAction(null);setArchived(false);const list=await commercialApi.projects(false);setProjects(list.projects);setNextPage(list.next);setNotice(copy?'Copie créée. Vérifiez les textes et choisissez les fichiers audio de cette annonce.':'Nouvelle annonce créée. Choisissez votre voix off ou commencez par les textes.');focusDocument();
  });}
  async function open(item:CommercialProject){await run(async()=>reset(await commercialApi.project(item.id)));}
  async function exportVideo(){
    if(!exportSupport?.supported){setError(exportSupport?.reason||'La vérification de l’export est encore en cours.');return;}
    if(busy||mediaBusy||!sessionState.permitted(sessionState.snapshot().epoch))return;setError('');const errors=validateCommercialData(data),missing=missingCommercialMedia(data);if(missing.length)errors.push(`Reconnectez ces fichiers sur ce poste : ${missing.join(', ')}.`);if(errors.length){setError(errors.join('\n'));return;}
    setBusy(true);clearResult();const controller=new AbortController();abort.current=controller;setProgress({percent:0,message:'Préparation…'});
    try{const output=await exportCommercialVideo(resolveCommercialMedia(data),controller.signal,setProgress);if(controller.signal.aborted){await output.dispose();controller.signal.throwIfAborted();}const url=URL.createObjectURL(output.blob);resultResource.current={url,dispose:output.dispose};setResult({url,report:output.report});setNotice('MP4 calculé et relu. Vous pouvez le télécharger.');}
    catch(e){if(!controller.signal.aborted)setError(message(e));else setNotice('Export annulé. Votre annonce est conservée.');}
    finally{abort.current=null;if(mounted.current){setBusy(false);setProgress(null);}}
  }
  const disabled=busy||mediaBusy||!!project?.archived,missing=missingCommercialMedia(data);
  return <div className="commercial-app">
    <a className="skip-link" href="#commercial-main">Aller à l’annonce</a>
    <header className="commercial-header"><a href="/" onClick={e=>{if(dirty){e.preventDefault();navigate(()=>{window.location.href='/';});}}} className="commercial-brand"><strong>SRTB</strong><span>Annonces</span></a>{member.role==='admin'?<a href="/" className="commercial-tools"><ArrowLeft size={16}/>Tous les outils</a>:<span className="commercial-account">{member.name}</span>}<div className="commercial-header-actions"><ThemeToggle/><button disabled={disabled||!title.trim()} onClick={()=>void save()}><Save size={17}/>Enregistrer</button><button className="primary" disabled={disabled||!exportSupport?.supported} title={!exportSupport?'Vérification de la qualité d’export…':undefined} onClick={()=>void exportVideo()}><Download size={17}/>Exporter MP4</button><LogoutButton/></div></header>
    <div className="commercial-layout">
      <aside className="commercial-sidebar" aria-label="Mes annonces"><h2>Mes annonces</h2><button className="primary" disabled={busy||mediaBusy} onClick={()=>requestDocumentAction('new')}><Plus size={18}/>Nouvelle annonce</button><button type="button" className="commercial-create-example" disabled={busy||mediaBusy} onClick={createExample}>Créer une annonce exemple</button><label className="commercial-check"><input type="checkbox" checked={archived} disabled={busy} onChange={e=>setArchived(e.target.checked)}/>Voir les archives</label><nav aria-label="Annonces enregistrées">{projects.map(item=><button key={item.id} disabled={busy||mediaBusy} aria-current={project?.id===item.id?'page':undefined} onClick={()=>navigate(()=>void open(item))}><strong>{item.title}</strong><small>Révision {item.revision}{item.archived?' · Archivée':''}</small><small>{new Date(item.updated_at).toLocaleDateString('fr-FR')}</small></button>)}</nav>{nextPage?<button disabled={busy||mediaBusy} onClick={()=>void run(async()=>{const more=await commercialApi.projects(archived,nextPage);setProjects(previous=>[...previous,...more.projects.filter(item=>!previous.some(old=>old.id===item.id))]);setNextPage(more.next);})}>Charger plus d’annonces</button>:null}{!projects.length?<p className="commercial-hint">{archived?'Aucune annonce archivée.':'Vos annonces enregistrées apparaîtront ici.'}</p>:null}<p className="commercial-local-note">La voix off et la musique se choisissent séparément pour chaque nouvelle annonce.</p></aside>
      <main id="commercial-main" className="commercial-main"><h1 className="sr-only">Créer une annonce commerciale</h1>
        {pending?<CommercialDialog title="Enregistrer l’annonce avant de continuer ?" busy={busy} onClose={()=>guard.cancel()}><p>Cette annonce contient des modifications non enregistrées.</p>{error?<p className="commercial-error" role="alert">{error}</p>:null}<div className="commercial-dialog-actions"><button type="button" data-autofocus disabled={busy} onClick={()=>guard.cancel()}>Rester sur l’annonce</button><button type="button" disabled={busy} onClick={()=>{clearRecovery();guard.confirm();}}>Continuer sans enregistrer</button><button type="button" className="primary" disabled={busy||!title.trim()} onClick={()=>void run(async()=>{await persistCurrent();guard.confirm();})}>Enregistrer et continuer</button></div></CommercialDialog>:null}
        {documentAction?<CommercialDialog title={documentAction==='delete'?'Supprimer cette annonce ?':documentAction==='duplicate'?'Dupliquer l’annonce':'Nouvelle annonce'} busy={busy} onClose={()=>setDocumentAction(null)}><form onSubmit={event=>{event.preventDefault();void confirmDocumentAction();}}>
          {documentAction==='delete'?<p><strong>{title}</strong> et son historique seront supprimés définitivement. Les fichiers de votre bibliothèque restent disponibles.</p>:<><label>Nom de la {documentAction==='duplicate'?'copie':'nouvelle annonce'}<input data-autofocus maxLength={120} autoComplete="off" required value={actionTitle} disabled={busy} onChange={event=>setActionTitle(event.target.value)}/></label>{documentAction==='duplicate'?<><p>Les textes, les séquences et leurs réglages sont copiés.</p><label className="commercial-check"><input type="checkbox" checked={copyAudio} disabled={busy} onChange={event=>setCopyAudio(event.target.checked)}/>Copier aussi la voix off et la musique</label></>:<p>Vous retrouverez ce brouillon dans Mes annonces.</p>}</>}
          {error?<p className="commercial-error" role="alert">{error}</p>:null}<div className="commercial-dialog-actions"><button type="button" disabled={busy} data-autofocus={documentAction==='delete'?true:undefined} onClick={()=>setDocumentAction(null)}>Annuler</button><button type="submit" className={documentAction==='delete'?'commercial-danger':'primary'} disabled={busy||(documentAction!=='delete'&&!actionTitle.trim())}>{busy?'En cours…':documentAction==='delete'?'Supprimer définitivement':documentAction==='duplicate'?'Créer la copie':'Créer l’annonce'}</button></div>
        </form></CommercialDialog>:null}
        {recovery?<div className="commercial-notice"><p>Une saisie non enregistrée est disponible sur ce poste : <strong>{recovery.title}</strong>.</p><div className="row wrap"><button onClick={()=>navigate(()=>{reset(recovery.project,recovery.data,recovery.title);setRecovery(null);})}>Reprendre la saisie</button><button onClick={()=>{setRecovery(null);localStorage.removeItem(recoveryKey);}}>Ignorer</button></div></div>:null}
        {error?<div className="commercial-error" role="alert">{error}</div>:null}{notice?<div className="commercial-notice commercial-status-message" role="status">{notice}</div>:null}
        {supportError||exportSupport&&!exportSupport.supported?<div className="commercial-notice" role="status"><p>{supportError||exportSupport?.reason} Vos textes et réglages peuvent être enregistrés et repris sur un autre appareil.</p><button type="button" disabled={busy||mediaBusy} onClick={checkExportSupport}>Vérifier à nouveau</button></div>:null}
        <div className="commercial-workspace">
          <div className="commercial-stage"><label className="commercial-title"><span className="sr-only">Nom de l’annonce</span><input aria-label="Nom de l’annonce" maxLength={120} disabled={disabled} value={title} onChange={e=>{setTitle(e.target.value);setDirty(true);}}/></label><div className="commercial-document-state">{project?`Révision ${project.revision}`:'Brouillon'}{dirty?' · Modifications à enregistrer':''}{project?.archived?' · Archivée':''}</div>
            <div className="commercial-document-actions"><button type="button" disabled={busy||mediaBusy} onClick={()=>requestDocumentAction('duplicate')}><Copy size={16}/>Dupliquer l’annonce</button>{project?<><button type="button" disabled={busy||mediaBusy} onClick={()=>void run(async()=>setHistory(await commercialApi.revisions(project.id)))}><History size={16}/>Historique</button><button type="button" disabled={busy||mediaBusy||dirty} onClick={()=>void run(async()=>{const updated=await commercialApi.archive(project,!project.archived);reset(updated);await refreshList();setNotice(updated.archived?'Annonce archivée.':'Annonce restaurée.');})}><Archive size={16}/>{project.archived?'Restaurer':'Archiver'}</button><button type="button" className="commercial-danger" disabled={busy||mediaBusy} onClick={()=>requestDocumentAction('delete')}><Trash2 size={16}/>Supprimer l’annonce</button></>:null}</div>
            <CommercialPreview key={generation.current} data={data} page={page} editRequest={editRequest} onPage={(index,source)=>{setPage(index);setSelection(null);if(source!=='playback')setTab('text');}} busy={disabled} selection={selection} logoSize={logoSize} onLogoSize={receiveLogoSize} onSelect={selectElement} onChange={change}/>
            <div className="commercial-support-settings">
            <nav className="commercial-media-summary" aria-label="Ajouter les médias de l’annonce">
              <button type="button" disabled={busy||mediaBusy} onClick={()=>openSettings('audio')}><Mic2 size={20} aria-hidden="true"/><span><strong>Voix off</strong><small>{data.voice?.name||'Ajouter un enregistrement'}</small></span></button>
              <button type="button" disabled={busy||mediaBusy} onClick={()=>openSettings('audio')}><Music2 size={20} aria-hidden="true"/><span><strong>Musique</strong><small>{data.music?.name||'Choisir une musique'}</small></span></button>
              <button type="button" disabled={busy||mediaBusy} onClick={()=>openSettings('logo')}><ImagePlus size={20} aria-hidden="true"/><span><strong>Logo annonceur</strong><small>{data.logo?.name||'Ajouter le logo'}</small></span></button>
            </nav>
            <DurationSettings data={data} onChange={change} disabled={disabled}/>
            {missing.length?<p className="commercial-error">Fichiers à reconnecter : {missing.join(', ')}. Choisissez-les à nouveau dans Voix &amp; musique ou Logo annonceur.</p>:null}
            </div>

            {history?<section className="commercial-history"><div className="row between"><h2>Historique</h2><button aria-label="Fermer l’historique" onClick={()=>setHistory(null)}><X size={16}/></button></div>{history.map(revision=><div className="commercial-history-row" key={revision.revision}><span>Révision {revision.revision}<small>{new Date(revision.created_at).toLocaleString('fr-FR')}</small></span><button disabled={disabled} onClick={()=>navigate(()=>{generation.current++;setSelection(null);setPage(0);setTab('text');setData(normalizeCommercialData(revision.data));setTitle(revision.title);setDirty(true);setHistory(null);clearResult();setNotice('Ancienne révision chargée. Enregistrez pour créer une nouvelle révision.');})}>Reprendre</button></div>)}</section>:null}
            {progress?<section className="commercial-export" role="status"><strong>{progress.message}</strong><progress value={progress.percent} max={100}/><span>{progress.percent}%</span><button onClick={()=>abort.current?.abort()}>Annuler l’export</button></section>:null}
            {result?<section className="commercial-export"><h2>Votre annonce est prête</h2><video controls src={result.url} preload="metadata" aria-label="Relire le MP4 exporté"/>{result.report.bitrateWarning?<p className="commercial-error" role="status">{result.report.bitrateWarning} Débit moyen : {(result.report.videoBitrate/1e6).toFixed(1)} Mb/s.</p>:null}<p>1920 × 1080 · {result.report.fps} images/s · {result.report.audio?'Audio inclus':'Sans piste audio'}</p><a className="button-link primary" href={result.url} download={`${title.replace(/[^\p{L}\p{N}_-]/gu,'_')}.mp4`}><Download size={17}/>Télécharger le MP4</a><button onClick={()=>downloadJson(`${title}-controle.json`,result.report)}>Télécharger le contrôle technique</button></section>:null}
          </div>
          <section ref={inspector} className="commercial-inspector" aria-label="Réglages de l’annonce"><div className="commercial-tabs" role="tablist" aria-label="Type de réglage">{INSPECTOR_TABS.map(([key,label,Icon],index)=><button key={key} id={`commercial-tab-${key}`} role="tab" tabIndex={tab===key?0:-1} disabled={mediaBusy} aria-selected={tab===key} aria-controls="commercial-tab-panel" onClick={()=>setTab(key)} onKeyDown={event=>{const next=event.key==='Home'?0:event.key==='End'?3:event.key==='ArrowRight'?(index+1)%4:event.key==='ArrowLeft'?(index+3)%4:['ArrowDown','ArrowUp'].includes(event.key)?(index+2)%4:null;if(next===null)return;event.preventDefault();setTab(INSPECTOR_TABS[next][0]);document.getElementById(`commercial-tab-${INSPECTOR_TABS[next][0]}`)?.focus();}}><Icon size={16} aria-hidden="true"/>{label}</button>)}</div>
            <fieldset disabled={busy||!!project?.archived} id="commercial-tab-panel" role="tabpanel" aria-labelledby={`commercial-tab-${tab}`} className="commercial-fields" onFocusCapture={()=>setEditRequest(value=>value+1)}>
              {tab==='text'?<>
                <TextPresentation data={data} disabled={disabled} onMode={changeTextMode}/>
                <div className="commercial-section-intro"><h2>Séquence {activeText.sequenceIndex+1}</h2><p>{COMMERCIAL_LAYOUT_LABELS[activeSequence.layout]} · Modifiez le texte affiché dans l’aperçu.</p>{activeSlots.length>1?<div className="commercial-text-slots" role="group" aria-label="Texte à modifier">{activeSlots.map(slot=><button type="button" key={slot.index} aria-pressed={page===slot.index} onClick={()=>{setPage(slot.index);setSelection(null);}}>{slot.slot===0?'Texte de gauche':'Texte de droite'}</button>)}</div>:null}</div>
                <label>Titre<input name="sequence-title" aria-label={`Titre de la séquence ${activeText.sequenceIndex+1}${activeSlots.length>1?activeText.slot===0?' à gauche':' à droite':''}`} maxLength={34} autoComplete="off" value={activeText.page.title} onChange={event=>change(updateCommercialTextPage(data,activeText.index,{...activeText.page,title:event.target.value.replace(/[\r\n]/g,' ')}))}/></label>
                <label>{data.textMode==='full'?'Passage du communiqué':'L’essentiel à l’écran'}<textarea name="sequence-text" aria-label={`Texte de la séquence ${activeText.sequenceIndex+1}${activeSlots.length>1?activeText.slot===0?' à gauche':' à droite':''}`} aria-describedby="commercial-body-rule commercial-body-lines commercial-body-issue" rows={4} maxLength={commercialBodyLimit(data,activeText.kind)} placeholder={'L’information essentielle.\nLa date et le lieu.\nLe contact utile.'} value={activeText.page.body} onChange={event=>change(updateCommercialTextPage(data,activeText.index,{...activeText.page,body:event.target.value}))}/><small className="commercial-count">{activeText.page.body.length.toLocaleString('fr-FR')} caractères</small></label>
                <TextDistribution data={data} page={activeText.index} disabled={disabled} onSplit={()=>void splitText()}/>
                {!data.textMode?<p className="commercial-text-help">Pour un communiqué long, choisissez une présentation lisible ci-dessus.</p>:null}
                <TypographySettings key={generation.current+'-'+activeText.index} page={activeText.page} index={activeText.kind} readable={data.textMode==='summary'||data.textMode==='full'} selection={selection?.kind==='title'||selection?.kind==='body'?selection.kind:undefined} request={selectionRequest} onChange={updated=>change(updateCommercialTextPage(data,activeText.index,updated))}/>
                <details className="commercial-details"><summary>Classement de l’annonce</summary><label>Annonceur (facultatif)<input maxLength={160} autoComplete="off" value={data.issuer} onChange={event=>change({...data,issuer:event.target.value})}/></label><small>Une référence interne pour vos dossiers. Ce nom n’apparaît pas dans la vidéo et n’est pas requis pour l’export.</small></details>
              </>:null}
              {tab==='audio'?<>
                <div className="commercial-section-intro"><h2>Voix off</h2><p>Choisissez l’enregistrement de cette annonce. La vidéo conserve toute la voix et couvre la durée des séquences.</p></div>
                <MediaChoice key={`voice-${generation.current}`} label="Fichier voix off" kind="audio" value={data.voice} media={availableMedia} locked={mediaBusy} onBusy={setMediaBusy} onRefresh={refreshMedia} onChange={item=>patchMedia(previous=>({voice:selectedAudio(previous.voice,item,true),durationMode:item?'voice':'manual'}))}/>
                {data.voice?<AudioSettings label="Voix off" value={data.voice} onChange={voice=>change({...data,voice})}/>:null}
                <hr/><div className="commercial-section-intro"><h2>Musique de fond</h2><p>Ajoutez une ambiance et réglez son volume séparément de la voix.</p></div>
                <MediaChoice key={`music-${generation.current}`} label="Fichier musique" kind="audio" value={data.music} media={availableMedia} locked={mediaBusy} onBusy={setMediaBusy} onRefresh={refreshMedia} onChange={item=>patchMedia(previous=>({music:selectedAudio(previous.music,item,false)}))}/>
                {data.music?<AudioSettings label="Musique" value={data.music} music onChange={music=>change({...data,music})}/>:null}
                <hr/><details className="commercial-details"><summary>Jingle d’ouverture</summary><div className="commercial-details-content"><label className="commercial-check"><input type="checkbox" checked={data.signatureEnabled} onChange={e=>change({...data,signatureEnabled:e.target.checked})}/>Activer le jingle du modèle</label>{data.signatureEnabled?<label>Volume du jingle · {Math.round(data.signatureVolume*100)} %<input type="range" min="0" max="2" step="0.01" value={data.signatureVolume} onChange={e=>change({...data,signatureVolume:Number(e.target.value)})}/></label>:null}</div></details>
              </>:null}
              {tab==='logo'?<>
                <div className="commercial-section-intro"><h2>Logo de l’annonceur</h2><p>Importez son logo, choisissez sa place et vérifiez le résultat dans l’aperçu.</p></div>
                <MediaChoice key={`logo-${generation.current}`} label="Logo de l’annonceur" kind="image" value={data.logo} media={availableMedia} locked={mediaBusy} onBusy={setMediaBusy} onRefresh={refreshMedia} onChange={item=>patchMedia(previous=>({logo:selectedLogo(previous.logo,item)}))}/>
                {effectiveLogo?<LogoSettings value={effectiveLogo} size={logoSize} onChange={logo=>change({...data,logo})}/>:<div className="commercial-logo-help"><strong>Trois emplacements disponibles</strong><p>En bas à droite, en bas au centre ou en haut à droite.</p><small>Le coin supérieur gauche reste libre.</small></div>}
              </>:null}
              {tab==='appearance'?<>
                <div className="commercial-section-intro"><h2>Habillage de l’annonce</h2><p>Les trois ambiances du modèle, avec les mêmes textes et médias.</p></div>
                <ThemeChoices data={data} onChange={change}/><hr/>
                <label className="commercial-check"><input type="checkbox" checked={data.demo} onChange={e=>change({...data,demo:e.target.checked})}/>Afficher la mention Démo</label><small>La mention apparaît en bas de l’image.</small>
              </>:null}
            </fieldset>
          </section>
        </div>
      </main>
    </div>
  </div>;
}
function ThemeChoices({data,onChange}:{data:CommercialData;onChange:(data:CommercialData)=>void}){return <fieldset className="commercial-themes"><legend>Thème</legend>{([['vert','Vert'],['beige','Beige'],['jaune','Jaune']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={data.theme===value} onClick={()=>onChange({...data,theme:value})}><span className={`commercial-swatch ${value}`}/>{label}</button>)}</fieldset>;}
