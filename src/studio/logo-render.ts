import type {BroadcastTemplate,ProjectData} from './domain';
import type {LegacyGraphic} from './video/engine';
import {TIMINGS} from './video/timeline';
import {overlayLogoGeometry,overlayLogoKey,overlayLogoMotion,overlayLogoPlates,overlayLogoSettings,overlayLogoSource} from './logo-model';

export async function prepareOverlayLogo(template:Pick<BroadcastTemplate,'module'>,data:ProjectData,signal:AbortSignal):Promise<HTMLImageElement|undefined>{
  const source=overlayLogoSource(data,template.module,document.baseURI);if(!source)return;
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const node=new Image();node.crossOrigin='anonymous';node.loading='eager';node.decoding='async';let settled=false;
    const done=(error?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);node.onload=node.onerror=null;if(error){node.removeAttribute('src');reject(error);}else resolve(node);};
    const abort=()=>done(signal.reason||new DOMException('Chargement du logo annulé.','AbortError'));
    const ready=()=>{if(node.complete&&node.naturalWidth>0)done();};
    const failed=()=>done(Error('Le logo supplémentaire ne peut pas être décodé. Choisissez une image PNG, JPEG, WebP ou SVG valide.'));
    const timer=setTimeout(()=>done(Error('Le logo supplémentaire ne se charge pas. Vérifiez sa source puis réessayez.')),20000);
    signal.addEventListener('abort',abort,{once:true});node.onload=ready;node.onerror=failed;node.src=source;
    if(typeof node.decode==='function')void node.decode().then(ready,failed);ready();
  });
}

function frame(data:ProjectData,image:HTMLImageElement,width:number,height:number,seconds:number,end:number){
  const config=overlayLogoSettings(data),layout=overlayLogoGeometry(data,width,height,image.naturalWidth,image.naturalHeight),motion=overlayLogoMotion(data,seconds,end);
  const distance=config.motion==='slide'?24*width/1920*(1-motion.progress):0;
  const dx=config.anchor.endsWith('right')?-distance:config.anchor.endsWith('left')?distance:0;
  const dy=config.anchor.endsWith('center')?(config.anchor.startsWith('bottom')?-distance:distance):0;
  return {config,layout,opacity:motion.opacity,dx,dy};
}
export function drawOverlayLogo(ctx:CanvasRenderingContext2D,data:ProjectData,image:HTMLImageElement|undefined,seconds:number,end:number,size={width:ctx.canvas.width,height:ctx.canvas.height}){
  if(!image)return;
  const f=frame(data,image,size.width,size.height,seconds,end);if(f.opacity<=0)return;
  const box=f.layout.image,plate=f.layout.plate;
  ctx.save();ctx.setTransform(ctx.canvas.width/size.width,0,0,ctx.canvas.height/size.height,0,0);ctx.globalAlpha=f.opacity;ctx.translate(f.dx,f.dy);
  if(f.config.plate!=='none'){ctx.fillStyle=overlayLogoPlates[f.config.plate];ctx.fillRect(plate.x,plate.y,plate.w,plate.h);}
  ctx.drawImage(image,box.x,box.y,box.w,box.h);ctx.restore();
}

export interface OverlayLogoClock {seconds:number;end?:number;duration?:number;visible?:boolean}
export function overlayLogoHitBox(data:ProjectData,image:HTMLImageElement|undefined,width:number,height:number,seconds:number,end:number){
  if(!image)return;
  const f=frame(data,image,width,height,seconds,end);if(f.opacity<=.05)return;
  return {...f.layout.image,x:f.layout.image.x+f.dx,y:f.layout.image.y+f.dy};
}
export type OverlayLogoLayout=ReturnType<typeof overlayLogoGeometry>;
/** Versioned instance extension. It is drawn in the same shadow tree copied by
 * the TV rasterizer and bundled with the existing portable typography runtime. */
