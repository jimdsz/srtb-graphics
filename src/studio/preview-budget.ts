/** Device-local preview budget, never persisted in projects or used for export. */
export class PreviewBudget {
  edge:number;
  private expensive=0;
  private slowPresentations=0;
  private seen=new WeakMap<object,number>();
  constructor(cores=8){this.edge=cores>0&&cores<=4?960:1280;}
  observe(milliseconds:number){
    if(!Number.isFinite(milliseconds)||milliseconds<0)return false;
    this.expensive=milliseconds>24?this.expensive+1:Math.max(0,this.expensive-1);
    if(this.expensive<8)return false;
    return this.reduce();
  }
  /** Encoding/decoding an SVG image finishes after draw() has returned. Count
   * each newly presented image once, independently of cheap synchronous draws.
   * Call only for a visible, playing track: an old intro sample is not a new
   * performance problem in the body. 40 ms is one frame at the native 25 fps. */
  observePresentation(sample:{presented:number;encodeMs:number}){
    if(!Number.isSafeInteger(sample.presented)||sample.presented<=0||!Number.isFinite(sample.encodeMs)||sample.encodeMs<0)return false;
    if((this.seen.get(sample)??0)>=sample.presented)return false;
    this.seen.set(sample,sample.presented);
    this.slowPresentations=sample.encodeMs>40?this.slowPresentations+1:Math.max(0,this.slowPresentations-1);
    if(this.slowPresentations<8)return false;
    return this.reduce();
  }
  private reduce(){
    if(this.edge<=640)return false;
    this.edge=this.edge>960?960:640;this.expensive=0;this.slowPresentations=0;return true;
  }
}
