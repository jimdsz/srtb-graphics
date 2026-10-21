import {BAPreviewFrame} from '../src/studio/ba-preview-frame';
import {PreviewWebGLGuard} from '../src/studio/preview-webgl-guard';

const buttons=[...document.querySelectorAll<HTMLButtonElement>('#faults,#cost')],cancel=document.querySelector<HTMLButtonElement>('#cancel')!;
const status=document.querySelector('#status')!,result=document.querySelector('#result')!,host=document.querySelector('#host')!;
let active:AbortController|undefined;
const placement={x:1,y:0,width:1920,height:1080};
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message);};
const nextFrame=(signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  const abort=()=>{cancelAnimationFrame(id);reject(signal.reason);};
  const id=requestAnimationFrame(()=>{signal.removeEventListener('abort',abort);signal.aborted?reject(signal.reason):resolve();});
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});
const summarize=(samples:number[])=>{const sorted=[...samples].sort((a,b)=>a-b);return {samples:samples.length,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1)};};
async function run(work:(lut:Uint8Array,signal:AbortSignal)=>Promise<unknown>){
  if(active)return;active=new AbortController();const signal=active.signal;
  buttons.forEach(button=>button.disabled=true);cancel.disabled=false;result.textContent='';host.replaceChildren();status.textContent='Préparation du rendu local…';
  const timer=setTimeout(()=>active?.abort(new Error('Recette interrompue après 45 secondes.')),45000);
  try{
    const response=await fetch('/library/v1.7.0/BTV_BA_1P/lib/media/native-pack-grade.rgb',{signal});assert(response.ok,'LUT native inaccessible.');
    const lut=new Uint8Array(await response.arrayBuffer());signal.throwIfAborted();assert(lut.length===64**3*3,'LUT native incomplète.');
    const report=await work(lut,signal);signal.throwIfAborted();result.textContent=JSON.stringify(report,null,2);status.textContent='Terminé · résultats locaux ci-dessous.';
  }catch(error){status.textContent=`ÉCHEC / ANNULATION · ${error instanceof Error?error.message:String(error)}`;result.textContent=JSON.stringify({error:String(error)},null,2);}
  finally{clearTimeout(timer);active=undefined;buttons.forEach(button=>button.disabled=false);cancel.disabled=true;}
}
cancel.onclick=()=>active?.abort(new DOMException('Recette annulée.','AbortError'));

document.querySelector<HTMLButtonElement>('#faults')!.onclick=()=>void run(async(lut,signal)=>{
  const renderer=new BAPreviewFrame(lut),gl=(renderer as any).gl as WebGLRenderingContext,guard=(renderer as any).guard as PreviewWebGLGuard;
  const source=document.createElement('canvas');source.width=64;source.height=36;
  const ctx=source.getContext('2d')!,output=document.createElement('canvas');output.width=960;output.height=540;host.append(output);
  const shown=output.getContext('2d')!;
  const draw=()=>renderer.draw(source as unknown as HTMLImageElement,960,540,'body',placement,true);
  const upload=gl.texImage2D.bind(gl);let published=0;
  try{
    ctx.fillStyle='#e50036';ctx.fillRect(0,0,64,36);shown.drawImage(draw(),0,0);published++;
    // Real WebGL error, without exhausting the device: negative texture level
    // is rejected and leaves the previously allocated picture texture intact.
    (gl as any).texImage2D=(...args:any[])=>{if(args.length===6)args[1]=-1;return (upload as any)(...args);};
    ctx.fillStyle='#0065e5';ctx.fillRect(0,0,64,36);let rejected='';
    try{shown.drawImage(draw(),0,0);published++;}catch(error){rejected=String(error);}
    assert(rejected.includes('refusé')&&published===1,'Une ancienne texture a été acceptée après le refus de la nouvelle.');
    (gl as any).texImage2D=upload;
    const over=document.createElement('canvas');over.width=guard.maxTextureSize+1;over.height=1;
    const overContext=over.getContext('2d');assert(overContext,'Le navigateur ne permet pas le canevas de test trop large.');
    overContext!.fillStyle='#27b779';overContext!.fillRect(0,0,over.width,1);
    const bounded=guard.source(over) as HTMLCanvasElement;
    assert(bounded.width<=guard.maxTextureSize&&bounded.height===1,'La source hors limite n’a pas été réduite.');
    const dimensions={source:[over.width,over.height],bounded:[bounded.width,bounded.height],maxTextureSize:guard.maxTextureSize};
    over.width=0;over.height=0;
    const lose=gl.getExtension('WEBGL_lose_context');assert(lose,'Extension de perte de contexte indisponible sur ce poste.');lose!.loseContext();await nextFrame(signal);
    let lost='';try{draw();}catch(error){lost=String(error);}
    assert(lost.includes('processeur graphique'),'Le contexte perdu a été accepté.');
    return {pass:true,scope:'WebGL réel du navigateur local ; erreur INVALID_VALUE injectée, pas de panne mémoire forcée',rejectedUpload:rejected,published,oversize:dimensions,rejectedContextLoss:lost};
  }finally{(gl as any).texImage2D=upload;renderer.dispose();source.width=0;source.height=0;}
});

