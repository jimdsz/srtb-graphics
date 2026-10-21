import {lazy,Suspense,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import type {BroadcastTemplate,FieldValue,ProjectData} from './domain';
import {beginLocalFile,bindLocalFile,connectedLocal,hasLocalPicker,localFingerprintState,localMediaSnapshot,localReferences,pickLocalFiles,restoreLocal,subscribeLocalMedia,localMime} from './local-media';
import {assertBrowserMedia,mediaPickerAccept,needsMediaPreparation} from './media-import';
import type {LocalDescriptor} from './local-media';
const PreparedMediaPicker=lazy(()=>import('./PreparedMediaPicker'));
const ConnectorSetup=lazy(()=>import('./ConnectorSetup'));

export function LocalFileButton({onChoose,kind='media',onBusyChange,onRange,selectionAction,selectionKey}:{onChoose:(value:FieldValue)=>void;kind?:string;onBusyChange?:(busy:boolean)=>void;onRange?:(range:{start:number;end:number})=>void;selectionAction?:ReactNode;selectionKey?:string}){
  const input=useRef<HTMLInputElement>(null),abort=useRef<AbortController|null>(null),mounted=useRef(true),phase=useRef<'checking'|'verifying'|null>(null),serial=useRef(0),pickerSerial=useRef(0);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[remember,setRemember]=useState(false),[checking,setChecking]=useState(false);
  type Candidate={file:File;serial:number;selectionKey?:string};
  const [candidate,setCandidate]=useState<Candidate|null>(null),candidateRef=useRef<Candidate|null>(null),currentKey=useRef(selectionKey),previousKey=useRef(selectionKey);currentKey.current=selectionKey;
  // The selected File belongs to the draft. Changing tabs may unmount this
  // control, but must not cancel its fingerprint or revoke a playing source.
  // A candidate which has not been inserted is cancelled when the control closes.
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;candidateRef.current=null;if(phase.current==='checking'){abort.current?.abort();reportBusy.current?.(false);}};},[]);
  useEffect(()=>{
    if(previousKey.current===selectionKey)return;previousKey.current=selectionKey;
    if(candidateRef.current&&candidateRef.current.selectionKey!==selectionKey){candidateRef.current=null;setCandidate(null);setMessage('');}
    if(phase.current==='checking')abort.current?.abort();
  },[selectionKey]);
  const chosen=useRef(onChoose),reportBusy=useRef(onBusyChange);chosen.current=onChoose;reportBusy.current=onBusyChange;
  function dismissCandidate(){candidateRef.current=null;setCandidate(null);setMessage('');}
  function acceptPrepared(expected:Candidate,descriptor:LocalDescriptor){
    if(!mounted.current||candidateRef.current!==expected||currentKey.current!==expected.selectionKey)return;
    candidateRef.current=null;setCandidate(null);setError('');setMessage('Copie MP4 prête et ajoutée. Le fichier original est conservé.');chosen.current(descriptor);
  }
  async function load(file:File,handle?:Awaited<ReturnType<typeof pickLocalFiles>>[number]){
    if(!mounted.current)return;
    abort.current?.abort();dismissCandidate();const task=new AbortController(),selectedKey=currentKey.current;abort.current=task;phase.current='checking';setBusy(true);setChecking(true);reportBusy.current?.(true);setError('');setMessage('Vérification de la lecture du fichier…');
    try{const mimeType=localMime(file),preparation=needsMediaPreparation(file);
      if(preparation&&(kind==='audio'||kind==='image'))throw Error('Choisissez un fichier correspondant à ce champ. Les MXF et MOV se préparent dans un champ vidéo.');
      if(kind==='audio'&&!mimeType.startsWith('audio/')||kind==='image'&&!mimeType.startsWith('image/')||kind==='media'&&mimeType.startsWith('audio/'))throw Error('Le type de ce fichier ne correspond pas à ce champ.');
      if(preparation){const next={file,serial:++serial.current,selectionKey:selectedKey};candidateRef.current=next;setCandidate(next);setMessage('');return;}
      await assertBrowserMedia(file,task.signal);task.signal.throwIfAborted();
      if(!mounted.current||abort.current!==task||currentKey.current!==selectedKey)return;
      const selection=beginLocalFile(file,p=>{if(mounted.current&&abort.current===task)setMessage(`Disponible pour l’aperçu · vérification pour l’enregistrement : ${Math.round(p*100)} %.`);},handle,task.signal);
      phase.current='verifying';setChecking(false);chosen.current(selection.descriptor);reportBusy.current?.(false);setMessage('Fichier disponible pour l’aperçu. Vérification en arrière-plan pour l’enregistrement.');
      // Workspace promotes only matching URLs; calling onChoose a second time
      // would reset marks or overwrite a different selection made meanwhile.
      await selection.verified;if(mounted.current&&abort.current===task)setMessage('Fichier vérifié sur ce poste · aucun envoi.');
    }catch(e){if(mounted.current&&abort.current===task){if(!task.signal.aborted){const detail=e instanceof Error?e.message:String(e);setError(detail+(phase.current==='checking'&&!/média actuel.*conservé/i.test(detail)?' Le média actuel est conservé.':''));setMessage('');}else setMessage(phase.current==='checking'?'Vérification annulée. Le média actuel est conservé.':'Vérification interrompue. Le fichier reste lisible ; sélectionnez-le à nouveau pour pouvoir enregistrer ses références.');}}
    finally{if(mounted.current&&abort.current===task){setBusy(false);setChecking(false);reportBusy.current?.(false);phase.current=null;abort.current=null;if(input.current)input.current.value='';}}
  }
  async function choose(){
    const request=++pickerSerial.current,selectedKey=currentKey.current;
    if(!remember||!hasLocalPicker()){input.current?.click();return;}
    const current=()=>mounted.current&&pickerSerial.current===request&&currentKey.current===selectedKey;
    try{const [handle]=await pickLocalFiles(false,kind);if(handle&&current()){const file=await handle.getFile();if(current())await load(file,handle);}}
    catch(e){if(current()&&!(e instanceof DOMException&&e.name==='AbortError'))setError(e instanceof Error?e.message:String(e));}
  }
  // Keep optional next-step actions above the changing fingerprint controls:
  // removing its cancel/status rows must not move an already targeted action.
  return <div className="local-media-picker"><button type="button" onClick={()=>void choose()}>Choisir sur cet ordinateur ou le réseau</button><input hidden ref={input} type="file" accept={mediaPickerAccept(kind)} onChange={e=>{const file=e.target.files?.[0];if(file)void load(file);}}/>{hasLocalPicker()?<label className="row"><input type="checkbox" checked={remember} disabled={busy} onChange={e=>setRemember(e.target.checked)}/><small>Mémoriser l’accès sur ce navigateur (facultatif)</small></label>:null}{selectionAction}{busy?<button type="button" onClick={()=>abort.current?.abort()}>{checking?'Annuler la vérification':'Interrompre la vérification'}</button>:null}{candidate?<Suspense fallback={<small role="status">Ouverture de la préparation locale…</small>}><PreparedMediaPicker key={candidate.serial} file={candidate.file} onReady={descriptor=>acceptPrepared(candidate,descriptor)} onDismiss={dismissCandidate} onChooseAnother={()=>{dismissCandidate();void choose();}}/></Suspense>:null}{message?<small role="status">{message}</small>:null}{error?<small role="alert">{error}</small>:null}</div>;
}
export default function LocalMedia({template,data}:{template:BroadcastTemplate;data:ProjectData}){
  useSyncExternalStore(subscribeLocalMedia,localMediaSnapshot);const refs=localReferences(template,data),missing=refs.filter(r=>!connectedLocal(r.url));
  const input=useRef<HTMLInputElement>(null),abort=useRef<AbortController|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[showConnector,setShowConnector]=useState(false);
  const preparedMissing=missing.some(ref=>/ - Graphics\.mp4$/i.test(ref.name));
  useEffect(()=>()=>abort.current?.abort(),[]);
  async function files(selected:{file:File;handle?:Awaited<ReturnType<typeof pickLocalFiles>>[number]}[]){
    setBusy(true);const task=new AbortController();abort.current=task;let matched=0;
    try{for(const {file,handle} of selected){await assertBrowserMedia(file,task.signal);task.signal.throwIfAborted();const descriptor=await bindLocalFile(file,p=>setMessage(`${file.name} · ${Math.round(p*100)} %`),handle,undefined,task.signal);if(refs.some(r=>r.url===descriptor.url))matched++;}
      setMessage(`${matched} fichier(s) correspondant(s) reconnecté(s). Les autres ne remplacent pas les médias du projet.`);
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);abort.current=null;if(input.current)input.current.value='';}
  }
  function choose(){input.current?.click();}
  async function reconnect(){setBusy(true);const task=new AbortController();abort.current=task;try{let count=0;for(const ref of missing)if(await restoreLocal(ref.url,p=>setMessage(`${ref.name} · ${Math.round(p*100)} %`),task.signal))count++;setMessage(`${count} fichier(s) retrouvé(s). Si un fichier manque, utilisez « Reconnecter les fichiers » pour le sélectionner.`);}catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);abort.current=null;}}
  if(!refs.length)return null;
  return <section className="panel local-media-status" aria-label="Médias de cet ordinateur"><h2>Médias locaux · {refs.length-missing.length}/{refs.length} disponibles</h2><p>Les vidéos, images et sons restent sur votre disque ou lecteur réseau. Seuls leurs noms, empreintes de contrôle et réglages sont enregistrés avec le projet partagé.</p><ul>{refs.map(ref=>{const state=localFingerprintState(ref.url);return <li key={ref.url}>{connectedLocal(ref.url)?'✓ Disponible':'À reconnecter'} · {ref.name}{state&&state.status!=='ready'?` · ${{queued:'vérification en attente',hashing:`vérification ${Math.round(state.progress*100)} %`,paused:'vérification en pause pendant l’aperçu ou l’export',cancelled:'vérification interrompue — à sélectionner de nouveau',error:'vérification impossible — à sélectionner de nouveau'}[state.status]}`:''}</li>;})}</ul>
    {missing.length?<div className="row wrap"><button disabled={busy} onClick={()=>void reconnect()}>Retrouver sur ce poste</button><button disabled={busy} onClick={()=>void choose()}>Reconnecter les fichiers</button></div>:null}
    {missing.length?<details className="local-media-connector-recovery" onToggle={event=>setShowConnector(event.currentTarget.open)}><summary>Reconnecter Graphics à ce poste</summary><p className="small muted">{preparedMissing?'Une copie préparée reste sur le poste où elle a été créée. Ouvrez son connecteur et associez-le à cette session pour la retrouver. Elle n’est pas transférée automatiquement sur un autre ordinateur.':'Si ces médias sont accessibles par le connecteur de ce poste, ouvrez-le et associez-le à cette session. Les fichiers doivent toujours être présents et accessibles.'}</p>{showConnector?<Suspense fallback={<p role="status">Ouverture de la connexion locale…</p>}><ConnectorSetup context={preparedMissing?'media-preparation':undefined} onConnected={()=>void reconnect()}/></Suspense>:null}</details>:null}
    <input hidden type="file" multiple ref={input} accept={mediaPickerAccept('all')} onChange={e=>{if(e.target.files)void files([...e.target.files].map(file=>({file})));}}/>
    {busy&&abort.current?<button onClick={()=>abort.current?.abort()}>Annuler</button>:null}{message?<p role="status">{message}</p>:null}<small>Si un fichier a changé, sélectionnez-le à nouveau dans les réglages. Le disque réseau doit être accessible depuis ce poste.</small>
  </section>;
}
