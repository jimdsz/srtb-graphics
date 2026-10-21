import {useEffect,useRef,useState} from 'react';
import {Upload,Trash2,ImagePlus} from 'lucide-react';
import type {MediaAsset} from '../domain';
import {chooseCommercialFile} from './media';
import {inspectCommercialAudio} from './audio';
import {shareCommercialFile} from './api';
import {localMime,localURL,connectedLocal} from '../local-media';
import {isCommercialExampleAsset} from './example-assets';

export interface SelectedCommercialMedia {url:string;name:string;duration:number;replacesUrl?:string}
export default function MediaChoice({label,kind,value,media,onChange,onRefresh,onBusy,locked=false}:{label:string;kind:'audio'|'image';value:{url:string;name:string}|null;media:MediaAsset[];onChange:(item:SelectedCommercialMedia|null)=>void;onRefresh:()=>Promise<void>;onBusy:(busy:boolean)=>void;locked?:boolean}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[file,setFile]=useState<File|null>(null),[progress,setProgress]=useState(0);
  const input=useRef<HTMLInputElement>(null),controller=useRef<AbortController|null>(null),mounted=useRef(true);
  const selectedLocalURL=useRef('');
  const included=!!value&&isCommercialExampleAsset(value.url,kind);
  const connected=!!value&&(included||connectedLocal(value.url));
  const source=connected?localURL(value!.url):'';
  const importLabel=kind==='image'?'Importer le logo':label.toLowerCase().includes('voix')?'Importer une voix off':'Importer une musique';
  useEffect(()=>{if(value?.url!==selectedLocalURL.current)setFile(null);},[value?.url]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();onBusy(false);};},[]);
  const options=media.filter(item=>item.status==='ready'&&item.mime_type.startsWith(`${kind}/`));
  async function run(action:(signal:AbortSignal)=>Promise<void>){
    if(controller.current)return;const control=new AbortController();controller.current=control;setBusy(true);onBusy(true);setError('');setProgress(0);
    try{await action(control.signal);}catch(e){if(mounted.current&&!control.signal.aborted)setError(e instanceof Error?e.message:String(e));}
    finally{if(mounted.current){setBusy(false);onBusy(false);}controller.current=null;}
  }
  return <section className="commercial-media-choice" aria-label={label}>
    {kind==='image'?<div className={`commercial-logo-preview ${source?'has-image':''}`}>
      {source?<img src={source} width="240" height="120" alt={`Logo sélectionné : ${value!.name}`}/>:<><ImagePlus size={30} aria-hidden="true"/><span>{value?'Reconnectez le logo sur ce poste':'Ajoutez le logo de votre annonceur'}</span></>}
    </div>:null}
    <label>{label}<select disabled={busy||locked} value={value?.url||''} onChange={e=>{const asset=options.find(item=>`/api/commercial/media/${item.id}/content`===e.target.value);if(!asset){onChange(null);setFile(null);return;}void run(async signal=>{const url=`/api/commercial/media/${asset.id}/content`,duration=kind==='audio'?(await inspectCommercialAudio(url,signal)).duration:0;signal.throwIfAborted();onChange({url,name:asset.name,duration});setFile(null);});}}>
      <option value="">{kind==='audio'?'Aucun fichier choisi':'Sans logo'}</option>
      {value&&!options.some(item=>`/api/commercial/media/${item.id}/content`===value.url)?<option value={value.url}>{value.name} · {included?'inclus dans l’exemple':'local'}</option>:null}
      {options.map(item=><option key={item.id} value={`/api/commercial/media/${item.id}/content`}>{item.name}</option>)}
    </select></label>
    <input ref={input} className="commercial-file-input" type="file" tabIndex={-1} aria-hidden="true" aria-label={`Importer ${label.toLowerCase()}`} accept={kind==='audio'?'.mp3,.wav,.m4a,.ogg':'.png,.jpg,.jpeg,.webp'} onChange={e=>{const picked=e.target.files?.[0];e.target.value='';if(picked)void run(async signal=>{const selected=await chooseCommercialFile(picked,kind,signal,setProgress);signal.throwIfAborted();selectedLocalURL.current=selected.url;onChange(selected);setFile(picked);});}}/>
    <div className="commercial-media-actions"><button className={!value?'primary':undefined} type="button" disabled={busy||locked} onClick={()=>input.current?.click()}><Upload size={16} aria-hidden="true"/>{value?'Remplacer le fichier':importLabel}</button>{value?<button type="button" disabled={busy||locked} aria-label={`Retirer ${label.toLowerCase()}`} onClick={()=>{onChange(null);setFile(null);}}><Trash2 size={16} aria-hidden="true"/></button>:null}</div>
    {kind==='audio'&&source?<div className="commercial-audio-source"><span>Écouter le fichier source</span><audio key={source} controls preload="metadata" src={source} aria-label={`Écouter ${label.toLowerCase()}`}/></div>:null}
    <small>{included?'Ce fichier est inclus dans l’exemple et reste disponible après rechargement, sans import sur ce poste.':`${kind==='image'?'PNG transparent conseillé · JPEG et WebP acceptés.':'MP3, WAV, M4A ou Ogg.'} Le fichier reste sur ce poste, sauf si vous le conservez dans votre bibliothèque privée.`}</small>
    {file&&value?<button className="quiet" disabled={busy||locked} type="button" onClick={()=>void run(async signal=>{const previousUrl=value.url,shared=await shareCommercialFile(file,localMime(file),signal,setProgress);await onRefresh();const duration=kind==='audio'?(await inspectCommercialAudio(shared.url,signal)).duration:0;signal.throwIfAborted();onChange({...shared,duration,replacesUrl:previousUrl});setFile(null);})}>Conserver dans ma bibliothèque privée</button>:null}
    {busy?<p role="status">Préparation du fichier… {progress}% <button type="button" onClick={()=>controller.current?.abort()}>Annuler</button></p>:null}
    {error?<p className="commercial-error" role="alert">{error}</p>:null}
  </section>;
}
