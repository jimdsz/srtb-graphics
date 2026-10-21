/** WebKit can composite accelerated canvas foreignObjects above SVG text and
 * ignore their ancestor transforms (WebKit #23113). Keep media in the SVG
 * paint tree on that engine. No user-agent gate is used for media capability;
 * this gate selects only the presentation workaround, never an export codec. */
import {PreviewImageEncoder} from './preview-image-encoder';
import {PreviewPresentationTimings} from './preview-presentation-timings';
import {previewCanvasContext,checkPreviewCanvas} from './preview-canvas-guard';
import {PreviewPictureProgress} from './preview-picture-progress';
export function needsSVGMediaPreview(userAgent:string){
  return /AppleWebKit\//.test(userAgent)&&(!/(?:Chrome|Chromium|Edg|OPR)\//.test(userAgent)||/(?:iPhone|iPad|iPod)/.test(userAgent));
}

const presentation=new WeakMap<HTMLCanvasElement,SVGImageElement>();
export function previewMediaElement(canvas:HTMLCanvasElement):Element{return presentation.get(canvas)||canvas;}
export function bindSVGMedia(canvas:HTMLCanvasElement,image:SVGImageElement){presentation.set(canvas,image);}

/** One asynchronous encoding in flight, plus ONE latest request. Never builds
 * an unbounded queue when the device cannot present at the source frame rate.
 * An image is decoded before swapping URLs. Stopped/seeked frames can await
 * flush(); disposal prevents late frames and revokes every owned object URL. */
export class SVGMediaPublisher {
  private snapshot=document.createElement('canvas');
  private pending?:{canvas:HTMLCanvasElement;opaque:boolean};
  private running?:Promise<void>;
  private closed=false;
  private current='';
  private previous='';
  private decoded?:HTMLImageElement;
  private retiredDecoded?:HTMLImageElement;
  private urls=new Set<string>();
  private failure?:unknown;
  private encoder?:PreviewImageEncoder;
  private timings=new PreviewPresentationTimings();
  private progress=new PreviewPictureProgress();
  private phase:'idle'|'capture'|'encode'|'decode'|'failed'|'disposed'='idle';
  private phaseAt=performance.now();
  readonly stats={presented:0,replaced:0,encodeMs:0,captureMs:0,packageMs:0,decodeMs:0};
  constructor(private images:SVGImageElement[],private onError:(error:unknown)=>void,worker=false){if(worker)this.encoder=new PreviewImageEncoder();}
  get busy(){return !!this.running;}
  pictureProgress(now=performance.now()){return {...this.progress.snapshot(now),phase:this.phase,phaseAgeMs:Math.round(Math.max(0,now-this.phaseAt)),busy:this.busy,pending:!!this.pending};}
  diagnostics(since=0){return {...this.stats,progress:this.pictureProgress(),observation:this.timings.snapshot(since)};}
  private setPhase(phase:typeof this.phase){this.phase=phase;this.phaseAt=performance.now();}
  private bounded<T>(work:Promise<T>){
    let timer:ReturnType<typeof setTimeout>;
    return Promise.race([work,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(Error('La présentation de cette image ne répond pas. Relancez l’aperçu.')),15000);})]).finally(()=>clearTimeout(timer));
  }
  publish(canvas:HTMLCanvasElement,opaque=false){
    if(this.closed)return;
    // A new IN does not recreate this publisher. Never silently accept frames
    // after a terminal failure and leave an old image under a moving clock.
    if(this.failure)throw this.failure;
    if(this.pending)this.stats.replaced++;
    this.pending={canvas,opaque};
    if(!this.running)this.start();
  }
  private start(){this.running=this.drain().catch(error=>{if(!this.closed){this.pending=undefined;this.failure=error;this.setPhase('failed');this.onError(error);}}).finally(()=>{this.running=undefined;if(this.pending&&!this.closed&&!this.failure)this.start();else if(!this.closed&&!this.failure)this.setPhase('idle');});}
  private async drain(){
    while(this.pending&&!this.closed){
      const {canvas,opaque}=this.pending;this.pending=undefined;
      if(!canvas.width||!canvas.height)continue;
      const started=performance.now();
      this.setPhase('capture');
      if(this.snapshot.width!==canvas.width||this.snapshot.height!==canvas.height){this.snapshot.width=canvas.width;this.snapshot.height=canvas.height;}
      const ctx=previewCanvasContext(this.snapshot,{willReadFrequently:!!this.encoder});ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(canvas,0,0);checkPreviewCanvas(ctx);
      const encoded=this.encoder?this.encoder.encode(this.snapshot):new Promise<Blob>((resolve,reject)=>this.snapshot.toBlob(value=>value?resolve(value):reject(Error('La présentation de cette image a échoué.')),opaque?'image/jpeg':'image/png',.94));
      this.stats.captureMs=performance.now()-started;
      this.setPhase('encode');
      const blob=await this.bounded(encoded);
      checkPreviewCanvas(ctx);
      this.stats.packageMs=performance.now()-started-this.stats.captureMs;
      if(this.closed)return;
      const url=URL.createObjectURL(blob);this.urls.add(url);
      const decoded=new Image();decoded.src=url;const decodeStart=performance.now();
      this.setPhase('decode');
      try{await this.bounded(decoded.decode());checkPreviewCanvas(ctx);}catch(error){decoded.removeAttribute('src');URL.revokeObjectURL(url);this.urls.delete(url);throw error;}
      this.stats.decodeMs=performance.now()-decodeStart;
      if(this.closed){decoded.removeAttribute('src');return;}
      for(const image of this.images)image.setAttribute('href',url);
      // Keep one retired, already decoded frame through the following swap.
      if(this.previous){URL.revokeObjectURL(this.previous);this.urls.delete(this.previous);}
      // Retain the decoded backing store while SVG references its URL. Clearing
      // src before the swap can discard it and cause a second decode in WebKit.
      this.retiredDecoded?.removeAttribute('src');this.retiredDecoded=this.decoded;this.decoded=decoded;
      this.previous=this.current;this.current=url;
      const cost=performance.now()-started;this.stats.presented++;this.stats.encodeMs=cost;
      this.progress.record(started+cost);
      this.timings.record({started,presented:started+cost,captureMs:this.stats.captureMs,packageMs:this.stats.packageMs,decodeMs:this.stats.decodeMs});
    }
  }
  async flush(){while(this.running)await this.running;if(this.failure)throw this.failure;}
  dispose(){this.closed=true;this.setPhase('disposed');this.pending=undefined;this.encoder?.dispose();this.decoded?.removeAttribute('src');this.retiredDecoded?.removeAttribute('src');this.decoded=this.retiredDecoded=undefined;for(const url of this.urls)URL.revokeObjectURL(url);this.urls.clear();for(const image of this.images)image.removeAttribute('href');}
}

