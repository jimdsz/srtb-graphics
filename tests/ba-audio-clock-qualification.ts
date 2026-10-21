// Real AudioContext/AudioWorklet emission; no mocked scheduler and no user media.
// Only JSON metrics leave browser memory, to the same-origin loopback sink.
import {captureSourceTap} from './audio-source-tap';
import {captureWindow} from './pcm-capture-window';
const RATE=48000,DURATION=3.6,INTRO=4.36-DURATION,OUTRO=68.48,ORIGIN='http://127.0.0.1:5198';
const runButton=document.querySelector<HTMLButtonElement>('#run')!,portableButton=document.querySelector<HTMLButtonElement>('#portable')!,cancelButton=document.querySelector<HTMLButtonElement>('#cancel')!;
const baselineButton=document.createElement('button');baselineButton.textContent='Diagnostic navigateur sans moteur BA · ~24 s';portableButton.after(baselineButton);
const disconnectButton=document.createElement('button');disconnectButton.textContent='Diagnostic natif avec déconnexion en fin · ~24 s';baselineButton.after(disconnectButton);
const gainButton=document.createElement('button');gainButton.textContent='Diagnostic natif avec gain et fondu BA · ~24 s';disconnectButton.after(gainButton);
const status=document.querySelector<HTMLElement>('#status')!,result=document.querySelector<HTMLElement>('#result')!;
const postGainControl=document.querySelector<HTMLInputElement>('#post-gain')!;
type Phase='intro'|'outro';
type Command={phase:Phase;when:number;offset:number;duration:number;calledAt:number;playbackRate:number;phaseAnchor?:{contextBefore:number;contextAfter:number;cueDelay:number;earliestWhen:number;latestWhen:number};stops:{when:number;calledAt:number}[];disconnects:{calledAt:number}[]};
type Chunk={firstFrame:number;channels:Float32Array[]};
type CaptureGap={expectedFrame:number;receivedFrame:number;delta:number};
type Engine={master:GainNode;buffers:{voice:{buffer:AudioBuffer}};errors:unknown[];prepare:(data:Record<string,unknown>)=>Promise<unknown>;unlock:()=>Promise<unknown>;sync:(seconds:number,options:{playing:boolean;muted:boolean;discontinuity?:boolean})=>void;stop:()=>void;dispose:()=>Promise<void>};
type Module={AudioEngine:new(options:{context:AudioContext;baseUrl:string})=>Engine;AUDIO_DEFAULTS:Record<string,unknown>};
type Stall={phase:Phase;beforeContext:number;afterContext:number;elapsedMs:number;scheduledWhen:number;startsBefore:number;startsAfter:number};
let controller:AbortController|undefined;
function ensure(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
async function loadModule(portable:boolean,signal:AbortSignal):Promise<{module:Module;identity:Record<string,unknown>}>{
  const profile=portable?'portable':'studio',base=`/__ba-audio-clock-qualification/${profile}/`;
  const response=await fetch(base+'manifest.json',{cache:'no-store',signal});ensure(response.ok,'Manifest de recette inaccessible. Redémarrez uniquement le serveur local5198 avec sa config mise à jour.');
  const identity=await response.json();ensure(identity.profile===profile&&/^[a-f0-9]{64}$/.test(identity.graphSha256),'Identité du graphe de recette invalide.');
  const url=base+'audio.mjs?v='+identity.graphSha256;
  // Every same-origin dependency is pinned to this graph digest by the local
  // middleware; a rebuild mid-import fails instead of mixing cached revisions.
  return {module:await import(/* @vite-ignore */url),identity};
}

function syntheticWav(){
  const frames=DURATION*RATE,bytes=new ArrayBuffer(44+frames*4),view=new DataView(bytes);
  const text=(offset:number,value:string)=>[...value].forEach((letter,index)=>view.setUint8(offset+index,letter.charCodeAt(0)));
  text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,RATE,true);view.setUint32(28,RATE*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,frames*4,true);
  for(let frame=0;frame<frames;frame++){
    const time=frame/RATE;
    const marker=time<.02?{at:0,hz:500,gain:.5}:time>=.06&&time<.12?{at:.06,hz:1000,gain:.35}:time>=DURATION-.02?{at:DURATION-.02,hz:1500,gain:.65}:null;
    const value=marker?marker.gain*Math.cos(2*Math.PI*marker.hz*(time-marker.at)):0;
    view.setInt16(44+frame*4,Math.round(value*32767),true);view.setInt16(46+frame*4,Math.round(-value*.8*32767),true);
  }
  return new Blob([bytes],{type:'audio/wav'});
}

