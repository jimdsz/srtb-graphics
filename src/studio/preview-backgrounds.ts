import type {BroadcastTemplate} from './domain';
import type {LegacyGraphic} from './video/engine';
import {PreviewBackgroundFrames} from './preview-background-frames';

type Archive=Record<string,Uint8Array<ArrayBuffer>>;
type ArchiveJob={promise:Promise<Archive>;abort:AbortController;readers:number;settled:boolean};
const pending=new Map<string,ArchiveJob>();
if(typeof window!=='undefined')window.addEventListener('srtb-local-media-clear',()=>{
  for(const job of pending.values())job.abort.abort();
  pending.clear();
});

/** Even fflate's asynchronous unzip inflates small PNG entries synchronously.
 * One dedicated worker keeps the whole archive off the preview's UI thread. */
export function extractPreviewBackgrounds(bytes:ArrayBuffer,signal:AbortSignal):Promise<Archive>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./preview-backgrounds.worker.ts',import.meta.url),{type:'module'});
    const finish=(error?:unknown,entries?:Archive)=>{
      clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();
      if(error)reject(error);else resolve(entries!);
    };
    const abort=()=>finish(signal.reason),timer=setTimeout(()=>finish(Error('La préparation de l’animation TV ne répond pas.')),15000);
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=(event:MessageEvent<{entries?:Archive;error?:string}>)=>{
      if(event.data.error||!event.data.entries)finish(Error(event.data.error||'Archive d’animation TV invalide.'));
      else finish(undefined,event.data.entries);
    };
    worker.onerror=()=>finish(Error('La préparation de l’animation TV a échoué.'));
    worker.onmessageerror=()=>finish(Error('Archive d’animation TV illisible.'));
    try{worker.postMessage(bytes,[bytes]);}catch(error){finish(error);}
  });
}

function acquireArchive(id:string){
  let job=pending.get(id);
  if(!job){
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(new Error('Animation TV inaccessible : délai de chargement dépassé.')),45000);
    job={abort,readers:0,settled:false,promise:Promise.resolve({})};
    const current=job;
    current.promise=fetch('/preview-media/v2/'+id+'.zip',{signal:abort.signal}).then(async response=>{
      if(!response.ok)throw Error('Animation TV inaccessible ('+response.status+').');
      return extractPreviewBackgrounds(await response.arrayBuffer(),abort.signal);
    }).finally(()=>{current.settled=true;clearTimeout(timer);});
    pending.set(id,current);
    void current.promise.catch(()=>{if(pending.get(id)===current)pending.delete(id);});
  }
  const current=job;current.readers++;
  let released=false;
  return {promise:current.promise,release:()=>{
    if(released)return;released=true;current.readers--;
    if(!current.readers&&!current.settled){current.abort.abort();if(pending.get(id)===current)pending.delete(id);}
  }};
}

/** Original PNG pixels and timing; preview integration only.
 * The frozen delivery engines and all export paths stay independent. */
export function installPreviewBackgrounds(g:LegacyGraphic,t:BroadcastTemplate,stage:(label:string)=>void){
  if(t.libraryVersion!=='1.7.0'||!['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'].includes(t.id))return;
  const originalDispose=g.dispose.bind(g),originalSet=g._setBackgroundFrame.bind(g),abort=new AbortController();
  let frames:PreviewBackgroundFrames|undefined,release:(()=>void)|undefined;
  g.dispose=()=>{abort.abort();release?.();frames?.dispose();return originalDispose();};
  g._setBackgroundFrame=(absoluteFrame:number)=>{
    const config=g.state.lottieTemplate?.btvAutomation?.backgroundSequence,image=g.state.backgroundImage as HTMLImageElement|null;
    if(!config||!image||!frames){originalSet(absoluteFrame);return;}
    // Match the version-pinned engine's rounding, clamping and frame clock.
    const first=Number(config.firstFrame||0),last=Number(config.lastFrame||first);
    const frame=Math.max(first,Math.min(last,Math.floor(Number(absoluteFrame||0)+.000001)));
    if(frame===g.state.backgroundFrame)return;
    const source=g.state.backgroundObjectUrls[frame-first];
    if(source&&source===image.src)g.state.backgroundFrame=frame;
    else{
      const decoded=source&&frames.take(source);
      if(decoded){
        decoded.id=image.id;decoded.alt=image.alt;decoded.draggable=false;decoded.style.cssText=image.style.cssText;
        image.replaceWith(decoded);g.state.backgroundImage=decoded;g.state.backgroundFrame=frame;
        image.removeAttribute('src');
      }else originalSet(absoluteFrame);
    }
    frames.ahead(frame-first);
  };
  g._loadBackgroundSequence=async()=>{
    const config=g.state.lottieTemplate?.btvAutomation?.backgroundSequence;if(!config)return {};
    abort.signal.throwIfAborted();stage('Préparation de l’animation TV');
    const request=acquireArchive(t.id);release=request.release;
    const urls:string[]=[],unique=new Map<string,string>();
    try{
      const entries=await request.promise;abort.signal.throwIfAborted();
      const index=JSON.parse(new TextDecoder().decode(entries['index.json'])) as {version:number;frames:Record<string,string>};
      if(index.version!==2||!index.frames)throw Error('Index d’animation TV invalide.');
      for(let frame=config.firstFrame;frame<=config.lastFrame;frame++){
        const name=index.frames[String(frame)],bytes=entries[name];if(!bytes)throw Error('Animation TV incomplète : image '+frame+'.');
        if(!unique.has(name))unique.set(name,URL.createObjectURL(new Blob([bytes],{type:'image/png'})));
        urls.push(unique.get(name)!);
      }
      const style=document.createElement('style');style.textContent=':host{position:relative;display:block;width:100%;height:100%;overflow:hidden}#btv-background-sequence,[id^="animation"]{position:absolute;inset:0;width:100%;height:100%}#btv-background-sequence{display:block;object-fit:fill;pointer-events:none;user-select:none}';
      const image=new Image();image.id='btv-background-sequence';image.alt='';image.draggable=false;image.src=urls[0];await image.decode();abort.signal.throwIfAborted();
      frames=new PreviewBackgroundFrames(urls);frames.ahead(0);await frames.ready();abort.signal.throwIfAborted();
      g.shadow.append(style,image);g.state.backgroundImage=image;g.state.backgroundObjectUrls=urls;g.state.backgroundFrame=config.firstFrame;
      stage('Ouverture des médias et préparation de la première image');return {frames:urls.length};
    }catch(error){frames?.dispose();unique.forEach(url=>URL.revokeObjectURL(url));throw error;}
    finally{request.release();if(release===request.release)release=undefined;}
  };
}
