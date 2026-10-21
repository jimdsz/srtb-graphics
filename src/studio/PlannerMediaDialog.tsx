import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,ChevronDown,Film,FolderOpen,FolderSearch,Image as ImageIcon,Link2,Monitor,RefreshCw,Search,ShieldCheck,Unplug,Upload,Users} from 'lucide-react';
import type {Member} from './domain';
import {canApprove} from './domain';
import type {DirectoryIndex,IndexedMedia,PlannerRecord,PlannerRow,PlannerSummary,ProgrammeRule} from './day-planner-model';
import {rankMedia} from './day-planner-model';
import {plannerMemoryRule} from './planner-rules';
import {mediaDateHint} from './day-planner-media-date';
import {mediaEpisodeHint} from './day-planner-media-episode';
import {plannerAPI} from './day-planner-api';
import {chooseFolder,connectedFolder,folderPickerAvailable,persistentFolderPickerAvailable,forgetFolder,indexedFile,rememberFolder,scanFolder} from './day-planner-folders';
import type {DirectoryHandle} from './day-planner-folders';
import {beginLocalFile,bindLocalFile,localMime,localURL} from './local-media';
import type {LocalDescriptor,ReadHandle} from './local-media';
import {assertBrowserMedia,mediaPickerAccept,needsMediaPreparation} from './media-import';
import PlannerSharedMedia from './PlannerSharedMedia';
import Activity from './Activity';
import NewProjectDialog from './NewProjectDialog';
import {loadPlannerMediaCatalog,rememberPlannerMedia,savePlannerDirectory} from './planner-media-workflow';
import {plannerProgrammeSchedule} from './planner-programme-label';
import {api} from './api';

const PreparedMediaPicker=lazy(()=>import('./PreparedMediaPicker'));