async function recorder(context:AudioContext,signal:AbortSignal){
  await context.audioWorklet.addModule('/tests/ba-audio-clock-capture.js');signal.throwIfAborted();
  const node=new AudioWorkletNode(context,'ba-qualification-capture',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'});
  const chunks:Chunk[]=[],gaps:CaptureGap[]=[],pending=new Map<number,()=>void>();let serial=0,processorError='';
  node.onprocessorerror=()=>{processorError='Le processeur AudioWorklet a échoué.';};
  node.port.onmessage=event=>{const data=event.data;if(data.type==='chunk')chunks.push({firstFrame:data.firstFrame,channels:data.channels});else if(data.type==='gap')gaps.push({expectedFrame:data.expectedFrame,receivedFrame:data.receivedFrame,delta:data.delta});else if(data.type==='flushed'||data.type==='armed'){pending.get(data.id)?.();pending.delete(data.id);}};
  async function request(type:'arm'|'flush'){
    signal.throwIfAborted();ensure(!processorError,processorError);const id=++serial;
    await new Promise<void>((resolve,reject)=>{const clean=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);pending.delete(id);},done=()=>{clean();resolve();},abort=()=>{clean();reject(signal.reason);};const timer=setTimeout(()=>{clean();reject(Error(`Le PCM AudioWorklet n’a pas confirmé ${type}.`));},3000);pending.set(id,done);signal.addEventListener('abort',abort,{once:true});node.port.postMessage({type,id});});
  }
  async function flush(){
    await request('flush');
    ensure(!processorError,processorError);ensure(chunks.length>0,'Aucun bloc PCM reçu.');
    const first=chunks[0].firstFrame,last=chunks.at(-1)!,length=last.firstFrame+last.channels[0].length-first;
    // Keep gaps visible and keep every block's original frame stamp. Diagnostic
    // source windows never silence-fill a missing sample or bypass an overlap.
    // The overall gate below STILL fails for any armed-capture discontinuity.
    let continuous=!gaps.length;
    try{captureWindow(chunks,first,first+length);}catch{continuous=false;}
    return {firstFrame:first,chunks:[...chunks],gaps:[...gaps],continuous,chunkCount:chunks.length,frameCount:length};
  }
  return {node,arm:()=>request('arm'),flush,dispose:()=>{node.port.postMessage({type:'stop'});node.disconnect();node.port.onmessage=null;node.port.close();pending.clear();}};
}

async function phaseRun(engine:Engine,context:AudioContext,phase:Phase,commands:Command[],stalls:Stall[],signal:AbortSignal){
  const base=phase==='intro'?0:64.8,cue=phase==='intro'?INTRO:OUTRO-base,end=cue+DURATION+.22;
  const anchor=performance.now(),contextBefore=context.currentTime;let stalled=false,raf=0;
  engine.sync(base,{playing:true,muted:false,discontinuity:true});
  const contextAfter=context.currentTime,firstCommand=commands.at(-1)!;
  ensure(firstCommand?.phase===phase,'La phase ne programme pas sa prochaine insertion.');
  firstCommand.phaseAnchor={contextBefore,contextAfter,cueDelay:cue,earliestWhen:contextBefore+cue,latestWhen:contextAfter+cue};
  ensure(firstCommand.when>=contextBefore+cue-1/context.sampleRate&&firstCommand.when<=contextAfter+cue+1/context.sampleRate,'Placement temporel incorrect : le départ doit suivre l’horloge de phase, à un échantillon près.');
  await new Promise<void>((resolve,reject)=>{
    const clean=()=>{cancelAnimationFrame(raf);signal.removeEventListener('abort',abort);};
    const abort=()=>{clean();reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});
    const tick=()=>{
      try{
        signal.throwIfAborted();ensure(document.visibilityState==='visible','Onglet masqué : recette interrompue, aucune conclusion temporelle.');ensure(context.state==='running','AudioContext suspendu pendant la capture.');
        let elapsed=(performance.now()-anchor)/1000;
        if(!stalled&&elapsed>=cue-.065){
          const command=commands.at(-1)!;ensure(command.phase===phase,'Départ vocal non programmé avant le stall.');
          const beforeContext=context.currentTime,startsBefore=commands.length,started=performance.now();
          while(performance.now()-started<120){/* Deliberate bounded main-thread stall; audio thread must continue. */}
          const afterContext=context.currentTime;stalled=true;
          const stall={phase,beforeContext,afterContext,elapsedMs:performance.now()-started,scheduledWhen:command.when,startsBefore,startsAfter:commands.length};stalls.push(stall);
          ensure(beforeContext<command.when&&afterContext>command.when,'Le stall n’a pas traversé le départ : ce parcours ne peut pas qualifier cette frontière.');
          elapsed=(performance.now()-anchor)/1000;
        }
        engine.sync(base+elapsed,{playing:true,muted:false});
        if(elapsed>=end){ensure(stalled,'Stall non exécuté.');clean();resolve();}else raf=requestAnimationFrame(tick);
      }catch(error){clean();reject(error);}
    };
    raf=requestAnimationFrame(tick);
  });
}

