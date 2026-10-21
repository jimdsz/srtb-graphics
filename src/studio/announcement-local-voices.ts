import type {DerivationAnnouncement} from './derivation-announcements';
import type {ProfileAsset} from './preparation-profile-model';
import {sharedProfileAsset} from './preparation-profile-model';
import {bindLocalFile,connectedLocal,localMime} from './local-media';
import {localReference} from './local-reference';

type VoiceSource={id:string;revision:number;data:{source:ProfileAsset}};
export type AnnouncementVoiceSources={key:string;references:ProfileAsset[];unresolved:number};
export function announcementVoiceSelectionKey(value:readonly DerivationAnnouncement[]){
  return JSON.stringify([...new Set(value.flatMap(item=>item.voice.mode==='profile'?[`${item.voice.profileId}:${item.voice.revision}`]:[]))].sort());
}
/** Resolve only the chosen revisions. New catalogue revisions never substitute
 * for old pins, and multiple announcements sharing bytes need one reconnection. */
export function announcementVoiceSources(value:readonly DerivationAnnouncement[],profiles:readonly VoiceSource[]):AnnouncementVoiceSources{
  const references=new Map<string,ProfileAsset>(),seen=new Set<string>();let unresolved=0;
  for(const item of value){
    if(item.voice.mode!=='profile')continue;
    const {profileId,revision}=item.voice,key=`${profileId}:${revision}`;if(seen.has(key))continue;seen.add(key);
    const profile=profiles.find(profile=>profile.id===profileId&&profile.revision===revision);
    if(!profile){unresolved++;continue;}
    if(!profile.data.source.mimeType.startsWith('audio/')){unresolved++;continue;}
    if(localReference(profile.data.source.url))references.set(profile.data.source.url,profile.data.source);
    else if(!sharedProfileAsset.test(profile.data.source.url))unresolved++;
  }
  return {key:announcementVoiceSelectionKey(value),references:[...references.values()],unresolved};
}
export function announcementVoicesReady(value:readonly DerivationAnnouncement[],sources:AnnouncementVoiceSources|null,connected:(url:string)=>boolean=connectedLocal){
  const key=announcementVoiceSelectionKey(value);if(key==='[]')return true;
  return !!sources&&sources.key===key&&sources.unresolved===0&&sources.references.every(source=>connected(source.url));
}
/** Verify against exactly this pinned reference before binding anything. Never
 * select another descriptor, mutate a profile, save a handle, or upload bytes. */
export async function reconnectAnnouncementVoice(source:ProfileAsset,file:File,progress:(fraction:number)=>void,signal?:AbortSignal){
  const reference=localReference(source.url);
  if(!reference||!source.mimeType.startsWith('audio/'))throw Error('Cette voix ne possède pas de référence audio locale vérifiée.');
  if(!localMime(file).startsWith('audio/'))throw Error('Choisissez le fichier audio correspondant à cette voix.');
  if(file.size!==reference.bytes)throw Error('Ce fichier ne correspond pas à la voix épinglée (taille différente). Le choix et sa révision sont conservés.');
  try{await bindLocalFile(file,progress,undefined,source.url,signal);}
  catch(cause){if(cause instanceof Error&&cause.message.includes('diffère de la version enregistrée'))throw Error('Empreinte différente : ce fichier est refusé. La voix épinglée et sa révision sont conservées.');throw cause;}
}
