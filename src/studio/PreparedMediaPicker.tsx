import {useEffect,useId,useRef,useState} from 'react';
import {ArrowRight,FileVideo,Monitor,Square,X} from 'lucide-react';
import type {LocalDescriptor} from './local-media';
import {hasConnectorSession} from './connector-client';
import {prepareConnectorFile} from './connector-preparation';
import ConnectorSetup from './ConnectorSetup';
import './prepared-media-picker.css';

type PreparationProgress={stage:string;progress?:number};
function fileSize(bytes:number){
  const gigabytes=bytes>=1024**3;
  return `${(bytes/(gigabytes?1024**3:1024**2)).toLocaleString('fr-FR',{maximumFractionDigits:1})} ${gigabytes?'Go':'Mo'}`;
}
function windowsPost(){return typeof navigator!=='undefined'&&/win/i.test(navigator.platform||navigator.userAgent);}

/** A candidate stays outside the project until the native preparation and its
 * browser playback check have succeeded. No download starts just by opening it. */
export default function PreparedMediaPicker({file,onReady,onDismiss,onChooseAnother}:{file:File;onReady:(descriptor:LocalDescriptor)=>void;onDismiss:()=>void;onChooseAnother:()=>void}){
  const id=useId(),controller=useRef<AbortController|null>(null),mounted=useRef(true),progressPanel=useRef<HTMLDivElement>(null);
  const [busy,setBusy]=useState(false),[status,setStatus]=useState<PreparationProgress|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[showSetup,setShowSetup]=useState(false);
  const windows=windowsPost();
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();controller.current=null;};},[]);
  useEffect(()=>{if(busy)progressPanel.current?.scrollIntoView({block:'nearest'});},[busy]);
  function cancel(){
    controller.current?.abort();controller.current=null;setBusy(false);setStatus(null);setError('');
    setNotice('Préparation annulée. Le média actuel reste utilisé.');
  }
  async function prepare(){
    if(controller.current||!windows)return;
    if(!hasConnectorSession()){
      setShowSetup(true);setError('');setNotice('Connectez ce poste, puis lancez la préparation.');return;
    }
    const task=new AbortController();controller.current=task;setBusy(true);setError('');setNotice('');setStatus({stage:'Vérification du connecteur…'});
    try{
      const descriptor=await prepareConnectorFile(file,task.signal,next=>{if(mounted.current&&controller.current===task&&!task.signal.aborted)setStatus(next);});
      task.signal.throwIfAborted();if(!mounted.current||controller.current!==task)return;
      onReady(descriptor);
    }catch(reason){
      if(!mounted.current||controller.current!==task)return;
      if(task.signal.aborted||reason instanceof DOMException&&reason.name==='AbortError')setNotice('Préparation annulée. Le média actuel reste utilisé.');
      else setError(reason instanceof Error?reason.message:'La préparation n’a pas abouti. Réessayez ou choisissez un autre fichier.');
    }finally{if(mounted.current&&controller.current===task){controller.current=null;setBusy(false);setStatus(null);}}
  }
  const percent=typeof status?.progress==='number'&&Number.isFinite(status.progress)?Math.max(0,Math.min(100,status.progress)):undefined;
  return <section className="prepared-media-picker" aria-labelledby={`${id}-title`}>
    <div className="prepared-media-heading"><span className="prepared-media-icon"><FileVideo size={21} strokeWidth={1.6} aria-hidden="true"/></span><div><strong id={`${id}-title`}>Préparer ce média</strong><small>{file.name} · {fileSize(file.size)}</small></div><button type="button" className="quiet prepared-media-dismiss" aria-label="Fermer la préparation et conserver le média actuel" onClick={()=>{controller.current?.abort();onDismiss();}}><X size={17} aria-hidden="true"/></button></div>
    <p>Ce fichier nécessite une copie compatible pour être lu dans Graphics.</p>
    <div className="prepared-media-copy"><strong>Copie MP4 sur ce poste</strong><span>Image H.264 8 bits · son AAC</span><small>L’original reste intact. Aucun envoi de vidéo.</small></div>
    {windows?<>
      <p className="prepared-media-instructions">Au lancement, une fenêtre Windows vous demande de sélectionner à nouveau ce fichier pour autoriser son accès au connecteur.</p>
      <p className="prepared-media-download" id={`${id}-download`}>Au premier lancement, le moteur de préparation est téléchargé sur ce poste : environ 109 Mo.</p>
      <div className="prepared-media-actions">
        {busy?<button type="button" onClick={cancel}><Square size={15} aria-hidden="true"/>Annuler la préparation</button>:<button type="button" className="primary" aria-describedby={`${id}-download`} onClick={()=>void prepare()}>{error?'Réessayer la préparation':'Préparer et utiliser'}<ArrowRight size={16} aria-hidden="true"/></button>}
        <button type="button" className="quiet" onClick={()=>{controller.current?.abort();onChooseAnother();}}>Choisir un autre fichier</button>
      </div>
      {busy&&status?<div className="prepared-media-progress" ref={progressPanel}><div role="status" aria-live="polite"><span>{status.stage}</span>{percent!==undefined?<span>{Math.round(percent)} %</span>:null}</div><progress value={percent} max={100} aria-label={status.stage}/><small>Gardez ce panneau ouvert pendant la préparation. Sa fermeture l’annule ; le média actuel reste utilisé.</small></div>:null}
      <button type="button" className="quiet prepared-media-setup-toggle" disabled={busy} aria-expanded={showSetup} aria-controls={`${id}-setup`} onClick={()=>setShowSetup(!showSetup)}><Monitor size={16} aria-hidden="true"/>{showSetup?'Masquer la connexion':'Configurer le connecteur Windows'}</button>
      {showSetup?<div id={`${id}-setup`} className="prepared-media-setup"><p>La préparation nécessite le connecteur Graphics 0.3 ou une version compatible plus récente.</p><ConnectorSetup context="media-preparation" onConnected={()=>{setShowSetup(false);setError('');setNotice('Poste connecté. Vous pouvez lancer la préparation.');}}/></div>:null}
    </>:<div className="prepared-media-unavailable"><p>Cette préparation locale nécessite le connecteur Windows. Sur ce poste, choisissez une copie MP4 compatible déjà préparée.</p><button type="button" onClick={onChooseAnother}>Choisir une copie compatible</button></div>}
    {error?<div className="prepared-media-error" role="alert"><strong>Le média actuel est conservé.</strong><p>{error}</p></div>:null}
    {notice?<p className="prepared-media-notice" role="status">{notice}</p>:null}
  </section>;
}
