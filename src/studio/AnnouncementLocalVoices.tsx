import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {ProfileAsset} from './preparation-profile-model';
import type {AnnouncementVoiceSources} from './announcement-local-voices';
import {reconnectAnnouncementVoice} from './announcement-local-voices';
import {connectedLocal,localMediaSnapshot,restoreLocal,subscribeLocalMedia} from './local-media';

/** Reconnects private bytes, never changes the choices owned by the modal. */
export default function AnnouncementLocalVoices({sources,disabled=false}:{sources:AnnouncementVoiceSources;disabled?:boolean}){
  useSyncExternalStore(subscribeLocalMedia,localMediaSnapshot,localMediaSnapshot);
  const inputs=useRef(new Map<string,HTMLInputElement>()),controller=useRef<AbortController|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const missing=sources.references.filter(source=>!connectedLocal(source.url));
  useEffect(()=>()=>{const task=controller.current;controller.current=null;task?.abort();},[]);
  async function run(action:(task:AbortController)=>Promise<string>){
    if(disabled||controller.current)return;
    const task=new AbortController();controller.current=task;setBusy(true);setError('');setMessage('Vérification locale de la référence épinglée…');
    try{const result=await action(task);if(controller.current===task){task.signal.throwIfAborted();setMessage(result);}}
    catch(cause){if(controller.current===task){setMessage('');setError(task.signal.aborted?'Reconnexion interrompue. Les choix et révisions sont conservés.':cause instanceof Error?cause.message:String(cause));}}
    finally{if(controller.current===task){controller.current=null;setBusy(false);for(const input of inputs.current.values())input.value='';}}
  }
  function reconnect(source:ProfileAsset,file:File){return run(async task=>{
    await reconnectAnnouncementVoice(source,file,fraction=>{if(controller.current===task)setMessage(`Vérification de l’empreinte · ${Math.round(fraction*100)} %`);},task.signal);
    return 'Fichier correspondant reconnecté sur ce poste. La voix épinglée et sa révision n’ont pas changé. Aucun fichier envoyé.';
  });}
  function restore(){return run(async task=>{
    let count=0;for(const source of missing)if(await restoreLocal(source.url,fraction=>{if(controller.current===task)setMessage(`Vérification de l’accès mémorisé · ${Math.round(fraction*100)} %`);},task.signal))count++;
    return `${count} fichier(s) retrouvé(s). Pour ceux encore manquants, utilisez leur bouton de reconnexion ci-dessous.`;
  });}
  if(!sources.references.length&&!sources.unresolved)return null;
  return <section className="panel local-media-status" aria-label="Reconnecter les fichiers des voix choisies" aria-busy={busy}>
    <h3>Fichiers des voix choisies · {sources.references.length-missing.length}/{sources.references.length} disponibles sur ce poste</h3>
    <p className="small">Ces voix restent épinglées à leurs révisions. Reconnecter vérifie le contenu du fichier, pas son nom ; aucun téléversement, remplacement de voix ni mémorisation d’accès automatique.</p>
    {sources.unresolved?<p className="notice warning" role="status">{sources.unresolved} révision(s) épinglée(s) non chargée(s). Leur état est indiqué dans les annonces ; utilisez « Réessayer les révisions de voix épinglées » si nécessaire. Aucune révision plus récente ne les remplace.</p>:null}
    <ul>{sources.references.map(source=><li key={source.url}><span>{connectedLocal(source.url)?'✓ Disponible':'À reconnecter'} · {source.name}</span>{!connectedLocal(source.url)?<><button type="button" disabled={busy||disabled} onClick={()=>inputs.current.get(source.url)?.click()}>Reconnecter le fichier · {source.name}</button><input hidden type="file" accept=".mp3,.wav,.m4a,.ogg" aria-label={`Fichier correspondant à ${source.name}`} ref={node=>{if(node)inputs.current.set(source.url,node);else inputs.current.delete(source.url);}} onChange={event=>{const file=event.target.files?.[0];if(file)void reconnect(source,file);}}/></>:null}</li>)}</ul>
    {missing.length?<><p className="notice warning" role="status">L’export attend la reconnexion de ces fichiers. Vous pouvez conserver vos choix et préparer les brouillons sans calcul vidéo.</p><button type="button" disabled={busy||disabled} onClick={()=>void restore()}>Retrouver les accès déjà mémorisés sur ce poste</button></>:null}
    {busy?<button type="button" onClick={()=>controller.current?.abort()}>Interrompre la reconnexion</button>:null}
    {message?<p role="status">{message}</p>:null}{error?<p className="notice error" role="alert">{error}</p>:null}
  </section>;
}
