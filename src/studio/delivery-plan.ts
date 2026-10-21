import { isMediaField, isSequenceField, validateProjectData } from './domain';
import type { BroadcastTemplate, MediaAsset, Project, ProjectData, FieldValue } from './domain';
import {localReference,mediaExtensions} from './local-reference';
import {selectedMediaData} from './media-selection';
import {CE_SOIR_SIGNATURE_URL} from './ce-soir-audio';

export interface LibraryAsset { key:string; bytes:number; sha256:string }
export interface DeliveryFile { path:string; url:string; bytes:number; sha256?:string }
export interface DeliveryPlan {
  format:'srtb-review-package'; version:1; filename:string;
  snapshot?:{id:string;createdAt:string;purpose:'working-copy'};
  project:{id:string;title:string;revision:number;templateId:string;templateVersion:string;libraryVersion:string};
  data:ProjectData; files:DeliveryFile[]; totalBytes:number;
}
export function safePackagePath(path:string) {
  return !!path && !/^[/.]/.test(path) && !/[\\:\x00-\x1f%]/.test(path) && path.split('/').every(p=>p&&p!=='.'&&p!=='..');
}
export function buildDeliveryPlan(project:Project,template:BroadcastTemplate,assets:LibraryAsset[],media:MediaAsset[],allowedLibraryUrls:readonly string[]=[]):DeliveryPlan {
  if(project.template_id!==template.id||project.template_version!==template.version||project.library_version!==template.libraryVersion)
    throw Error('La version originale du modèle n’est pas disponible.');
  const data=selectedMediaData(template,validateProjectData(template,project.data)),files=new Map<string,DeliveryFile>();
  const prefix=`${template.id}/`,library=`/library/v${template.libraryVersion}/`;
  for(const a of assets.filter(a=>a.key.startsWith(prefix))){
    const path=a.key.slice(prefix.length);
    if(!safePackagePath(path)||!Number.isSafeInteger(a.bytes)||a.bytes<0||! /^[a-f\d]{64}$/.test(a.sha256))throw Error('Inventaire de bibliothèque invalide.');
    files.set(path,{path,url:library+a.key,bytes:a.bytes,sha256:a.sha256});
  }
  if(['BTV_Evenement','BTV_Semainier'].includes(template.id)){
    const runtime=assets.find(asset=>asset.key==='_shared/lottie-ae-engine.mjs');
    if(!runtime||!Number.isSafeInteger(runtime.bytes)||runtime.bytes<0||!/^[a-f\d]{64}$/.test(runtime.sha256))
      throw Error('Moteur partagé absent de la livraison.');
    const path='lottie-ae-engine.mjs';
    files.set(path,{path,url:library+runtime.key,bytes:runtime.bytes,sha256:runtime.sha256});
  }
  if(!files.has('graphic.mjs'))throw Error('Moteur absent de la livraison.');
  function portable(value:FieldValue,field?:string):FieldValue {
    const url=typeof value==='string'?value:typeof value==='object'?value.url:'';
    if(!url)return value;
    const local=localReference(url);
    if(local){
      if(typeof value!=='object'||!mediaExtensions[value.mimeType])throw Error('Référence locale incomplète.');
      const path=`lib/local/${local.sha256}.${mediaExtensions[value.mimeType]}`;
      files.set(path,{path,url,bytes:local.bytes,sha256:local.sha256});return {...value,url:path};
    }
    // Ferryman's embedded image identifiers are resolved under lib/images by the engine.
    if(/^img_\d+\.(?:png|jpe?g|webp)$/.test(url)&&files.has(`lib/images/${url}`))return value;
    let path=url;
    const shared=url.match(/^\/api\/graphics\/media\/([a-f\d-]+)\/content$/);
    if(shared){
      const m=media.find(m=>m.id===shared[1]&&m.status==='ready');
      if(!m)throw Error('Un média partagé n’est plus disponible.');
      const extension:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/webm':'webm','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/mp4':'m4a','audio/ogg':'ogg'};
      if(!extension[m.mime_type])throw Error('Format média non pris en charge.');
      path=`lib/shared/${m.id}.${extension[m.mime_type]}`;
      files.set(path,{path,url,bytes:m.bytes});
    }else if(url.startsWith('/library/')){
      if(!url.startsWith(library+prefix)){
        const stockOpening=template.id==='BTV_Ce_Soir'&&template.libraryVersion==='1.7.0'&&field==='_audio_signature_url'&&url===CE_SOIR_SIGNATURE_URL;
        if(!url.startsWith(library)||(!stockOpening&&!allowedLibraryUrls.includes(url)))throw Error('Une ressource appartient à un autre modèle. Réimportez-la comme média partagé.');
        const key=decodeURIComponent(url.slice(library.length)),asset=assets.find(item=>item.key===key);
        if(!asset||!safePackagePath(key)||!Number.isSafeInteger(asset.bytes)||asset.bytes<0||!/^[a-f\d]{64}$/.test(asset.sha256))throw Error('La ressource liée n’est pas présente dans l’inventaire original.');
        path='lib/derived/'+key;files.set(path,{path,url,bytes:asset.bytes,sha256:asset.sha256});
      }else path=decodeURIComponent(url.slice((library+prefix).length));
    }else path=decodeURIComponent(url);
    if(!safePackagePath(path)||!files.has(path))throw Error(`Ressource absente : ${path}`);
    return typeof value==='object'?{...value,url:path}:path;
  }
  for(const [key,field]of Object.entries(template.fields)){
    if(isMediaField(key,field))data[key]=portable(data[key],key);
    else if(isSequenceField(key,field)){
      const clips=JSON.parse(String(data[key])) as {url:FieldValue;start:number;end:number}[];
      data[key]=JSON.stringify(clips.map(clip=>({...clip,url:portable(clip.url)})));
    }
  }
  const list=[...files.values()].sort((a,b)=>a.path.localeCompare(b.path));
  const totalBytes=list.reduce((sum,f)=>sum+f.bytes,0);
  // This is also the video-render snapshot: it contains metadata, not file bytes.
  // A short rendered excerpt may use a 64 GiB local source. ZIP capacity belongs
  // to the archive writer, not to this plan shared by all export formats.
  if(!Number.isSafeInteger(totalBytes))throw Error('Taille des ressources invalide.');
  return {format:'srtb-review-package',version:1,filename:`${template.id}_${project.id}_r${project.revision}.zip`,project:{id:project.id,title:project.title,revision:project.revision,templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion},data,files:list,totalBytes};
}
