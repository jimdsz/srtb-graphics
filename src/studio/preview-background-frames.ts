type Entry={image:HTMLImageElement;ready:boolean;started:boolean;done:Promise<void>;finish:()=>void};

/** Three upcoming distinct PNGs, two concurrent decodes, original dimensions.
 * Together with the displayed image this retains at most four 1080p images
 * (about 32 MiB of RGBA). Long holds never allocate hundreds of duplicate nodes. */
export class PreviewBackgroundFrames {
  private readonly entries=new Map<string,Entry>();
  private active=0;
  private closed=false;
  constructor(private readonly urls:readonly string[],private readonly image=()=>new Image()){}
  ahead(offset:number){
    if(this.closed)return;
    const wanted=new Set<string>(),current=this.urls[offset];
    for(let i=offset+1;i<this.urls.length&&wanted.size<3;i++)if(this.urls[i]!==current)wanted.add(this.urls[i]);
    for(const [source,entry]of this.entries)if(!wanted.has(source)){this.entries.delete(source);entry.image.removeAttribute('src');entry.finish();}
    for(const source of wanted)if(!this.entries.has(source)){
      let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});
      this.entries.set(source,{image:this.image(),ready:false,started:false,done,finish});
    }
    this.pump();
  }
  take(source:string){
    const entry=this.entries.get(source);if(!entry?.ready)return;
    this.entries.delete(source);return entry.image;
  }
  ready(){return Promise.all([...this.entries.values()].map(entry=>entry.done));}
  private pump(){
    if(this.closed)return;
    for(const [source,entry]of this.entries){
      if(this.active>=2)break;if(entry.started)continue;
      entry.started=true;this.active++;entry.image.decoding='async';entry.image.src=source;
      void entry.image.decode().then(()=>{if(this.entries.get(source)===entry)entry.ready=true;},()=>{
        if(this.entries.get(source)===entry){this.entries.delete(source);entry.image.removeAttribute('src');}
      }).finally(()=>{this.active--;entry.finish();this.pump();});
    }
  }
  dispose(){
    this.closed=true;
    for(const entry of this.entries.values()){entry.image.removeAttribute('src');entry.finish();}
    this.entries.clear();
  }
}
