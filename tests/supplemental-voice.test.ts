import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {supplementalVoiceTemplates} from '../src/studio/voice-fields';
import {stripSupplementalVoice,supplementalVoicePlan,assertSupplementalVoiceFits,loadSupplementalVoice,SupplementalVoicePlayer,installSupplementalVoice} from '../src/studio/supplemental-voice';
import type {LegacyGraphic} from '../src/studio/video/engine';
import type {ProjectData} from '../src/studio/domain';

const template={id:'BTV_PopUp',libraryVersion:'1.7.0'};
const data:ProjectData={_audio_voice_enabled:true,_audio_voice_url:'voice.wav',_audio_voice_start_seconds:.125,_audio_voice_end_seconds:3.725,_audio_voice_delay_seconds:.76321,_audio_voice_volume:.4,_out_mode:'manual',_out_duration_seconds:12};
const buffer={duration:5,sampleRate:48000,length:240000,numberOfChannels:2} as AudioBuffer;
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9,`${a} differs from ${b}`);
class Source {
  buffer:unknown;playbackRate={value:1};onended:(()=>void)|null=null;stops=0;disconnected=false;call?:{when:number;offset:number;duration:number;rate:number};
  connect(_node:unknown){}disconnect(){this.disconnected=true;}
  start(when:number,offset:number,duration:number){assert.equal(this.call,undefined);this.call={when,offset,duration,rate:this.playbackRate.value};}
  stop(){this.stops++;}
}
class Gain {gain={value:1};connect(_node:unknown){}disconnect(){}}
class Context {
  time=100;auto=false;state:'running'|'suspended'|'closed'='running';destination={};sources:Source[]=[];sampleRate=44100;closed=false;
  get currentTime(){if(this.auto)this.time+=.001;return this.time;}
  createGain(){return new Gain();}createBufferSource(){const node=new Source();this.sources.push(node);return node;}
  async resume(){this.state='running';}async close(){this.closed=true;this.state='closed';}
}
const prepared=(overrides:ProjectData={})=>({buffer,plan:supplementalVoicePlan(template,{...data,...overrides},buffer)!});

for(const id of supplementalVoiceTemplates)test(`${id}: exactly six voice fields are separated from frozen engine data`,()=>{
  const original:ProjectData={...data,_audio_bed_enabled:true,_audio_bed_volume:.7,_titre:'Texte'};
  const clean=stripSupplementalVoice({...template,id},original);
  assert.equal(Object.keys(clean).filter(key=>key.startsWith('_audio_voice_')).length,0);assert.equal(clean._audio_bed_volume,.7);assert.equal(original._audio_voice_enabled,true);
});
for(const id of ['BTV_BA_1P','BTV_BA_TDS'])test(`${id}: native voice data is untouched and no second plan exists`,()=>{
  assert.equal(stripSupplementalVoice({...template,id},data),data);assert.equal(supplementalVoicePlan({...template,id},data,buffer),null);
});
test('disabled voice is a strict no-op even when stale URL/range is unavailable',async()=>{
  assert.equal(supplementalVoicePlan(template,{...data,_audio_voice_enabled:false,_audio_voice_end_seconds:99},buffer),null);
  assert.equal(await loadSupplementalVoice(template,{...data,_audio_voice_enabled:false},new AbortController().signal),undefined);
});
test('fractional source passage, arbitrary fractional delay and volume are preserved without frame rounding',()=>{
  const plan=prepared().plan;assert.deepEqual(plan,{url:'voice.wav',start:.125,end:3.725,duration:3.6,delay:.76321,volume:.4});
});
test('end zero resolves to decoded canonical duration, never container metadata',()=>{
  const plan=prepared({_audio_voice_end_seconds:0}).plan;assert.equal(plan.end,5);assert.equal(plan.duration,4.875);
});
test('invalid, backward, empty and out-of-file passages fail; no silent clipping',()=>{
  const patches:ProjectData[]=[{_audio_voice_start_seconds:4,_audio_voice_end_seconds:3},{_audio_voice_start_seconds:5},{_audio_voice_end_seconds:5.001},{_audio_voice_delay_seconds:-.1},{_audio_voice_volume:1.1},{_audio_voice_url:''},{_audio_voice_start_seconds:NaN},{_audio_voice_enabled:'banana'}];
  for(const patch of patches)assert.throws(()=>prepared(patch));
  assert.throws(()=>supplementalVoicePlan(template,data,{duration:5,sampleRate:44100}),/48/);
});
test('one canonical sample tolerance is bounded and never rewrites selected end',()=>{
  const end=5+1/48000,plan=prepared({_audio_voice_end_seconds:end}).plan;assert.equal(plan.end,end);assert.throws(()=>prepared({_audio_voice_end_seconds:5+2/48000}));
});
test('programme fit excludes terminal hold and refuses rather than truncating whole voice',()=>{
  const plan=prepared({_audio_voice_delay_seconds:.6}).plan;assert.throws(()=>assertSupplementalVoiceFits(plan,4.04),/Aucun son n’a été coupé/);assert.doesNotThrow(()=>assertSupplementalVoiceFits(plan,4.2));assert.equal(plan.duration,3.6);
});
for(const rate of [44100,48000])test(`player ${rate}: complete future source survives stall and naturally ends without stop`,()=>{
  const context=new Context();context.sampleRate=rate;const player=new SupplementalVoicePlayer(context as unknown as AudioContext,context.destination as AudioNode,prepared());
  player.start(0);const source=context.sources[0],call=source.call!;close(call.when,100.76321);close(call.offset,.125);close(call.duration,3.6);assert.equal(call.rate,1);
  context.time=100.89;assert.equal(context.sources.length,1);assert.equal(source.stops,0);
  context.time=call.when+call.duration-24/rate;assert.equal(player.finish(),true);assert.equal(source.stops,0);source.onended?.();assert.equal(source.disconnected,true);player.dispose();assert.equal(source.stops,0);
});
test('pause cancels a future start, resume uses output elapsed and exact source offset',()=>{
  const context=new Context(),player=new SupplementalVoicePlayer(context as unknown as AudioContext,context.destination as AudioNode,prepared());
  player.start(0);player.stop();assert.equal(context.sources[0].stops,1);context.time=120;player.start(1.5);
  const call=context.sources[1].call!;close(call.when,120);close(call.offset,.125+1.5-.76321);close(call.duration,3.6-(1.5-.76321));player.dispose();assert.equal(context.sources[1].stops,1);
});
test('seek after voice end produces no new source; explicit early finish reports interruption',()=>{
  const context=new Context(),player=new SupplementalVoicePlayer(context as unknown as AudioContext,context.destination as AudioNode,prepared());
  player.start(9);assert.equal(context.sources.length,0);player.start(0);assert.equal(player.finish(),false);assert.equal(context.sources[0].stops,1);
});

