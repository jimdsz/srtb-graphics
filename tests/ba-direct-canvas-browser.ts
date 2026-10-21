import {paintBAPreviewCanvas,copyBAPreviewCanvas} from '../src/studio/ba-preview-canvas';
import {baPreviewPlacement} from '../src/studio/ba-preview-surfaces';
if(location.origin!=='http://127.0.0.1:5192')throw Error('Recette locale uniquement.');
type Kind='intro'|'body';
const status=document.querySelector('#status')!,result=document.querySelector('#result')!,host=document.querySelector('#host')!;
const pixels=document.querySelector<HTMLButtonElement>('#pixels')!,cost=document.querySelector<HTMLButtonElement>('#cost')!,cancel=document.querySelector<HTMLButtonElement>('#cancel')!;
let abort:AbortController|undefined;
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message);};
const policy=document.querySelector<HTMLSelectElement>('#policy')!;
const canvas=()=>{const out=document.createElement('canvas');if(policy.value==='software')out.getContext('2d',{willReadFrequently:true});return out;};
// Frozen control: the previous Chromium framing/copy sequence, independent of
// the new helper. Colour conversion remains upstream and unchanged in product.
function oldPaint(source:CanvasImageSource,work:HTMLCanvasElement,targets:HTMLCanvasElement[],w:number,h:number,kind:Kind,placement:{x:number;y:number;width:number;height:number}){
 if(work.width!==w||work.height!==h){work.width=w;work.height=h;}
 const ctx=work.getContext('2d')!;ctx.setTransform(w/1920,0,0,h/1080,0,0);ctx.clearRect(0,0,1920,1080);
 if(kind==='intro'){ctx.fillStyle='rgba(0,0,0,.1)';ctx.fillRect(0,0,1920,1080);}
 ctx.drawImage(source,placement.x,placement.y,placement.width,placement.height);
 for(const target of targets){if(target.width!==w||target.height!==h){target.width=w;target.height=h;}
  const out=target.getContext('2d')!;out.clearRect(0,0,w,h);out.drawImage(work,0,0,w,h);}
}
function newPaint(source:CanvasImageSource,targets:HTMLCanvasElement[],w:number,h:number,kind:Kind,placement:{x:number;y:number;width:number;height:number}){
 paintBAPreviewCanvas(source,targets[0],w,h,kind,placement);copyBAPreviewCanvas(targets[0],targets,w,h);
}
function compare(a:HTMLCanvasElement,b:HTMLCanvasElement){
 // Read an isolated snapshot, not the renderer's context: repeatedly reading
 // product canvases can switch only one path to software rasterization.
 const snapshot=(source:HTMLCanvasElement)=>{const out=canvas();out.width=source.width;out.height=source.height;const c=out.getContext('2d',{willReadFrequently:true})!;c.drawImage(source,0,0);return c.getImageData(0,0,out.width,out.height).data;};
 const x=snapshot(a),y=snapshot(b);
 let different=0,max=0;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);if(d)different++;max=Math.max(max,d);}
 return {components:x.length,different,max};
}
const frame=(signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 const done=()=>{signal.removeEventListener('abort',stop);resolve();},id=requestAnimationFrame(done),stop=()=>{cancelAnimationFrame(id);reject(signal.reason);};
 signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
});
async function run(work:(signal:AbortSignal)=>Promise<unknown>){
 if(abort)return;abort=new AbortController();const signal=abort.signal;
 pixels.disabled=cost.disabled=policy.disabled=true;cancel.disabled=false;result.textContent='';host.replaceChildren();
 const timer=setTimeout(()=>abort?.abort(Error('Recette dépassant 50 secondes.')),50000);
 try{const report=await work(signal);signal.throwIfAborted();const evidence=`ba-direct-canvas-${Date.now()}.json`;
  const r=await fetch('/__video-evidence/'+evidence,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});assert(r.ok,'Écriture de preuve refusée');
  result.textContent=JSON.stringify({report,evidence},null,2);status.textContent='Terminé — preuves locales conservées.';
 }catch(error){result.textContent=JSON.stringify({pass:false,error:String(error)},null,2);status.textContent='Échec / annulation';}
 finally{clearTimeout(timer);abort=undefined;pixels.disabled=cost.disabled=policy.disabled=false;cancel.disabled=true;}
}
cancel.onclick=()=>abort?.abort(new DOMException('Annulé','AbortError'));
pixels.onclick=()=>void run(async signal=>{
 const records:unknown[]=[],a=[canvas(),canvas()],b=[canvas(),canvas()],scratch=canvas();host.append(a[0],b[0]);
 for(const [sw,sh]of [[640,360],[640,480],[360,640]])for(const transparent of [false,true]){
  const source=canvas();source.width=sw;source.height=sh;const c=source.getContext('2d')!,gradient=c.createLinearGradient(0,0,sw,sh);
  gradient.addColorStop(0,transparent?'#ef0d3c00':'#ef0d3c');gradient.addColorStop(.49,'#155de588');gradient.addColorStop(.5,'#fff');gradient.addColorStop(1,'#07db3b');c.fillStyle=gradient;c.fillRect(0,0,sw,sh);c.clearRect(sw/3,sh/3,7,17);c.fillStyle='#0008';c.fillRect(11,3,sw/3,sh/3);
  for(const edge of [640,960,1280,724])for(const fit of ['contain','cover'])for(const kind of ['intro','body'] as Kind[]){
   const w=edge,h=Math.round(edge*1080/1920),p=baPreviewPlacement(sw,sh,fit,kind);
   for(const indices of [[0,1],[1],[1,0],[0,1]]){
    signal.throwIfAborted();oldPaint(source,scratch,indices.map(i=>a[i]),w,h,kind,p);newPaint(source,indices.map(i=>b[i]),w,h,kind,p);
    for(const i of indices){const difference=compare(a[i],b[i]);assert(difference.different===0,`Pixels modifiés : ${JSON.stringify({sw,sh,transparent,edge,fit,kind,indices,i,difference})}`);}
   }
   records.push({source:[sw,sh],transparent,output:[w,h],fit,kind,firstVisibleChanged:true,identical:true});
  }
  source.width=source.height=0;status.textContent=`${records.length} configurations identiques`;await frame(signal);
 }
 return {pass:true,contextPolicy:policy.value,scope:'RGBA exact, même navigateur Chromium Windows, hors colorimétrie amont inchangée',configurations:records.length,records};
});
function summary(values:number[]){const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)};}
cost.onclick=()=>void run(async signal=>{
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.loop=true;
 const wait=new Promise<void>((resolve,reject)=>{video.onloadeddata=()=>resolve();video.onerror=()=>reject(Error('Vidéo inaccessible'));signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 video.src='/preview-media/v1/ba-programme.mp4';const a=[canvas(),canvas()],b=[canvas(),canvas()],scratch=canvas();host.append(a[0],b[0]);
 try{await wait;signal.throwIfAborted();await video.play();const before=video.getVideoPlaybackQuality(),initial=video.currentTime,samples={control:[] as number[],direct:[] as number[]},blocks:unknown[]=[];
  const p=baPreviewPlacement(video.videoWidth,video.videoHeight,'cover','body');
  for(const mode of ['control','direct','direct','control'] as const){
   status.textContent=`Vidéo réelle — ${mode}`;const q=video.getVideoPlaybackQuality(),time=video.currentTime;
   for(let i=0;i<100;i++){await frame(signal);const start=performance.now();if(mode==='control')oldPaint(video,scratch,a,960,540,'body',p);else newPaint(video,b,960,540,'body',p);if(i>=10)samples[mode].push(performance.now()-start);}
   const after=video.getVideoPlaybackQuality();blocks.push({mode,seconds:video.currentTime-time,decoded:after.totalVideoFrames-q.totalVideoFrames,dropped:after.droppedVideoFrames-q.droppedVideoFrames});
  }
  video.pause();oldPaint(video,scratch,a,960,540,'body',p);newPaint(video,b,960,540,'body',p);const comparison=compare(a[0],b[0]);assert(comparison.different===0,'Une même image vidéo arrêtée diffère');
  const after=video.getVideoPlaybackQuality();assert(video.currentTime>initial+3,'Vidéo non avancée');
  return {pass:true,scope:'Sous-étape cadrage et copies, pas toute la scène ni une mesure Mac ; ABBA vidéo réelle',control:summary(samples.control),direct:summary(samples.direct),blocks,comparison,seconds:video.currentTime-initial,decoded:after.totalVideoFrames-before.totalVideoFrames,dropped:after.droppedVideoFrames-before.droppedVideoFrames,copiesPerFrame:{control:3,direct:2}};
 }finally{video.pause();video.removeAttribute('src');video.load();video.remove();}
});