export function installOverlayLogo(g:LegacyGraphic,template:BroadcastTemplate,initial:ProjectData){
  let data=initial,image:HTMLImageElement|undefined,source='',disposed=false,pending:AbortController|undefined;
  let svg:SVGSVGElement|undefined,group:SVGGElement|undefined,picture:SVGImageElement|undefined,plate:SVGRectElement|undefined;
  let inspection:number|undefined,explicit:OverlayLogoClock|undefined,started=false,outAtEvent:number|undefined;
  const timing=TIMINGS[template.id],namespace='http://www.w3.org/2000/svg';
  function clock():OverlayLogoClock{
    if(explicit)return explicit;
    const transport=g.__previewTransport?.snapshot();
    if(transport)return {seconds:transport.seconds,end:transport.outAt===undefined?Infinity:transport.outAt+timing.out,visible:!['ready','stopped'].includes(transport.phase)};
    const state=g.state||{},phase=g.phase??state.phase;
    const visible=inspection!==undefined||started;
    let seconds=inspection??g._times?.().elapsed??g._time?.();
    if(!Number.isFinite(seconds))seconds=g.autoOut?.startedAt!=null?Math.max(0,(performance.now()-g.autoOut.startedAt)/1000):Number(state.currentFrame||0)/25;
    const outAt=outAtEvent??(phase==='out'&&g._elapsedAtOut!=null?g._elapsedAtOut:g.outAt);
    // Frozen legacy engines expose source-frame inspection; the final source
    // frame must finish the logo before PopUp's transparent terminal hold.
    const end=Number.isFinite(outAt)?outAt+timing.out:inspection!==undefined?timing.stop+timing.out:Infinity;
    return {seconds:Number(seconds)||0,end,visible};
  }
  function refresh(at?:OverlayLogoClock){
    if(at)explicit=at;
    if(disposed||!image||data._studio_format&&data._studio_format!=='tv'){if(svg)svg.style.visibility='hidden';return;}
    if(!svg){
      svg=document.createElementNS(namespace,'svg');svg.setAttribute('data-studio-overlay-logo','1');svg.setAttribute('viewBox','0 0 1920 1080');
      svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:9';
      group=document.createElementNS(namespace,'g');plate=document.createElementNS(namespace,'rect');picture=document.createElementNS(namespace,'image');picture.setAttribute('preserveAspectRatio','xMidYMid meet');
      group.append(plate,picture);svg.append(group);
    }
    // Native scene updates may replace the shadow tree. Reattach the same
    // extension rather than retain a detached, permanently stale overlay.
    if(svg.parentNode!==g.shadowRoot)g.shadowRoot!.append(svg);
    const atTime=clock(),f=frame(data,image,1920,1080,atTime.seconds,atTime.end??atTime.duration??Infinity);
    svg.style.visibility=atTime.visible===false||f.opacity<=0?'hidden':'visible';group!.setAttribute('opacity',String(f.opacity));group!.setAttribute('transform',`translate(${f.dx} ${f.dy})`);
    picture!.setAttribute('href',image.currentSrc||image.src);
    for(const [key,value]of Object.entries(f.layout.image))picture!.setAttribute(key==='w'?'width':key==='h'?'height':key,String(value));
    for(const [key,value]of Object.entries(f.layout.plate))plate!.setAttribute(key==='w'?'width':key==='h'?'height':key,String(value));
    plate!.setAttribute('fill',overlayLogoPlates[f.config.plate]);
  }
  async function stage(next:ProjectData){
    if(disposed)throw new DOMException('Logo fermé.','AbortError');
    pending?.abort();const controller=new AbortController();pending=controller;
    let candidate:HTMLImageElement|undefined;
    try{
      const url=next._studio_format&&next._studio_format!=='tv'?'':overlayLogoSource(next,template.module,document.baseURI);
      candidate=url===source?image:url?await prepareOverlayLogo(template,next,controller.signal):undefined;
      controller.signal.throwIfAborted();if(disposed)throw new DOMException('Logo fermé.','AbortError');
      return {controller,candidate,url};
    }catch(error){if(candidate!==image)candidate?.removeAttribute('src');if(pending===controller)pending=undefined;throw error;}
  }
  function commit(next:ProjectData,prepared:Awaited<ReturnType<typeof stage>>){
    prepared.controller.signal.throwIfAborted();if(disposed)throw new DOMException('Logo fermé.','AbortError');
    if(image&&image!==prepared.candidate)image.removeAttribute('src');data=next;image=prepared.candidate;source=prepared.url;refresh();
    if(pending===prepared.controller)pending=undefined;
  }
  const clean=(next:ProjectData)=>Object.fromEntries(Object.entries(next).filter(([key])=>!overlayLogoKey(key)));
  const native={load:g.load.bind(g),update:g.updateAction.bind(g),dispose:g.dispose.bind(g)};
  const release=(prepared:Awaited<ReturnType<typeof stage>>)=>{if(prepared.candidate!==image)prepared.candidate?.removeAttribute('src');if(pending===prepared.controller)pending=undefined;};
  g.load=async(params:any)=>{const next={...data,...params.data},prepared=await stage(next);try{const result=await native.load({...params,data:clean(params.data||{})});if(!result?.statusCode||result.statusCode<400)commit(next,prepared);else release(prepared);return result;}catch(error){release(prepared);throw error;}};
  g.updateAction=async(raw:ProjectData)=>{const next={...data,...raw},prepared=await stage(next);try{const result=await native.update(clean(raw));if(!result?.statusCode||result.statusCode<400)commit(next,prepared);else release(prepared);return result;}catch(error){release(prepared);throw error;}};
  for(const method of ['playAction','stopAction','goToTime'] as const){
    const original=g[method].bind(g);g[method]=async(...args:any[])=>{
      explicit=undefined;if(method==='playAction'){inspection=undefined;started=true;outAtEvent=undefined;}
      if(method==='stopAction'&&args[0]?.skipAnimation){inspection=undefined;started=false;refresh();}
      let result;try{result=await original(...args);}catch(error){if(method==='playAction')started=false;refresh();throw error;}
      if(result?.statusCode>=400){if(method==='playAction')started=false;refresh();return result;}
      if(method==='goToTime')inspection=Number(args[0]?.seconds);else if(method==='stopAction'){inspection=undefined;started=false;}
      refresh();return result;
    };
  }
  const out=(event:Event)=>{const phase=(event as CustomEvent).detail?.phase;if(phase==='stopping'){outAtEvent=clock().seconds;inspection=undefined;}else if(phase==='completed'){started=false;inspection=undefined;refresh();}};
  g.addEventListener('broadcast-out',out);
  g.dispose=async()=>{disposed=true;pending?.abort();g.removeEventListener('broadcast-out',out);image?.removeAttribute('src');image=undefined;svg?.remove();delete g.__studioLogo;return native.dispose();};
  const controller={refresh,layout:():OverlayLogoLayout|undefined=>g.__socialPreview?.logoLayout?.()??(image?overlayLogoGeometry(data,1920,1080,image.naturalWidth,image.naturalHeight):undefined)};
  g.__studioLogo=controller;return controller;
}
