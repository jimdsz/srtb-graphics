import type {BroadcastTemplate,FieldValue,ProjectData} from './domain';
import {isMediaField,isSequenceField} from './domain';
import {localReference,mediaExtensions,MAX_LOCAL_BYTES} from './local-reference';
import {localBindings as bindings} from './local-files';
import {selectedMediaData} from './media-selection';
import {rebindSequenceCrops} from './sequence-crop';
import {createFingerprintQueue} from './local-fingerprint';
import {isCatalogueMediaExample} from './catalogue-preview';
import type {FingerprintStatus,FingerprintWorker} from './local-fingerprint';
import {needsMediaPreparation,preparationRequiredMessage} from './media-import';
export type LocalDescriptor={url:string;name:string;mimeType:string};
export type LocalFingerprintState={status:FingerprintStatus|'ready'|'cancelled'|'error';progress:number;error?:string};
export type LocalSelection={descriptor:LocalDescriptor;verified:Promise<LocalDescriptor>;cancel:()=>void};
export interface ReadHandle extends FileSystemFileHandle {queryPermission(o:{mode:'read'}):Promise<PermissionState>;requestPermission(o:{mode:'read'}):Promise<PermissionState>}
interface PickerWindow extends Window {showOpenFilePicker?:(options:{multiple:boolean;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<ReadHandle[]>}
const listeners=new Set<()=>void>();let revision=0;
function changed(){revision++;for(const listener of listeners)listener();}
const fingerprints=createFingerprintQueue(()=>new Worker(new URL('./local-hash.worker.ts',import.meta.url),{type:'module'}) as unknown as FingerprintWorker);
type Session={descriptor:LocalDescriptor;stable?:LocalDescriptor;state:LocalFingerprintState;controller:AbortController;verified:Promise<LocalDescriptor>;progress:Set<(value:number)=>void>;users:number;handles:Set<ReadHandle>};
const sessions=new Map<string,Session>();let files=new WeakMap<File,Session>();
export const localMediaSnapshot=()=>revision;
export function subscribeLocalMedia(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function localFingerprintState(url:string):LocalFingerprintState|undefined{return sessions.get(url)?.state;}
export function prioritizeLocalMedia(){return fingerprints.prioritize();}
const isSessionURL=(url:string)=>url.startsWith('blob:');
export function connectedLocal(url:string){return !localReference(url)&&!isSessionURL(url)||bindings.has(url)||[...bindings.values()].some(binding=>binding.url===url);}
export function localURL(url:string){if(isCatalogueMediaExample(url)||!localReference(url)&&!isSessionURL(url))return url;const binding=bindings.get(url)||[...bindings.values()].find(binding=>binding.url===url);if(!binding)throw Error('Un média local manque. Cliquez sur « Reconnecter les fichiers » ; aucun téléversement n’est nécessaire.');return binding.url;}
/** Identity comes only from verified fingerprints or an existing binding. Two
 * selections of identical bytes can have different live blob URLs. */
export function sameLocalMediaSource(first:string,second:string){
  if(first===second)return true;
  if((sessions.get(first)?.stable?.url??first)===(sessions.get(second)?.stable?.url??second))return true;
  try{return localURL(first)===localURL(second);}catch{return false;}
}
export function localMime(file:File){
  if(mediaExtensions[file.type])return file.type;
  const ext=file.name.split('.').at(-1)?.toLowerCase();return Object.entries(mediaExtensions).find(([,e])=>e===ext)?.[0]||(ext==='jpeg'?'image/jpeg':'');
}
/** Only a verified fingerprint is saved in a project. The origin-bound local
 * read ticket stays in memory; video/decoder fetches stream byte ranges. */
export function bindConnectorMedia(descriptor:LocalDescriptor,url:string){
  const reference=localReference(descriptor.url);
  if(!reference||!Object.hasOwn(mediaExtensions,descriptor.mimeType)||!/^http:\/\/127\.0\.0\.1:43871\/v1\/media\/[a-f\d]{64}$/.test(url))throw Error('Référence du connecteur invalide.');
  if(!bindings.has(descriptor.url)||bindings.get(descriptor.url)?.connector)bindings.set(descriptor.url,{url,connector:true});
  changed();return descriptor;
}
export function hashLocalFile(file:File,progress:(p:number)=>void,signal?:AbortSignal):Promise<string>{
  return fingerprints.hash(file,progress,signal);
}
async function handleStore(mode:'readonly'|'readwrite',operation:(store:IDBObjectStore)=>IDBRequest){
  return new Promise<unknown>((resolve,reject)=>{
    const request=indexedDB.open('srtb-local-media-handles',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('handles');request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result;try{const tx=db.transaction('handles',mode);let result:unknown;tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||new Error('Mémorisation locale indisponible.'));};const item=operation(tx.objectStore('handles'));item.onsuccess=()=>{result=item.result;};}catch(error){db.close();reject(error);}};
  });
}
function validateLocalFile(file:File){
  if(needsMediaPreparation(file))throw Error(preparationRequiredMessage);
  const mimeType=localMime(file);if(!mimeType)throw Error('Format non pris en charge. Choisissez PNG, JPEG, WebP, MP4, WebM, MP3, WAV, M4A ou Ogg.');
  if(file.size<=0||file.size>MAX_LOCAL_BYTES)throw Error('Le fichier doit contenir des données et ne pas dépasser 64 Go pour la lecture locale.');
  if(file.name.length>200)throw Error('Nom de fichier trop long (200 caractères maximum).');
  return mimeType;
}
// A fresh selection is immediately usable on this page. Only the verified
// descriptor can cross a save/backup boundary; metadata never reconnects files.
export function beginLocalFile(file:File,progress:(p:number)=>void,handle?:ReadHandle,signal?:AbortSignal):LocalSelection{
  signal?.throwIfAborted();const mimeType=validateLocalFile(file);let session=files.get(file);
  if(!session||session.state.status==='cancelled'||session.state.status==='error'){
    const url=URL.createObjectURL(file),controller=new AbortController();
    session={descriptor:{url,name:file.name,mimeType},controller,state:{status:'queued',progress:0},verified:Promise.resolve(null as unknown as LocalDescriptor),progress:new Set(),users:0,handles:new Set()};
    const current=session;sessions.set(url,current);files.set(file,current);bindings.set(url,{file,url});
    current.verified=fingerprints.hash(file,value=>{current.state={...current.state,progress:value};for(const report of current.progress)report(value);changed();},controller.signal,status=>{current.state={...current.state,status};changed();}).then(async hash=>{
      controller.signal.throwIfAborted();const stable={url:`local-media:${hash}:${file.size}`,name:file.name,mimeType};
      // Keep the provisional URL alive: already loaded previews/exports may still
      // read it, even when identical bytes have a different existing binding.
      if(!bindings.has(stable.url)||bindings.get(stable.url)?.connector)bindings.set(stable.url,bindings.get(url)!);
      current.stable=stable;current.state={status:'ready',progress:1};changed();
      for(const remembered of current.handles)await handleStore('readwrite',store=>store.put(remembered,stable.url)).catch(()=>{});
      controller.signal.throwIfAborted();
      return stable;
    }).catch(error=>{current.state={...current.state,status:controller.signal.aborted?'cancelled':'error',error:error instanceof Error?error.message:String(error)};changed();throw error;});
    // An abandoned UI observer must not produce an unhandled rejection.
    void current.verified.catch(()=>{});changed();
  }
  const current=session;current.users++;current.progress.add(progress);if(handle){current.handles.add(handle);if(current.stable)void handleStore('readwrite',store=>store.put(handle,current.stable!.url)).catch(()=>{});}
  let active=true,rejectCancelled:(error:unknown)=>void=()=>{};
  const release=()=>{if(!active)return;active=false;signal?.removeEventListener('abort',cancel);current.progress.delete(progress);current.users--;};
  const cancel=()=>{if(!active)return;release();rejectCancelled(new DOMException('Lecture annulée.','AbortError'));if(!current.users&&!current.stable)current.controller.abort();};
  const verified=new Promise<LocalDescriptor>((resolve,reject)=>{rejectCancelled=reject;current.verified.then(value=>{if(active){release();resolve(value);}},error=>{if(active){release();reject(error);}});});
  void verified.catch(()=>{});signal?.addEventListener('abort',cancel,{once:true});
  return {descriptor:current.stable||current.descriptor,verified,cancel};
}
export async function bindLocalFile(file:File,progress:(p:number)=>void,handle?:ReadHandle,expected?:string,signal?:AbortSignal):Promise<LocalDescriptor>{
  signal?.throwIfAborted();const mimeType=validateLocalFile(file);
  const hash=await hashLocalFile(file,progress,signal),url=`local-media:${hash}:${file.size}`;
  signal?.throwIfAborted();
  if(expected&&expected!==url)throw Error('Le contenu de ce fichier diffère de la version enregistrée. Remplacez le média dans les réglages pour créer une nouvelle révision.');
  // Identical bytes share a stable URL; reconnecting one field must not revoke
  // a URL that another preview or an in-progress export is still reading.
  if(!bindings.has(url)||bindings.get(url)?.connector)bindings.set(url,{file,url:URL.createObjectURL(file)});
  // Store only the user-granted handle, never a copy of the video.
  if(handle)await handleStore('readwrite',store=>store.put(handle,url)).catch(()=>{});
  changed();return {url,name:file.name,mimeType};
}
export function hasLocalPicker(){return typeof(window as PickerWindow).showOpenFilePicker==='function';}
export async function pickLocalFiles(multiple:boolean,kind='all'){
  const accept:Record<string,string[]>={};
  if(kind!=='audio')accept['image/*']=['.png','.jpg','.jpeg','.webp'];
  if(kind!=='audio'&&kind!=='image'){accept['video/*']=['.mp4','.webm','.mov'];accept['application/mxf']=['.mxf'];}
  if(kind==='all'||kind==='audio')accept['audio/*']=['.mp3','.wav','.m4a','.ogg'];
  return (window as PickerWindow).showOpenFilePicker!.call(window,{multiple,types:[{description:kind==='audio'?'Sons':kind==='image'?'Images':'Médias · MXF et MOV à préparer',accept}]});
}
export async function restoreLocal(reference:string,progress:(p:number)=>void,signal?:AbortSignal){
  signal?.throwIfAborted();if(!localReference(reference))return false;
  let handle:ReadHandle|undefined;
  try{handle=await handleStore('readonly',store=>store.get(reference)) as ReadHandle|undefined;if(handle&&await handle.queryPermission({mode:'read'})!=='granted')handle=undefined;}catch{signal?.throwIfAborted();}
  if(!handle){const {restorePreparedMedia}=await import('./connector-preparation');return restorePreparedMedia(reference,signal);}
  signal?.throwIfAborted();await bindLocalFile(await handle.getFile(),progress,handle,reference,signal);return true;
}
export function localReferences(template:BroadcastTemplate,data:ProjectData){
  data=selectedMediaData(template,data);
  const list=new Map<string,LocalDescriptor>();
  const add=(v:FieldValue)=>{if(v&&typeof v==='object'&&(localReference(v.url)||isSessionURL(v.url)))list.set(v.url,v);};
  for(const [key,field]of Object.entries(template.fields)){if(isMediaField(key,field))add(data[key]);else if(isSequenceField(key,field)){try{for(const clip of JSON.parse(String(data[key])))add(clip.url);}catch{/* Validation reports malformed sequences separately. */}}}
  return [...list.values()];
}
function mapMediaData(template:BroadcastTemplate,data:ProjectData,visit:(value:FieldValue)=>FieldValue):ProjectData{
  let next=data;const put=(key:string,value:FieldValue)=>{if(value!==data[key]){if(next===data)next={...data};next[key]=value;}};
  for(const [key,field]of Object.entries(template.fields)){
    if(isMediaField(key,field))put(key,visit(data[key]));
    else if(isSequenceField(key,field)&&typeof data[key]==='string'){
      let clips:unknown;try{clips=JSON.parse(data[key]);}catch{continue;}if(!Array.isArray(clips))continue;
      let updated=false;const mapped=clips.map(clip=>{if(!clip||typeof clip!=='object'||!('url'in clip))return clip;const value=visit(clip.url);if(value===clip.url)return clip;updated=true;return {...clip,url:value};});if(updated){put(key,JSON.stringify(mapped));for(const [name,value]of Object.entries(rebindSequenceCrops(data,key.slice(7,-9),clips,mapped)))put(name,value);}
    }
  }return next;
}
export function promoteVerifiedLocalData(template:BroadcastTemplate,data:ProjectData):ProjectData{
  return mapMediaData(template,data,value=>{if(!value||typeof value!=='object')return value;const stable=sessions.get(value.url)?.stable;return stable?{...value,url:stable.url}:value;});
}
export function pendingLocalReferences(template:BroadcastTemplate,data:ProjectData):LocalDescriptor[]{
  const pending=new Map<string,LocalDescriptor>();mapMediaData(template,data,value=>{if(value&&typeof value==='object'&&isSessionURL(value.url)&&!sessions.get(value.url)?.stable)pending.set(value.url,value);return value;});return [...pending.values()];
}
// Scope cleanup to this draft's removed references. Opening a different project
// must never cancel unrelated selections or verified-reference reconnection.
export function cancelUnusedLocalFingerprints(template:BroadcastTemplate,previousData:ProjectData,nextData:ProjectData){
  const retained=new Set(pendingLocalReferences(template,nextData).map(value=>value.url));let cancelled=0;
  for(const {url}of pendingLocalReferences(template,previousData)){
    const session=sessions.get(url);if(retained.has(url)||!session||session.stable||session.controller.signal.aborted||session.users>1)continue;
    session.controller.abort();cancelled++;
  }return cancelled;
}
export function stableLocalData(template:BroadcastTemplate,data:ProjectData):ProjectData{
  return mapMediaData(template,data,value=>{
    const url=typeof value==='string'?value:value&&typeof value==='object'?value.url:'';if(!isSessionURL(url))return value;
    const stable=sessions.get(url)?.stable;if(!stable)throw Error('Le contrôle des médias locaux doit être terminé avant d’enregistrer ou de partager les références. L’aperçu reste disponible sur ce poste.');
    return typeof value==='object'?{...value,url:stable.url}:stable;
  });
}
export function resolveLocalData(template:BroadcastTemplate,data:ProjectData):ProjectData{
  const next=selectedMediaData(template,data),resolve=(v:FieldValue):FieldValue=>v&&typeof v==='object'?{...v,url:localURL(v.url)}:typeof v==='string'?localURL(v):v;
  return mapMediaData(template,next,resolve);
}
export const fetchWithLocal:typeof fetch=async(input,init)=>{
  if(typeof input==='string'&&localReference(input))return fetch(localURL(input),init);
  return fetch(input,init);
};
if(typeof window!=='undefined'){
  window.addEventListener('srtb-connector-disconnect',()=>{for(const [key,binding]of bindings)if(binding.connector)bindings.delete(key);changed();});
  let renderRelease:(()=>void)|undefined;
  window.addEventListener('srtb-render-start',()=>{renderRelease??=prioritizeLocalMedia();});
  window.addEventListener('srtb-render-end',()=>{renderRelease?.();renderRelease=undefined;});
  window.addEventListener('srtb-local-media-clear',()=>{for(const session of sessions.values())session.controller.abort();fingerprints.cancelAll();for(const url of new Set([...bindings.values()].map(binding=>binding.url)))URL.revokeObjectURL(url);bindings.clear();sessions.clear();files=new WeakMap();renderRelease?.();renderRelease=undefined;changed();});
}
