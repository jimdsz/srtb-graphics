import {resumeAudioClock} from './audio-clock-ready';
type Insertion={id:string;mainIn:number;mainOut:number;sourceIn:number;sourceOut:number;envelope:[number,number][]};
type Active={source:AudioBufferSourceNode;gain:GainNode;insertion:Insertion;mainStart:number;contextStart:number;offset:number;duration:number;ended:boolean};
type Clock={context:AudioContext;master:GainNode;buffers:Record<string,{buffer:AudioBuffer}>;active:Record<string,Active>;config:Record<string,unknown>;plan:Record<string,Insertion[]>;mainSeconds:number;playing:boolean;muted:boolean;ready:boolean;disposed:boolean;lockReported:boolean;_stopOne:(kind:string)=>void;_stopSources:()=>void;_report:(reason:Error)=>void;_start:(kind:string,insertion:Insertion,seconds:number)=>void};
type Functions={dbToGain:(db:number)=>number;envelopeDbAt:(keys:[number,number][],seconds:number)=>number};

/** Buffer decoding is independent of the workstation's output device rate.
 * The AudioContext may render at 44.1/48 kHz; every BA source is measured at48k. */
export async function decodeBAAudio(bytes:ArrayBuffer):Promise<AudioBuffer>{
  const context=new OfflineAudioContext(2,1,48000),buffer=await context.decodeAudioData(bytes);
  if(buffer.sampleRate!==48000)throw Error('Le décodage BA doit conserver la fréquence de référence48kHz.');
  return buffer;
}

/** Install only on the versioned studio BA class, never the frozen library.
 * Schedule the next insertion in the SAME phase before its start. A body hold
 * must never schedule OUT. Explicit seeks/resumes retain their source offset. */