async function comparePcm(capture:{firstFrame:number;channels:Float32Array[]},source:AudioBuffer,command:Command,rate:number,postGain=false,nativeFade=false,guard=Math.round(.02*rate)){
  const floor=Math.floor(command.when*rate),fraction=command.when*rate-floor,length=Math.ceil(DURATION*rate)+guard*2+4;
  const offline=new OfflineAudioContext(2,length,rate),referenceSource=offline.createBufferSource();referenceSource.buffer=source;referenceSource.playbackRate.value=1;
  if(postGain){
    // Independent documented BA voice envelope: 40 ms from -191 dB to 0 dB.
    // Do not read the product's computed plan or reuse its envelope helper.
    const gain=offline.createGain(),when=(guard+fraction)/rate;
    // Set the pre-start value too: fractional source starts are interpolated
    // across the boundary sample. Leaving the default gain=1 until `when`
    // would make this reference create a click that the live graph never had.
    gain.gain.value=nativeFade ? .6*10**(-191/20) : .6;
    gain.gain.setValueAtTime(gain.gain.value,when);
    if(nativeFade)gain.gain.exponentialRampToValueAtTime(.6,when+.04);
    referenceSource.connect(gain);gain.connect(offline.destination);
  }else referenceSource.connect(offline.destination);
  // Independent reference: full source from zero, not the observed command's offset/duration.
  referenceSource.start((guard+fraction)/rate,0,DURATION);const reference=await offline.startRendering();referenceSource.disconnect();
  const base=floor-guard-capture.firstFrame;ensure(base>=1&&base+length+1<capture.channels[0].length,'Fenêtre PCM non entièrement capturée.');
  const measures=(shift:number,start=0,end=length)=>{
    let squared=0,maximum=0,referenceEnergy=0,actualEnergy=0,cross=0;
    for(let channel=0;channel<2;channel++){const expected=reference.getChannelData(channel),actual=capture.channels[channel];for(let index=start;index<end;index++){const a=actual[base+index+shift],b=expected[index],difference=a-b;squared+=difference*difference;maximum=Math.max(maximum,Math.abs(difference));referenceEnergy+=b*b;actualEnergy+=a*a;cross+=a*b;}}
    return {rmse:Math.sqrt(squared/(2*(end-start))),maxAbsoluteError:maximum,energyRatio:referenceEnergy?actualEnergy/referenceEnergy:0,correlation:referenceEnergy&&actualEnergy?cross/Math.sqrt(referenceEnergy*actualEnergy):0};
  };
  const candidates=[-1,0,1].map(shift=>({shift,...measures(shift)})).sort((a,b)=>a.rmse-b.rmse),best=candidates[0];
  ensure(best.rmse<=.000015&&best.maxAbsoluteError<=.00015,`${command.phase} ${rate} Hz : PCM différent de la référence complète (RMS ${best.rmse}, max ${best.maxAbsoluteError}).`);
  const markers=[{name:'head',at:0,duration:.02},{name:'body',at:.06,duration:.06},{name:'tail',at:DURATION-.02,duration:.02}].map(marker=>{
    const start=Math.max(0,Math.floor(guard+fraction+marker.at*rate)-1),end=Math.min(length,Math.ceil(guard+fraction+(marker.at+marker.duration)*rate)+1),metrics=measures(best.shift,start,end);
    ensure(metrics.correlation>=.99999&&Math.abs(metrics.energyRatio-1)<=.0002,`${command.phase} : marqueur ${marker.name} incomplet ou divergent.`);
    return {...marker,framesCompared:end-start,...metrics};
  });
  const bounds=(samples:Float32Array,offset:number)=>{let first=-1,last=-1;for(let index=0;index<length;index++)if(Math.abs(samples[offset+index])>.001){if(first<0)first=index;last=index;}return {first,last};};
  const expected=bounds(reference.getChannelData(0),0),actual=bounds(capture.channels[0],base+best.shift);
  ensure(expected.first>=0&&actual.first>=0,'Marqueurs PCM absents.');
  const missingHeadFrames=Math.max(0,actual.first-expected.first),missingTailFrames=Math.max(0,expected.last-actual.last);
  ensure(missingHeadFrames<=1&&missingTailFrames<=1,'Début ou fin PCM manquant de plus d’un échantillon.');
  return {phase:command.phase,rate,guardFrames:guard,alignmentFrames:best.shift,expectedFirstFrame:floor-guard+expected.first,observedFirstFrame:floor-guard+actual.first+best.shift,expectedLastFrame:floor-guard+expected.last,observedLastFrame:floor-guard+actual.last+best.shift,missingHeadFrames,missingTailFrames,...best,markers};
}

