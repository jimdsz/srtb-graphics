import type {BroadcastTemplate,ProjectData} from './domain';
import {hasSupplementalVoice} from './voice-fields';
import {resumeAudioClock} from './audio-clock-ready';
import {makeTimeline,TIMINGS,socialExcerptEnd} from './video/timeline';
import {tracksOf} from './media-tracks';
import type {LegacyGraphic} from './video/engine';
import {installAESignatureLevel} from './ae-signature-audio';
import {ceSoirSignatureKeys,ceSoirSignatureData} from './ce-soir-audio';

export const SUPPLEMENTAL_VOICE_VERSION=1;
export const supplementalVoiceKeys=['_audio_voice_enabled','_audio_voice_url','_audio_voice_start_seconds','_audio_voice_end_seconds','_audio_voice_delay_seconds','_audio_voice_volume'] as const;
type Template=Pick<BroadcastTemplate,'id'|'libraryVersion'>;
export interface SupplementalVoicePlan {url:string;start:number;end:number;duration:number;delay:number;volume:number}
export interface PreparedSupplementalVoice {plan:SupplementalVoicePlan;buffer:AudioBuffer}
const sourceURL=(value:unknown)=>typeof value==='string'?value:typeof value==='object'&&value!==null&&'url'in value?String(value.url):'';
function number(value:unknown,fallback:number,name:string,max=86400){
  const result=value===undefined?fallback:typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value):NaN;
  if(!Number.isFinite(result)||result<0||result>max)throw Error(`Voix off : ${name} invalide.`);
  return result;
}
function enabled(data:ProjectData){
  const value=data._audio_voice_enabled;
  if(value===true||value==='true'||value===1||value==='1')return true;
  if(value===undefined||value===false||value==='false'||value===0||value==='0')return false;
  throw Error('Voix off : activation invalide.');
}
export function stripSupplementalVoice(template:Template,data:ProjectData):ProjectData{
  if(!hasSupplementalVoice(template))return data;
  return Object.fromEntries(Object.entries(data).filter(([key])=>!(supplementalVoiceKeys as readonly string[]).includes(key)&&!(template.id==='BTV_Ce_Soir'&&ceSoirSignatureKeys.includes(key))));
}
/** The selected passage is never shortened or sped up to fit a graphic. */
export function supplementalVoicePlan(template:Template,data:ProjectData,decoded:{duration:number;sampleRate:number}):SupplementalVoicePlan|null{
  if(!hasSupplementalVoice(template)||!enabled(data))return null;
  const url=sourceURL(data._audio_voice_url);
  if(!url)throw Error('Voix off : choisissez un fichier audio avant de lancer la lecture.');
  if(!Number.isFinite(decoded.duration)||decoded.duration<=0||decoded.duration>600||decoded.sampleRate!==48000)throw Error('Voix off : un fichier de 600 secondes maximum, décodé à 48 kHz, est requis.');
  const start=number(data._audio_voice_start_seconds,0,'début du passage'),requestedEnd=number(data._audio_voice_end_seconds,0,'fin du passage');
  const end=requestedEnd||decoded.duration,delay=number(data._audio_voice_delay_seconds,0,'délai'),volume=number(data._audio_voice_volume,1,'volume',1);
  if(end<=start||start>=decoded.duration||end>decoded.duration+1/decoded.sampleRate+1e-9)throw Error('Voix off : le passage choisi dépasse le fichier ou sa fin précède son début.');
  return {url,start,end,duration:end-start,delay,volume};
}
export function assertSupplementalVoiceFits(plan:SupplementalVoicePlan|null|undefined,audioEnd:number){
  if(!plan)return;
  if(!Number.isFinite(audioEnd)||audioEnd<0||plan.delay+plan.duration>audioEnd+1/48000+1e-9)throw Error(`La voix off complète se termine à ${(plan.delay+plan.duration).toFixed(3)} s, après la fin sonore du programme (${audioEnd.toFixed(3)} s). Prolongez le programme, réduisez le délai ou choisissez explicitement un autre passage. Aucun son n’a été coupé.`);
}
/** Private/local media only in the editor; relative same-origin files in HTML.
 * Bound both streamed bytes and decoded PCM. No upload and no identity cache. */