export function installBAScheduledAudio(Engine:{prototype:any},{dbToGain,envelopeDbAt}:Functions){
  const waits=new WeakMap<Clock,{controller:AbortController;promise:Promise<{unlocked:boolean}>}>(),stop=Engine.prototype.stop;
  Engine.prototype.stop=function(this:Clock){waits.get(this)?.controller.abort();waits.delete(this);return stop.call(this);};
  Engine.prototype.unlock=function(this:Clock){
    if(this.disposed)return Promise.reject(Object.assign(Error('Moteur audio détruit.'),{code:'AUDIO_DISPOSED'}));
    const current=waits.get(this);if(current)return current.promise;
    const controller=new AbortController();
    const promise=resumeAudioClock(this.context,{signal:controller.signal}).then(()=>{
      controller.signal.throwIfAborted();if(this.disposed)throw Object.assign(Error('Moteur audio détruit.'),{code:'AUDIO_DISPOSED'});
      this.lockReported=false;Engine.prototype.sync.call(this,this.mainSeconds,{playing:this.playing,muted:this.muted,discontinuity:true});
      return {unlocked:true};
    }).catch(error=>{if(error?.name!=='AbortError')this._report(error);throw error;}).finally(()=>{if(waits.get(this)?.controller===controller)waits.delete(this);});
    waits.set(this,{controller,promise});return promise;
  };
  Engine.prototype._start=function(this:Clock,kind:string,insertion:Insertion,seconds:number){
    const data=this.buffers[kind];if(!data)return;
    const now=this.context.currentTime,mainStart=Math.max(seconds,insertion.mainIn),when=now+mainStart-seconds;
    const source=this.context.createBufferSource(),gain=this.context.createGain();
    source.buffer=data.buffer;source.playbackRate.value=1;source.connect(gain);gain.connect(this.master);
    const volume=Number(this.config[`_audio_${kind}_gain`]),offset=insertion.sourceIn+mainStart-insertion.mainIn,duration=Math.max(0,insertion.sourceOut-offset);
    const item:Active={source,gain,insertion,mainStart,contextStart:when,offset,duration,ended:false};this.active[kind]=item;
    gain.gain.value=volume*dbToGain(envelopeDbAt(insertion.envelope,mainStart));
    gain.gain.setValueAtTime(gain.gain.value,when);
    const points=[...insertion.envelope.filter(([time])=>time>mainStart&&time<insertion.mainOut),[insertion.mainOut,envelopeDbAt(insertion.envelope,insertion.mainOut)]];
    for(const [time,db]of points){const at=when+time-mainStart;volume===0?gain.gain.setValueAtTime(0,at):gain.gain.exponentialRampToValueAtTime(volume*dbToGain(db),at);}
    source.onended=()=>{if(this.active[kind]===item){item.ended=true;source.disconnect();gain.disconnect();}};
    try{source.start(when,offset,duration);}catch(cause){this._stopOne(kind);this._report(Object.assign(Error(`Lecture ${kind} impossible : ${cause instanceof Error?cause.message:String(cause)}`),{code:'AUDIO_PLAY'}));}
  };
  Engine.prototype.sync=function(this:Clock,mainSeconds:number,{playing=this.playing,muted=this.muted,discontinuity=false}:{playing?:boolean;muted?:boolean;discontinuity?:boolean}={}){
    if(this.disposed)return;
    if(!Number.isFinite(mainSeconds)||mainSeconds<0)throw Object.assign(Error('Temps audio principal invalide.'),{code:'AUDIO_CLOCK'});
    this.mainSeconds=mainSeconds;this.playing=Boolean(playing);this.muted=Boolean(muted);
    const now=this.context.currentTime;this.master.gain.value=this.muted||!this.playing?0:1;
    if(!this.ready||!this.playing){this._stopSources();return;}
    if(this.context.state!=='running'){
      this._stopSources();
      if(!this.muted&&!this.lockReported){this.lockReported=true;this._report(Object.assign(Error('Son verrouillé : activez-le depuis un clic opérateur.'),{code:'AUDIO_GESTURE_REQUIRED'}));}
      return;
    }
    const phase=this.config._audio_social_direct_enabled===true?'intro':mainSeconds>=64.8?'outro':'intro';
    for(const kind of ['bed','voice']){
      const enabled=Boolean(this.config[`_audio_${kind}_enabled`]);
      const insertion=enabled?this.plan[kind].find(clip=>clip.id.endsWith(phase)&&mainSeconds<clip.mainOut):undefined;
      let active:Active|undefined=this.active[kind];
      if(active){
        const drift=Math.abs(active.mainStart+now-active.contextStart-mainSeconds);
        // The graphics clock can cross mainOut a few samples before the audio
        // clock. The existing one-shot duration already owns the exact end:
        // let that tail finish, without extending the plan or rescheduling it.
        // Explicit pause/seek, phase changes, disable and drift correction keep
        // their normal cancellation semantics.
        const naturalTail=!discontinuity&&enabled&&!insertion&&!active.ended&&active.insertion.id.endsWith(phase)&&mainSeconds>=active.insertion.mainOut&&now<active.contextStart+active.duration&&drift<=.08;
        if(!naturalTail&&(discontinuity||active.insertion.id!==insertion?.id||drift>.08)){this._stopOne(kind);active=undefined;}
      }
      if(insertion&&!active)this._start(kind,insertion,mainSeconds);
    }
  };
  const status=Engine.prototype.status;
  Engine.prototype.status=function(this:Clock){
    const result=status.call(this);
    for(const kind of ['bed','voice']){
      const active=this.active[kind],track=result.tracks[kind];if(!active)continue;
      const scheduled=this.context.currentTime<active.contextStart;
      track.scheduled=scheduled;track.running=track.running&&!scheduled;track.audible=track.audible&&!scheduled;
      track.sourceSeconds=Math.min(active.insertion.sourceOut,active.offset+Math.max(0,this.context.currentTime-active.contextStart));
    }
    return result;
  };
}