async function qualify(context:AudioContext,requestedRate:number,module:Module,urls:string[],signal:AbortSignal,postGain=false,nativeFade=false){
  ensure(context.sampleRate===requestedRate,`Fréquence demandée ${requestedRate}, obtenue ${context.sampleRate}.`);ensure(context.state==='running','Le contexte doit être déverrouillé par le clic opérateur.');
  const capture=await recorder(context,signal),silence=context.createGain();silence.gain.value=0;silence.connect(context.destination);capture.node.connect(silence);
  // Keep the capture graph pulled between/after finite voice sources. This
  // independent zero signal adds no PCM and remains active through flush;
  // disconnecting a naturally ended voice cannot make the recorder dormant.
  // Dedicated non-silent input is never mixed into the captured voice (input 0).
  // A zero source may be culled when the voice disconnects. Input 1 keeps the
  // qualification worklet continuously pulled, without changing a voice sample.
  const captureClock=context.createConstantSource();captureClock.offset.value=1;captureClock.connect(capture.node,0,1);captureClock.start();
  const engine=new module.AudioEngine({context,baseUrl:location.href});engine.master.disconnect();engine.master.connect(postGain?capture.node:silence);
  const commands:Command[]=[],stalls:Stall[]=[],releaseTaps:(()=>void)[]=[];let phase:Phase='intro',startup:{before:number;after:number;elapsedMs:number;state:AudioContextState}|undefined;const createSource=context.createBufferSource.bind(context);
  context.createBufferSource=()=>{
    const source=createSource();if(!postGain)releaseTaps.push(captureSourceTap(source,capture.node));
    const start=source.start.bind(source),stop=source.stop.bind(source),disconnect=source.disconnect.bind(source);let command:Command|undefined;
    source.start=(when=0,offset=0,duration?:number)=>{ensure(duration!==undefined,'Durée start explicite requise.');command={phase,when,offset,duration,calledAt:context.currentTime,playbackRate:source.playbackRate.value,stops:[],disconnects:[]};commands.push(command);start(when,offset,duration);};
    // Observe topology changes without suppressing, delaying or altering them.
    source.disconnect=((...args:unknown[])=>{command?.disconnects.push({calledAt:context.currentTime});Reflect.apply(disconnect,source,args);}) as typeof source.disconnect;
    source.stop=(when=0)=>{command?.stops.push({when,calledAt:context.currentTime});stop(when);};return source;
  };
  const wav=URL.createObjectURL(syntheticWav());urls.push(wav);
  try{
    await engine.prepare({...module.AUDIO_DEFAULTS,_studio_ba_voice_fit:'fit-complete',_audio_bed_enabled:false,_audio_voice_enabled:true,_audio_voice_url:wav,_audio_voice_gain:postGain ? .6 : 1,_audio_voice_in_seconds:0,_audio_voice_out_seconds:DURATION,_audio_voice_intro_offset_seconds:INTRO,_audio_voice_outro_offset_seconds:OUTRO});signal.throwIfAborted();
    const buffer=engine.buffers.voice.buffer;ensure(buffer.sampleRate===RATE&&buffer.length===DURATION*RATE&&buffer.numberOfChannels===2,'Le vrai chargement doit décoder le WAV en PCM stéréo canonique 48 kHz.');
    status.textContent=`${requestedRate} Hz · attente de progression de l’horloge audio…`;
    engine.sync(0,{playing:false,muted:true});const before=context.currentTime,unlockStarted=performance.now();
    startup={before,after:before,elapsedMs:0,state:context.state};
    try{await engine.unlock();}finally{startup={before,after:context.currentTime,elapsedMs:performance.now()-unlockStarted,state:context.state};}signal.throwIfAborted();
    ensure(startup.after>startup.before&&startup.state==='running','unlock a terminé sans progression réelle de l’horloge audio.');ensure(commands.length===0,'Le déverrouillage à l’arrêt ne doit pas programmer de voix.');
    await capture.arm();signal.throwIfAborted();
    status.textContent=`${requestedRate} Hz réels · capture IN et stall 120 ms…`;await phaseRun(engine,context,'intro',commands,stalls,signal);
    ensure(Number(commands.length)===1,'IN : nombre de départs différent de un.');
    phase='outro';status.textContent=`${requestedRate} Hz réels · saut OUT explicite et stall 120 ms…`;await phaseRun(engine,context,'outro',commands,stalls,signal);
    ensure(Number(commands.length)===2,'OUT : un redémarrage ou un départ supplémentaire a été observé.');ensure(engine.errors.length===0,'Le moteur a signalé une erreur audio.');
    const pcm=await capture.flush();signal.throwIfAborted();
    const measured=[],sourceDiagnostics=[],failures:string[]=[];
    if(!pcm.continuous)failures.push('La capture armée entière est discontinue ; aucune qualification globale.');
    async function measureWindow(command:Command,guard:number){
      const floor=Math.floor(command.when*context.sampleRate),length=Math.ceil(DURATION*context.sampleRate)+2*guard+4;
      const start=floor-guard-2,end=floor-guard+length+2;
      const window=captureWindow(pcm.chunks,start,end);
      return comparePcm(window,buffer,command,context.sampleRate,postGain,nativeFade,guard);
    }
    for(const command of commands){
      ensure(command.when>command.calledAt,'La voix n’a pas été programmée avant son départ.');ensure(command.playbackRate===1,'Vitesse différente de 1.');
      ensure(Math.abs(command.offset)<=1/RATE&&Math.abs(command.offset+command.duration-DURATION)<=1/RATE,'Commande start tronquant la source de plus d’un échantillon.');
      ensure(command.stops.every(stop=>Math.max(stop.when,stop.calledAt)>=command.when+DURATION-1/context.sampleRate),'Arrêt vocal avant la fin du passage.');
      try{measured.push({status:'PASS',...await measureWindow(command,Math.round(.02*context.sampleRate))});}
      catch(error){failures.push(`${command.phase} : ${message(error)}`);measured.push({status:'FAIL',phase:command.phase,error:message(error)});}
      // Separate diagnosis, never a replacement for the strict 20 ms guard or
      // whole-capture gate: examine the COMPLETE source, with 2 sample guards.
      try{sourceDiagnostics.push({status:'PASS',...await measureWindow(command,2)});}
      catch(error){sourceDiagnostics.push({status:'FAIL',phase:command.phase,error:message(error)});}
      signal.throwIfAborted();
    }
    return {status:failures.length?'FAIL':'PASS',failures,requestedRate,actualRate:context.sampleRate,startup,canonicalDecoded:{sampleRate:buffer.sampleRate,frames:buffer.length,channels:buffer.numberOfChannels,duration:buffer.duration},capture:{firstFrame:pcm.firstFrame,frameCount:pcm.frameCount,chunkCount:pcm.chunkCount,continuous:pcm.continuous,gaps:pcm.gaps},commands:commands.map(command=>({...command,headLossSeconds:command.offset,tailLossSeconds:DURATION-command.offset-command.duration})),stalls,pcm:measured,sourceDiagnostics};
  }catch(error){throw Object.assign(Error(message(error)),{qualification:{status:'FAIL',requestedRate,actualRate:context.sampleRate,startup,error:message(error),commands,stalls,engineErrors:engine.errors}});}
  finally{engine.stop();await engine.dispose();context.createBufferSource=createSource;for(const release of releaseTaps)release();captureClock.stop();captureClock.disconnect();capture.dispose();silence.disconnect();}
}

