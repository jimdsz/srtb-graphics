import {useEffect,useRef,useState} from 'react';
import type {BroadcastTemplate,Project} from './domain';
import {exportSnapshot} from './export-snapshot';
import type {ArchiveSink} from './delivery-zip';
import VideoExport from './VideoExport';
import {fetchWithLocal,localURL,resolveLocalData} from './local-media';
import {bindVideoSession} from './video-snapshot';
import {selectedMediaData} from './media-selection';
import {FileJson,FolderArchive,HardDrive} from 'lucide-react';
import Activity from './Activity';
import {HelpBubble} from './GraphicsHelp';
import {withRenderSlot} from './render-slot';

interface SaveHandle {createWritable():Promise<ArchiveSink>}
interface SavePickerWindow extends Window {showSaveFilePicker?:(options:{suggestedName:string;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<SaveHandle>}
export default function ExportPanel({project,template,backup,voicePending=false,unsaved=false,onRunningChange}:{project:Project;template:BroadcastTemplate;backup:()=>void;voicePending?:boolean;unsaved?:boolean;onRunningChange:(running:boolean)=>void}){
  const [running,setRunning]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[percent,setPercent]=useState(0);
  const controller=useRef<AbortController|null>(null);
  const [withoutVoice,setWithoutVoice]=useState(false);
  useEffect(()=>setWithoutVoice(false),[project.id,project.revision,voicePending]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{onRunningChange(running);},[running,onRunningChange]);
  useEffect(()=>{if(!running)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[running]);
  async function prepare(){
    if(controller.current||running||voicePending&&!withoutVoice)return;
    const snapshot=structuredClone(project);
    const task=new AbortController();controller.current=task;setRunning(true);setError('');setMessage('Préparation de vos réglages…');setPercent(0);
    const stopSessionGuard=bindVideoSession(task);
    let sink:ArchiveSink|undefined;
    try{
      // Must be called during the click gesture, before network requests.
      const picker=(window as SavePickerWindow).showSaveFilePicker;
      const handle=picker?await picker.call(window,{suggestedName:`${template.id}_${project.id}_export.zip`,types:[{description:'Paquet HTML SRTB',accept:{'application/zip':['.zip']}}]}):undefined;
      task.signal.throwIfAborted();
      const plan=await exportSnapshot(snapshot,task.signal);
      if(plan.totalBytes>3*1024**3)throw Error('Le paquet HTML avec tous ses médias dépasse 3 Go. L’export vidéo d’un extrait reste disponible dans « Vidéo ou séquence d’images ».');
      for(const file of plan.files)localURL(file.url);
      task.signal.throwIfAborted();
      if(snapshot.data._audio_voice_enabled){
        setMessage('Vérification du passage vocal entier et de la durée du programme…');
        const [{prepareGraphic},{audioEvents}]=await Promise.all([import('./video/engine'),import('./video/audio')]);
        await withRenderSlot(task.signal,async()=>{
          const prepared=await prepareGraphic(template,resolveLocalData(template,{...selectedMediaData(template,snapshot.data),_studio_format:'tv'}),Number(snapshot.data._out_duration_seconds||12),false,task.signal);
          try{audioEvents(prepared,template.id,false);}finally{await prepared.dispose();}
        });
        task.signal.throwIfAborted();
      }
      const [{writeDeliveryZip},{packageDocuments}]=await Promise.all([import('./delivery-zip'),import('./delivery-runtime')]);
      task.signal.throwIfAborted();
      if(handle)sink=await handle.createWritable();
      else{
        if(plan.totalBytes>128*1024**2)throw Error('Pour ce gros paquet, utilisez Chrome ou Edge sur ordinateur : l’écriture directe sur disque évite de saturer la mémoire.');
        const chunks:Uint8Array<ArrayBuffer>[]=[];
        sink={write:async bytes=>{chunks.push(bytes);},abort:async()=>{chunks.length=0;},close:async()=>{const url=URL.createObjectURL(new Blob(chunks,{type:'application/zip'}));const a=document.createElement('a');a.href=url;a.download=plan.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);chunks.length=0;}};
      }
      const fonts=await (await import('./typography-fonts')).portableFonts(plan.data);
      await writeDeliveryZip(plan,packageDocuments(plan,template,fonts),sink,task.signal,(bytes)=>{setPercent(Math.min(99,Math.floor(bytes/Math.max(1,plan.totalBytes)*100)));setMessage('Copie et contrôle des fichiers…');},fetchWithLocal);
      setPercent(100);setMessage('Paquet ZIP téléchargé.');
    }catch(e){await sink?.abort().catch(()=>undefined);if(task.signal.aborted||e instanceof DOMException&&e.name==='AbortError'){setMessage('Export annulé.');}else{setError(e instanceof Error?e.message:String(e));setMessage('');}}
    finally{stopSessionGuard();controller.current=null;setRunning(false);}
  }
  return <div className="side-content delivery-panel">
    <div className="delivery-heading"><h2>Exporter</h2><HelpBubble section="export"/><span className="delivery-local"><HardDrive size={13} aria-hidden="true"/>Sur ce poste</span></div><p className="delivery-intro">Réglages affichés, sans validation préalable. Le projet partagé reste inchangé.</p>
    {voicePending?<div className="notice warning"><p>Voix à associer : cette variante n’a pas encore d’annonce vocale.</p><label className="row"><input type="checkbox" checked={withoutVoice} disabled={running} onChange={event=>setWithoutVoice(event.target.checked)}/>Sans voix off pour cet export · conserver la musique selon les réglages</label></div>:null}
    <VideoExport project={project} template={template} permitted={!running&&(!voicePending||withoutVoice)} unsaved={unsaved}/>
    <details className="export-options delivery-packages"><summary>Autres formats · HTML / réglages</summary><div className="delivery-package"><h3><FolderArchive size={17} aria-hidden="true"/>Paquet HTML TV · 16:9</h3><p>Moteur, polices, médias et réglages dans un ZIP transportable. Pour les formats sociaux, utilisez l’export vidéo ou PNG ci-dessus.</p>
      <button disabled={running||voicePending&&!withoutVoice} onClick={()=>void prepare()}>{running?'Préparation…':'Télécharger le paquet HTML (.zip)'}</button>
      {running?<><Activity label={message||'Préparation du paquet'} percent={percent>0?percent:undefined}/><button onClick={()=>controller.current?.abort()}>Annuler</button></>:null}
      {message?<p role="status">{message}</p>:null}{error?<p className="notice error" role="alert">{error}</p>:null}
      <p>Médias privés : réservés à l’équipe SRTB. À vérifier hors antenne dans SPX/CasparCG avant diffusion.</p></div><div className="delivery-package"><h3><FileJson size={17} aria-hidden="true"/>Réglages du projet</h3><p>Une copie JSON des réglages, sans les médias.</p><button onClick={backup}>Sauvegarder les réglages (.json)</button></div>
    </details>
  </div>;
}
