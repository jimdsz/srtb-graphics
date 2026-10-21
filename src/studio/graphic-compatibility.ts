import type {BroadcastTemplate} from './domain';

interface LottieAsset {p?:string;u?:string;e?:number;[key:string]:unknown}
interface AnimationData {assets?:LottieAsset[];[key:string]:unknown}
interface Buildable {
  _build?:(data:AnimationData,media:unknown,signal:AbortSignal)=>Promise<unknown>;
  _update?:(data:unknown,initial?:boolean,...args:unknown[])=>Promise<unknown>;
  original?:AnimationData;
  _abort?:AbortController;
  dispose?:(...args:unknown[])=>Promise<unknown>;
}
const installed=new WeakSet<object>();

/** Resolve against the engine, never against /graphics or the current SPA route. */
export function resolveGraphicImages<T extends AnimationData>(data:T,moduleUrl:string):T {
  return {...data,assets:data.assets?.map(asset=>{
    if(!asset.p||asset.p.startsWith('data:'))return {...asset};
    const source=/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(asset.p)?asset.p:(asset.u||'')+asset.p;
    return {...asset,u:'',p:new URL(source,moduleUrl).href,e:1};
  })};
}

function decodeImage(url:string,signal:AbortSignal):Promise<HTMLImageElement>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const image=new Image();image.crossOrigin='anonymous';
    image.loading='eager';image.decoding='async';image.fetchPriority='high';
    const name=new URL(url).pathname.split('/').pop()||'image';
    let settled=false;
    const timeout=setTimeout(()=>finish(Error(`L’image interne « ${name} » ne se charge pas. Vérifiez la connexion puis relancez l’aperçu.`)),15000);
    function finish(error?:unknown){if(settled)return;settled=true;clearTimeout(timeout);signal.removeEventListener('abort',abort);image.onload=image.onerror=null;if(error){image.removeAttribute('src');reject(error);}else resolve(image);}
    const abort=()=>finish(signal.reason||new DOMException('Chargement annulé','AbortError'));
    const ready=()=>{if(image.complete&&image.naturalWidth>0)finish();};
    const failed=()=>finish(Error(`L’image interne « ${name} » est inaccessible. Relancez l’aperçu ; ne remplacez pas votre vidéo pour cette erreur.`));
    signal.addEventListener('abort',abort,{once:true});
    image.onload=ready;
    image.onerror=failed;
    image.src=url;
    // Also observe decoding/cache completion, not only a future load event.
    if(typeof image.decode==='function')void image.decode().then(ready,failed);
    ready();
  });
}

/** App integration fix for the frozen BA 1.0.3. Delivery files stay byte-identical.
 * Apply before load, on both preview and export instances. Rebuilding after a text,
 * sponsor or sound edit passes through the same asset resolver.
 */
export function installGraphicCompatibility(graphic:Buildable,template:Pick<BroadcastTemplate,'id'|'version'|'libraryVersion'|'module'>){
  if(template.id!=='BTV_BA_1P'||template.version!=='1.0.3'||template.libraryVersion!=='1.7.0'||installed.has(graphic))return;
  const build=graphic._build;
  if(typeof build!=='function')throw Error('Adaptateur d’images BA incompatible avec ce moteur.');
  installed.add(graphic);
  // Keep decoded images alive for this instance, including text-only rebuilds.
  const decoded=new Map<string,Promise<HTMLImageElement>>();
  async function preload(data:AnimationData,signal:AbortSignal){
    const resolved=resolveGraphicImages(data,template.module);
    const loading=new AbortController(),abort=()=>loading.abort(signal.reason);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    try{await Promise.all((resolved.assets||[]).filter(asset=>asset.p&&!asset.p.startsWith('data:')).map(asset=>{
      const url=asset.p!;let pending=decoded.get(url);
      if(!pending){pending=decodeImage(url,loading.signal);decoded.set(url,pending);void pending.catch(()=>{if(decoded.get(url)===pending)decoded.delete(url);});}
      return pending;
    }));}catch(error){loading.abort(error);throw error;}finally{signal.removeEventListener('abort',abort);}
    signal.throwIfAborted();
    return resolved;
  }
  // The native update opens three videos before _build. Load its small images
  // first so their deadline is not spent waiting behind those media preloads.
  const update=graphic._update;
  if(update)graphic._update=async function(data,initial,...args){
    if(initial&&this.original&&this._abort)await preload(this.original,this._abort.signal);
    return update.call(this,data,initial,...args);
  };
  graphic._build=async function(data,media,signal){
    const resolved=await preload(data,signal);
    return build.call(this,resolved,media,signal);
  };
  const dispose=graphic.dispose;
  if(dispose)graphic.dispose=function(...args){
    for(const pending of decoded.values())void pending.then(image=>image.removeAttribute('src'),()=>{});
    decoded.clear();return dispose.apply(this,args);
  };
}