/** Independent control: two native AudioBufferSource insertions, no BA adapter,
 * no sync/rescheduling at frame boundaries. Never counts as product evidence. */
function baselineModule(disconnectOnEnd=false,perSourceGain=false):Module{
  class Baseline implements Engine {
    master:GainNode;buffers={} as Engine['buffers'];errors:unknown[]=[];
    private sources:AudioBufferSourceNode[]=[];
    private gains:GainNode[]=[];
    private volume=1;
    private pendingCleanup:{source:AudioBufferSourceNode;gain:GainNode;mainOut:number;contextOut:number}|undefined;
    constructor(private options:{context:AudioContext;baseUrl:string}){this.master=options.context.createGain();this.master.connect(options.context.destination);}
    async prepare(data:Record<string,unknown>){const response=await fetch(String(data._audio_voice_url));const offline=new OfflineAudioContext(2,1,48000);this.buffers={voice:{buffer:await offline.decodeAudioData(await response.arrayBuffer())}};this.volume=Number(data._audio_voice_gain);this.master.gain.value=perSourceGain?1:this.volume;}
    async unlock(){const context=this.options.context,before=context.currentTime,start=performance.now();await context.resume();while(context.currentTime<=before){if(performance.now()-start>3000)throw Error('Horloge native immobile.');await new Promise(resolve=>setTimeout(resolve,10));}}
    sync(seconds:number,options:{playing:boolean;muted:boolean;discontinuity?:boolean}){
      if(perSourceGain){
        this.master.gain.value=options.playing&&!options.muted?1:0;
        const pending=this.pendingCleanup;
        if(pending&&seconds>=pending.mainOut&&this.options.context.currentTime>=pending.contextOut){pending.source.stop();pending.source.disconnect();pending.gain.disconnect();this.pendingCleanup=undefined;}
      }
      if(!options.playing||options.muted||!options.discontinuity)return;
      const context=this.options.context,source=context.createBufferSource(),when=context.currentTime+(seconds>=64.8?OUTRO-seconds:INTRO);source.buffer=this.buffers.voice.buffer;
      const gain=perSourceGain?context.createGain():undefined;
      if(gain){gain.gain.value=this.volume*10**(-191/20);gain.gain.setValueAtTime(gain.gain.value,when);gain.gain.exponentialRampToValueAtTime(this.volume,when+.04);source.connect(gain);gain.connect(this.master);this.gains.push(gain);}else source.connect(this.master);
      if(disconnectOnEnd)source.onended=()=>{source.disconnect();gain?.disconnect();};
      if(gain)this.pendingCleanup={source,gain,mainOut:(seconds>=64.8?OUTRO:INTRO)+DURATION,contextOut:when+DURATION};
      source.start(when,0,DURATION);this.sources.push(source);
    }
    stop(){for(const source of this.sources){try{source.stop();}catch{}source.disconnect();}this.sources=[];for(const gain of this.gains)gain.disconnect();this.gains=[];}
    async dispose(){this.stop();this.master.disconnect();}
  }
  return {AudioEngine:Baseline,AUDIO_DEFAULTS:{}};
}

