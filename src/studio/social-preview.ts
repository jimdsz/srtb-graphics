import type {BroadcastTemplate,ProjectData} from './domain';
import {engineData} from './presentation';
import {SocialRenderer,prepareSocialAssets,socialTrackTimes,liveSocialPictures} from './social-renderer';
import type {PictureCache} from './social-renderer';
import type {ClipPosition} from './media-position';
import {tracksOf} from './media-tracks';
import type {LegacyGraphic} from './video/engine';
import {makeTimeline,graphicTime,socialExcerptEnd} from './video/timeline';
import {patchTextStyle} from './typography-model';
import {seekPreviewTrack} from './preview-timeline';
import {liveTextEdit} from './live-preview';
import {prepareTextFonts} from './typography-fonts';
import {preservePortraitLayout} from './social-portrait-layout';
import {PreviewBudget} from './preview-budget';
import {previewDisplayEdge} from './preview-resolution';

/** Reuse native media playback/audio; draw the same social composition as export. */
export async function attachSocialPreview(g:LegacyGraphic,template:BroadcastTemplate,initial:ProjectData,signal:AbortSignal){
  const budget=new PreviewBudget(navigator.hardwareConcurrency);
  let data=initial,renderer=new SocialRenderer(template,data,await prepareSocialAssets(template,data,signal),budget.edge),disposed=false,running=false,inspection=0,start=0,outAt:number|undefined,last=-1,raf=0;
  let pendingAssets:AbortController|undefined,lastWarning='';
  const reportLayout=()=>{const message=[...new Set(renderer.warnings)].join(' ');if(message!==lastWarning){lastWarning=message;g.dispatchEvent(new CustomEvent('broadcast-layout-warning',{detail:{message}}));}};
  signal.throwIfAborted();
  const timeline=()=>{const tracks=tracksOf(g);return makeTimeline(template.id,data,Object.fromEntries(Object.entries(tracks).map(([key,t])=>[key,t.length??t.clips.reduce((n,c)=>n+c.length,0)/(t.rate||1)])),Number(data._out_duration_seconds||12));};
  let timing=timeline();
  const excerptEnd=()=>socialExcerptEnd(template.id,data,{body:tracksOf(g).body?.length??NaN});
  // These versioned AE engines share sources with a distinct social timeline.
  // Drive their live media from that clock too, not from TV matte activation.
  if(['BTV_Evenement','BTV_Semainier'].includes(template.id))g.__aeSocialTimes=(seconds:number)=>socialTrackTimes(template.id,seconds,outAt??timing.outAt);
  g.__socialTypography={boxes:()=>{const phase=g.__previewTransport?.snapshot().phase;return phase==='ready'||phase==='stopped'||inspection>=(outAt??timing.outAt)+timing.timing.out?[]:renderer.textBoxes;},nudge:(field:string,x:number,y:number)=>{renderer.data=preservePortraitLayout(template.id,renderer.data,{...renderer.data,...patchTextStyle(renderer.data,field,{x,y})});last=-1;paint();}};
  const pictures:PictureCache=new Map();
  liveSocialPictures(tracksOf(g),Object.fromEntries(Object.keys(tracksOf(g)).map(key=>[key,0])),pictures);
  const host=g.parentElement!;g.style.cssText+=';position:absolute;inset:0;opacity:0;pointer-events:none';
  let display=host.getBoundingClientRect(),rasterEdge=budget.edge;
  const fitResolution=()=>{
    const edge=previewDisplayEdge(display.width,display.height,renderer.width,renderer.height,window.devicePixelRatio,budget.edge);
    if(edge===rasterEdge)return;
    rasterEdge=edge;g.__previewMediaEdge=edge;renderer.setPreviewEdge(edge);pictures.clear();last=-1;
  };
  // The observer runs only when the monitor changes size, not on every frame.
  // Keep the last usable dimensions while the pane is hidden/collapsed.
  const resize=new ResizeObserver(entries=>{
    const box=entries[0]?.contentRect;if(!box||box.width<=0||box.height<=0||disposed)return;
    display=box;fitResolution();paint();
  });
  fitResolution();resize.observe(host);
  const show=()=>{renderer.canvas.style.cssText='position:relative;display:block;width:100%;height:100%;object-fit:contain';host.append(renderer.canvas);};show();
  const elapsed=()=>{
    if(g.__previewTransport)return g.__previewTransport.snapshot().seconds;
    if(!running)return inspection;
    if(g._times)return g._times().elapsed;
    if(g._time)return g._time();
    return Math.max(0,(performance.now()-(g.autoOut?.startedAt??start))/1000);
  };
  function paint(){
    if(disposed||signal.aborted)return false;
    fitResolution();
    const transport=g.__previewTransport?.snapshot();
    if(transport){running=transport.playing;inspection=transport.seconds;outAt=transport.outAt;
      if(transport.phase==='ready'||transport.phase==='stopped'){renderer.ctx.clearRect(0,0,renderer.width,renderer.height);last=-1;return;}}
    const seconds=elapsed(),frame=Math.floor(seconds*25);
    if(frame!==last){
      last=frame;const stop=Math.min(outAt??(data._out_mode==='manual'&&(running||transport?.phase==='paused')?Infinity:timing.outAt),excerptEnd()),tl={...timing,outAt:stop,duration:stop+timing.timing.out};
      try{const begin=performance.now(),tracks=tracksOf(g);
        const compose=()=>{const presented:Record<string,ClipPosition>={},images=liveSocialPictures(tracks,socialTrackTimes(template.id,seconds,stop),pictures,rasterEdge,presented);renderer.frame(seconds,tl,images,null,false,tracks,presented);};
        compose();reportLayout();
        if(running&&budget.observe(performance.now()-begin)){fitResolution();compose();}
      }
      catch(error){running=false;g.dispatchEvent(new CustomEvent('broadcast-error',{detail:{message:error instanceof Error?error.message:String(error)}}));return false;}
    }
  }
  function draw(){if(paint()!==false)raf=requestAnimationFrame(draw);}
  // Pause/inspection acknowledge the final still image synchronously. A hidden
  // tab may defer RAF, which must not repaint once after Pause has completed.
  g.__socialPreview={get canvas(){return renderer.canvas;},refresh:()=>{last=-1;paint();},logoLayout:()=>renderer.logoLayout(),elementBoxes:()=>{
    const phase=g.__previewTransport?.snapshot().phase;
    return phase==='ready'||phase==='stopped'||inspection>=(outAt??timing.outAt)+timing.timing.out?[]:renderer.elementBoxes;
  },updateLive:async(next:ProjectData,allowed:()=>boolean)=>{
    if(!liveTextEdit(template,data,next,true))return false;
    await prepareTextFonts(next,template.module);if(disposed||signal.aborted||!allowed())throw new DOMException('Édition interrompue.','AbortError');
    data=next;renderer.data=next;last=-1;paint();return true;
  }};
  const out=(event:Event)=>{const phase=(event as CustomEvent).detail?.phase;if(phase==='stopping')outAt=elapsed();else if(phase==='completed'){running=false;inspection=timing.duration;renderer.ctx.clearRect(0,0,renderer.width,renderer.height);last=Math.floor(inspection*25);}};
  g.addEventListener('broadcast-out',out);
  const native={play:g.playAction.bind(g),stop:g.stopAction.bind(g),update:g.updateAction.bind(g),seek:g.goToTime.bind(g),dispose:g.dispose.bind(g),status:g.getStatus.bind(g)};
  g.playAction=async(...args:unknown[])=>{if(!running){outAt=undefined;inspection=0;start=performance.now();running=true;last=-1;}try{const result=await native.play(...args);if(result?.statusCode>=400)running=false;return result;}catch(error){running=false;throw error;}};
  g.stopAction=async(args?:{skipAnimation?:boolean})=>{const result=await native.stop(args);if(args?.skipAnimation){running=false;inspection=timing.duration;last=Math.floor(inspection*25);renderer.ctx.clearRect(0,0,renderer.width,renderer.height);}return result;};
  g.updateAction=async(next:ProjectData)=>{
    pendingAssets?.abort();const request=new AbortController();pendingAssets=request;
    const abort=()=>request.abort(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    let candidate:SocialRenderer|undefined;
    try{
      const assets=await prepareSocialAssets(template,next,request.signal);request.signal.throwIfAborted();
      candidate=new SocialRenderer(template,next,assets,rasterEdge);
      for(const t of [3,14,timing.outAt+2])candidate.frame(t,timing,{},null);
      const result=await native.update(engineData(next,!!g.__typography));request.signal.throwIfAborted();
      if(result?.statusCode>=400){candidate.dispose();return result;}
      data=next;timing=timeline();pictures.clear();liveSocialPictures(tracksOf(g),Object.fromEntries(Object.keys(tracksOf(g)).map(key=>[key,0])),pictures);renderer.canvas.remove();renderer.dispose();renderer=candidate;show();last=-1;return result;
    }catch(error){candidate?.dispose();throw error;}
    finally{signal.removeEventListener('abort',abort);if(pendingAssets===request)pendingAssets=undefined;}
  };
  g.goToTime=async({seconds,outAt:requestedOut}:{seconds:number;outAt?:number})=>{
    const stop=Math.min(requestedOut??timing.outAt,excerptEnd()),effective={...timing,outAt:stop,duration:stop+timing.timing.out};
    const source=graphicTime(effective,seconds),result=await native.seek({seconds:source});
    if(result?.statusCode>=400)return result;
    // TV markers can hold at an earlier frame; social inspection uses output time.
    running=false;inspection=seconds;outAt=effective.outAt;
    for(const [kind,time]of Object.entries(socialTrackTimes(template.id,seconds,effective.outAt))){const track=tracksOf(g)[kind];if(!track)continue;if(template.id==='BTV_BA_1P')await g.media.position(kind,time,{exact:true,playing:false,muted:true});await seekPreviewTrack(track,time);}
    last=-1;return result;
  };
  g.getStatus=async()=>({...await native.status(),elapsed:elapsed(),frame:Math.round(elapsed()*25)});
  g.dispose=async()=>{disposed=true;resize.disconnect();delete g.__previewMediaEdge;pendingAssets?.abort();cancelAnimationFrame(raf);pictures.clear();delete g.__socialPreview;g.removeEventListener('broadcast-out',out);renderer.canvas.remove();renderer.dispose();return native.dispose();};
  for(const t of [3,14,timing.outAt+2])renderer.frame(t,timing,{},null);
  reportLayout();
  renderer.ctx.clearRect(0,0,renderer.width,renderer.height);draw();
}
