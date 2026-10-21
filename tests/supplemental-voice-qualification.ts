import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import type {BroadcastTemplate,ProjectData} from '../src/studio/domain';
import {engineData} from '../src/studio/presentation';
import {studioEngineModule} from '../src/studio/text-editing';
import {installSupplementalVoice} from '../src/studio/supplemental-voice';
import {hasSupplementalVoice} from '../src/studio/voice-fields';
import {prepareGraphic} from '../src/studio/video/engine';
import type {LegacyGraphic} from '../src/studio/video/engine';
import {audioEvents,mixAudio} from '../src/studio/video/audio';
import {TIMINGS} from '../src/studio/video/timeline';
import {captureWindow} from './pcm-capture-window';
import {installTypography} from '../src/studio/typography-engine';
import {installGraphicCompatibility} from '../src/studio/graphic-compatibility';

// Qualification-only: actual AudioWorklet capture after the product voice gain,
// compared with an independently constructed, quantized PCM signal.
const RATE=48000,START=.2,END=1,DELAY=.4,GAIN=.6,DURATION=END-START;
const button=document.querySelector<HTMLButtonElement>('#run')!,mixButton=document.querySelector<HTMLButtonElement>('#mix')!,cancel=document.querySelector<HTMLButtonElement>('#cancel')!,status=document.querySelector('#status')!,result=document.querySelector('#result')!,scene=document.querySelector('#scene')!;
let controller:AbortController|undefined;
function ensure(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function wait(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{signal.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});}
async function until(check:()=>boolean,signal:AbortSignal){const end=performance.now()+15000;while(!check()){ensure(performance.now()<end,'Délai de lecture dépassé.');await wait(20,signal);}}
function sample(frame:number,channel:number){const time=frame/RATE,hz=time<.22?500:time>.98?1500:750,value=.4*Math.cos(2*Math.PI*hz*time)*(channel?-.8:1);return Math.round(value*32767)/32768;}
function signalWav(){
  const frames=RATE*1.2,bytes=new ArrayBuffer(44+frames*4),view=new DataView(bytes),text=(at:number,s:string)=>[...s].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
  text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,RATE,true);view.setUint32(28,RATE*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,frames*4,true);
  for(let n=0;n<frames;n++)for(let c=0;c<2;c++)view.setInt16(44+n*4+c*2,sample(n,c)*32768,true);
  return new Blob([bytes],{type:'audio/wav'});
}
function settings(template:BroadcastTemplate,url:string):ProjectData{
  const data=templateDefaults(template);
  for(const key of Object.keys(data)){
    if(/_audio.*enabled$/.test(key))data[key]=false;
    if(/^_media_.+_sequence$/.test(key))data[key]='[]';
    if(/^_media_.+_url$/.test(key)&&data[key]){const prefix=key.slice(0,-4);data[key]='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';if(prefix+'_start_seconds'in data)data[prefix+'_start_seconds']=0;if(prefix+'_end_seconds'in data)data[prefix+'_end_seconds']=40;if(prefix+'_rate'in data)data[prefix+'_rate']=1;}
  }
  if(template.id==='BTV_Passerelle_Replay')data._replay_url='https://srtb.bj';
  return {...data,_out_mode:'manual',_audio_voice_enabled:true,_audio_voice_url:url,_audio_voice_start_seconds:START,_audio_voice_end_seconds:END,_audio_voice_delay_seconds:DELAY,_audio_voice_volume:GAIN};
}
type Chunk={firstFrame:number;channels:Float32Array[]};
async function recorder(context:AudioContext,signal:AbortSignal){
  await context.audioWorklet.addModule('/tests/ba-audio-clock-capture.js');signal.throwIfAborted();
  const node=new AudioWorkletNode(context,'ba-qualification-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit'}),chunks:Chunk[]=[],gaps:{expectedFrame:number;receivedFrame:number;delta:number}[]=[],pending=new Map<number,()=>void>();let serial=0,error='';
  node.onprocessorerror=()=>{error='Erreur du processeur PCM.';};node.port.onmessage=({data})=>{if(data.type==='chunk')chunks.push(data);else if(data.type==='gap')gaps.push(data);else if(data.type==='flushed'||data.type==='armed'){pending.get(data.id)?.();pending.delete(data.id);}};
  async function request(type:'arm'|'flush'){
    signal.throwIfAborted();ensure(!error,error);const id=++serial;
    await new Promise<void>((resolve,reject)=>{const clean=()=>{clearTimeout(timer);pending.delete(id);signal.removeEventListener('abort',abort);},abort=()=>{clean();reject(signal.reason);},timer=setTimeout(()=>{clean();reject(Error('Capture PCM sans réponse.'));},3000);pending.set(id,()=>{clean();resolve();});signal.addEventListener('abort',abort,{once:true});node.port.postMessage({type,id});});
  }
  return {node,gaps,arm:()=>request('arm'),flush:async()=>{
    await request('flush');ensure(!error,error);ensure(chunks.length,'PCM absent.');return {chunks:[...chunks],gaps:[...gaps]};
  },dispose:()=>{node.port.postMessage({type:'stop'});node.disconnect();node.port.onmessage=null;node.port.close();pending.clear();}};
}
async function reference(rate:number,when:number,duration:number){
  const context=new OfflineAudioContext(2,Math.ceil(duration*rate),rate),buffer=context.createBuffer(2,RATE*1.2,RATE);
  for(let c=0;c<2;c++){const channel=buffer.getChannelData(c);for(let n=0;n<channel.length;n++)channel[n]=sample(n,c);}
  const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;gain.gain.value=GAIN;source.connect(gain);gain.connect(context.destination);source.start(when,START,DURATION);return context.startRendering();
}
function compare(actual:Float32Array[],expected:AudioBuffer,base:number,allowShift=false,label='export'){
  const length=expected.length;ensure(base>=1&&base+length+1<=actual[0].length,'Fenêtre PCM incomplète.');
  const metrics=(shift:number)=>{let max=0,squared=0,first=-1,last=-1,refFirst=-1,refLast=-1,worst:unknown;for(let c=0;c<2;c++){const e=expected.getChannelData(c);for(let n=0;n<length;n++){const a=actual[c][base+n+shift],b=e[n],d=a-b;if(Math.abs(d)>max){max=Math.abs(d);worst={channel:c,index:n,seconds:n/expected.sampleRate,actual:a,expected:b};}squared+=d*d;if(c===0){if(Math.abs(a)>.001){if(first<0)first=n;last=n;}if(Math.abs(b)>.001){if(refFirst<0)refFirst=n;refLast=n;}}}}return {shift,max,rmse:Math.sqrt(squared/(length*2)),missingHead:Math.max(0,first-refFirst),missingTail:Math.max(0,refLast-last),worst};};
  const best=(allowShift?[-1,0,1]:[0]).map(metrics).sort((a,b)=>a.rmse-b.rmse)[0];ensure(best.max<=.00015&&best.rmse<=.000015&&best.missingHead<=1&&best.missingTail<=1,`${label} PCM divergent : ${JSON.stringify(best)}`);return best;
}
async function qualify(template:BroadcastTemplate,context:AudioContext,url:string,signal:AbortSignal){
  const data=settings(template,url),module=await import(/* @vite-ignore */studioEngineModule(template)),tag='voice-qa-'+template.id.toLowerCase().replaceAll('_','-');if(!customElements.get(tag))customElements.define(tag,class extends module.default{});
  // Diagnostic topology: keep the captured input itself connected to a silent
  // continuous source when a finite source disconnects. Every discontinuity is
  // reported; the comparison rejects gaps in its guarded window and all
  // overlaps. No missing PCM is invented and no comparison tolerance relaxed.
  // The capture worklet itself writes zeros to its output; no test tone is
  // sent to the speakers and no extra graph node is required for monitoring.
  const graphic=document.createElement(tag) as LegacyGraphic,capture=await recorder(context,signal),clock=context.createConstantSource(),captureBus=context.createGain();clock.offset.value=0;clock.connect(captureBus);captureBus.connect(capture.node);capture.node.connect(context.destination);clock.start();
  const commands:{when:number;offset:number;duration:number;calledAt:number}[]=[],create=context.createBufferSource.bind(context);context.createBufferSource=()=>{const source=create(),start=source.start.bind(source);source.start=(when=0,offset=0,duration?:number)=>{ensure(duration!==undefined,'Durée vocale manquante.');commands.push({when,offset,duration,calledAt:context.currentTime});start(when,offset,duration);};return source;};
  const voice=installSupplementalVoice(graphic,template,{context,destination:captureBus,signal})!;
  // Match Preview's adapter order: studio-only typography/logo fields must not
  // leak into strict native schemas (notably Ce soir and signature engines).
  installGraphicCompatibility(graphic,{...template,module:new URL(template.module,document.baseURI).href});
  installTypography(graphic,template,data);scene.append(graphic);let playError:unknown;
  let anchor:{before:number;after:number;seconds:number}|undefined;
  const nativeAnchor=TIMINGS[template.id].kind==='signature'?'_tick':'_playMarker',originalAnchor=graphic[nativeAnchor].bind(graphic);
  graphic[nativeAnchor]=(...args:any[])=>{const before=context.currentTime,count=commands.length,seconds=nativeAnchor==='_tick'?Number(graphic.elapsed||0):0;const response=originalAnchor(...args);if(commands.length>count)anchor={before,after:context.currentTime,seconds};return response;};
  try{
    status.textContent=template.name+' · chargement du vrai moteur';const loaded=await graphic.load({renderType:'realtime',previewMuted:false,data:engineData(data,true)});ensure(!(loaded?.statusCode>=400),loaded?.statusMessage||'Chargement refusé');ensure(voice.prepared,'Voix non préparée.');
    await capture.arm();status.textContent=template.name+' · capture audio réelle';void graphic.playAction().catch((e:unknown)=>{playError=e;});await voice.activation;await until(()=>commands.length>0||!!playError,signal);if(playError)throw playError;
    ensure(commands.length===1,'La voix doit être programmée exactement une fois.');const command=commands[0];ensure(Math.abs(command.offset-START)<1/RATE&&Math.abs(command.duration-DURATION)<1/RATE,'Passage vocal mal calé.');ensure(anchor,'Ancrage natif non observé.');const cue=Math.max(0,DELAY-anchor.seconds);ensure(command.when>=anchor.before+cue-1/RATE&&command.when<=anchor.after+cue+1/RATE,'Délai vocal hors de l’intervalle de l’ancrage natif.');
    await until(()=>context.currentTime>command.when+DURATION+.15,signal);const captured=await capture.flush();ensure(commands.length===1,'Redépart vocal inattendu.');const guard=.03,baseFrame=Math.floor((command.when-guard)*RATE),referenceWhen=command.when-baseFrame/RATE,expected=await reference(RATE,referenceWhen,DURATION+.07),pcm=captureWindow(captured.chunks,baseFrame-1,baseFrame+expected.length+1);
    const preview=compare(pcm.channels,expected,baseFrame-pcm.firstFrame,true,'aperçu');result.textContent=JSON.stringify({template:template.id,preview},null,2);await graphic.stopAction({skipAnimation:true});
    status.textContent=template.name+' · comparaison au mixage d’export';const prepared=await prepareGraphic(template,data,12,false,signal);
    try{const events=audioEvents(prepared,template.id,false);ensure(events.length===1,'Une piste non demandée participe au mix.');const mixed=await mixAudio(events,prepared.timeline.duration,signal,()=>{}),expectedMix=await reference(RATE,DELAY,prepared.timeline.duration);
      // Offset by one silent sample on both sides to retain the same comparison
      // bounds invariant as the real capture. No alignment permitted offline.
      const padded=Array.from({length:2},(_,c)=>{const out=new Float32Array(mixed.buffer.length+2);out.set(mixed.buffer.getChannelData(c),1);return out;});const exported=compare(padded,expectedMix,1);ensure(mixed.audible,'Mix muet.');
      return {template:template.id,status:'PASS',actualRate:context.sampleRate,captureTopology:'one-continuously-driven-input-bus',capture:{measuredFirstFrame:pcm.firstFrame,measuredFrames:pcm.channels[0].length,measuredWindowContinuous:true,wholeCaptureContinuous:captured.gaps.length===0,gapsOutsideMeasuredWindow:captured.gaps},command,anchor,preview,exported,peak:mixed.peak,events:events.length};
    }finally{await prepared.dispose();}
  }catch(reason){throw Object.assign(Error(reason instanceof Error?reason.message:String(reason)),{qualification:{template:template.id,status:'FAIL',commands,anchor,captureGaps:capture.gaps}});}
  finally{context.createBufferSource=create;await graphic.dispose();graphic.remove();clock.stop();clock.disconnect();captureBus.disconnect();capture.dispose();}
}
async function qualifyMix(template:BroadcastTemplate,url:string,signal:AbortSignal){
  status.textContent=template.name+' · mixage d’export seul';const prepared=await prepareGraphic(template,settings(template,url),12,false,signal);
  try{const events=audioEvents(prepared,template.id,false);ensure(events.length===1,'Piste non demandée.');const mixed=await mixAudio(events,prepared.timeline.duration,signal,()=>{}),expected=await reference(RATE,DELAY,prepared.timeline.duration),padded=Array.from({length:2},(_,c)=>{const out=new Float32Array(mixed.buffer.length+2);out.set(mixed.buffer.getChannelData(c),1);return out;});ensure(mixed.audible,'Mix muet.');return {template:template.id,status:'PASS',scope:'Mix PCM export uniquement',exported:compare(padded,expected,1),peak:mixed.peak,events:events.length};}finally{await prepared.dispose();}
}
async function run(offlineOnly=false){
  if(controller)return;controller=new AbortController();const signal=controller.signal,records:unknown[]=[],url=URL.createObjectURL(signalWav());button.disabled=mixButton.disabled=true;cancel.disabled=false;const started=performance.now();let error='';result.textContent='';
  // Preview owns one context per loaded model. Do not reuse a test context
  // across independently disposed engines and their graph mutations.
  let context:AudioContext|undefined=offlineOnly?undefined:new AudioContext({sampleRate:RATE});
  const firstResume=context?.resume();
  try{ensure(location.hostname==='127.0.0.1','Banc limité au serveur local.');await firstResume;for(const template of broadcastTemplates.filter(hasSupplementalVoice)){
    signal.throwIfAborted();
    if(offlineOnly)records.push(await qualifyMix(template,url,signal));
    else{context??=new AudioContext({sampleRate:RATE});await context.resume();ensure(context.sampleRate===RATE,'Fréquence audio inattendue.');try{records.push(await qualify(template,context,url,signal));}catch(reason){error=reason instanceof Error?reason.message:String(reason);records.push(reason&&typeof reason==='object'&&'qualification'in reason?{...reason.qualification as object,error}:{template:template.id,status:'FAIL',error});}finally{await context.close();context=undefined;}}
    result.textContent=JSON.stringify(records,null,2);
  }}
  catch(reason){error=reason instanceof Error?reason.message:String(reason);if(reason&&typeof reason==='object'&&'qualification'in reason)records.push(reason.qualification);}
  finally{if(context)await context.close();URL.revokeObjectURL(url);const count=broadcastTemplates.filter(hasSupplementalVoice).length,scope=offlineOnly?`${count} moteurs TV : mix PCM d’export seulement, aperçu non testé.`:`${count} moteurs TV, voix seule : vrai chargement, calage, gain, PCM aperçu et mix export ; un contexte audio par aperçu. Signal capturé puis coupé avant les haut-parleurs.`;const report={status:error?'FAIL':'PASS',error:error||undefined,scope:scope+' Aucun codec vidéo ni norme loudness qualifié.',elapsedMs:Math.round(performance.now()-started),records};result.textContent=JSON.stringify(report,null,2);status.textContent=(error?'FAIL · '+error:offlineOnly?`PASS · ${count} mixages d’export seuls`:`PASS · ${count} moteurs, aperçu et mix export`);
    if(!signal.aborted&&location.port==='5198'){try{const path='/__social-evidence/supplemental-voice-'+Date.now()+'.json',saved=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2),signal:AbortSignal.timeout(5000)});ensure(saved.ok,'Rapport non enregistré.');status.textContent+=' · '+path;}catch(reason){status.textContent+=' · '+String(reason);}}
    controller=undefined;button.disabled=mixButton.disabled=false;cancel.disabled=true;
  }
}
button.onclick=()=>void run();mixButton.onclick=()=>void run(true);
cancel.onclick=()=>controller?.abort(new DOMException('Annulé','AbortError'));
window.addEventListener('pagehide',()=>controller?.abort(new DOMException('Page fermée','AbortError')));
