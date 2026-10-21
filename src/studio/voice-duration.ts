import {localURL} from './local-media';
import {localReference} from './local-reference';
import {sharedProfileAsset} from './preparation-profile-model';
import {sessionState} from './session-state';
import {bindVideoSession} from './video-snapshot';
import type {ProfileAsset} from './preparation-profile-model';
export interface VoiceDurationProgress {phase:'reading'|'decoding';bytes:number;total:number|null}
export const decodedVoiceDuration=(buffer:{length:number;sampleRate:number})=>{
  const duration=buffer.length/buffer.sampleRate;
  if(!Number.isSafeInteger(buffer.length)||buffer.length<1||!Number.isFinite(buffer.sampleRate)||buffer.sampleRate<=0||!Number.isFinite(duration)||duration<.04||duration>600)throw Error('Le fichier décodé doit durer de 0,04 à 600 secondes.');
  return duration;
};
/** Explicit local read, never an upload or a container-duration estimate. */
export async function measureVoiceDuration(source:ProfileAsset,controller:AbortController,onProgress?:(value:VoiceDurationProgress)=>void):Promise<number>{
  if(!source.mimeType.startsWith('audio/')||!localReference(source.url)&&!source.url.startsWith('blob:')&&!sharedProfileAsset.test(source.url))throw Error('Choisissez un fichier audio local ou partagé.');
  const epoch=sessionState.snapshot().epoch,release=bindVideoSession(controller),signal=controller.signal,limit=32*1024**2;
  try{
    signal.throwIfAborted();const response=await fetch(localURL(source.url),{signal,credentials:'same-origin',cache:'no-store',redirect:'error'});
    signal.throwIfAborted();
    if(response.status===401)sessionState.end('expired',epoch);
    if(!response.ok||!response.headers.get('Content-Type')?.startsWith('audio/'))throw Error('Ce fichier audio n’est pas disponible. Reconnectez-le ou choisissez une source compatible.');
    const announced=Number(response.headers.get('Content-Length')),total=Number.isSafeInteger(announced)&&announced>0?announced:null;
    if(announced>limit)throw Error('La mesure de voix accepte au maximum 32 Mo. Choisissez un fichier d’annonce plus court.');
    const report=(phase:VoiceDurationProgress['phase'],bytes:number)=>{try{onProgress?.({phase,bytes,total});}catch{/* Progress cannot interrupt resource cleanup. */}};
    report('reading',0);
    const reader=response.body?.getReader();if(!reader)throw Error('Lecture audio indisponible.');
    const chunks:Uint8Array<ArrayBuffer>[]= [];let size=0;
    try{while(true){signal.throwIfAborted();const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>limit)throw Error('Le fichier audio dépasse 32 Mo.');chunks.push(next.value);report('reading',size);}}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
    const encoded=new Uint8Array(size);let offset=0;for(const chunk of chunks){encoded.set(chunk,offset);offset+=chunk.length;}chunks.length=0;
    signal.throwIfAborted();report('decoding',size);const context=new AudioContext({sampleRate:48000});
    try{if(context.sampleRate!==48000)throw Error('La mesure de référence exige un décodage à48kHz.');const decoded=await context.decodeAudioData(encoded.buffer);signal.throwIfAborted();if(decoded.sampleRate!==48000)throw Error('La source n’a pas été décodée à la fréquence de référence48kHz.');return decodedVoiceDuration(decoded);}
    finally{await context.close().catch(()=>undefined);}
  }finally{release();}
}