function browserMocks(t:test.TestContext,decoded:AudioBuffer=buffer){
  let decodes=0;
  t.mock.property(globalThis,'document',{baseURI:'https://local.invalid/package/index.html'} as Document);
  t.mock.property(globalThis,'location',{origin:'https://local.invalid'} as Location);
  class Offline {constructor(public channels:number,public frames:number,public sampleRate:number){assert.equal(sampleRate,48000);}async decodeAudioData(_bytes:ArrayBuffer){decodes++;return decoded;}}
  t.mock.property(globalThis,'OfflineAudioContext',Offline as unknown as typeof OfflineAudioContext);
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/wav'}}));
  return {get decodes(){return decodes;}};
}
// MockTracker.property requires an existing property on some supported Node
// versions. Define only these absent browser names, and restore per test.
for(const key of ['document','location','OfflineAudioContext'])if(!(key in globalThis))Object.defineProperty(globalThis,key,{value:undefined,writable:true,configurable:true});
test('real loader path fetches same-origin audio, decodes once at48k and validates range',async t=>{
  const mocks=browserMocks(t),value=await loadSupplementalVoice(template,data,new AbortController().signal);assert.equal(value?.buffer,buffer);assert.equal(mocks.decodes,1);
});
test('loader refuses cross-origin, fake image descriptor, bad MIME, overlimit and abort',async t=>{
  browserMocks(t);const signal=new AbortController().signal;
  await assert.rejects(loadSupplementalVoice(template,{...data,_audio_voice_url:'https://outside.invalid/v.wav'},signal),/même paquet/);
  await assert.rejects(loadSupplementalVoice(template,{...data,_audio_voice_url:{url:'voice.wav',mimeType:'image/png'} as any},signal),/audio/);
  t.mock.method(globalThis,'fetch',async()=>new Response('login',{headers:{'Content-Type':'text/html'}}));await assert.rejects(loadSupplementalVoice(template,data,signal),/format non audio/);
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array([1]),{headers:{'Content-Type':'audio/wav','Content-Length':String(33*1024**2)}}));await assert.rejects(loadSupplementalVoice(template,data,signal),/32 Mo/);
  const controller=new AbortController();controller.abort();await assert.rejects(loadSupplementalVoice(template,data,controller.signal),{name:'AbortError'});
});
class Graphic extends EventTarget {
  [key:string]:any;
  running=false;elapsed=0;phase='ready';muted=false;tracks={};state={};_chain=Promise.resolve();seen:ProjectData[]=[];anchor?:()=>Promise<void>;
  async load(args:{data:ProjectData}){this.seen.push(args.data);assert.equal('_audio_voice_enabled'in args.data,false);return {};}
  async updateAction(value:ProjectData){this.seen.push(value);assert.equal('_audio_voice_enabled'in value,false);return {};}
  playAction(){this._chain=Promise.resolve().then(async()=>{await this.anchor?.();this.running=true;this._tick();});return this._chain;}
  _tick(){} _playMarker(_name:string,_args:unknown){}
  async stopAction(){this.running=false;return {};}
  async pauseAction(){this.running=false;return {};}
  async goToTime(){this.running=false;return {};}
  async setMuted(value:boolean){this.muted=value;return {};}
  async dispose(){return {};}
}
test('adapter starts at native anchor after preparation, not on play click or next RAF',async t=>{
  browserMocks(t);const g=new Graphic(),context=new Context();context.auto=true;let release!:()=>void;g.anchor=()=>new Promise<void>(resolve=>{release=resolve;});
  const control=installSupplementalVoice(g as unknown as LegacyGraphic,{...template,id:'BTV_Ce_Soir'},{context:context as unknown as AudioContext})!;
  await g.load({data});const playback=g.playAction();await control.activation;await Promise.resolve();assert.equal(context.sources.length,0);release();await playback;
  assert.equal(context.sources.length,1);close(context.sources[0].call!.offset,.125);g._tick();g._tick();assert.equal(context.sources.length,1);await g.dispose();assert.equal(context.closed,false);
});
test('adapter inspection is silent; pause cancels pending source; resume uses requested output time',async t=>{
  browserMocks(t);const g=new Graphic(),context=new Context();context.auto=true;
  const control=installSupplementalVoice(g as unknown as LegacyGraphic,{...template,id:'BTV_Ce_Soir'},{context:context as unknown as AudioContext})!;
  await g.load({data});await g.goToTime();assert.equal(context.sources.length,0);await g.playAction();await g.pauseAction();assert.equal(context.sources[0].stops,1);
  await control.resume(1.25);close(context.sources[1].call!.offset,.125+1.25-.76321);await g.dispose();
});
test('Ce soir opening is independent, cached on edits and never replayed after its end',async t=>{
  const mocks=browserMocks(t,{...buffer,duration:30,length:1440000});
  const g=new Graphic(),context=new Context();context.auto=true;
  const control=installSupplementalVoice(g as unknown as LegacyGraphic,{...template,id:'BTV_Ce_Soir'},{context:context as unknown as AudioContext})!;
  await g.load({data:{...data,_audio_signature_enabled:true,_audio_signature_url:'opening.wav',_audio_signature_volume:.5}});
  assert.equal(mocks.decodes,2);assert.equal(g.seen[0]._audio_signature_enabled,undefined);
  await g.playAction();assert.equal(context.sources.length,2);assert.equal(context.sources[1].call?.offset,0);assert.equal(context.sources[1].call?.duration,9.68);
  await g.pauseAction();assert.equal(context.sources[1].stops,1);
  await g.updateAction({_studio_ce_soir_background:'or',_audio_signature_volume:.25});
  assert.equal(mocks.decodes,3,'only voice is fetched again; the fixed signature buffer is reused');assert.equal(control.signature?.plan.volume,.25);
  await control.resume(10);assert.equal(context.sources.length,2,'neither completed track restarts at OUT');
  await g.updateAction({_audio_signature_enabled:false});assert.equal(control.signature,undefined);assert.ok(control.prepared);
  await g.dispose();assert.equal(control.signature,undefined);
});
for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier'])test(`${id}: AE playing clock starts one voice at IN, cancels on pause and resumes at the source offset`,async t=>{
  browserMocks(t);
  class AEGraphic extends Graphic {
    playing=false;
    playAction(){this._chain=Promise.resolve().then(()=>{this.playing=true;this._tick();});return this._chain;}
    async pauseAction(){this.playing=false;return {};}
    async goToTime(){this.playing=false;return {};}
    async stopAction(){this.playing=false;return {};}
  }
  const g=new AEGraphic(),context=new Context();context.auto=true;
  installSupplementalVoice(g as unknown as LegacyGraphic,{...template,id},{context:context as unknown as AudioContext});
  await g.load({data});g._tick();assert.equal(context.sources.length,0);
  await g.playAction();assert.equal(g.running,false);assert.equal(context.sources.length,1);close(context.sources[0].call!.offset,.125);
  g._tick();g._tick();assert.equal(context.sources.length,1);
  await g.pauseAction();assert.equal(context.sources[0].stops,1);g._tick();assert.equal(context.sources.length,1);
  g.elapsed=1.5;await g.playAction();assert.equal(context.sources.length,2);close(context.sources[1].call!.offset,.125+1.5-.76321);
  await g.goToTime();assert.equal(context.sources[1].stops,1);g._tick();assert.equal(context.sources.length,2);await g.dispose();
});
test('session suspension and dispose during stalled clock prevent native play and future sources',async t=>{
  browserMocks(t);const g=new Graphic(),context=new Context();let permitted=true;
  const control=installSupplementalVoice(g as unknown as LegacyGraphic,{...template,id:'BTV_Ce_Soir'},{context:context as unknown as AudioContext,permission:()=>()=>permitted})!;
  await g.load({data});const playback=g.playAction();permitted=false;control.pause();await assert.rejects(playback,{name:'AbortError'});assert.equal(g.running,false);assert.equal(context.sources.length,0);await g.dispose();
});
test('automatic programme fit is checked before native IN or any source creation',async t=>{
  browserMocks(t);const g=new Graphic(),context=new Context();context.auto=true;
  installSupplementalVoice(g as unknown as LegacyGraphic,{...template,id:'BTV_Ce_Soir'},{context:context as unknown as AudioContext});
  await g.load({data:{...data,_out_mode:'duration',_out_duration_seconds:1.6}});await assert.rejects(g.playAction(),/Aucun son/);assert.equal(g.running,false);assert.equal(context.sources.length,0);await g.dispose();
});
test('portable bundle exposes the same plan/player and preserves exact commands',async()=>{
  const generated=JSON.parse(await readFile(new URL('../src/studio/supplemental-voice-runtime.generated.json',import.meta.url),'utf8'));
  assert.equal(generated.version,1);const portable=await import(`data:text/javascript;base64,${Buffer.from(generated.code).toString('base64')}`);
  assert.equal(portable.SUPPLEMENTAL_VOICE_VERSION,1);assert.equal(typeof portable.installPortableTransport,'function');
  assert.deepEqual(portable.supplementalVoicePlan(template,data,buffer),prepared().plan);
  const a=new Context(),b=new Context(),live=new SupplementalVoicePlayer(a as unknown as AudioContext,a.destination as AudioNode,prepared()),pack=new portable.SupplementalVoicePlayer(b,b.destination,prepared());live.start(1.234567);pack.start(1.234567);assert.deepEqual(a.sources[0].call,b.sources[0].call);live.dispose();pack.dispose();
});
test('portable HTML uses the AE playing anchor, not the unrelated running flag',async t=>{
  browserMocks(t);
  const generated=JSON.parse(await readFile(new URL('../src/studio/supplemental-voice-runtime.generated.json',import.meta.url),'utf8'));
  const portable=await import(`data:text/javascript;base64,${Buffer.from(generated.code).toString('base64')}`);
  class AEGraphic extends Graphic {
    playing=false;
    playAction(){this._chain=Promise.resolve().then(()=>{this.playing=true;this._tick();});return this._chain;}
  }
  for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier']){
    const g=new AEGraphic(),context=new Context();context.auto=true;
    portable.installSupplementalVoice(g,{...template,id},{context});await g.load({data});
    await g.playAction();assert.equal(context.sources.length,1,id);close(context.sources[0].call!.offset,.125);await g.dispose();
  }
});

test('portable HTML applies the native jingle level even with no supplemental voice',async()=>{
  const generated=JSON.parse(await readFile(new URL('../src/studio/supplemental-voice-runtime.generated.json',import.meta.url),'utf8'));
  const portable=await import(`data:text/javascript;base64,${Buffer.from(generated.code).toString('base64')}`);
  for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier']){
    const g=new Graphic(),node={volume:1},calls:unknown[][]=[];
    g.data={_audio_enabled:true,_audio_volume:.25,_audio_voice_enabled:false};g.audio=[{node}];g.syncAudio=(...args:unknown[])=>{calls.push(args);};
    portable.installSupplementalVoice(g,{...template,id},{context:new Context()});g.syncAudio(3,true);
    assert.equal(node.volume,.25,id);assert.deepEqual(calls,[[3,true]]);await g.dispose();
  }
});
