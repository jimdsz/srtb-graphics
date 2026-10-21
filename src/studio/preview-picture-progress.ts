/** Numeric, instance-local counters. A successful copy/swap is not proof of
 * compositor output or distinct pixels. No pixels, paths or source identifiers. */
export class PreviewPictureProgress {
  private count=0;
  private lastAt:number|null=null;
  private sourceTime:number|null=null;
  record(at:number,sourceTime?:number){
    if(!Number.isFinite(at)||at<0)return;
    this.count++;this.lastAt=at;
    this.sourceTime=sourceTime!==undefined&&Number.isFinite(sourceTime)?sourceTime:null;
  }
  snapshot(now:number){
    return {completed:this.count,lastCompletedAgeMs:this.lastAt===null?null:Math.round(Math.max(0,now-this.lastAt)),sourceTimeAtCopy:this.sourceTime};
  }
}

/** Only collected while the operator explicitly runs the 15 s diagnostic.
 * Both dimensions are capped so a stalled timer/large playlist cannot grow it.
 * Numbers/booleans are whitelisted at the DOM adapter, never raw media objects. */
export const PICTURE_SAMPLE_LIMIT=32;
export const PICTURE_SOURCE_LIMIT=32;
export type PictureSourceSample={id:number;time:number|null;paused:boolean;ended:boolean;seeking:boolean;readyState:number;frames:number|null;dropped:number|null};
const finite=(value:number)=>Number.isFinite(value)&&value>=0?value:null;
export function pictureSourceSample(node:HTMLVideoElement,id:number):PictureSourceSample {
  let frames:number|null=null,dropped:number|null=null;
  // A missing/throwing browser counter must not interrupt the diagnostic.
  try{const q=node.getVideoPlaybackQuality?.();if(q){frames=finite(q.totalVideoFrames);dropped=finite(q.droppedVideoFrames);}}catch{/* unavailable */}
  const time=finite(node.currentTime);
  return {id,time:time===null?null:Math.round(time*1000)/1000,paused:node.paused,ended:node.ended,seeking:node.seeking,readyState:node.readyState,frames,dropped};
}
export type PictureSurfaceSample={kind:'intro'|'body'|'pack';phaseActive:boolean;destinationVisible:boolean;sourceId:number|null;sourceIsVideo:boolean;sink:'canvas'|'html-canvas'|'svg-href';copy:ReturnType<PreviewPictureProgress['snapshot']>;svg?:ReturnType<PreviewPictureProgress['snapshot']>&{phase:string;phaseAgeMs:number;busy:boolean;pending:boolean}};
type PictureSample={atMs:number;timelineSeconds:number|null;sources:PictureSourceSample[];surfaces:PictureSurfaceSample[]|null};
/** A diagnostic warning, never an automatic renderer action. Require repeated
 * close samples of the SAME active source/sink, source frame progression and
 * no successful copy/swap for at least 2 s. A paused/ended/changed source or an
 * inactive publisher cannot qualify; missing counters remain inconclusive. */
export function pictureCopyStalls(samples:PictureSample[]){
  const windows=new Map<string,{first:PictureSample;source:PictureSourceSample;surface:PictureSurfaceSample;last:number}>(),stalls=new Set<string>();
  for(const sample of samples){
    const seen=new Set<string>();
    for(const surface of sample.surfaces||[]){
      const source=sample.sources.find(s=>s.id===surface.sourceId),copy=surface.sink==='svg-href'?surface.svg:surface.copy,key=surface.kind;
      if(!surface.phaseActive||!surface.destinationVisible||!surface.sourceIsVideo||!source||source.paused||source.ended||source.seeking||source.readyState<2||source.frames===null||source.dropped===null||!copy?.completed||sample.timelineSeconds===null)continue;
      seen.add(key);const previous=windows.get(key),previousCopy=previous&&(previous.surface.sink==='svg-href'?previous.surface.svg:previous.surface.copy);
      if(!previous||sample.atMs-previous.last>1200||previous.source.id!==source.id||previous.surface.sink!==surface.sink||previousCopy?.completed!==copy.completed||source.frames<previous.source.frames!||source.dropped<previous.source.dropped!){
        windows.set(key,{first:sample,source,surface,last:sample.atMs});continue;
      }
      previous.last=sample.atMs;
      if(sample.atMs-previous.first.atMs>=2000&&sample.timelineSeconds>previous.first.timelineSeconds!+.5&&source.frames-source.dropped>previous.source.frames!-previous.source.dropped!)stalls.add(key);
    }
    for(const key of windows.keys())if(!seen.has(key))windows.delete(key);
  }
  return [...stalls];
}
export class PreviewPictureSamples {
  private entries:PictureSample[]=[];
  private truncated=false;
  add(atMs:number,timelineSeconds:number|null,sources:PictureSourceSample[],surfaces:PictureSurfaceSample[]|null){
    if(this.entries.length>=PICTURE_SAMPLE_LIMIT){this.truncated=true;return;}
    if(sources.length>PICTURE_SOURCE_LIMIT)this.truncated=true;
    this.entries.push({atMs:Math.round(atMs),timelineSeconds,sources:sources.slice(0,PICTURE_SOURCE_LIMIT),surfaces});
  }
  snapshot(){return {observes:'source clocks and successful canvas copies / SVG href swaps; not compositor output or distinct pixels',limit:PICTURE_SAMPLE_LIMIT,sourceLimit:PICTURE_SOURCE_LIMIT,truncated:this.truncated,copyStallSignals:pictureCopyStalls(this.entries),samples:this.entries};}
}
