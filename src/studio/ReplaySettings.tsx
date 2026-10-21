import {useEffect,useRef,useState} from 'react';
import {ExternalLink,QrCode,Download} from 'lucide-react';
import type {ProjectData} from './domain';
import {replayAddress,replayCatalogue} from './replay-catalogue';
const moduleUrl='/library/v1.7.0/BTV_Passerelle_Replay/layout.mjs';
export async function replayQR(value:string){const {makeQR}=await import(/* @vite-ignore */moduleUrl);const svg=makeQR(replayAddress(value));return svg?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg)):'';}
export default function ReplaySettings({data,onChange,disabled}:{data:ProjectData;onChange:(patch:ProjectData)=>void;disabled:boolean}){
  const saved=String(data._replay_url||''),[draft,setDraft]=useState(saved),[qr,setQR]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),epoch=useRef(0);
  const selected=replayCatalogue.find(item=>item.url===saved);
  useEffect(()=>{setDraft(saved);setQR('');setError('');const own=++epoch.current;void replayQR(saved).then(value=>{if(epoch.current===own)setQR(value);},error=>{if(epoch.current===own)setError(error instanceof Error?error.message:'QR indisponible.');});return()=>{epoch.current++;};},[saved]);
  async function apply(value:string,title?:string){const own=++epoch.current;setBusy(true);setError('');try{const url=replayAddress(value),picture=await replayQR(url);if(epoch.current!==own)return;setDraft(url);setQR(picture);onChange({_replay_url:url,...(title?{_title:title}:{})});}catch(error){if(epoch.current===own)setError(error instanceof Error?error.message:'Lien non utilisable.');}finally{setBusy(false);}}
  return <section className="social-card-settings replay-settings" aria-label="Lien et QR du replay"><header><QrCode size={18}/><strong>Replay · lien et QR</strong></header><fieldset disabled={disabled||busy}>
    <label>Choisir une émission<select value={selected?.id||''} onChange={e=>{const item=replayCatalogue.find(item=>item.id===e.target.value);if(item)void apply(item.url,item.title);}}><option value="">Lien personnalisé</option>{replayCatalogue.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <label>Adresse du replay<input type="url" value={draft} maxLength={2048} placeholder="https://…" onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void apply(draft);}}}/></label>
    <button type="button" onClick={()=>void apply(draft)}>{busy?'Préparation du QR…':'Utiliser ce lien'}</button>
    <small>Choisir une émission remplit son titre et sa playlist. Pour un épisode précis, collez son propre lien. Les modifications du lien sont vérifiées avant de changer l’aperçu.</small>
    {error?<p role="alert">{error} Le lien précédent reste utilisé tant que le nouveau n’est pas accepté.</p>:null}
    {qr?<div className="replay-qr-preview"><img src={qr} width="144" height="144" alt="QR code du lien actuellement utilisé"/><div><a href={saved} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>Vérifier la destination</a><a href={qr} download="replay-qr.svg"><Download size={15}/>Télécharger le QR</a></div></div>:<p className="small">Aucun QR pour le moment. Vous pouvez préparer l’habillage ; renseignez le lien avant l’export.</p>}
    {selected?<small>Playlist référencée par <a href={selected.source} target="_blank" rel="noopener noreferrer">la page officielle SRTB</a>. Vérifiez son contenu avant diffusion.</small>:null}
  </fieldset></section>;
}
