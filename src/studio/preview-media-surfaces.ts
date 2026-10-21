import type {BroadcastTemplate} from './domain';
import type {LegacyGraphic} from './video/engine';
import {PreviewBudget} from './preview-budget';
import {needsSVGMediaPreview,previewMediaElement,SVGMediaTargets} from './svg-media-preview';
import {rememberPreviewPosition} from './preview-picture-position';
import {AEPreviewPlayback} from './ae-preview-playback';
import {previewCanvasContext,checkPreviewCanvas} from './preview-canvas-guard';

/** Preview-only raster budget. Logical SVG geometry, source clips and export
 * frames remain untouched. Bound both axes, including portrait/4K sources. */
export function previewSurfaceSize(width:number,height:number,maxEdge=1280){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return;
  const scale=Math.min(1,maxEdge/Math.max(width,height));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
type MediaNode=HTMLVideoElement|HTMLImageElement;
const targetSizes=new WeakMap<HTMLCanvasElement,{width:number;height:number}>();
/** Lottie marks inactive AE layers directly. Do not force computed-style or
 * layout reads per frame, and do not guess visibility from clipping/geometry. */
export function explicitlyHiddenCanvas(target:HTMLCanvasElement){
  return explicitlyHiddenMedia(previewMediaElement(target));
}
function explicitlyHiddenMedia(target:Element){
  for(let parent=target.parentElement;parent;parent=parent.parentElement){
    if(parent.style.display==='none'||parent.style.opacity==='0'||parent.getAttribute('display')==='none'||parent.getAttribute('opacity')==='0')return true;
  }
  return false;
}
export function paintPreviewMedia(node:MediaNode,source:HTMLCanvasElement,targets:HTMLCanvasElement[],maxEdge=1280,skipHidden=false){
  const width=node instanceof HTMLVideoElement?node.videoWidth:node.naturalWidth;
  const height=node instanceof HTMLVideoElement?node.videoHeight:node.naturalHeight;
  const size=previewSurfaceSize(width,height,maxEdge);if(!size)return false;
  if(node instanceof HTMLVideoElement&&(node.readyState<2||node.seeking||node.error))return false;
  if(source.width!==size.width||source.height!==size.height){source.width=size.width;source.height=size.height;}
  const context=previewCanvasContext(source);context.clearRect(0,0,size.width,size.height);context.drawImage(node,0,0,size.width,size.height);checkPreviewCanvas(context);
  for(const target of targets){
    // Inspect/seeking paints every target before the native animation changes
    // frame. Live playback may skip only layers explicitly hidden right now;
    // each newly visible target is redrawn on the next native frame.
    if(skipHidden&&node instanceof HTMLVideoElement&&explicitlyHiddenCanvas(target))continue;
    let logical=targetSizes.get(target);if(!logical){logical={width:target.width,height:target.height};targetSizes.set(target,logical);}
    const bounded=previewSurfaceSize(logical.width,logical.height,maxEdge)!;
    if(target.width!==bounded.width||target.height!==bounded.height){target.width=bounded.width;target.height=bounded.height;}
    const ctx=previewCanvasContext(target),scale=Math.max(target.width/size.width,target.height/size.height);
    ctx.clearRect(0,0,target.width,target.height);
    ctx.drawImage(source,(target.width-size.width*scale)/2,(target.height-size.height*scale)/2,size.width*scale,size.height*scale);
    checkPreviewCanvas(ctx);
  }
  return true;
}
function ready(node:HTMLMediaElement,event:string,timeout=15000){
  return new Promise<void>((resolve,reject)=>{
    const done=()=>finish(),failed=()=>finish(Error('Image vidéo inaccessible pendant l’aperçu.'));
    const timer=setTimeout(failed,timeout);
    function finish(error?:Error){clearTimeout(timer);node.removeEventListener(event,done);node.removeEventListener('error',failed);error?reject(error):resolve();}
    node.addEventListener(event,done,{once:true});node.addEventListener('error',failed,{once:true});
  });
}
/** Version-pinned instance adapter. Never installed by the export renderer or
 * portable packages, never edits the frozen library. Native clocks/seeks stay
 * authoritative; only redundant rasterization is removed. */
export async function installPreviewMediaSurfaces(g:LegacyGraphic,t:BroadcastTemplate,social:boolean,svgMedia=needsSVGMediaPreview(navigator.userAgent)){
  if(t.libraryVersion!=='1.7.0'||t.version!=='1.0.0'||!['BTV_Evenement','BTV_Semainier','BTV_Renvoi'].includes(t.id))return;
  const playback=new AEPreviewPlayback(error=>g.dispatchEvent(new CustomEvent('broadcast-media-error',{detail:{message:error.message}})));
  const pause=g.pause.bind(g),disposePlayback=g.dispose.bind(g),drawPlayback=g._draw.bind(g);
  g.pause=(...args:unknown[])=>{playback.pause();return pause(...args);};
  g.dispose=async()=>{playback.dispose();return disposePlayback();};
  g._draw=(...args:unknown[])=>{playback.sweep();return drawPlayback(...args);};
  const budget=new PreviewBudget(navigator.hardwareConcurrency);
  const surfaces=!social&&svgMedia?new SVGMediaTargets(error=>g.dispatchEvent(new CustomEvent('broadcast-media-error',{detail:{message:error instanceof Error?error.message:String(error)}}))):undefined;
  if(surfaces){
    budget.edge=Math.min(budget.edge,960);g.__previewRenderer='ae-tv-worker-media-v4';g.__previewPresentationStats=(since=0)=>surfaces.stats(since);
    const dispose=g.dispose.bind(g);g.dispose=async()=>{surfaces.dispose();return dispose();};
    const seek=g.goToTime.bind(g);g.goToTime=async(args:{seconds:number})=>{const result=await seek(args);await surfaces.flush();return result;};
  }
  const paint=(node:MediaNode,source:HTMLCanvasElement,targets:HTMLCanvasElement[],precise:boolean)=>{
    const groups=surfaces?.resolve(source,targets),begin=performance.now();
    // For shared snapshots, hidden copies can differ between siblings. Paint
    // their common source if ANY slot is visible, not just the first sibling.
    const active=groups?.filter(group=>precise||!g.playing||group.images.some(image=>!explicitlyHiddenMedia(image)));
    if(g.playing&&!precise)for(const group of active||[])budget.observePresentation(group.publisher.stats);
    const current=active?.filter(group=>precise||!g.playing||!group.publisher.busy);
    if(current&&!current.length)return false;
    const displayEdge=Number(g.__previewMediaEdge),edge=social&&Number.isFinite(displayEdge)&&displayEdge>=320?Math.min(budget.edge,displayEdge):budget.edge;
    if(!social)g.__previewMediaEdge=edge;
    const result=paintPreviewMedia(node,source,current?current.map(group=>group.canvas):targets,edge,current?false:!!g.playing&&!precise);
    if(result&&current)for(const group of current)group.publisher.publish(group.canvas);
    if(g.playing)budget.observe(performance.now()-begin);return result;
  };
  const {positionVideo}=await import(/* @vite-ignore */new URL('../_shared/ae-live-media.mjs',new URL(t.module,location.href)).href);
  if(t.id==='BTV_Renvoi')g.renderMedia=async(seconds:number,precise:boolean)=>{
    const node=g.media as MediaNode|undefined;if(!node)return;
    if(node instanceof HTMLVideoElement){
      if(precise||!g.playing){playback.reset(node);await positionVideo(node,seconds,precise,false,g.tracks.renvoi.loop,ready);}
      else if(!playback.position(node,seconds,g.tracks.renvoi.loop,()=>!g.disposed&&g.playing&&g.media===node))return;
    }
    else if(g.mediaPainted)return;
    if(g.disposed||g.media!==node)return;
    g.mediaPainted=paint(node,g.mediaCanvas,social?[]:g.mediaTargets,precise);
    if(g.mediaPainted)rememberPreviewPosition(g.mediaCanvas,{index:g.tracks.renvoi.montageIndex??0,time:node instanceof HTMLVideoElement?node.currentTime:0});
    if(precise)await surfaces?.flush();
  };
  else g.renderMedia=async(key:string,seconds:number,precise=false)=>{
    const item=g.mediaItems?.get(key);if(!item||!item.video&&item.painted)return;
    const node=item.node;
    if(item.video){
      if(precise||!g.playing){playback.reset(node);await positionVideo(node,seconds,precise,false,g.tracks[key].loop,ready);}
      else if(!playback.position(node,seconds,g.tracks[key].loop,()=>{
        if(g.disposed||!g.playing||g.mediaItems?.get(key)!==item||item.node!==node)return false;
        const socialTimes=g.__aeSocialTimes?.(g.elapsed);
        return socialTimes?key in socialTimes:g.frame/25>=item.spec.activeStart&&g.frame/25<item.spec.activeEnd;
      }))return;
    }
    if(g.disposed||g.mediaItems?.get(key)!==item||item.node!==node)return;
    item.painted=paint(node,item.canvas,social?[]:item.targets,precise);
    if(item.painted)rememberPreviewPosition(item.canvas,{index:g.tracks[key].montageIndex??0,time:item.video?node.currentTime:0});
    if(precise)await surfaces?.flush();
  };
  if(social){
    const draw=g._draw.bind(g);
    g._draw=(...args:unknown[])=>{
      const animation=g.animation,layout=g.layout,render=animation?.goToAndStop,refresh=layout?.refresh;
      if(animation)animation.goToAndStop=()=>{};
      if(layout)layout.refresh=()=>{};
      try{return draw(...args);}finally{if(animation)animation.goToAndStop=render;if(layout)layout.refresh=refresh;}
    };
  }
}