export default function PlannerMediaDialog({row,member,onClose,onSelect}:{row:PlannerRow;member:Member;onClose:()=>void;onSelect:(media:LocalDescriptor,location:PlannerRow['location'],warning?:string)=>void}){
 const canLearn=canApprove(member.role);
 const [directories,setDirectories]=useState<PlannerSummary[]>([]),[directory,setDirectory]=useState<PlannerRecord<DirectoryIndex>|null>(null),[rule,setRule]=useState<PlannerRecord<ProgrammeRule>|null>(null);
 const [index,setIndex]=useState<DirectoryIndex|null>(null),[indexId,setIndexId]=useState(''),[handle,setHandle]=useState<DirectoryHandle|null>(null);
 const [remember,setRemember]=useState(true),[learn,setLearn]=useState(false),[query,setQuery]=useState('');
 const [reuse,setReuse]=useState(false),[recommendation,setRecommendation]=useState<ProgrammeRule>();
 const [selection,setSelection]=useState<{file?:File;handle?:ReadHandle;media:LocalDescriptor;entry?:IndexedMedia;directoryId?:string}|null>(null);
 const [candidate,setCandidate]=useState<{file:File;id:number}|null>(null),[checking,setChecking]=useState(false);
 const choiceId=useRef(0),choiceController=useRef<AbortController|null>(null),fileInput=useRef<HTMLInputElement>(null);
 const [busy,setBusy]=useState(''),[percent,setPercent]=useState<number>(),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const controller=useRef<AbortController|null>(null),lock=useRef(false);
 const [catalogBusy,setCatalogBusy]=useState(true),[catalogError,setCatalogError]=useState('');
 const catalogController=useRef<AbortController|null>(null),directoryChosen=useRef(false),active=useRef(true);
 async function loadCatalog(){
  catalogController.current?.abort();const c=new AbortController();catalogController.current=c;
  setCatalogBusy(true);setCatalogError('');
  try{const result=await loadPlannerMediaCatalog(row,plannerAPI,c.signal,api.programme);c.signal.throwIfAborted();
   if(!active.current||catalogController.current!==c)return;
   setDirectories(result.directories);setRule(result.rule);setRecommendation(result.recommendation);
   if(index&&result.directories.some(d=>d.id===indexId&&d.revision>(directory?.revision||0)&&d.name===index.name.trim())){
    setIndex(null);setNotice('L’index a bien été partagé. Sélectionnez-le dans les dossiers d’équipe pour poursuivre ; aucun nouveau partage nécessaire.');
   }
   if(!directoryChosen.current){setDirectory(result.directory);if(result.warning)setCatalogError(result.warning);}
  }catch(error){if(active.current&&!c.signal.aborted&&catalogController.current===c)setCatalogError(error instanceof Error?error.message:String(error));}
  finally{if(active.current&&catalogController.current===c)setCatalogBusy(false);c.abort();}
 }
 useEffect(()=>{active.current=true;directoryChosen.current=false;void loadCatalog();return()=>{active.current=false;catalogController.current?.abort();controller.current?.abort();};},[row.id,row.title,row.subtitle,row.location?.directoryId,row.programmeId,row.programmeRevision]);
 useEffect(()=>{setCandidate(null);setChecking(false);return()=>{choiceId.current++;choiceController.current?.abort();choiceController.current=null;};},[row.id]);
 useEffect(()=>()=>{if(selection?.file)URL.revokeObjectURL(selection.media.url);},[selection]);
 async function run(label:string,fn:(signal:AbortSignal)=>Promise<void>){if(lock.current)return;lock.current=true;const control=new AbortController();controller.current=control;setBusy(label);setPercent(undefined);setError('');setNotice('');try{await fn(control.signal);}catch(e){if(active.current){if(control.signal.aborted)setNotice('Action arrêtée. Un index ou une association peut avoir été partagé. Actualisez les dossiers d’équipe avant de réessayer. Aucun média envoyé.');else if(e instanceof DOMException&&e.name==='AbortError')setNotice('Choix du dossier annulé. Vos choix sont conservés.');else setError(e instanceof Error?e.message:String(e));}}finally{lock.current=false;if(active.current){setBusy('');setPercent(undefined);}}}
 function discardCandidate(){choiceId.current++;choiceController.current?.abort();choiceController.current=null;setCandidate(null);setChecking(false);}
 async function selectFile(file:File,fileHandle?:ReadHandle,entry?:IndexedMedia,directoryId?:string,parentSignal?:AbortSignal){
  discardCandidate();const id=choiceId.current;setError('');setNotice('');
  if(needsMediaPreparation(file)){setCandidate({file,id});return;}
  const mime=localMime(file);if(!/^(video|image)\//.test(mime)){setError('Choisissez une vidéo ou une image. Votre choix précédent est conservé.');return;}
  const control=new AbortController(),abortChoice=()=>control.abort();choiceController.current=control;setChecking(true);
  parentSignal?.addEventListener('abort',abortChoice,{once:true});if(parentSignal?.aborted)control.abort();
  try{
   await assertBrowserMedia(file,control.signal);control.signal.throwIfAborted();
   if(!active.current||choiceId.current!==id||choiceController.current!==control)return;
   setLearn(false);setReuse(false);setSelection({file,handle:fileHandle,entry,directoryId,media:{url:URL.createObjectURL(file),name:file.name,mimeType:mime}});
  }catch(reason){if(active.current&&choiceId.current===id&&!control.signal.aborted)setError(reason instanceof Error?reason.message:'Lecture impossible. Votre choix précédent est conservé.');}
  finally{parentSignal?.removeEventListener('abort',abortChoice);if(active.current&&choiceController.current===control){choiceController.current=null;setChecking(false);}}
 }
 function usePrepared(media:LocalDescriptor,id:number){
  if(!active.current||choiceId.current!==id)return;
  discardCandidate();setLearn(false);setReuse(false);
  // The prepared copy is not the original indexed file. Never attach its
  // fingerprint to the MXF/MOV path or silently change an existing team rule.
  setSelection({media});setNotice('Copie MP4 prête sur ce poste. Vérifiez le média ci-dessous avant de l’utiliser. Aucun fichier partagé.');
 }
 async function connect(scan:boolean){
   await run('Choix du dossier sur ce poste',async signal=>{
    const chosen=await chooseFolder(signal);signal.throwIfAborted();directoryChosen.current=true;setHandle(chosen);
    if(!scan&&directory){const warning=await rememberFolder(member.email,directory.id,chosen,remember);signal.throwIfAborted();setNotice(warning||'Dossier connecté sur ce poste. Vérifiez un fichier proposé avant de l’utiliser.');return;}
    setBusy('Indexation locale du dossier');const next=await scanFolder(chosen,signal,n=>setBusy(`Indexation locale · ${n} fichiers trouvés`));signal.throwIfAborted();setIndex(next);setIndexId(directory?.id||crypto.randomUUID());
   });
 }
 async function useEntry(entry:IndexedMedia){discardCandidate();await run('Lecture du fichier sélectionné',async signal=>{if(!directory)return;const folder=handle||await connectedFolder(member.email,directory.id,signal);if(!folder)throw Error('Connectez ce dossier sur ce poste pour lire ses fichiers.');const source=await indexedFile(folder,entry,signal);signal.throwIfAborted();setHandle(folder);await selectFile(source.file,source.handle,entry,directory.id,signal);signal.throwIfAborted();});}
 async function shareIndex(){await run('Partage des noms et chemins relatifs',async signal=>{
   if(!handle||!index)return;
   const saved=await savePlannerDirectory(plannerAPI,indexId,directory?.revision||0,index,signal);
   // The team index has been saved even if optional local persistence fails.
   setDirectory(saved);setDirectories(ds=>[...ds.filter(d=>d.id!==saved.id),{id:saved.id,revision:saved.revision,kind:'directory',name:index.name,updatedAt:saved.updatedAt,archived:false}]);setIndex(null);
   signal.throwIfAborted();const warning=await rememberFolder(member.email,saved.id,handle,remember);signal.throwIfAborted();
   setNotice(warning||'Index partagé. Les fichiers restent dans votre dossier.');
 });}
 async function confirm(){await run('Vérification locale du média',async signal=>{
   if(!selection||candidate||checking)return;const chosen=selection;
   const media=chosen.file?await beginLocalFile(chosen.file,p=>setPercent(p*100),remember?chosen.handle:undefined,signal).verified:chosen.media;
   signal.throwIfAborted();const location=chosen.entry&&chosen.directoryId?{directoryId:chosen.directoryId,path:chosen.entry.path,size:chosen.entry.size,modified:chosen.entry.modified}:null;
   let warning='';
   if(canLearn&&learn&&location){setBusy('Mémorisation de l’association pour l’équipe');const data=plannerMemoryRule(row,location.directoryId,location.path,reuse);warning=await rememberPlannerMedia(plannerAPI,rule?.id||crypto.randomUUID(),rule?.revision||0,data,signal);}
   signal.throwIfAborted();onSelect(media,location,warning);
 });}
 const matches=directory?rankMedia(row,directory,recommendation):[];
 const results=directory?(query?directory.data.files.filter(f=>f.path.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr'))).slice(0,40).map(file=>({file,score:0,reason:['Résultat de votre recherche',mediaEpisodeHint(file,row).reason,mediaDateHint(file,row.airDate).reason].filter(Boolean).join(' · ')})):matches):[];
 const selectionDate=selection?.entry?mediaDateHint(selection.entry,row.airDate):null;
 const selectionEpisode=selection?mediaEpisodeHint(selection.entry||{path:selection.media.name,name:selection.media.name,size:0,modified:0},row):null;
 return <NewProjectDialog labelledBy="planner-media-title" busy={!!busy} onClose={onClose}>
  <div className="planner-media-heading"><span className="planner-entry-icon"><Film size={26} strokeWidth={1.5} aria-hidden="true"/></span><div><p className="eyebrow">{plannerProgrammeSchedule(row)}</p><h2 id="planner-media-title">Le média de « {row.title} »</h2>{row.subtitle?<p>{row.subtitle}</p>:null}</div></div>
  <p className="planner-privacy"><ShieldCheck size={17} aria-hidden="true"/><span>Aucun fichier n’est envoyé. Lecture sur votre poste ou le réseau.</span></p>
  {error?<p className="notice error" role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  {busy?<><Activity label={busy} percent={percent}/><button onClick={()=>controller.current?.abort()}>Annuler le traitement</button></>:null}
  <fieldset disabled={!!busy} className="planner-media-choices">
   {row.location&&row.media?<button className="planner-reconnect" onClick={()=>{discardCandidate();void run('Reconnexion du média enregistré',async signal=>{const location=row.location!,folder=await connectedFolder(member.email,location.directoryId,signal);if(!folder)throw Error('Connectez ce dossier dans « Dossiers d’équipe » ci-dessous.');const {file,handle:fileHandle}=await indexedFile(folder,{...location,name:row.media!.name},signal);await assertBrowserMedia(file,signal);signal.throwIfAborted();const verified=await bindLocalFile(file,p=>setPercent(p*100),remember?fileHandle:undefined,row.media!.url,signal);signal.throwIfAborted();onSelect(verified,location);});}}><Link2 size={18} aria-hidden="true"/>Reconnecter le média depuis le dossier mémorisé<ArrowRight size={16} aria-hidden="true"/></button>:null}
   <label className="planner-file-button planner-local-file"><span><Monitor size={22} strokeWidth={1.5} aria-hidden="true"/><span><strong>Choisir une vidéo ou une image sur ce poste</strong><small>MP4, WebM · MXF, MOV à préparer · PNG, JPEG, WebP</small></span><Upload size={18} aria-hidden="true"/></span><input ref={fileInput} type="file" accept={mediaPickerAccept('media')} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void selectFile(file);}}/></label>
   {checking?<div><Activity label="Vérification de la lecture sur ce poste"/><button type="button" onClick={()=>{discardCandidate();setNotice('Vérification annulée. Votre choix précédent est conservé.');}}>Annuler la vérification</button></div>:null}
   {candidate?<Suspense fallback={<Activity label="Ouverture de la préparation locale"/>}><PreparedMediaPicker key={candidate.id} file={candidate.file} onReady={media=>usePrepared(media,candidate.id)} onDismiss={discardCandidate} onChooseAnother={()=>{discardCandidate();fileInput.current?.click();}}/></Suspense>:null}
   <details className="planner-media-source">
    <summary><FolderSearch size={23} strokeWidth={1.5} aria-hidden="true"/><span><strong>Dossiers d’équipe et recherche de médias</strong><small>{directory?directory.data.name:'Retrouver un fichier dans un dossier local ou réseau'}</small></span><ChevronDown size={18} aria-hidden="true"/></summary>
    <div className="planner-folder-content">
     <div className="planner-folder-heading"><span className="planner-section-number">1</span><h3>Choisir le dossier</h3></div>
     {catalogBusy?<Activity label="Lecture des dossiers d’équipe"/>:null}
     {catalogError?<p className="notice warning" role="status">{catalogError}</p>:null}
     <button disabled={catalogBusy} onClick={()=>void loadCatalog()}><RefreshCw size={16} aria-hidden="true"/>{catalogError?'Réessayer les dossiers':'Actualiser les dossiers d’équipe'}</button>
     <label>Dossier indexé<select value={directory?.id||''} onChange={e=>{directoryChosen.current=true;const id=e.target.value;setHandle(null);setIndex(null);setDirectory(null);if(id)void run('Ouverture de l’index',async signal=>{const found=await plannerAPI.get<DirectoryIndex>(id,signal);signal.throwIfAborted();if(found.archived||found.data.kind!=='directory')throw Error('Dossier retiré. Actualisez la liste.');setDirectory(found);});}}><option value="">Nouvel emplacement</option>{directories.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
     <p className="planner-folder-permission"><ShieldCheck size={16} aria-hidden="true"/>Chaque poste doit autoriser son propre accès au dossier.</p>
     {folderPickerAvailable()?<div className="row">{directory?<button onClick={()=>void connect(false).catch(e=>{if(e.name!=='AbortError')setError(e.message);})}><Link2 size={16} aria-hidden="true"/>Connecter ce dossier sur mon poste</button>:null}<button onClick={()=>void connect(true).catch(e=>{if(e.name!=='AbortError')setError(e.message);})}>{directory?<RefreshCw size={16} aria-hidden="true"/>:<FolderOpen size={16} aria-hidden="true"/>}{directory?'Actualiser l’index depuis un dossier':'Choisir et indexer un dossier'}</button></div>:<p className="notice warning">Ce navigateur ne permet pas de sélectionner un dossier. Le choix de fichiers reste disponible ci-dessus.</p>}
     <div className="planner-folder-memory">{persistentFolderPickerAvailable()?<label className="check"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>Mémoriser l’accès sur ce navigateur</label>:<p className="small muted">Choisissez un dossier précis, pas tout le disque. Accès pour cette ouverture uniquement : resélectionnez le dossier au prochain lancement. Aucun fichier envoyé.</p>}{directory?<button className="quiet" onClick={()=>void run('Oubli de l’accès local',async()=>{await forgetFolder(member.email,directory.id);setHandle(null);setNotice('Accès oublié sur ce navigateur ; l’index d’équipe reste conservé.');})}><Unplug size={15} aria-hidden="true"/>Oublier l’accès local</button>:null}</div>
     {index?<section className="notice planner-index-confirm"><div className="planner-folder-heading"><Users size={19} aria-hidden="true"/><h3>Partager les références du dossier ?</h3></div><label>Nom partagé du dossier<input value={index.name} maxLength={120} onChange={e=>setIndex({...index,name:e.target.value})}/></label><p><strong>{index.files.length} fichiers visuels trouvés.</strong> Seuls les noms, tailles, dates et chemins relatifs seront partagés. Les fichiers restent dans le dossier.</p>{index.partial?<p>Index partiel : limite atteinte ou fichiers inaccessibles. Choisissez un sous-dossier pour compléter.</p>:null}<div className="row"><button onClick={()=>void shareIndex()}><Users size={16} aria-hidden="true"/>Partager cet index avec l’équipe</button><button className="quiet" onClick={()=>setIndex(null)}>Ne pas partager</button></div></section>:null}
     {directory?<section className="planner-folder-results"><div className="planner-folder-heading"><span className="planner-section-number">2</span><h3>{query?'Résultats':'Suggestions à vérifier'}</h3><span className="small muted">{directory.data.files.length} fichiers</span></div><label>Rechercher dans les noms<span className="search-control"><Search size={17} aria-hidden="true"/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={row.title}/></span></label><p className="small muted">Index du {new Date(directory.data.scannedAt).toLocaleDateString('fr-FR')}{directory.data.partial?' · partiel':''}. {query?'40 résultats maximum.':'Suggestions par noms et épisodes, pas une reconnaissance du contenu.'}</p>{results.length?<ul className="planner-candidates">{results.map(({file,reason})=><li key={file.path}><span className="planner-candidate-icon">{/\.(png|jpe?g|webp)$/i.test(file.name)?<ImageIcon size={23} strokeWidth={1.5} aria-hidden="true"/>:<Film size={23} strokeWidth={1.5} aria-hidden="true"/>}</span><span className="planner-candidate-copy"><strong>{file.name}</strong><small>{file.path}</small><small className="planner-match-reason">{reason}</small></span><button onClick={()=>void useEntry(file)}>Voir et vérifier<ArrowRight size={15} aria-hidden="true"/></button></li>)}</ul>:<div className="planner-empty"><Search size={24} aria-hidden="true"/><p>Aucune correspondance. Essayez un autre nom ou choisissez un fichier sur ce poste.</p></div>}</section>:<p className="small muted">L’index contient uniquement les références du dossier choisi. Aucune analyse de vos autres disques.</p>}
    </div>
   </details>
   <PlannerSharedMedia selectedUrl={selection?.media.url} onSelect={media=>{discardCandidate();setLearn(false);setReuse(false);setError('');setNotice('');setSelection({media});}}/>
   {selection?<section className="planner-media-preview">
    <div className="planner-preview-heading"><span className="planner-section-number">3</span><div><h3>Vérifier le média</h3><p>{selection.media.name}</p></div></div>
    {selection.media.mimeType.startsWith('video/')?<video key={selection.media.url} controls preload="metadata" src={selection.file?selection.media.url:localURL(selection.media.url)}/>:<img src={selection.file?selection.media.url:localURL(selection.media.url)} alt="Média sélectionné"/>}
    <p className="small muted">Vérifiez l’émission et l’épisode.{selection.media.mimeType.startsWith('video/')?' Vous pourrez choisir le passage juste après.':''}</p>
    {selectionDate?.manual?<p className="notice warning">{selectionDate.reason}. Vous pouvez conserver ce choix s’il s’agit du passage voulu.</p>:null}
    {selectionEpisode?.manual?<p className="notice warning" role="status">{selectionEpisode.reason}. Vous pouvez utiliser ce média après vérification.</p>:null}
    {canLearn&&selection.entry?<label className="check"><input type="checkbox" checked={learn} onChange={e=>{setLearn(e.target.checked);setReuse(false);}}/>Mémoriser l’association programme / média pour l’équipe</label>:null}
    {canLearn&&selection.entry&&learn?<label className="check"><input type="checkbox" checked={reuse} onChange={e=>setReuse(e.target.checked)}/><span>Réutiliser aussi ce dossier et ces habillages pour les prochains épisodes<small>Le fichier reste propre à cet épisode. Aucun ancien projet ne change.</small></span></label>:null}
    {!canLearn?<p className="small muted">Utilisez ce média dans cette préparation, puis confirmez vos choix dans « Habitudes proposées ». Les règles d’équipe sont validées par la diffusion ou l’administration.</p>:null}
    {candidate||checking?<p className="small muted">Votre choix précédent est conservé. Terminez ou fermez la préparation du nouveau fichier pour confirmer un média.</p>:null}
    <button type="button" className="primary" disabled={!!candidate||checking} onClick={()=>void confirm()}><Check size={17} aria-hidden="true"/>Utiliser ce média</button>
   </section>:null}
  </fieldset><div className="planner-dialog-footer"><button disabled={!!busy} onClick={onClose}>Fermer</button></div>
 </NewProjectDialog>;
}
