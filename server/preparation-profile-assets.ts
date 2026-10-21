import inventory from '../reports/library-intake.json';
import {isMediaField,isSequenceField} from '../src/studio/domain';
import type {BroadcastTemplate,FieldValue,ProjectData} from '../src/studio/domain';
import {localReference,mediaExtensions} from '../src/studio/local-reference';
import {MAX_PROFILE_ASSETS,sharedProfileAsset} from '../src/studio/preparation-profile-model';
import {HttpError} from './http';

export interface ProfileAssetUse {value:FieldValue;kind?:'image'|'audio'|'visual';template?:BroadcastTemplate}
const libraryAssets=new Set(inventory.assets.map(asset=>asset.key));
const extensionMime:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',mpeg:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg'};
const accepts=(mime:string,kind:ProfileAssetUse['kind'])=>!kind||(kind==='visual'?/^(?:image|video)\//.test(mime):mime.startsWith(kind+'/'));

/** Validate every stored source, including disabled alternatives that may be reused. */
export function presetAssetUses(template:BroadcastTemplate,data:ProjectData):ProfileAssetUse[]{
  const result:ProfileAssetUse[]=[];
  for(const [key,field]of Object.entries(template.fields)){
    const kind=field['x-control']==='audio'||key.startsWith('_audio')?'audio':field['x-control']==='image'||key.includes('sponsor')?'image':'visual';
    if(isMediaField(key,field))result.push({value:data[key],kind,template});
    else if(isSequenceField(key,field))for(const clip of JSON.parse(String(data[key])))result.push({value:clip.url,kind,template});
  }
  return result;
}
export async function validateProfileAssets(db:D1Database,uses:ProfileAssetUse[]){
  const shared=new Map<string,ProfileAssetUse[]>(),unique=new Set<string>();
  for(const use of uses){
    const value=use.value,url=typeof value==='string'?value:value&&typeof value==='object'?value.url:'';
    if(!url)continue;unique.add(url);
    if(unique.size>MAX_PROFILE_ASSETS)throw new HttpError(422,`Une fiche accepte au maximum ${MAX_PROFILE_ASSETS} sources différentes.`);
    if(localReference(url)){
      if(typeof value!=='object'||!Object.hasOwn(mediaExtensions,value.mimeType)||!accepts(value.mimeType,use.kind))throw new HttpError(422,'La référence locale ne correspond pas au type de média attendu.');
      continue;
    }
    const match=sharedProfileAsset.exec(url);
    if(match){const references=shared.get(match[1])||[];references.push(use);shared.set(match[1],references);continue;}
    // Presets may refer only to actual assets in their pinned template library.
    if(!use.template)throw new HttpError(422,'Sélectionnez un média privé partagé ou une référence locale vérifiée.');
    const prefix=`${use.template.id}/`,base=`/library/v${use.template.libraryVersion}/`;
    let key:string;
    if(url.startsWith(base+prefix))key=decodeURIComponent(url.slice(base.length));
    else if(/^img_\d+\.(?:png|jpe?g|webp)$/.test(url))key=prefix+'lib/images/'+url;
    else if(/^(?:lib|sourceassets)\//.test(url))key=prefix+decodeURIComponent(url);
    else throw new HttpError(422,'Une ressource n’appartient pas à la bibliothèque du modèle.');
    const mime=extensionMime[key.split('.').at(-1)?.toLowerCase()||''];
    if(!libraryAssets.has(key)||!mime||!accepts(mime,use.kind))throw new HttpError(422,'Une ressource du modèle est absente ou son format ne convient pas.');
    if(typeof value==='object'&&value.mimeType!==mime)throw new HttpError(422,'Le format déclaré de la ressource ne correspond pas au fichier.');
  }
  if(!shared.size)return;
  // All active team members share this media ACL. Never expose storage/provider IDs.
  const rows=await db.prepare(`SELECT id,mime_type FROM media WHERE status='ready' AND tool_scope='graphics' AND id IN (${[...shared].map(()=>'?').join(',')})`).bind(...shared.keys()).all<{id:string;mime_type:string}>();
  const available=new Map(rows.results.map(row=>[row.id,row.mime_type]));
  for(const [id,references]of shared){
    const mime=available.get(id);
    if(!mime||!Object.hasOwn(mediaExtensions,mime))throw new HttpError(422,'Un média privé manque ou son transfert n’est pas terminé.');
    for(const {value,kind}of references)if(!accepts(mime,kind)||typeof value==='object'&&value.mimeType!==mime)throw new HttpError(422,'Le média privé ne correspond pas au type annoncé.');
  }
}