async function openVideo(signal:AbortSignal){
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.loop=true;video.preload='auto';host.append(video);
  const ready=new Promise<void>((resolve,reject)=>{
    const clean=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',loaded);video.removeEventListener('error',failed);signal.removeEventListener('abort',aborted);};
    const loaded=()=>{clean();resolve();},failed=()=>{clean();reject(Error('Vidéo locale inaccessible.'));},aborted=()=>{clean();reject(signal.reason);};
    const timer=setTimeout(()=>{clean();reject(Error('Chargement vidéo supérieur à 15 secondes.'));},15000);
    video.addEventListener('loadeddata',loaded,{once:true});video.addEventListener('error',failed,{once:true});signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();
  });
  video.src='/preview-media/v1/ba-programme.mp4';
  try{await ready;signal.throwIfAborted();await video.play();signal.throwIfAborted();return video;}
  catch(error){video.pause();video.removeAttribute('src');video.load();video.remove();throw error;}
}
document.querySelector<HTMLButtonElement>('#cost')!.onclick=()=>void run(async(lut,signal)=>{
  const video=await openVideo(signal),renderer=new BAPreviewFrame(lut),guard=(renderer as any).guard as PreviewWebGLGuard;
  const nativeSource=guard.source.bind(guard),nativeCheck=guard.check.bind(guard),output=document.createElement('canvas');output.width=960;output.height=540;host.append(output);
  const ctx=output.getContext('2d')!,samples={guarded:[] as number[],control:[] as number[]},checks:number[]=[];
  const before={time:video.currentTime,frames:video.getVideoPlaybackQuality?.().totalVideoFrames??null};
  try{
    assert(Math.max(video.videoWidth,video.videoHeight)<=guard.maxTextureSize,'La vidéo témoin ne doit pas nécessiter de réduction.');
    for(const mode of ['control','guarded','guarded','control'] as const){
      // Local fixture only: compare the exact same shader/video/copy, ABBA
      // order, with/without the additional guard. Never touches product code.
      guard.source=mode==='guarded'?nativeSource:source=>source;
      guard.check=mode==='guarded'?()=>{const start=performance.now();nativeCheck();checks.push(performance.now()-start);}:()=>{};
      status.textContent=`Mesure ${mode==='guarded'?'protégée':'témoin'} · vidéo réelle et copie HTML 960 × 540`;
      for(let i=0;i<100;i++){
        await nextFrame(signal);const start=performance.now();
        const frame=renderer.draw(video,960,540,'body',placement,true);ctx.clearRect(0,0,960,540);ctx.drawImage(frame,0,0);
        if(i>=10)samples[mode].push(performance.now()-start);
      }
    }
    const after={time:video.currentTime,frames:video.getVideoPlaybackQuality?.().totalVideoFrames??null};
    assert(after.time>before.time,'Le média n’a pas avancé pendant la mesure.');
    const guarded=summarize(samples.guarded),control=summarize(samples.control);
    return {scope:'Mesure locale seulement ; aucune conclusion Safari/Mac physique sur un autre poste',source:[video.videoWidth,video.videoHeight],output:[960,540],before,after,guarded,control,check:summarize(checks),difference:{meanMs:guarded.meanMs-control.meanMs,p95Ms:guarded.p95Ms-control.p95Ms},note:'Durées CPU observées avec copie vers le canevas HTML, sans gl.finish ni readPixels. Pas une mesure garantie du débit de présentation écran.'};
  }finally{guard.source=nativeSource;guard.check=nativeCheck;renderer.dispose();video.pause();video.removeAttribute('src');video.load();video.remove();}
});