export async function loadSupplementalVoice(template:Template,data:ProjectData,signal:AbortSignal,baseURL?:string):Promise<PreparedSupplementalVoice|undefined>{
  if(!hasSupplementalVoice(template)||!enabled(data))return;
  signal.throwIfAborted();
  const value=data._audio_voice_url,url=sourceURL(value);
  if(!url)throw Error('Voix off : choisissez un fichier audio.');
  if(typeof value==='object'&&value!==null&&'mimeType'in value&&!String(value.mimeType).startsWith('audio/'))throw Error('La voix off exige un fichier audio, pas une image ou une vidéo.');
  const resolved=new URL(url,baseURL||document.baseURI);
  if(resolved.protocol!=='blob:'&&(resolved.origin!==location.origin||!['http:','https:'].includes(resolved.protocol)))throw Error('La voix off doit être un fichier local connecté ou une ressource du même paquet.');
  const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(60000)]);
  const limit=32*1024**2,response=await fetch(resolved,{signal:requestSignal,credentials:'same-origin',cache:'no-store',redirect:'error'});
  if(!response.ok||!response.headers.get('Content-Type')?.toLowerCase().startsWith('audio/'))throw Error(`Voix off indisponible ou format non audio (${response.status}). Reconnectez le fichier ou vérifiez votre accès.`);
  if(Number(response.headers.get('Content-Length'))>limit)throw Error('La voix off dépasse la limite de 32 Mo.');
  const reader=response.body?.getReader();if(!reader)throw Error('Lecture du fichier voix indisponible.');
  const chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
  try{while(true){requestSignal.throwIfAborted();const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>limit)throw Error('La voix off dépasse la limite de 32 Mo.');chunks.push(item.value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}chunks.length=0;
  signal.throwIfAborted();const decoder=new OfflineAudioContext(2,1,48000);
  let buffer:AudioBuffer;
  try{buffer=await decoder.decodeAudioData(bytes.buffer);}catch{throw Error('Ce fichier ne contient pas de voix décodable. Choisissez un fichier WAV, MP3 ou AAC compatible.');}
  signal.throwIfAborted();
  if(buffer.numberOfChannels>2)throw Error('La voix off doit être mono ou stéréo.');
  const plan=supplementalVoicePlan(template,data,buffer)!;return {plan,buffer};
}

export async function loadSupplementalSignature(template:Template,data:ProjectData,signal:AbortSignal,baseURL?:string):Promise<PreparedSupplementalVoice|undefined>{
  if(template.id!=='BTV_Ce_Soir'||template.libraryVersion!=='1.7.0')return;
  try{return await loadSupplementalVoice(template,ceSoirSignatureData(data),signal,baseURL);}
  catch(error){if(error instanceof Error&&error.name!=='AbortError')throw Error(error.message.replaceAll('Voix off','Signature BTV').replaceAll('voix off','signature BTV'));throw error;}
}

/** One scheduled buffer source per uninterrupted run. RAF never restarts or
 * cuts the last samples: source.onended owns the natural completion. */
export class SupplementalVoicePlayer {
  private active?:{source:AudioBufferSourceNode;gain:GainNode;endAt:number};
  private disposed=false;
  constructor(readonly context:AudioContext,readonly destination:AudioNode,public prepared?:PreparedSupplementalVoice){}
  start(seconds:number){
    this.stop();if(this.disposed||!this.prepared)return;
    if(!Number.isFinite(seconds)||seconds<0)throw Error('Position de voix invalide.');
    const {plan,buffer}=this.prepared,elapsed=Math.max(0,seconds-plan.delay);
    if(elapsed>=plan.duration)return;
    const when=this.context.currentTime+Math.max(0,plan.delay-seconds),source=this.context.createBufferSource(),gain=this.context.createGain();
    source.buffer=buffer;source.playbackRate.value=1;gain.gain.value=plan.volume;source.connect(gain);gain.connect(this.destination);
    const item={source,gain,endAt:when+plan.duration-elapsed};this.active=item;
    source.onended=()=>{source.disconnect();gain.disconnect();if(this.active===item)this.active=undefined;};
    try{source.start(when,plan.start+elapsed,plan.duration-elapsed);}catch(error){this.stop();throw error;}
  }
  stop(){const active=this.active;this.active=undefined;if(active){active.source.onended=null;try{active.source.stop();}catch{/* Already ended/closed; teardown must still release both nodes. */}active.source.disconnect();active.gain.disconnect();}}
  finish(){
    // Allow only a tiny difference between the visual/performance clock and
    // the already scheduled device clock, never an arbitrarily long tail.
    if(this.active&&this.active.endAt-this.context.currentTime>.08){this.stop();return false;}
    return true;
  }
  dispose(){this.disposed=true;this.stop();this.prepared=undefined;}
}

