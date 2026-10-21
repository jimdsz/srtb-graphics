import {ApiError,request} from './api';
import {getTemplate,isMediaField,isSequenceField,validateProjectData} from './domain';
import type {BroadcastTemplate,FieldValue,Project,ProjectData} from './domain';
import {localURL} from './local-media';
import {localReference} from './local-reference';
import {selectedMediaData} from './media-selection';
import {rebindSequenceCrops} from './sequence-crop';
import {sessionState} from './session-state';
import type {DerivationOrigin} from './derivation-types';

export interface VideoSnapshot {template:BroadcastTemplate;data:ProjectData;filename:string}
function requireVideoSession(epoch:number){
  if(!sessionState.current(epoch))throw new ApiError('La session a été fermée. Reconnectez-vous.',401);
  if(!sessionState.permitted(epoch))throw new ApiError('La session doit être vérifiée avant de relancer l’export.',503);
}

/** Keep an in-progress local render bound to the session that started it. */
export function bindVideoSession(controller:AbortController){
  const epoch=sessionState.snapshot().epoch;
  const check=()=>{if(!sessionState.permitted(epoch))controller.abort(new DOMException(sessionState.snapshot().suspended?'La session doit être vérifiée avant de relancer le rendu.':'La session a été fermée.','AbortError'));};
  const stop=sessionState.subscribe(check);check();return stop;
}

async function checkSource(path:string,signal:AbortSignal,epoch:number){
  signal.throwIfAborted();
  requireVideoSession(epoch);
  let response:Response;
  try{response=await fetch(path,{method:'HEAD',credentials:'same-origin',cache:'no-store',redirect:'error',signal});}
  catch{signal.throwIfAborted();throw new ApiError('Une ressource de l’export est inaccessible. Vérifiez la connexion puis réessayez.',0);}
  if(response.status===401)sessionState.end('expired',epoch);
  if(!response.ok)throw new ApiError('Une ressource privée de l’export est indisponible. Reconnectez-vous ou vérifiez le média sélectionné.',response.status);
  // A successful login/SPA fallback is not a media response.
  const mime=response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()||'';
  if(!/^(?:image|video|audio)\//.test(mime)&&mime!=='application/octet-stream')throw new ApiError('Une ressource de l’export ne contient pas le média attendu.',422);
  signal.throwIfAborted();
  requireVideoSession(epoch);
}

/** Video-only snapshot. Draft settings and local source metadata never leave the tab.
 * HTML packages and saved projects still use the content-pinned exportSnapshot. */
export async function videoSnapshot(project:Project,signal:AbortSignal,options:{rejectArchived?:boolean;channelId?:string}={}):Promise<VideoSnapshot>{
  signal.throwIfAborted();
  const epoch=sessionState.snapshot().epoch,snapshot=structuredClone(project),template=getTemplate(snapshot.template_id);
  if(!/^[a-f\d-]{36}$/.test(snapshot.id)||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<1)throw new Error('Référence de projet invalide.');
  if(snapshot.template_version!==template.version||snapshot.library_version!==template.libraryVersion)throw new Error('La version originale du modèle n’est pas disponible.');
  // Capture and validate before the first await: editing the workspace or finishing
  // a background digest must not change the sources of this render.
  const data=selectedMediaData(template,validateProjectData(template,snapshot.data,true)),sources=new Set<string>(),foreignSources=new Set<string>();
  const prefix=`/library/v${template.libraryVersion}/${template.id}/`;
  function source(value:FieldValue):FieldValue{
    const url=typeof value==='string'?value:value&&typeof value==='object'?value.url:'';
    if(!url)return value;
    let resolved:string;
    if(url.startsWith('blob:')||localReference(url)){
      // localURL accepts only File bindings explicitly selected/reconnected on
      // this page, never an arbitrary blob URL supplied in project JSON.
      resolved=localURL(url);
    }else if(/^\/api\/graphics\/media\/[a-f\d-]{36}\/content$/.test(url)){
      resolved=url;sources.add(resolved);
    }else{
      if(url.startsWith('/api/'))throw new Error('Référence de média partagé invalide.');
      const embedded=/^img_\d+\.(?:png|jpe?g|webp)$/.test(url);
      if(url.startsWith('/library/')&&!url.startsWith(prefix)){
        if(!url.startsWith(`/library/v${template.libraryVersion}/`))throw new Error('Une ressource appartient à une autre version de la bibliothèque.');
        foreignSources.add(encodeURI(decodeURIComponent(url)));
      }
      const path=url.startsWith('/library/')?url:prefix+(embedded?'lib/images/':'')+url;
      resolved=encodeURI(decodeURIComponent(path));sources.add(resolved);
      // The original engines resolve their embedded image identifiers internally.
      if(embedded)return value;
    }
    return typeof value==='object'?{...value,url:resolved}:resolved;
  }
  for(const [key,field]of Object.entries(template.fields)){
    if(isMediaField(key,field))data[key]=source(data[key]);
    else if(isSequenceField(key,field)){
      const before=JSON.parse(String(data[key])) as {url:FieldValue;start:number;end:number}[],after=before.map(clip=>({...clip,url:source(clip.url)}));
      Object.assign(data,rebindSequenceCrops(data,key.slice(7,-9),before,after));data[key]=JSON.stringify(after);
    }
  }
  // A read-only request keeps server authentication/project permissions authoritative.
  // It sends only the saved project ID, not this draft's title, settings or filenames.
  const context=options.channelId?{channelId:options.channelId}:undefined;
  const current=await request<Project>(`/projects/${snapshot.id}`,{signal},context);
  signal.throwIfAborted();
  if(current.id!==snapshot.id||current.template_id!==template.id||current.template_version!==template.version||current.library_version!==template.libraryVersion)throw new Error('La version originale du modèle n’est pas disponible.');
  if(!Number.isSafeInteger(current.revision)||snapshot.revision>current.revision)throw new Error('Révision de départ inconnue. Rouvrez le projet.');
  if(options.rejectArchived&&current.archived)throw new Error('Ce projet a été archivé depuis l’ouverture de l’ensemble. Restaurez-le avant de l’exporter.');
  if(foreignSources.size){
    const origin=await request<DerivationOrigin>(`/projects/${snapshot.id}/derivation-origin`,{signal},context);
    if(origin.sourceLibraryVersion!==template.libraryVersion||!Array.isArray(origin.allowedLibraryUrls))throw new Error('Provenance des ressources liées invalide.');
    const allowed=new Set(origin.allowedLibraryUrls.map(url=>encodeURI(decodeURIComponent(url))));
    if([...foreignSources].some(url=>!allowed.has(url)))throw new Error('Une ressource étrangère n’appartient pas à cette déclinaison. Réimportez-la comme média partagé.');
  }
  // Bound concurrent private HEAD requests; the actual reads remain authenticated.
  const paths=[...sources];
  for(let offset=0;offset<paths.length;offset+=4)await Promise.all(paths.slice(offset,offset+4).map(path=>checkSource(path,signal,epoch)));
  signal.throwIfAborted();
  requireVideoSession(epoch);
  return {template,data,filename:`${template.id}_${snapshot.id}_export_${crypto.randomUUID().slice(0,8)}`};
}
