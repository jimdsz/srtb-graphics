import type {MediaAsset} from './domain';
import type {ProfileAsset} from './preparation-profile-model';
import {profileAssetSchema,sharedProfileAsset} from './preparation-profile-model';
import {searchRead} from './planner-team-search';

export const logoImageMime=(mime:string)=>['image/png','image/jpeg','image/webp'].includes(mime);
export const MAX_LOGO_BYTES=20*1024**2;

/** Resolve the actual ready metadata. Neither a URL nor a filename proves MIME. */
export async function readSharedLogo(url:string,get:(id:string,signal?:AbortSignal)=>Promise<MediaAsset>,signal:AbortSignal):Promise<ProfileAsset>{
 const id=sharedProfileAsset.exec(url)?.[1];
 if(!id)throw Error('Le logo doit être une image partagée dans cette chaîne.');
 const asset=await searchRead(s=>get(id,s),signal,10000,'Les informations du logo ne répondent pas. Votre choix actuel reste conservé.');
 signal.throwIfAborted();
 if(asset.id!==id||asset.status!=='ready'||!logoImageMime(asset.mime_type)||asset.bytes<=0)throw Error('Ce logo n’est pas une image PNG, JPEG ou WebP prête à être utilisée.');
 return profileAssetSchema.parse({url,name:asset.name,mimeType:asset.mime_type});
}

/** Image signatures are read locally before fingerprinting. Reject disguised
 * SVG/video files without trusting an extension or the browser's MIME hint. */
export async function checkedLocalLogo(file:File,signal:AbortSignal):Promise<File>{
 signal.throwIfAborted();
 if(!file.size||file.size>MAX_LOGO_BYTES)throw Error('Choisissez une image de 20 Mo maximum, non vide.');
 if(!file.name||file.name.length>200||/[\x00-\x1f/\\]/.test(file.name))throw Error('Choisissez un nom de fichier simple, de 200 caractères maximum.');
 const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer());signal.throwIfAborted();
 let mime='';
 if([137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte))mime='image/png';
 else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
 else if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')mime='image/webp';
 if(!mime)throw Error('Choisissez une véritable image PNG, JPEG ou WebP. Les fichiers SVG et les vidéos ne sont pas acceptés comme logo.');
 return file.type===mime?file:new File([file],file.name,{type:mime,lastModified:file.lastModified});
}