export interface SupplementalVoiceOptions {context?:AudioContext;destination?:AudioNode;signal?:AbortSignal;permission?:()=>()=>boolean;baseURL?:string}
/** Version-pinned instance adapter shared by preview and the portable HTML.
 * Frozen engine files and their own music/accompaniment remain untouched. */
export function installSupplementalVoice(g:LegacyGraphic,template:Template,options:SupplementalVoiceOptions={}){
  if(!hasSupplementalVoice(template))return;
  installAESignatureLevel(g,template);
  if(g.__supplementalVoice)return g.__supplementalVoice as SupplementalVoiceControl;
  const context=options.context||new AudioContext(),master=context.createGain();master.connect(options.destination||context.destination);
  const player=new SupplementalVoicePlayer(context,master),signaturePlayer=new SupplementalVoicePlayer(context,master),lifetime=new AbortController();
  let data:ProjectData={},disposed=false,muted=false,armed=false,token=0,pending:AbortController|undefined;
  let playbackPermission=()=>true;
  let activation:Promise<void>|undefined;
  const signal=options.signal?AbortSignal.any([lifetime.signal,options.signal]):lifetime.signal;
  const report=(message:string)=>g.dispatchEvent(new CustomEvent('broadcast-audio-warning',{detail:{message}}));
  const invalidate=()=>{token++;armed=false;pending?.abort();pending=undefined;player.stop();signaturePlayer.stop();};
  const ensure=()=>{signal.throwIfAborted();if(disposed)throw Error('La voix off a été fermée.');};
  async function prepare(next:ProjectData){
    invalidate();const current=token;
    const previousSignature=signaturePlayer.prepared,signatureData=ceSoirSignatureData(next);
    // A colour/level edit must not fetch the same 8 MB jingle again. Keep only
    // this instance's decoded source, and recompute the independent gain plan.
    const cachedSignature=template.id==='BTV_Ce_Soir'&&previousSignature&&enabled(signatureData)&&sourceURL(signatureData._audio_voice_url)===previousSignature.plan.url
      ?{buffer:previousSignature.buffer,plan:supplementalVoicePlan(template,signatureData,previousSignature.buffer)!}:undefined;
    const [prepared,signature]=await Promise.all([loadSupplementalVoice(template,next,signal,options.baseURL),cachedSignature?Promise.resolve(cachedSignature):loadSupplementalSignature(template,next,signal,options.baseURL)]);ensure();
    if(current!==token)throw new DOMException('Préparation de voix interrompue.','AbortError');
    player.prepared=prepared;signaturePlayer.prepared=signature;data=structuredClone(next);
  }
  async function ready(){
    ensure();if((!player.prepared&&!signaturePlayer.prepared)||muted)return;
    const controller=new AbortController();pending?.abort();pending=controller;
    try{await resumeAudioClock(context,{signal:AbortSignal.any([signal,controller.signal])});ensure();}
    finally{if(pending===controller)pending=undefined;}
  }
  function begin(seconds:number){
    if(!armed||disposed)return;armed=false;
    if(!playbackPermission()){player.stop();signaturePlayer.stop();return;}
    if(!muted){player.start(seconds);signaturePlayer.start(seconds);}
  }
  function plannedEnd(){
    if(data._out_mode==='manual')return Infinity;
    const lengths=Object.fromEntries(Object.entries(tracksOf(g)).map(([key,t])=>[key,t.length??t.clips.reduce((n,c)=>n+c.length,0)/(t.rate||1)]));
    const timeline=makeTimeline(template.id,data,lengths,Number(data._out_duration_seconds||12),false);
    return (timeline.frames-timeline.terminalHoldFrames)/25;
  }
  const native={load:g.load.bind(g),update:g.updateAction.bind(g),play:g.playAction.bind(g),stop:g.stopAction.bind(g),seek:g.goToTime.bind(g),dispose:g.dispose.bind(g),mute:g.setMuted?.bind(g),pause:g.pauseAction?.bind(g)};
  g.load=async(args:any={})=>{muted=!!args.previewMuted;master.gain.value=muted?0:1;await prepare(args.data||{});return native.load({...args,data:stripSupplementalVoice(template,args.data||{})});};
  g.updateAction=async(raw:ProjectData)=>{const wrapped=raw.data&&typeof raw.data==='object'&&!Array.isArray(raw.data),input=(wrapped?raw.data:raw) as ProjectData,next={...data,...input};await prepare(next);const clean=stripSupplementalVoice(template,input);return native.update(wrapped?{...raw,data:clean}:clean);};
  g.playAction=(...args:any[])=>{
    let completion:Promise<any>|undefined;
    activation=(async()=>{
      playbackPermission=options.permission?.()||(()=>true);if(!playbackPermission())throw Error('Vérifiez la connexion avant de lancer la voix.');
      const current=token,end=plannedEnd();if(Number.isFinite(end))assertSupplementalVoiceFits(player.prepared?.plan,end);
      await ready();ensure();if(current!==token||!playbackPermission())throw new DOMException('Lecture interrompue.','AbortError');
      armed=true;completion=native.play(...args);
      if(TIMINGS[template.id].kind!=='signature'&&typeof g._playMarker!=='function')begin(args[0]?.skipAnimation?TIMINGS[template.id].entry:0);
    })();
    return activation.then(()=>completion).catch(error=>{invalidate();throw error;});
  };
  // These hooks run at the native clock anchor, after media/font preparation,
  // not at the next RAF nor at completion of the native IN promise.
  if(TIMINGS[template.id].kind==='signature'){
    // Signature canvases expose `running`; the three AE conversions expose
    // `playing`. Both enter _tick at their native anchor, before their first
    // visual frame. Inspection must never schedule an audio source.
    const tick=g._tick.bind(g);g._tick=(...args:any[])=>{if(g.running===true||g.playing===true)begin(Number(g.elapsed||0));return tick(...args);};
  }else if(typeof g._playMarker==='function'){
    const marker=g._playMarker.bind(g);g._playMarker=(name:string,args:any)=>{if(name==='start')begin(args?.skip?TIMINGS[template.id].entry:0);return marker(name,args);};
  }
  g.goToTime=(args:{seconds:number})=>{invalidate();return native.seek(args);};
  if(native.pause)g.pauseAction=(...args:any[])=>{invalidate();return native.pause!(...args);};
  g.stopAction=(args:any={})=>{
    if(args.skipAnimation)invalidate();
    else if(player.prepared){
      const seconds=g.__previewTransport?.snapshot().seconds??g._time?.()??Math.max(0,(performance.now()-g.autoOut?.startedAt)/1000);
      if(Number.isFinite(seconds)&&player.prepared.plan.delay+player.prepared.plan.duration>seconds+TIMINGS[template.id].out+1/48000)report('Sortie demandée : la voix off sera interrompue volontairement avant la fin du passage.');
    }
    return native.stop(args);
  };
  if(native.mute)g.setMuted=async(value:boolean)=>{control.mute(value);return native.mute!(value);};
  const completed=(event:Event)=>{if((event as CustomEvent).detail?.phase==='completed'){signaturePlayer.stop();if(!player.finish())report('La sortie opérateur a interrompu la voix off. Prolongez le programme pour entendre le passage entier.');}};
  g.addEventListener('broadcast-out',completed);
  const onAbort=()=>invalidate();signal.addEventListener('abort',onAbort,{once:true});
  const control={
    ready,
    get activation(){return activation;},
    resume:async(seconds:number)=>{const current=token;playbackPermission=options.permission?.()||(()=>true);await ready();ensure();if(current!==token||!playbackPermission())throw new DOMException('Reprise interrompue.','AbortError');armed=true;begin(seconds);},
    pause:invalidate,
    mute:(value:boolean)=>{muted=value;master.gain.value=value?0:1;},
    get prepared(){return player.prepared;},
    get signature(){return signaturePlayer.prepared;},
    dispose:()=>{if(disposed)return;disposed=true;invalidate();lifetime.abort();signal.removeEventListener('abort',onAbort);g.removeEventListener('broadcast-out',completed);player.dispose();signaturePlayer.dispose();master.disconnect();if(!options.context&&context.state!=='closed')void context.close().catch(()=>{});delete g.__supplementalVoice;},
  };
  g.dispose=async()=>{control.dispose();return native.dispose();};
  g.__supplementalVoice=control;return control;
}
export type SupplementalVoiceControl={ready:()=>Promise<void>;readonly activation:Promise<void>|undefined;resume:(seconds:number)=>Promise<void>;pause:()=>void;mute:(value:boolean)=>void;readonly prepared:PreparedSupplementalVoice|undefined;readonly signature:PreparedSupplementalVoice|undefined;dispose:()=>void};

