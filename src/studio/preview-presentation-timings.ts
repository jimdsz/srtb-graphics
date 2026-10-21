type FrameTiming={started:number;presented:number;captureMs:number;packageMs:number;decodeMs:number};
const limit=512;
function distribution(values:number[]){
  if(!values.length)return {meanMs:0,p95Ms:0,maxMs:0};
  const ordered=[...values].sort((a,b)=>a-b),round=(value:number)=>Math.round(value*100)/100;
  return {meanMs:round(values.reduce((sum,value)=>sum+value,0)/values.length),p95Ms:round(ordered[Math.max(0,Math.ceil(ordered.length*.95)-1)]),maxMs:round(ordered[ordered.length-1])};
}
/** Bounded numbers only; never stores pixels, media names or source URLs.
 * Snapshot sorting runs on demand, not on each video frame. SVG href swaps
 * are observed here; the browser's actual paint/compositor is not observed. */
export class PreviewPresentationTimings {
  private frames:FrameTiming[]=[];
  private next=0;
  private discardedThrough=-Infinity;
  record(frame:FrameTiming){
    if(Object.values(frame).some(value=>!Number.isFinite(value))||frame.started<0||frame.presented<frame.started||Math.min(frame.captureMs,frame.packageMs,frame.decodeMs)<0)return;
    if(this.frames.length===limit)this.discardedThrough=Math.max(this.discardedThrough,this.frames[this.next].started);
    this.frames[this.next]=frame;this.next=(this.next+1)%limit;
  }
  snapshot(since=0){
    const frames=this.frames.filter(frame=>frame.started>=since).sort((a,b)=>a.started-b.started);
    const gaps=frames.slice(1).map((frame,index)=>frame.presented-frames[index].presented);
    return {samples:frames.length,limit,truncated:this.discardedThrough>=since,
      capture:distribution(frames.map(frame=>frame.captureMs)),package:distribution(frames.map(frame=>frame.packageMs)),decode:distribution(frames.map(frame=>frame.decodeMs)),
      preparation:distribution(frames.map(frame=>frame.presented-frame.started)),hrefSwapGap:distribution(gaps),hrefSwapGapsOver80ms:gaps.filter(gap=>gap>80).length};
  }
}
