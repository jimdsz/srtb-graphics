import { useEffect,useRef,useState } from 'react';
import type { MediaAsset } from './domain';
import { shareFile } from './api';
import TransferRecovery from './TransferRecovery';
import {ArrowRight,AudioLines,ChevronDown,FileVideo,Film,Search,Upload} from 'lucide-react';
import {activeChannelId} from './channel-context';
import {HelpBubble} from './GraphicsHelp';
import {assertBrowserMedia,mediaPickerAccept,needsMediaPreparation} from './media-import';
import './media-library-import.css';
export function bytesLabel(bytes:number){const large=bytes>=1024**3;return `${(bytes/(large?1024**3:1024**2)).toLocaleString('fr-FR',{maximumFractionDigits:1})} ${large?'Go':'Mo'}`;}
export default function MediaLibrary({media,refresh,onOpenProjects}:{media:MediaAsset[];refresh:()=>Promise<void>;onOpenProjects?:()=>void}) {
  const [file,setFile]=useState<File|null>(null),[consent,setConsent]=useState(false),[progress,setProgress]=useState<number|null>(null);
  const [candidate,setCandidate]=useState<File|null>(null),[checking,setChecking]=useState(false);
  const [message,setMessage]=useState(''),[error,setError]=useState(''),[query,setQuery]=useState(''),[selected,setSelected]=useState<MediaAsset|null>(null),[uploadState,setUploadState]=useState('');
  const abort=useRef<AbortController|null>(null),input=useRef<HTMLInputElement>(null);
  const checkController=useRef<AbortController|null>(null),active=useRef(true);
  const searchInput=useRef<HTMLInputElement>(null);
  const filteredMedia=media.filter(m=>m.name.toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr')));
  useEffect(()=>{active.current=true;return()=>{active.current=false;abort.current?.abort();checkController.current?.abort();};},[]);
  function cancelCheck(){checkController.current?.abort();checkController.current=null;setChecking(false);}
  async function chooseFile(next:File){
    cancelCheck();setConsent(false);setError('');setMessage('');
    if(needsMediaPreparation(next)){setCandidate(next);return;}
    setCandidate(null);const control=new AbortController();checkController.current=control;setChecking(true);
    try{await assertBrowserMedia(next,control.signal);control.signal.throwIfAborted();if(active.current&&checkController.current===control)setFile(next);}
    catch(reason){if(active.current&&checkController.current===control&&!control.signal.aborted)setError(reason instanceof Error?reason.message:'Lecture impossible. Le fichier précédent est conservé.');}
    finally{if(active.current&&checkController.current===control){checkController.current=null;setChecking(false);}}
  }
  async function upload(){
    if(!file||!consent||candidate||checking||progress!==null||abort.current)return;
    const control=new AbortController();abort.current=control;setError('');setMessage('');setUploadState('Préparation du transfert privé…');setProgress(0);
    try{await shareFile(file,control.signal,value=>{if(active.current&&!control.signal.aborted)setProgress(value);},value=>{if(active.current&&!control.signal.aborted)setUploadState(value);});control.signal.throwIfAborted();await refresh();if(!active.current||control.signal.aborted)return;setFile(null);setConsent(false);if(input.current)input.current.value='';setMessage('Média partagé. Il est maintenant disponible dans les réglages des projets.');}
    catch(e){if(active.current){if(control.signal.aborted)setMessage('Transfert annulé. Le fichier choisi est conservé.');else setError(e instanceof Error?e.message:String(e));}}
    finally{if(abort.current===control){abort.current=null;if(active.current){setProgress(null);setUploadState('');}}}
  }
  return <><div className="section-heading"><div><p className="eyebrow">RESSOURCES PARTAGÉES</p><div className="help-title-row"><h1>Les médias de l’équipe</h1><HelpBubble section="media"/></div><p>Images, séquences et sons partagés.</p></div><button onClick={()=>void refresh().catch(e=>setError(String(e)))}>Actualiser</button></div>
    {import.meta.env.VITE_STUDIO_QUALIFICATION?<div className="notice warning">Banc de test local : les fichiers choisis restent dans le simulateur de ce PC. Ils ne sont pas partagés dans le cloud et ne seront pas conservés au redémarrage.</div>:null}
    <p className="small muted media-local-note">Sans partage : utilisez « Choisir sur cet ordinateur ou le réseau » dans les réglages d’un projet.</p>
    <details className="media-upload-disclosure"><summary><Upload size={18} aria-hidden="true"/><span>Partager un média<small>{progress!==null?`Partage en cours · ${progress} %`:'Facultatif · espace privé SRTB'}</small></span><ChevronDown size={16} aria-hidden="true"/></summary>
    <div className="upload-panel"><div><h2>Ajouter un média privé</h2><p>Choisir un fichier ne l’envoie pas. Le partage commence uniquement avec le bouton ci-dessous.</p><small>PNG, JPEG, WebP · MP4, WebM · MP3, WAV, M4A, Ogg. MXF et MOV : préparation locale dans un projet.</small></div>
      <div><input ref={input} type="file" aria-label="Fichier à partager" accept={mediaPickerAccept('all')} disabled={progress!==null} onChange={e=>{const next=e.target.files?.[0];e.target.value='';if(next)void chooseFile(next);}}/>
        {checking?<div className="media-import-check"><p role="status">Vérification de la lecture sur ce poste… Aucun envoi.</p><button type="button" onClick={()=>{cancelCheck();setMessage('Vérification annulée. Le fichier précédent est conservé.');}}>Annuler la vérification</button></div>:null}
        {candidate?<section className="media-import-guidance" aria-label="Préparation locale nécessaire"><div className="media-import-heading"><FileVideo size={22} strokeWidth={1.5} aria-hidden="true"/><div><strong>Préparer dans un projet</strong><small>{candidate.name} · {bytesLabel(candidate.size)}</small></div></div><p>Ce fichier doit d’abord devenir une copie MP4 compatible. Le connecteur Windows peut la préparer sur votre poste, sans envoyer la vidéo ni modifier l’original.</p><p>Cette bibliothèque ne partage pas directement cette copie locale. Pour partager un MP4 compatible dont vous disposez, choisissez-le ici puis confirmez son envoi.</p><div className="media-import-actions">{onOpenProjects?<button type="button" className="primary" onClick={onOpenProjects}>Ouvrir mes projets<ArrowRight size={16} aria-hidden="true"/></button>:null}<button type="button" onClick={()=>input.current?.click()}>Choisir un fichier compatible</button>{file?<button type="button" className="quiet" onClick={()=>setCandidate(null)}>Conserver le fichier précédent</button>:null}</div><small>Dans un projet, ouvrez les réglages du média et choisissez à nouveau ce fichier. La préparation ne démarre qu’après votre accord.</small></section>:null}
        {!candidate&&file?<p className="media-import-filename">{file.name} · {bytesLabel(file.size)}</p>:null}<label className="check"><input type="checkbox" checked={consent} disabled={progress!==null||!file||!!candidate||checking} onChange={e=>setConsent(e.target.checked)}/>Partager ce fichier dans l’espace cloud privé SRTB, accessible aux membres autorisés.</label>
        <div className="row"><button type="button" className="primary" disabled={!file||!consent||!!candidate||checking||progress!==null} onClick={()=>void upload()}>Partager ce média</button>{progress!==null?<><progress value={progress} max={100} aria-label="Progression du partage"/><span>{progress}%</span><button type="button" onClick={()=>abort.current?.abort()}>Annuler</button></>:null}</div>
        {uploadState?<p className="small" role="status" aria-live="polite">{uploadState}</p>:null}
      </div>
    </div></details>
    {error?<div className="notice error" role="alert">{error}</div>:null}{message?<div className="notice" role="status">{message}</div>:null}
    <div className="filter-row media-filter"><label className="search">Rechercher un média<span className="search-control"><Search size={18} aria-hidden="true"/><input ref={searchInput} type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nom du fichier…"/></span></label><span className="filter-result" role="status">{filteredMedia.length} média{filteredMedia.length!==1?'s':''}</span></div>
    <div className="media-grid">{filteredMedia.map(m=><button className="media-card" key={m.id} onClick={()=>setSelected(m)}>{m.mime_type.startsWith('image/')?<img src={`/api/graphics/media/${m.id}/content`} alt="" loading="lazy"/>:<span className="media-type">{m.mime_type.startsWith('video/')?<Film size={26} aria-hidden="true"/>:<AudioLines size={26} aria-hidden="true"/>}{m.mime_type.startsWith('video/')?'VIDÉO':'AUDIO'}</span>}<strong>{m.name}</strong><span>{bytesLabel(m.bytes)} · {m.mime_type.split('/')[1]}</span></button>)}</div>
    {media.length&&!filteredMedia.length?<div className="empty"><Search size={26} aria-hidden="true"/><h2>Aucun média correspondant</h2><p>Essayez un autre nom de fichier.</p><button onClick={()=>{setQuery('');searchInput.current?.focus();}}>Effacer la recherche</button></div>:null}
    {!media.length?<div className="empty"><h2>Aucun média partagé</h2><p>{activeChannelId()==='benin-tv'?'Les ressources d’origine des modèles restent disponibles. Ajoutez ici vos propres programmes et vos voix.':'Ajoutez les images, programmes et voix de cette chaîne. Les ressources des autres chaînes restent séparées.'}</p></div>:null}
    {selected?<section className="panel media-inspector"><div className="row"><h2>{selected.name}</h2><span className="grow"/><button onClick={()=>setSelected(null)}>Fermer l’aperçu</button></div>{selected.mime_type.startsWith('image/')?<img src={`/api/graphics/media/${selected.id}/content`} alt={selected.name}/>:selected.mime_type.startsWith('video/')?<video src={`/api/graphics/media/${selected.id}/content`} controls preload="metadata"/>:<audio src={`/api/graphics/media/${selected.id}/content`} controls preload="metadata"/>}<p className="small muted">Partagé par {selected.created_by} · {new Date(selected.created_at).toLocaleDateString('fr-FR')}</p></section>:null}
    <TransferRecovery uploading={progress!==null} refreshMedia={refresh}/>
  </>;
}