async function run(portable:boolean|'baseline'|'baseline-disconnect'|'baseline-gain'){
  if(controller)return;controller=new AbortController();const signal=controller.signal,urls:string[]=[],contexts:AudioContext[]=[],records:unknown[]=[];let identity:Record<string,unknown>={};const started=performance.now(),postGain=postGainControl.checked;postGainControl.disabled=true;
  runButton.disabled=portableButton.disabled=baselineButton.disabled=disconnectButton.disabled=gainButton.disabled=true;cancelButton.disabled=false;result.textContent='';
  let failure='';
  try{
    ensure(location.origin===ORIGIN,'Recette réservée au serveur local 127.0.0.1:5198.');ensure(window.isSecureContext&&typeof AudioWorkletNode==='function','AudioWorklet sécurisé indisponible.');
    // Both contexts are created and resumed synchronously within this user gesture.
    const resumes=[44100,48000].map(rate=>{const context=new AudioContext({sampleRate:rate});contexts.push(context);return context.resume();});await Promise.all(resumes);
    const loaded=typeof portable==='string'?{module:baselineModule(portable!=='baseline',portable==='baseline-gain'),identity:{profile:portable,scope:'Diagnostic navigateur indépendant, aucun moteur de production.',disconnectOnEnd:portable!=='baseline',perSourceGain:portable==='baseline-gain',postEndedFrameCleanup:portable==='baseline-gain'}}:await loadModule(portable,signal);identity=loaded.identity;
    for(let index=0;index<contexts.length;index++){signal.throwIfAborted();const record=await qualify(contexts[index],[44100,48000][index],loaded.module,urls,signal,postGain,typeof portable!=='string'||portable==='baseline-gain');records.push(record);if(record.status==='FAIL')failure='Échec de la capture stricte. Les fenêtres vocales sont diagnostiquées séparément, sans valider le moteur.';await contexts[index].close();result.textContent=JSON.stringify(records,null,2);}
  }catch(error){failure=signal.aborted?'Recette annulée.':message(error);if(error&&typeof error==='object'&&'qualification'in error)records.push(error.qualification);}
  finally{
    for(const context of contexts)if(context.state!=='closed')await context.close().catch(()=>undefined);
    for(const url of urls)URL.revokeObjectURL(url);
    const report={scope:postGain?'Émission PCM réelle après volume 0,6 et fondu natif. Signal synthétique uniquement ; aucun contrôle éditorial ou haut-parleur.':'Émission PCM réelle AudioContext/AudioWorklet avant gain. Signal synthétique uniquement, sans preuve d’audibilité après fondu ni qualification éditoriale.',captureTopology:postGain?'Une seule branche master → capture → sortie muette. Aucune dérivation ni modification des connexions des sources. Start/stop observés sans changement.':'Tap avant gain indépendant ; déconnexions de toutes les destinations du moteur transmises, branche de mesure conservée jusqu’au flush. Aucun start/stop/gain modifié.',status:failure?'FAIL':'PASS',error:failure||undefined,module:identity,elapsedMs:Math.round(performance.now()-started),reference:'OfflineAudioContext indépendant au taux réel ; source entière 0..3.6s à vitesse1 ; alignement limité à ±1 frame.',limits:{maxAlignmentFrames:1,maxMissingHeadOrTailFrames:1,maxRmse:.000015,maxAbsoluteError:.00015},records};
    result.textContent=JSON.stringify(report,null,2);
    if(!signal.aborted&&location.origin===ORIGIN){
      try{const path=`/__social-evidence/ba-audio-clock-${Date.now()}.json`,saved=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2),signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});ensure(saved.ok,`Rapport local non enregistré (HTTP ${saved.status}).`);status.textContent=failure?`FAIL — ${failure} Rapport JSON local : ${path}`:`PASS — deux taux, IN/OUT complets sous stall. Rapport JSON local : ${path}`;}
      catch(error){status.textContent=`${failure?'FAIL':'PCM PASS, sauvegarde FAIL'} — ${failure||message(error)}`;}
    }else status.textContent=failure||'Recette terminée.';
    controller=undefined;runButton.disabled=portableButton.disabled=baselineButton.disabled=disconnectButton.disabled=gainButton.disabled=postGainControl.disabled=false;cancelButton.disabled=true;
  }
}
runButton.addEventListener('click',()=>void run(false));portableButton.addEventListener('click',()=>void run(true));
baselineButton.addEventListener('click',()=>void run('baseline'));
disconnectButton.addEventListener('click',()=>void run('baseline-disconnect'));
gainButton.addEventListener('click',()=>void run('baseline-gain'));
cancelButton.addEventListener('click',()=>controller?.abort(new DOMException('Recette annulée.','AbortError')));
window.addEventListener('pagehide',()=>controller?.abort(new DOMException('Page fermée.','AbortError')));
