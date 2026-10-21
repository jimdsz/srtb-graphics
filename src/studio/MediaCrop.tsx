import {lazy,Suspense,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {Crop,ChevronDown,Play,Pause,RotateCcw} from 'lucide-react';
import type {BroadcastTemplate,FieldValue,ProjectData} from './domain';
import {localMediaSnapshot,localURL,subscribeLocalMedia} from './local-media';
import {frameTime,mediaKind,timeLabel} from './media-trim';
import {cropGeometry,SocialRenderer} from './social-renderer';
import {makeTimeline} from './video/timeline';
import {cropMotionKey,currentCropMotion,cropMotionMatches,interpolateCrop,patchCropMotion,placeCropPoint} from './crop-motion';
import type {CropMotion,CropPoint} from './crop-motion';
import TimeRuler from './TimeRuler';
import {imageScale} from './image-sizing-model';
import './media-crop.css';
import {HelpBubble} from './GraphicsHelp';
const SubjectCrop=lazy(()=>import('./SubjectCrop'));

const clamp=(value:number)=>Math.max(0,Math.min(100,value));
export function dragCrop(x:number,y:number,dx:number,dy:number,overflowX:number,overflowY:number){
  return {x:overflowX>1?clamp(x-dx/overflowX*100):x,y:overflowY>1?clamp(y-dy/overflowY*100):y};
}
/** On-demand, single-frame player. It reads the selected File/range URL only;
 * no upload, full-file decode, face model or unverified automatic edit. */
export default function MediaCrop({value,template,kind,data,start=0,imageField,onPatch}:{value:FieldValue;template:BroadcastTemplate;kind:string;data:ProjectData;start?:number;imageField?:string;onPatch:(patch:ProjectData)=>void}){
  const [open,setOpen]=useState(false),source=typeof value==='object'?value.url:String(value||'');
  if(!source||!['video','image'].includes(mediaKind(value)||''))return null;
  // A new source, cut or output format starts a fresh editing session. Pending
  // analysis and its proposed motion belong only to the previous selection.
  const sessionKey=JSON.stringify([source,start,data[`_media_${kind}_end_seconds`]??0,data._studio_format]);
  return <div className="crop-editor"><div className="help-title-row"><button type="button" className="crop-editor-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}><Crop size={17} aria-hidden="true"/><span>Cadrer pour les réseaux</span><ChevronDown size={16} aria-hidden="true"/></button><HelpBubble section="crop"/></div>{open?<CropPlayer key={sessionKey} {...{value,template,kind,data,start,imageField,onPatch}}/>:null}</div>;
}
function CropPlayer({value,template,kind,data,start,imageField,onPatch}:{value:FieldValue;template:BroadcastTemplate;kind:string;data:ProjectData;start:number;imageField?:string;onPatch:(patch:ProjectData)=>void}){
  const module=template.module;
  // Ask the export renderer for the actual media rectangle, including compact
  // portrait panels. Dragging does not recompute typography or this layout.
  const layoutKey=JSON.stringify(Object.fromEntries(Object.entries(data).filter(([key])=>!/^_studio_.*_(x|y|fit|crop_motion|sequence_crops)$/.test(key))));
  const ratio=useMemo(()=>{
    const settings=JSON.parse(layoutKey) as ProjectData,sponsors:Record<string,HTMLImageElement>={};
    if(settings._sponsor_visible)sponsors.main=new Image();
    for(const n of [1,2])if(settings[`_p${n}_sponsor_visible`])sponsors[`p${n}`]=new Image();
    const renderer=new SocialRenderer(template,settings,{sponsors,mentions:settings._mentions_visible||settings._p1_mentions_visible||settings._p2_mentions_visible?new Image():undefined});
    try{
      const timing=makeTimeline(template.id,{...settings,_out_mode:'duration',_out_duration_seconds:30},{},30);
      const times=[2,6,16,20,32],slot=/^programme_(\d)$/.exec(kind);if(slot)times.unshift(3+2.4*(Number(slot[1])-1));
      for(const seconds of times){renderer.frame(seconds,timing,{},null);const box=renderer.cropBoxes[kind];if(box)return box.w/box.h;}
      return renderer.canvas.width/renderer.canvas.height;
    }finally{renderer.dispose();}
  },[layoutKey,template,kind]);
  useSyncExternalStore(subscribeLocalMedia,localMediaSnapshot);
  const canvas=useRef<HTMLCanvasElement>(null),source=useRef<HTMLImageElement|HTMLVideoElement|null>(null),drag=useRef<{id:number;clientX:number;clientY:number;x:number;y:number;ox:number;oy:number}|undefined>(undefined);
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [time,setTime]=useState(0),[duration,setDuration]=useState(0),[playing,setPlaying]=useState(false),[undo,setUndo]=useState<ProjectData[]>([]);
  const [proposal,setProposal]=useState<CropMotion|null>(null),[tracking,setTracking]=useState(false);
  const xKey=`_studio_${kind}_x`,yKey=`_studio_${kind}_y`,fitKey=`_studio_${kind}_fit`;
  const motionKey=cropMotionKey(kind),motion=currentCropMotion(data,kind),matched=!!motion&&cropMotionMatches(data,kind,motion);
  const base={x:Number(data[xKey]??50),y:Number(data[yKey]??50)},position=proposal?interpolateCrop(proposal.points,time,base):matched?interpolateCrop(motion!.points,time,base):base;
  const {x,y}=position,contain=data[fitKey]==='contain',end=Number(data[`_media_${kind}_end_seconds`]||0),video=mediaKind(value)==='video';
  const sizePercent=imageScale(data,imageField||`_media_${kind}_url`);
  const selected=matched?motion!.points.find(point=>Math.abs(point.at-time)<.02):undefined;
  let url='';try{const raw=localURL(typeof value==='object'?value.url:String(value));url=new URL(raw,new URL(module,document.baseURI)).href;}catch{}
  useEffect(()=>{
    if(!url){setError('Reconnectez ce média local avant de le recadrer.');return;}
    let alive=true;const node=document.createElement(video?'video':'img');source.current=node;setReady(false);setError('');setPlaying(false);setTime(0);setDuration(0);
    node.crossOrigin='anonymous';
    const display=()=>{if(alive){setError('');setReady(true);setRevision(r=>r+1);}};
    if(node instanceof HTMLVideoElement){node.preload='metadata';node.muted=true;node.playsInline=true;node.onloadedmetadata=()=>{
      const length=Math.min(end||node.duration,node.duration,start+86400)-start;
      if(!Number.isFinite(length)||length<=0){setError('Les repères IN/OUT ne désignent pas un passage disponible.');return;}
      setDuration(length);node.currentTime=start;
    };node.onloadeddata=display;node.onseeked=display;node.onended=()=>setPlaying(false);}
    else node.onload=()=>{setDuration(Math.max(.04,end-start||5));display();};
    node.onerror=()=>{if(alive)setError('Impossible de lire l’image du média. Vérifiez le fichier ou son codec.');};node.src=url;
    const timer=setTimeout(()=>{if(alive&&!(node instanceof HTMLImageElement?node.complete:node.readyState>=2))setError('Le média tarde à répondre. Vérifiez l’accès au disque réseau.');},15000);
    return()=>{alive=false;clearTimeout(timer);if(node instanceof HTMLVideoElement){node.pause();node.removeAttribute('src');node.load();}else node.removeAttribute('src');source.current=null;};
  },[url,start,end,video]);
  useEffect(()=>{
    if(!playing)return;const node=source.current;if(!(node instanceof HTMLVideoElement))return;
    let raf=0;const tick=()=>{
      const position=Math.max(0,node.currentTime-start),limit=Math.max(0,duration-.04);
      if(position>=limit||node.ended){node.pause();setTime(limit);setPlaying(false);return;}
      setTime(frameTime(position));raf=requestAnimationFrame(tick);
    };raf=requestAnimationFrame(tick);return()=>cancelAnimationFrame(raf);
  },[playing,start,duration]);
  useEffect(()=>{
    const node=source.current,c=canvas.current;if(!node||!c||!ready||node instanceof HTMLVideoElement&&node.seeking)return;
    const sw=node instanceof HTMLVideoElement?node.videoWidth:node.naturalWidth,sh=node instanceof HTMLVideoElement?node.videoHeight:node.naturalHeight;if(!sw||!sh)return;
    const ctx=c.getContext('2d')!,box=cropGeometry(sw,sh,{x:0,y:0,w:c.width,h:c.height},x,y,contain&&!proposal);
    const scale=node instanceof HTMLImageElement?sizePercent/100:1;
    ctx.clearRect(0,0,c.width,c.height);ctx.save();ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h);ctx.clip();ctx.drawImage(node,box.x+box.w*(1-scale)/2,box.y+box.h*(1-scale)/2,box.w*scale,box.h*scale);ctx.restore();
  },[ready,revision,x,y,ratio,contain,time,sizePercent,proposal]);
  function pause(){const node=source.current;if(node instanceof HTMLVideoElement)node.pause();setPlaying(false);}
  function seek(seconds:number){pause();const next=Math.max(0,Math.min(Math.max(0,duration-.04),frameTime(seconds)));setTime(next);const node=source.current;if(node instanceof HTMLVideoElement)node.currentTime=start+next;}
  function remember(){pause();setUndo(previous=>[...previous.slice(-29),{[motionKey]:data[motionKey]??'{}',[xKey]:data[xKey]??50,[yKey]:data[yKey]??50,[fitKey]:data[fitKey]??'cover'}]);}
  function saveMotion(next:CropMotion|undefined){try{setError('');onPatch(patchCropMotion(data,kind,next));}catch(error){setError(String(error instanceof Error?error.message:error));}}
  function initialMotion():CropMotion{return {start,end,duration,points:[{at:0,...base,transition:'smooth'}]};}
  function pointPatch(next:{x:number;y:number},transition:CropPoint['transition']=selected?.transition||'smooth'){
    if(!matched){onPatch({[xKey]:next.x,[yKey]:next.y});return;}
    try{saveMotion(placeCropPoint(motion!,{at:Math.min(duration,frameTime(time)),...next,transition}));}catch(error){setError(String(error instanceof Error?error.message:error));}
  }
  function addPoint(){remember();try{saveMotion(placeCropPoint(matched?motion!:initialMotion(),{at:Math.min(duration,frameTime(time)),x,y,transition:'smooth'}));}catch(error){setError(String(error instanceof Error?error.message:error));}}
  function geometry(){const c=canvas.current!,node=source.current!,sw=node instanceof HTMLVideoElement?node.videoWidth:node.naturalWidth,sh=node instanceof HTMLVideoElement?node.videoHeight:node.naturalHeight;const size=c.getBoundingClientRect(),scale=Math.max(size.width/sw,size.height/sh);return {ox:sw*scale-size.width,oy:sh*scale-size.height};}
  return <section className="crop-player" aria-label="Cadrage du média pour les réseaux"><header className="crop-player-heading"><strong>Aperçu du cadrage</strong><span>{data._studio_format==='vertical'?'9:16':'4:5'}</span></header>
    {video&&ready&&['portrait','vertical'].includes(String(data._studio_format))?<Suspense fallback={<small>Préparation du suivi…</small>}><SubjectCrop key={JSON.stringify([url,start,end,duration,ratio,data._studio_format,data[motionKey],data[xKey],data[yKey],data[fitKey]])} {...{url,start,end,duration,ratio}} onPreview={next=>{pause();setProposal(next);seek(0);}} onBusy={value=>{if(value)pause();setTracking(value);}} onApply={next=>{remember();onPatch({...patchCropMotion(data,kind,next),[fitKey]:'cover'});setProposal(null);}}/></Suspense>:null}
    {motion&&!matched?<p className="crop-notice" role="status">L’extrait a changé. Créez de nouveaux repères pour adapter son cadrage.</p>:null}
    {error?<p role="alert">{error}</p>:!ready?<p role="status">Lecture d’une image du passage…</p>:null}
    <canvas ref={canvas} className="crop-output" width={480} height={Math.round(480/ratio)} style={{aspectRatio:String(ratio),maxWidth:`calc(var(--crop-preview-height) * ${ratio})`,marginInline:'auto'}} tabIndex={ready&&!contain&&!tracking&&!proposal?0:-1} role="group" aria-label="Image à recadrer par glisser ou avec les flèches" aria-disabled={!ready||contain||tracking||!!proposal}
      onPointerDown={event=>{if(!ready||contain||tracking||proposal)return;remember();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,clientX:event.clientX,clientY:event.clientY,x,y,...geometry()};}}
      onPointerMove={event=>{const d=drag.current;if(!d||d.id!==event.pointerId)return;const next=dragCrop(d.x,d.y,event.clientX-d.clientX,event.clientY-d.clientY,d.ox,d.oy);pointPatch(next);}}
      onPointerUp={()=>{drag.current=undefined;}} onPointerCancel={()=>{drag.current=undefined;}} onLostPointerCapture={()=>{drag.current=undefined;}}
      onKeyDown={event=>{if(!ready||contain||tracking||proposal||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();remember();const {ox,oy}=geometry(),step=event.shiftKey?10:1,next=dragCrop(x,y,event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0,ox,oy);pointPatch(next);}}/>
    <TimeRuler value={time} duration={duration} onSeek={seek} disabled={!ready} label="Position dans l’extrait source"/>
    {video?<div className="crop-playback"><button type="button" disabled={!ready||tracking} onClick={async()=>{const node=source.current;if(!(node instanceof HTMLVideoElement))return;if(playing){pause();return;}if(time>=duration-.05){node.currentTime=start;setTime(0);}node.playbackRate=Number(data[`_media_${kind}_rate`]??1);try{await node.play();setPlaying(true);}catch{setError('Lecture impossible : vérifiez le fichier ou réessayez après chargement.');}}}>{playing?<Pause size={16} aria-hidden="true"/>:<Play size={16} aria-hidden="true"/>}{playing?'Pause':'Lire l’aperçu'}</button><small>Sans son</small></div>:null}
    {!contain&&!proposal?<small className="crop-direct-hint">{matched?'Glissez l’image pour ajuster le repère à cet instant.':'Glissez l’image pour ajuster le cadrage.'}</small>:null}
    <details className="crop-manual"><summary>Cadrage manuel<ChevronDown size={16} aria-hidden="true"/></summary><div className="crop-manual-body"><p className="small">Ajoutez des repères pour déplacer le cadrage au fil de l’extrait.</p>
    <div className="crop-actions"><button type="button" disabled={!ready||contain||!duration||playing||tracking||!!proposal} onClick={addPoint}>{matched?'Ajouter un repère ici':'Créer des repères'}</button><button type="button" disabled={!ready||contain||tracking||!!proposal} onClick={()=>{remember();pointPatch({x:50,y:50});}}>Recentrer ici</button></div>
    <fieldset disabled={tracking||!!proposal} className="crop-existing-motion" aria-label="Réglages du mouvement enregistré">
    {matched?<><div className="crop-points" aria-label="Repères de cadrage">{motion!.points.map(point=><button key={point.at} type="button" aria-pressed={Math.abs(point.at-time)<.02} onClick={()=>seek(point.at)}>{timeLabel(point.at)}</button>)}</div>{selected?<div className="crop-actions"><label>Mouvement vers ce repère<select value={selected.transition} onChange={event=>{remember();pointPatch({x,y},event.target.value as CropPoint['transition']);}}><option value="smooth">Doux</option><option value="linear">Régulier</option><option value="cut">Coupe franche</option></select></label><button type="button" onClick={()=>{remember();const points=motion!.points.filter(point=>point!==selected);saveMotion(points.length?{...motion!,points}:undefined);}}>Retirer ce repère</button></div>:null}<button type="button" onClick={()=>{remember();onPatch({...patchCropMotion(data,kind,undefined),[xKey]:x,[yKey]:y});}}>Garder ce cadrage fixe</button></>:null}
    </fieldset>
    <small>Flèches : déplacement fin. Maj + flèches : déplacement rapide. Temps mesuré depuis le point IN, avant vitesse.</small></div></details>
    {undo.length?<button type="button" className="crop-undo" disabled={tracking||!!proposal} onClick={()=>{pause();onPatch(undo.at(-1)!);setUndo(previous=>previous.slice(0,-1));}}><RotateCcw size={15} aria-hidden="true"/>Annuler le dernier cadrage</button>:null}
    {contain?<small>« Image entière » ne recadre pas. Choisissez « Remplir le cadre » pour glisser l’image.</small>:null}
    <small className="crop-format-note">Cadrage propre à ce format, repris dans l’export.</small>
  </section>;
}
