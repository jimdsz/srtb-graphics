/** Session-local bytes of the fixed public renderer only. Never caches a
 * project, API response, user media, audio or authenticated account data. */
const templates=['BTV_Renvoi','BTV_Evenement','BTV_Semainier','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay'];
const paths=new Set(templates.flatMap(id=>{
  const files=['lib/fonts/BeninSemiBold-Regular.otf','lib/fonts/SuisseIntl.otf'];
  if(id==='BTV_Renvoi')files.push('lib/benin-outlines.json','source/1L/animation.json','source/2L/animation.json');
  else if(id==='BTV_Evenement'||id==='BTV_Semainier')files.push('source/animation.json');
  else files.push('layout.css');
  return files.map(file=>`/library/v1.7.0/${id}/${file}`);
}));
type Job={controller:AbortController;promise:Promise<Uint8Array>;readers:number;settled:boolean};
type CacheOptions={fetcher?:typeof fetch;origin?:string;timeoutMs?:number;maxBytes?:number;maxResourceBytes?:number};
const interrupted=()=>new DOMException('Chargement de l’aperçu interrompu.','AbortError');
export function publicPreviewResourceURL(value:string|URL,origin:string){
  const url=new URL(value,origin);
  if(url.origin!==origin||url.search||url.hash||!paths.has(url.pathname))throw Error('Cette ressource ne peut pas être conservée dans le cache public de l’aperçu.');
  return url.href;
}
export function createPreviewResourceCache({fetcher=fetch,origin=location.origin,timeoutMs=45000,maxBytes=8*1024**2,maxResourceBytes=2*1024**2}:CacheOptions={}){
  const complete=new Map<string,Uint8Array>(),pending=new Map<string,Job>();let bytes=0;
  async function download(url:string,signal:AbortSignal){
    const response=await fetcher(url,{signal,redirect:'error'}); // Keep credentials unchanged; never follow a public path into a private endpoint.
    if(response.redirected)throw Error('Redirection inattendue d’une ressource graphique.');
    if(!response.ok)throw Error(`Ressource du modèle indisponible (HTTP ${response.status}). Réessayez.`);
    if(Number(response.headers.get('content-length'))>maxResourceBytes)throw Error('Ressource graphique trop volumineuse.');
    const reader=response.body?.getReader();if(!reader)throw Error('Réponse graphique vide.');
    const chunks:Uint8Array[]= [];let size=0;
    try{for(;;){signal.throwIfAborted();const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>maxResourceBytes)throw Error('Ressource graphique trop volumineuse.');chunks.push(item.value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    signal.throwIfAborted();const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
  }
  function acquire(url:string,signal:AbortSignal):Promise<Uint8Array>{
    signal.throwIfAborted();const cached=complete.get(url);
    if(cached){complete.delete(url);complete.set(url,cached);return Promise.resolve(cached);}
    let job=pending.get(url);
    if(!job){
      const controller=new AbortController(),current:Job={controller,promise:Promise.resolve(new Uint8Array()),readers:0,settled:false};job=current;pending.set(url,current);
      const timer=setTimeout(()=>controller.abort(new Error('Le chargement du modèle a dépassé 45 secondes. Réessayez.')),timeoutMs);
      current.promise=download(url,controller.signal).then(value=>{
        controller.signal.throwIfAborted();
        if(value.length<=maxBytes){while(bytes+value.length>maxBytes&&complete.size){const [key,old]=complete.entries().next().value!;complete.delete(key);bytes-=old.length;}complete.set(url,value);bytes+=value.length;}
        return value;
      }).catch(error=>{controller.abort(error);throw error;}).finally(()=>{current.settled=true;clearTimeout(timer);if(pending.get(url)===current)pending.delete(url);});
    }
    const current=job;current.readers++;
    return new Promise((resolve,reject)=>{
      let done=false;
      const finish=(error?:unknown,value?:Uint8Array)=>{
        if(done)return;done=true;signal.removeEventListener('abort',abort);current.readers--;
        if(!current.readers&&!current.settled){if(pending.get(url)===current)pending.delete(url);current.controller.abort(interrupted());}
        error?reject(error):resolve(value!);
      };
      const abort=()=>finish(signal.reason||interrupted());signal.addEventListener('abort',abort,{once:true});
      current.promise.then(value=>finish(undefined,value),error=>finish(error));if(signal.aborted)abort();
    });
  }
  return {
    async load(value:string|URL,type:'json'|'bytes'|'text',signal:AbortSignal){
      const url=publicPreviewResourceURL(value,origin),raw=await acquire(url,signal);signal.throwIfAborted();
      try{return type==='bytes'?raw.slice().buffer:type==='text'?new TextDecoder().decode(raw):JSON.parse(new TextDecoder().decode(raw));}
      catch(error){const cached=complete.get(url);if(cached){bytes-=cached.length;complete.delete(url);}throw error;}
    },
    evict(value:string|URL){const url=publicPreviewResourceURL(value,origin),cached=complete.get(url);if(cached){bytes-=cached.length;complete.delete(url);}},
    clear(){for(const job of pending.values())job.controller.abort(interrupted());pending.clear();complete.clear();bytes=0;},
    get stats(){return {bytes,entries:complete.size,pending:pending.size};},
  };
}
let cache:ReturnType<typeof createPreviewResourceCache>|undefined;
export function previewResource(url:string|URL,type:'json'|'bytes'|'text',signal:AbortSignal){return (cache??=createPreviewResourceCache()).load(url,type,signal);}
if(typeof window!=='undefined')window.addEventListener('srtb-local-media-clear',()=>{cache?.clear();cache=undefined;});

const installedFonts=new Map<string,{family:string;bytes:ArrayBuffer}>();
if(typeof window!=='undefined')window.addEventListener('srtb-local-media-clear',()=>installedFonts.clear());
export async function previewFont(family:string,url:string|URL,signal:AbortSignal){
  signal.throwIfAborted();const key=publicPreviewResourceURL(url,location.origin)+'|'+family,cached=installedFonts.get(key);if(cached)return cached;
  const bytes=await previewResource(url,'bytes',signal) as ArrayBuffer;signal.throwIfAborted();
  let face:FontFace;
  try{face=await new FontFace(family,bytes).load();}catch(error){cache?.evict(url);throw error;}
  signal.throwIfAborted();
  // Only successful immutable fonts are shared. A failed or cancelled attempt
  // cannot poison a subsequent instance's retry.
  const existing=installedFonts.get(key);if(existing)return existing;
  document.fonts.add(face);const result={family,bytes};installedFonts.set(key,result);return result;
}

/** Nodes still being prepared are not in the engine's committed tracks yet.
 * Own their abort listener now, otherwise dispose() cannot stop their fetch. */
function releaseMedia(node:HTMLMediaElement|HTMLImageElement){if('pause'in node)node.pause();node.removeAttribute('src');if('load'in node)node.load();node.remove();}
export function assertPreviewMedia(node:HTMLMediaElement|HTMLImageElement,signal:AbortSignal){if(signal.aborted)releaseMedia(node);signal.throwIfAborted();}
export function previewMediaReady(node:HTMLMediaElement|HTMLImageElement,event:string,signal:AbortSignal,timeoutMs=45000):Promise<void>{
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(error?:unknown)=>{
      if(done)return;done=true;clearTimeout(timer);node.removeEventListener(event,ready);node.removeEventListener('error',failed);signal.removeEventListener('abort',abort);
      if(error){releaseMedia(node);reject(error);}else resolve();
    };
    const ready=()=>finish(),failed=()=>finish(Error('Média inaccessible ou codec non décodable. Réessayez.')),abort=()=>finish(signal.reason||interrupted());
    const timer=setTimeout(()=>finish(Error('Le média met trop de temps à répondre. Réessayez ou reconnectez le fichier local.')),timeoutMs);
    node.addEventListener(event,ready,{once:true});node.addEventListener('error',failed,{once:true});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}
export function previewAnimationReady(animation:any,signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(error?:unknown)=>{if(done)return;done=true;clearTimeout(timer);animation.removeEventListener('DOMLoaded',ready);animation.removeEventListener('data_failed',failed);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
    const ready=()=>finish(),failed=()=>finish(Error('Animation refusée.')),abort=()=>finish(signal.reason||interrupted());
    const timer=setTimeout(()=>finish(Error('Chargement du moteur dépassé.')),15000);
    animation.addEventListener('DOMLoaded',ready);animation.addEventListener('data_failed',failed);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();else if(animation.isLoaded)ready();
  });
}
