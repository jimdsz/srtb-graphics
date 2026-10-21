import manifest from './preview-audio-proxy.generated.json';
export const previewAudioProxyManifest=manifest;
type PCM={length:number;sampleRate:number;numberOfChannels:number;getChannelData:(channel:number)=>Float32Array};
type Read<T>=(url:string,signal:AbortSignal,reload:boolean)=>Promise<{url:string;buffer:T}>;
const cancelled=()=>new DOMException('Préparation audio interrompue.','AbortError');
export function isPinnedPreviewBed(url:string,origin:string){
  try{const value=new URL(url,origin);return value.origin===origin&&!value.username&&!value.password&&!value.search&&!value.hash&&value.pathname===manifest.sourcePath;}catch{return false;}
}
export function previewAudioCacheKey(url:string,allowed:boolean,origin:string){return !allowed&&isPinnedPreviewBed(url,origin)?'native-only:'+url:url;}
/** _load is shared by bed and voice. Never substitute a voice that deliberately
 * points to the same WAV, even though both downloads would otherwise dedupe. */
export function previewBedProxyAllowed(raw:any,previous:any,baseUrl:string,origin:string){
  const data=raw?.data||raw||{},value=data._audio_voice_url??previous?._audio_voice_url;
  const text=typeof value==='object'&&value?(value.url||value.src||value.path):value;
  try{return typeof text!=='string'||!isPinnedPreviewBed(new URL(text.trim().replace(/\\/g,'/'),baseUrl).href,origin);}catch{return false;}
}
export function validatePreviewBedPCM(buffer:PCM){
  if(buffer.length!==manifest.frames||buffer.sampleRate!==manifest.sampleRate||buffer.numberOfChannels!==manifest.channels)throw Error('Le proxy audio ne conserve pas la durée ou le format source.');
  const channels=[buffer.getChannelData(0),buffer.getChannelData(1)];
  for(const [frame,left,right]of manifest.probes)if(channels[0][frame]!==left||channels[1][frame]!==right)throw Error('Le proxy audio ne conserve pas les échantillons source.');
}
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason||cancelled());};signal.addEventListener('abort',abort,{once:true});
    promise.then(value=>{signal.removeEventListener('abort',abort);signal.aborted?reject(signal.reason||cancelled()):resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
/** No persistent/global cache. The caller's existing 48MiB instance cache owns
 * only successful decoded PCM, keyed by the unchanged original WAV URL. */
export function createPreviewAudioProxy<T extends PCM>({decode,origin=location.origin,fetcher=fetch,timeoutMs=45000,enabled=true}:{decode:(bytes:ArrayBuffer)=>Promise<T>;origin?:string;fetcher?:typeof fetch;timeoutMs?:number;enabled?:boolean}){
  let closed=false,unavailable=false;const active=new Set<AbortController>();
  return {
    async load(url:string,signal:AbortSignal,reload:boolean,read:Read<T>,allowed=true):Promise<{url:string;buffer:T}>{
      signal.throwIfAborted();if(closed)throw cancelled();
      if(!enabled||!allowed||!isPinnedPreviewBed(url,origin)||(unavailable&&!reload))return read(url,signal,reload);
      const controller=new AbortController(),relay=()=>controller.abort(signal.reason||cancelled());signal.addEventListener('abort',relay,{once:true});active.add(controller);let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;controller.abort(Error('Préparation du son d’aperçu trop longue. Réessayez.'));},timeoutMs);
      try{
        const response=await abortable(fetcher(new URL(manifest.proxyPath,origin).href,{signal:controller.signal,redirect:'error',cache:reload?'reload':'default'}),controller.signal);
        if(!response.ok||response.redirected)throw Error('Son d’aperçu indisponible.');
        if(Number(response.headers.get('content-length'))>manifest.proxyBytes)throw Error('Son d’aperçu inattendu.');
        const reader=response.body?.getReader();if(!reader)throw Error('Son d’aperçu vide.');const chunks:Uint8Array[]=[];let size=0;
        try{for(;;){controller.signal.throwIfAborted();const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>manifest.proxyBytes)throw Error('Son d’aperçu inattendu.');chunks.push(item.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
        const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
        if(size!==manifest.proxyBytes||digest!==manifest.proxySha256)throw Error('Son d’aperçu non conforme.');
        controller.signal.throwIfAborted();const buffer=await abortable(decode(bytes.buffer),controller.signal);validatePreviewBedPCM(buffer);controller.signal.throwIfAborted();unavailable=false;return {url,buffer};
      }catch(error){
        controller.abort(error);if(signal.aborted||closed)throw signal.reason||cancelled();if(timedOut)throw error;
        // Exactly one native fallback within the engine's SAME 45s budget.
        // A failed codec/download is not retried on every text edit.
        unavailable=true;
      }finally{clearTimeout(timer);signal.removeEventListener('abort',relay);active.delete(controller);}
      signal.throwIfAborted();if(closed)throw cancelled();return read(url,signal,reload);
    },
    dispose(){closed=true;for(const controller of active)controller.abort(cancelled());active.clear();},
  };
}
