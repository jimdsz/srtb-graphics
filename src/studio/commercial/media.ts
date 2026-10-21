import {bindLocalFile,localURL,localMime,connectedLocal} from '../local-media';
import {assertBrowserMedia} from '../media-import';
import {inspectCommercialAudio} from './audio';
import {commercialTimeline} from './model';
import type {CommercialAudio,CommercialData} from './model';

export async function chooseCommercialFile(file:File,kind:'audio'|'image',signal:AbortSignal,progress:(n:number)=>void){
  const mimeType=localMime(file);
  if(!mimeType.startsWith(`${kind}/`))throw Error(kind==='audio'?'Choisissez une voix ou une musique en MP3, WAV, M4A ou Ogg.':'Choisissez un logo en PNG, JPEG ou WebP.');
  await assertBrowserMedia(file,signal);
  const descriptor=await bindLocalFile(file,progress,undefined,undefined,signal);
  const duration=kind==='audio'?(await inspectCommercialAudio(localURL(descriptor.url),signal)).duration:0;
  return {...descriptor,duration};
}
export function newCommercialAudio(url:string,name:string,duration:number,voice:boolean):CommercialAudio{
  return {url,name,duration,start:0,end:duration,delay:voice?commercialTimeline(60).firstStart:0,volume:voice?1:.15,loop:!voice,fadeIn:voice?0:.5,fadeOut:voice?0:1};
}
export function resolveCommercialMedia(data:CommercialData):CommercialData{
  return {...data,voice:data.voice?{...data.voice,url:localURL(data.voice.url)}:null,music:data.music?{...data.music,url:localURL(data.music.url)}:null,logo:data.logo?{...data.logo,url:localURL(data.logo.url)}:null};
}
export function missingCommercialMedia(data:CommercialData){return [data.voice,data.music,data.logo].filter(item=>item&&!connectedLocal(item.url)).map(item=>item!.name);}