/** Native BA/TDS keep their own voice tracks. Only reject an impossible whole
 * passage; do not move a cue, alter their bed or change the native scheduler. */
export function assertNativeVoiceFits(g:LegacyGraphic,template:Template,manualOut?:number){
  if(template.libraryVersion!=='1.7.0'||!['BTV_BA_1P','BTV_BA_TDS'].includes(template.id))return;
  const data:ProjectData=template.id==='BTV_BA_1P'?(g.__baSocialData||g.data):g.config;
  if(!data?._audio_voice_enabled)return;
  const timing=TIMINGS[template.id];let outAt=manualOut;
  if(outAt===undefined&&data._out_mode!=='manual'){
    const lengths=Object.fromEntries(Object.entries(tracksOf(g)).map(([key,t])=>[key,t.length??t.clips.reduce((n,c)=>n+c.length,0)/(t.rate||1)]));
    outAt=makeTimeline(template.id,data,lengths,Number(data._out_duration_seconds||12),false).outAt;
  }
  const sourceEnd=socialExcerptEnd(template.id,data,{body:tracksOf(g).body?.length??NaN});
  if(Number.isFinite(sourceEnd))outAt=Math.min(outAt??Infinity,sourceEnd);
  if(template.id==='BTV_BA_1P'){
    const plan=g.audio?.plan?.voice as {id:string;mainIn:number;mainOut:number;sourceIn:number;sourceOut:number}[]|undefined;
    if(!plan?.length)throw Error('La piste voix BA active n’est pas prête.');
    for(const item of plan){
      const outro=item.id.endsWith('outro');if(!outro&&outAt===undefined)continue;
      assertSupplementalVoiceFits({url:'',start:item.sourceIn,end:item.sourceOut,duration:item.mainOut-item.mainIn,delay:outro?item.mainIn-timing.stop:item.mainIn,volume:1},outro?timing.out:outAt!);
    }
  }else if(outAt!==undefined){
    const node=g.sound?.voice?.node as HTMLMediaElement|undefined;if(!node)throw Error('La piste voix TDS active n’est pas prête.');
    const start=Number(data._audio_voice_start_seconds),end=Number(data._audio_voice_end_seconds)||node.duration,delay=Number(data._audio_voice_delay_seconds);
    if(!Number.isFinite(end)||end<=start||end>node.duration+1/48000)throw Error('Voix TDS : passage hors du fichier audio.');
    assertSupplementalVoiceFits({url:node.src,start,end,duration:end-start,delay,volume:1},outAt+timing.out);
  }
}
export function installNativeVoiceFit(g:LegacyGraphic,template:Template){
  if(template.libraryVersion!=='1.7.0'||!['BTV_BA_1P','BTV_BA_TDS'].includes(template.id)||g.__nativeVoiceFit)return;
  const play=g.playAction.bind(g),stop=g.stopAction.bind(g);
  const check=()=>assertNativeVoiceFits(g,template);g.__nativeVoiceFit=check;
  g.playAction=(...args:any[])=>{try{check();return play(...args);}catch(error){return Promise.reject(error);}};
  g.stopAction=(args:{skipAnimation?:boolean}={})=>{
    const phase=g.state?.phase||g.phase;
    if(!args.skipAnimation&&phase!=='out'&&(g._running||g.runningMedia||phase==='paused'||g.state?.playStatus==='play')){
      try{
        const seconds=g.__previewTransport?.snapshot().seconds??g._times?.().elapsed??Math.max(0,(performance.now()-g.runStartedAt)/1000);
        assertNativeVoiceFits(g,template,seconds);
      }catch{
        // OUT is an explicit operator interruption, not an export. Never trap
        // the operator on air; report the consequence without blocking OUT.
        g.dispatchEvent(new CustomEvent('broadcast-audio-warning',{detail:{message:'Sortie demandée : la voix off sera interrompue volontairement avant la fin du passage.'}}));
      }
    }
    return stop(args);
  };
}
