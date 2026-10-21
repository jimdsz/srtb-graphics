/** Live playback only: never hold the native AE renderer's mediaBusy slot on
 * a browser play()/seek promise. Exact inspection/export use their own path. */
interface LiveVideoState {
  active:()=>boolean;
  waitingSince?:number;
  pendingPlay?:number;
  lastSeek:number;
  raw?:number;
  failed:boolean;
}
export class AEPreviewPlayback {
  private states=new Map<HTMLVideoElement,LiveVideoState>();
  private disposed=false;
  constructor(private onError:(error:Error)=>void,private now=()=>performance.now()){}
  reset(node:HTMLVideoElement){if(this.states.delete(node))node.pause();}
  pause(){for(const node of this.states.keys())node.pause();this.states.clear();}
  dispose(){this.disposed=true;this.pause();}
  sweep(){for(const [node,state]of this.states)if(!state.active())this.reset(node);}
  private fail(node:HTMLVideoElement,state:LiveVideoState,reason:unknown){
    if(this.disposed||this.states.get(node)!==state||!state.active()||state.failed)return;
    state.failed=true;node.pause();
    this.onError(Error(`Lecture vidéo interrompue. ${reason instanceof Error?reason.message:String(reason)} Relancez l’aperçu ; vos réglages sont conservés.`));
  }
  position(node:HTMLVideoElement,seconds:number,loop:boolean,active:()=>boolean):boolean{
    if(this.disposed||!active()){this.reset(node);return false;}
    const now=this.now();let state=this.states.get(node);
    if(!state){state={active,lastSeek:-Infinity,failed:false};this.states.set(node,state);}else state.active=active;
    if(state.failed)return false;
    if(node.error){this.fail(node,state,node.error.message||'Le navigateur ne peut plus lire ce média.');return false;}
    if(!Number.isFinite(node.duration)||node.duration<=0||node.seeking||node.readyState<2){
      state.waitingSince??=now;
      if(now-state.waitingSince>=15000)this.fail(node,state,'Le média ne fournit pas d’image depuis 15 secondes.');
      return false;
    }
    state.waitingSince=undefined;
    if(state.pendingPlay!==undefined&&now-state.pendingPlay>=15000){this.fail(node,state,'Le démarrage du média n’a pas abouti après 15 secondes.');return false;}
    const duration=Math.max(.04,node.duration),raw=Math.max(0,seconds),target=loop?raw%duration:Math.min(raw,duration-.04);
    // A short loop can wrap below the drift tolerance. Do not repeatedly seek
    // while the decoder is already seeking or buffering.
    const wrapped=loop&&state.raw!==undefined&&raw>=state.raw&&Math.floor(raw/duration)>Math.floor(state.raw/duration);
    const discontinuity=state.raw!==undefined&&raw<state.raw;
    const drift=Math.abs(node.currentTime-target);
    if((wrapped||discontinuity||!loop&&raw>=duration&&drift>.000001||drift>.24&&now-state.lastSeek>=1000)&&node.readyState>=3){
      state.lastSeek=now;
      // Native precise inspection must not accept a prior frame-ready marker
      // while this new asynchronous seek has not decoded its target yet.
      (node as HTMLVideoElement&{__frameReady?:boolean}).__frameReady=false;
      try{node.currentTime=target;}catch(error){this.fail(node,state,error);return false;}
    }
    state.raw=raw;
    if(!loop&&raw>=duration){node.pause();return !node.seeking;}
    if(node.paused&&state.pendingPlay===undefined&&!node.seeking){
      state.pendingPlay=now;
      const current=state;
      try{
        void Promise.resolve(node.play()).then(()=>{
          if(this.states.get(node)!==current)return;
          current.pendingPlay=undefined;
          if(!current.active())this.reset(node);
        },error=>{
          if(this.states.get(node)!==current)return;
          current.pendingPlay=undefined;this.fail(node,current,error);
        });
      }catch(error){state.pendingPlay=undefined;this.fail(node,state,error);return false;}
    }
    return !state.failed&&!node.seeking;
  }
}
