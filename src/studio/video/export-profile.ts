// Explicitly supplied by local qualification only. No global switch, media
// contents, URLs, telemetry, persistence or clocks when no profile is supplied.
export type ExportStage='prepare'|'audio.mix'|'frame.total'|'decode.frame'|'engine.mediaCopy'|'engine.scene'|'engine.decorate'|'engine.compare'|'raster.total'|'raster.clone'|'raster.bitmap'|'raster.bitmapScan'|'raster.bitmapEncode'|'raster.serialize'|'raster.svgDecode'|'raster.canvasDraw'|'raster.compare'|'proof.sample'|'encoder.start'|'encoder.audio'|'encoder.add'|'encoder.finalize'|'destination.open'|'destination.finish'|'yield'|'bitrate.native'|'bitrate.final'|'verify';
export type ExportPhase='setup'|'intro'|'body'|'out';
interface Metric {calls:number;ms:number;maxMs:number}
type Metrics=Partial<Record<ExportStage,Metric>>;
interface FrameProfile {frame:number;sourceTime:number;phase:ExportPhase;stages:Metrics}
const add=(metrics:Metrics,stage:ExportStage,ms:number)=>{const metric=metrics[stage]??={calls:0,ms:0,maxMs:0};metric.calls++;metric.ms+=ms;metric.maxMs=Math.max(metric.maxMs,ms);};

export class ExportProfile {
  private readonly started:number;
  private stages:Metrics={};
  private phases:Record<ExportPhase,Metrics>={setup:{},intro:{},body:{},out:{}};
  private frames:FrameProfile[]=[];
  private current?:FrameProfile;
  private counters:Record<string,number>={};
  private omittedFrames=0;
  constructor(private clock:()=>number=()=>performance.now(),private frameLimit=2048){this.started=clock();}
  now(){return this.clock();}
  record(stage:ExportStage,started:number){
    const ms=Math.max(0,this.clock()-started);add(this.stages,stage,ms);add(this.phases[this.current?.phase||'setup'],stage,ms);
    if(this.current)add(this.current.stages,stage,ms);
  }
  count(name:string,amount=1){this.counters[name]=(this.counters[name]||0)+amount;}
  frame(frame:number,sourceTime:number,phase:ExportPhase){this.endFrame();this.current={frame,sourceTime,phase,stages:{}};}
  endFrame(){if(this.current){if(this.frames.length<this.frameLimit)this.frames.push(this.current);else this.omittedFrames++;this.current=undefined;}}
  snapshot(){return structuredClone({elapsedMs:this.clock()-this.started,stages:this.stages,phases:this.phases,counters:this.counters,frames:[...this.frames,...(this.current&&this.frames.length<this.frameLimit?[this.current]:[])],omittedFrames:this.omittedFrames,
    accounting:'Inclusive wall times: frame.total contains decode/engine/raster; raster.total contains clone (including bitmap), serialize, svgDecode and canvasDraw. Do not add nested stages. encoder.add is awaited backpressure/submission, not hardware CPU time. Final verification remains enabled.'});}
}
