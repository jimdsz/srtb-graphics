import {ALL_FORMATS,CanvasSink,Input} from 'mediabunny';
import {browserSource} from './source';
import type {ExportProfile} from './export-profile';

// Sequential WebCodecs decoding, not HTMLVideoElement seeking. The decoder keeps
// only a small frame pool; it neither plays the source nor copies the full file.
export class VideoFrames {
  private aborters=new Set<()=>void>();
  private inputs=new Map<string,Promise<{input:Input;sink:CanvasSink;iterator?:AsyncGenerator;current?:{canvas:HTMLCanvasElement|OffscreenCanvas;timestamp:number;duration:number};next?:{canvas:HTMLCanvasElement|OffscreenCanvas;timestamp:number;duration:number};last:number}>>();
  constructor(private signal:AbortSignal,private profile?:ExportProfile){}
  private open(key:string,url:string){
    if(!this.inputs.has(key))this.inputs.set(key,(async()=>{
      const input=new Input({formats:ALL_FORMATS,source:browserSource(url)});
      const abort=()=>input.dispose();this.aborters.add(abort);this.signal.addEventListener('abort',abort,{once:true});
      try{const track=await input.getPrimaryVideoTrack();if(!track||!await track.canDecode())throw Error('Codec vidéo non décodable sur ce poste.');return {input,sink:new CanvasSink(track,{alpha:true,poolSize:3}),last:-1};}
      catch(error){input.dispose();throw error;}
    })());
    return this.inputs.get(key)!;
  }
  async frame(key:string,url:string,time:number){
    const started=this.profile?.now();try{
    this.signal.throwIfAborted();const state=await this.open(key,url),target=time+1e-7;
    if(!state.current||time<state.last-1e-6||time-state.last>2){
      await state.iterator?.return(undefined);
      state.current=await state.sink.getCanvas(target)||undefined;
      if(!state.current)throw Error('Aucune image vidéo au point IN demandé.');
      state.iterator=state.sink.canvases(state.current.timestamp+Math.max(1e-6,state.current.duration/2));
      state.next=(await state.iterator.next()).value;
    }
    while(state.next&&state.next.timestamp<=target){state.current=state.next;state.next=(await state.iterator!.next()).value;this.signal.throwIfAborted();}
    state.last=time;return state.current.canvas;
    }finally{if(started!==undefined)this.profile?.record('decode.frame',started);}
  }
  async dispose(){for(const abort of this.aborters)this.signal.removeEventListener('abort',abort);this.aborters.clear();for(const promise of this.inputs.values()){const state=await promise.catch(()=>null);if(state){await state.iterator?.return(undefined).catch(()=>{});state.input.dispose();}}this.inputs.clear();}
}
