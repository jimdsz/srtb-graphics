import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ChevronDown,Film,Image as ImageIcon,RefreshCw,Users} from 'lucide-react';
import {api} from './api';
import Activity from './Activity';
import type {MediaAsset} from './domain';
import type {LocalDescriptor} from './local-media';
import {loadPlannerSharedMedia} from './planner-media-workflow';
import {logoImageMime} from './planner-logo-selection';

/** Independent read: the network catalogue never disables local media choice. */
export default function PlannerSharedMedia({selectedUrl,onSelect,imageOnly=false}:{selectedUrl?:string;onSelect:(media:LocalDescriptor)=>void;imageOnly?:boolean}){
 const [media,setMedia]=useState<MediaAsset[]|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const controller=useRef<AbortController|null>(null),attempted=useRef(false),active=useRef(true);
 useEffect(()=>{active.current=true;return()=>{active.current=false;controller.current?.abort();};},[]);
 async function load(){
  if(controller.current)return;
  const c=new AbortController();controller.current=c;attempted.current=true;setBusy(true);setMessage('');
  try{
   const result=await loadPlannerSharedMedia(api,c.signal);
   if(active.current&&controller.current===c)setMedia(imageOnly?result.filter(asset=>logoImageMime(asset.mime_type)):result);
  }catch(error){
   if(active.current&&controller.current===c)setMessage(c.signal.aborted?'Lecture arrêtée. Vos choix sont conservés.':error instanceof Error?error.message:String(error));
  }finally{
   if(controller.current===c){controller.current=null;if(active.current)setBusy(false);}
   c.abort();
  }
 }
 return <details className="planner-media-source" onToggle={e=>{
  if(!e.currentTarget.open)controller.current?.abort();
  else if(!attempted.current)void load();
 }}>
  <summary><Users size={23} strokeWidth={1.5} aria-hidden="true"/><span><strong>{imageOnly?'Images déjà partagées dans Graphics':'Médias déjà partagés dans Graphics'}</strong><small>{imageOnly?'PNG, JPEG, WebP · sans nouvel envoi':'Choisir une ressource de la médiathèque'}</small></span><ChevronDown size={18} aria-hidden="true"/></summary>
  <div className="planner-folder-content">
   {busy?<><Activity label="Lecture des médias partagés"/><button onClick={()=>controller.current?.abort()}>Arrêter le chargement des médias</button></>:null}
   {message?<p className="notice warning" role="status">{message}</p>:null}
   {!busy&&attempted.current?<button onClick={()=>void load()}><RefreshCw size={16} aria-hidden="true"/>{message?'Réessayer les médias partagés':'Actualiser les médias partagés'}</button>:null}
  </div>
  <div className="planner-shared-grid">{media?.map(m=>{
   const url=`/api/graphics/media/${m.id}/content`;
   return <button key={m.id} aria-pressed={selectedUrl===url} onClick={()=>onSelect({url,name:m.name,mimeType:m.mime_type})}>{m.mime_type.startsWith('image/')?<ImageIcon size={24} strokeWidth={1.4} aria-hidden="true"/>:<Film size={24} strokeWidth={1.4} aria-hidden="true"/>}<span>{m.name}</span><ArrowRight size={16} aria-hidden="true"/></button>;
  })}{media?.length===0?<p className="muted">{imageOnly?'Aucune image PNG, JPEG ou WebP partagée prête à être utilisée.':'Aucun média partagé prêt à être utilisé.'}</p>:null}</div>
 </details>;
}