/** Media slots with equal logical dimensions share one snapshot. Native SVG
 * transforms, clips, masks and paint order stay on their original ancestors. */
export class SVGMediaTargets {
  private records=new Map<HTMLCanvasElement,{targets:HTMLCanvasElement[];groups:{canvas:HTMLCanvasElement;images:SVGImageElement[];publisher:SVGMediaPublisher}[]}>();
  constructor(private onError:(error:unknown)=>void){}
  resolve(source:HTMLCanvasElement,targets:HTMLCanvasElement[]){
    for(const [key,value]of this.records)if(key!==source&&value.groups.every(group=>group.images.every(image=>!image.isConnected))){for(const group of value.groups)group.publisher.dispose();this.records.delete(key);}
    let record=this.records.get(source);
    if(record&&record.targets.length===targets.length&&record.targets.every((target,i)=>target===targets[i]))return record.groups;
    if(record)for(const group of record.groups)group.publisher.dispose();
    const groups=new Map<string,{canvas:HTMLCanvasElement;images:SVGImageElement[];publisher:SVGMediaPublisher}>();
    for(const target of targets){
      const foreign=target.parentElement;
      if(!foreign||foreign.localName!=='foreignObject')throw Error('Structure média incompatible avec la présentation SVG.');
      const image=document.createElementNS('http://www.w3.org/2000/svg','image');
      for(const attribute of foreign.attributes)image.setAttribute(attribute.name,attribute.value);
      image.setAttribute('preserveAspectRatio','none');image.setAttribute('data-studio-media-surface','svg');foreign.replaceWith(image);bindSVGMedia(target,image);
      const key=target.width+':'+target.height;let group=groups.get(key);
      if(!group){const images:SVGImageElement[]=[];group={canvas:target,images,publisher:new SVGMediaPublisher(images,this.onError,true)};groups.set(key,group);}
      group.images.push(image);
    }
    record={targets:[...targets],groups:[...groups.values()]};this.records.set(source,record);return record.groups;
  }
  async flush(){await Promise.all([...this.records.values()].flatMap(record=>record.groups.map(group=>group.publisher.flush())));}
  stats(since=0){return [...this.records.values()].flatMap(record=>record.groups.map(group=>group.publisher.diagnostics(since)));}
  dispose(){for(const record of this.records.values())for(const group of record.groups)group.publisher.dispose();this.records.clear();}
}
