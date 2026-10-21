import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

// Exercise the generated v2 implementation, not a copied scheduling algorithm.
// These tests prove Web Audio commands, not the PCM emitted by a real browser.
const audio=await import(pathToFileURL(resolve(import.meta.dirname,'../public/studio-engines/ba-text-v2/audio.mjs')).href);
const close=(actual:number,expected:number,label='number')=>assert.ok(Math.abs(actual-expected)<1e-9,`${label}: ${actual} != ${expected}`);
type Start={when:number;offset:number;duration:number;calledAt:number;rate:number};
class FakeParam {
  value=1;
  events:{method:string;value:number;time:number}[]=[];
  setValueAtTime(value:number,time:number){this.events.push({method:'set',value,time});return this;}
  exponentialRampToValueAtTime(value:number,time:number){assert.ok(value>0,'Web Audio exponential ramps cannot target zero.');this.events.push({method:'exponential',value,time});return this;}
  linearRampToValueAtTime(value:number,time:number){this.events.push({method:'linear',value,time});return this;}
  cancelScheduledValues(time:number){this.events=this.events.filter(event=>event.time<time);return this;}
}
class FakeGain {
  gain=new FakeParam();disconnected=false;
  connect(_target:unknown){} disconnect(){this.disconnected=true;}
}
class FakeSource {
  buffer:unknown;playbackRate=new FakeParam();startCall?:Start;stopCalls:number[]=[];onended:(()=>void)|null=null;ended=false;disconnected=false;
  constructor(readonly context:FakeContext){}
  connect(_target:unknown){} disconnect(){this.disconnected=true;}
  start(when:number,offset:number,duration:number){
    assert.equal(this.startCall,undefined,'An AudioBufferSourceNode is one-shot.');
    this.startCall={when,offset,duration,calledAt:this.context.currentTime,rate:this.playbackRate.value};
    this.context.events.push({type:'start',node:this,at:this.context.currentTime});
  }
  stop(when=this.context.currentTime){this.stopCalls.push(when);this.context.events.push({type:'stop',node:this,at:this.context.currentTime});}
}
class FakeContext {
  currentTime=100;state:'running'|'suspended'|'closed'='running';destination={};sources:FakeSource[]=[];
  events:{type:'start'|'stop';node:FakeSource;at:number}[]=[];
  constructor(readonly sampleRate=48000){}
  createGain(){return new FakeGain();}
  createBufferSource(){const source=new FakeSource(this);this.sources.push(source);return source;}
  async resume(){this.state='running';}
  async close(){this.state='closed';}
  advance(time:number){
    assert.ok(time>=this.currentTime,'The audio clock must not run backwards.');this.currentTime=time;
    for(const source of this.sources){const start=source.startCall;if(!start||source.ended)continue;
      const end=Math.min(start.when+start.duration,...source.stopCalls);
      if(time>=end){source.ended=true;source.onended?.();}
    }
  }
}
async function fixture(options:{bed?:boolean;bufferRate?:number;contextRate?:number;bufferDuration?:number;data?:Record<string,unknown>}={}){
  const context=new FakeContext(options.contextRate),engine=new audio.AudioEngine({context,baseUrl:'https://fixture.invalid/'});
  const duration=3.6,sourceIn=.123456,intro=4.36-duration;
  const data={...audio.AUDIO_DEFAULTS,_studio_ba_voice_fit:'fit-complete',_audio_bed_enabled:options.bed??false,_audio_voice_enabled:true,
    _audio_voice_url:'voice.wav',_audio_bed_url:'bed.wav',_audio_voice_gain:.7,_audio_voice_in_seconds:sourceIn,_audio_voice_out_seconds:sourceIn+duration,
    _audio_voice_intro_offset_seconds:intro,_audio_voice_outro_offset_seconds:68.48,...options.data};
  const bufferRate=options.bufferRate??48000;
  const loads:string[]=[];
  engine._load=async(url:string)=>{loads.push(url);const length=url.endsWith('/bed.wav')?40:options.bufferDuration??10;
    return {url,buffer:{duration:length,length:Math.round(length*bufferRate),sampleRate:bufferRate,numberOfChannels:2}};
  };
  await engine.prepare(data);
  return {engine,context,data,loads,sourceIn,duration,intro};
}
const play={playing:true,muted:false};
const starts=(context:FakeContext)=>context.sources.filter(source=>source.startCall);

test('direct social voice has one unrestricted excerpt cue and crosses the TV 64.8s marker without a restart',async()=>{
  for(const at of [0,12,64,65]){
    const {engine,context,loads}=await fixture({data:{_audio_social_direct_enabled:true,_studio_ba_voice_fit:'manual',_audio_voice_in_seconds:0,_audio_voice_out_seconds:5,_audio_voice_intro_offset_seconds:at,_audio_voice_outro_offset_seconds:68.48}});
    assert.equal(engine.plan.voice.length,1);assert.deepEqual(engine.plan.bed,[]);assert.equal(loads.length,1);
    engine.sync(at,play);const first=context.sources[0];close(first.startCall!.duration,5);
    for(const t of [.5,.8,1,2,4.9]){context.advance(100+t);engine.sync(at+t,play);}
    assert.equal(starts(context).length,1);assert.equal(first.stopCalls.length,0);
    context.advance(105.1);engine.sync(at+5.1,play);assert.equal(starts(context).length,1);assert.deepEqual(engine.errors,[]);
  }
});

test('sync zero schedules the complete future voice against the AudioContext clock, not the first RAF crossing',async()=>{
  const {engine,context,sourceIn,duration,intro}=await fixture();
  engine.sync(0,play);
  assert.equal(starts(context).length,1);
  const call=context.sources[0].startCall!;
  close(call.when,100+intro,'future context time');close(call.offset,sourceIn,'exact source IN');close(call.duration,duration,'complete duration');assert.equal(call.rate,1);
  assert.ok(call.when>call.calledAt);assert.equal(context.sources[0].ended,false);
});

test('a future source survives normal ticks and a 120ms RAF stall without restart or lost source head',async()=>{
  const {engine,context,intro,sourceIn}=await fixture();engine.sync(0,play);
  const first=context.sources[0];
  for(const main of [.4,intro-.001,intro+.12,intro+.5]){context.advance(100+main);engine.sync(main,play);}
  assert.equal(starts(context).length,1);assert.equal(first.stopCalls.length,0);close(first.startCall!.offset,sourceIn);
});

test('native source placement is also anticipated without changing its original offsets or plan',async()=>{
  const {engine,context}=await fixture({data:{_studio_ba_voice_fit:'source',_audio_voice_in_seconds:3.2,_audio_voice_out_seconds:5.36,_audio_voice_intro_offset_seconds:1.92}});
  const plan=structuredClone(engine.plan);engine.sync(0,play);
  close(context.sources[0].startCall!.when,101.92);close(context.sources[0].startCall!.offset,3.2);close(context.sources[0].startCall!.duration,2.16);
  for(const main of [.5,1.919,1.921,2.1]){context.advance(100+main);engine.sync(main,play);}
  assert.equal(starts(context).length,1);assert.deepEqual(engine.plan,plan);
});

test('a completed intro never schedules OUT while the programme clock remains in its held intro/body phase',async()=>{
  const {engine,context}=await fixture();engine.sync(0,play);
  for(const [clock,main]of [[105,5],[120,20],[164.76,64.76],[1100,64.76]]){context.advance(clock);engine.sync(main,play);}
  assert.equal(starts(context).length,1,'OUT must await the explicit source-clock phase change.');
  assert.equal(engine.active.voice,undefined);
});

test('the final intro sync after a voice ends does not replay a completed one-shot source',async()=>{
  const {engine,context}=await fixture();engine.sync(0,play);context.advance(104.37);engine.sync(4.37,play);
  for(const main of [4.4,5,9,10]){context.advance(100+main);engine.sync(main,play);}
  assert.equal(starts(context).length,1);
});

test('onended followed by a slightly older RAF does not replay the final millisecond',async()=>{
  const {engine,context}=await fixture();engine.sync(0,play);context.advance(104.361);
  assert.equal(context.sources[0].ended,true);engine.sync(4.359,play);
  assert.equal(starts(context).length,1);assert.equal(engine.active.voice.ended,true);
});

for(const rate of [44100,48000])for(const phase of ['intro','outro'] as const){
  test(`${phase} at ${rate}Hz finishes naturally when the transport crosses OUT before the audio clock`,async()=>{
    const {engine,context}=await fixture({contextRate:rate});const base=phase==='intro'?0:64.8;engine.sync(base,play);
    const source=context.sources[0],active=engine.active.voice,plan=structuredClone(engine.plan),remainingFrames=phase==='intro'?20:24;
    const finish=source.startCall!.when+source.startCall!.duration;
    context.advance(finish-remainingFrames/rate);engine.sync(active.insertion.mainOut+.0001,play);
    assert.equal(source.ended,false);assert.equal(source.stopCalls.length,0,'A performance-clock crossing must not cut the last PCM samples.');
    assert.equal(engine.active.voice,active);assert.equal(starts(context).length,1);assert.deepEqual(engine.plan,plan);
    context.advance(finish+.01);assert.equal(source.ended,true);engine.sync(active.insertion.mainOut+.011,play);
    assert.equal(starts(context).length,1);assert.ok(source.stopCalls.every(time=>time>=finish));
  });
}

for(const action of ['pause','stop','seek','phase-change','disable','drift-correction'] as const){
  test(`natural-tail protection still respects explicit ${action}`,async()=>{
    const {engine,context,data}=await fixture();engine.sync(0,play);const source=context.sources[0],active=engine.active.voice,finish=source.startCall!.when+source.startCall!.duration;
    context.advance(finish-20/48000);engine.sync(active.insertion.mainOut+.0001,play);assert.equal(source.stopCalls.length,0);
    if(action==='pause')engine.sync(active.insertion.mainOut+.0001,{playing:false,muted:false});
    else if(action==='stop')engine.stop();
    else if(action==='seek')engine.sync(2,{...play,discontinuity:true});
    else if(action==='phase-change')engine.sync(64.8,play);
    else if(action==='disable')await engine.prepare({...data,_audio_voice_enabled:false});
    else engine.sync(active.insertion.mainOut+.1,play);
    assert.equal(source.stopCalls.length,1);assert.ok(source.stopCalls[0]<finish);
    assert.equal(starts(context).length,action==='seek'||action==='phase-change'?2:1);
  });
}

test('stop followed by a deliberate restart may play the same insertion again',async()=>{
  const {engine,context,sourceIn,intro}=await fixture();engine.sync(0,play);context.advance(105);engine.sync(5,play);
  engine.stop();context.advance(200);engine.sync(0,{...play,discontinuity:true});
  assert.equal(starts(context).length,2);close(context.sources[1].startCall!.when,200+intro);close(context.sources[1].startCall!.offset,sourceIn);
});

test('a future voice is reported as scheduled but neither running nor audible and never has a negative source offset',async()=>{
  const {engine,context,sourceIn,intro}=await fixture();engine.sync(0,play);
  for(const main of [0,.4,intro-.001]){context.advance(100+main);engine.sync(main,play);const status=engine.status().tracks.voice;
    assert.equal(status.scheduled,true);assert.equal(status.running,false);assert.equal(status.audible,false);close(status.sourceSeconds,sourceIn);
  }
  context.advance(100+intro+.12);engine.sync(intro+.12,play);const current=engine.status().tracks.voice;
  assert.equal(current.scheduled,false);assert.equal(current.running,true);assert.equal(current.audible,true);close(current.sourceSeconds,sourceIn+.12);
});

test('zero voice gain remains silent without invalid exponential ramps or audio errors',async()=>{
  const {engine,context,intro}=await fixture({data:{_audio_voice_gain:0}});engine.sync(0,play);
  assert.equal(starts(context).length,1);assert.equal(engine.active.voice.gain.gain.value,0);
  assert.ok(engine.active.voice.gain.gain.events.every((event:{method:string;value:number})=>event.method==='set'&&event.value===0));
  context.advance(100+intro+.1);engine.sync(intro+.1,play);assert.equal(engine.status().tracks.voice.audible,false);assert.deepEqual(engine.errors,[]);
});

test('explicit OUT jump cancels a pending intro before scheduling a complete future OUT voice',async()=>{
  const {engine,context,sourceIn,duration}=await fixture();engine.sync(0,play);const pending=context.sources[0];
  context.advance(100.2);engine.sync(64.8,{...play,discontinuity:true});
  assert.equal(starts(context).length,2);assert.equal(pending.stopCalls.length,1);
  const next=context.sources[1].startCall!;close(next.when,100.2+3.68);close(next.offset,sourceIn);close(next.duration,duration);
  const cancellation=context.events.findIndex(event=>event.type==='stop'&&event.node===pending),creation=context.events.findIndex(event=>event.type==='start'&&event.node===context.sources[1]);
  assert.ok(cancellation>=0&&cancellation<creation);
});

test('bed and voice anticipation stay in the same phase and create no duplicate OUT nodes',async()=>{
  const {engine,context}=await fixture({bed:true});engine.sync(0,play);assert.equal(starts(context).length,2);
  context.advance(110);engine.sync(10,play);context.advance(160);engine.sync(60,play);assert.equal(starts(context).length,2);
  engine.sync(64.8,{...play,discontinuity:true});assert.equal(starts(context).length,4);
  context.advance(163.8);engine.sync(68.6,play);assert.equal(starts(context).length,4);
  context.advance(169);engine.sync(73.8,play);engine.sync(73.8,play);assert.equal(starts(context).length,4);
});

test('stop is idempotent and cancels a scheduled future source before its onset',async()=>{
  const {engine,context}=await fixture();engine.sync(0,play);const pending=context.sources[0];
  context.advance(100.1);engine.stop();engine.stop();context.advance(105);
  assert.equal(pending.stopCalls.length,1);assert.ok(pending.stopCalls[0]<pending.startCall!.when);assert.equal(engine.active.voice,undefined);assert.equal(engine.master.gain.value,0);
  assert.equal(starts(context).length,1);
});

test('playing false cancels future scheduling and a resume before the cue reschedules the complete source',async()=>{
  const {engine,context,intro,sourceIn,duration}=await fixture();engine.sync(0,play);context.advance(100.4);engine.sync(.4,{playing:false,muted:false});
  assert.equal(context.sources[0].stopCalls.length,1);context.advance(200);
  engine.sync(.4,{...play,discontinuity:true});const resumed=context.sources[1].startCall!;
  close(resumed.when,200+intro-.4);close(resumed.offset,sourceIn);close(resumed.duration,duration);
});

test('resume midway through a cue retains the frozen playhead instead of replaying its beginning',async()=>{
  const {engine,context,intro,sourceIn,duration}=await fixture();engine.sync(0,play);const progress=1.2;
  context.advance(100+intro+progress);engine.sync(intro+progress,play);engine.stop();context.advance(200);
  engine.sync(intro+progress,{...play,discontinuity:true});const resumed=context.sources[1].startCall!;
  close(resumed.when,200);close(resumed.offset,sourceIn+progress);close(resumed.duration,duration-progress);
  context.advance(200.02);engine.sync(intro+progress+.02,play);assert.equal(starts(context).length,2);
});

test('a delayed onended callback from an old cancelled generation cannot clear its replacement',async()=>{
  const {engine,context}=await fixture();engine.sync(0,play);const stale=context.sources[0].onended!;
  engine.stop();context.advance(200);engine.sync(0,{...play,discontinuity:true});const replacement=engine.active.voice;
  stale();assert.equal(engine.active.voice,replacement);assert.equal(context.sources[1].stopCalls.length,0);assert.equal(replacement.ended,false);
});

test('muting keeps the master silent without an unintended new voice when unmuted before onset',async()=>{
  const {engine,context}=await fixture();engine.sync(0,{playing:true,muted:true});assert.equal(engine.master.gain.value,0);
  const initial=starts(context).length;context.advance(100.4);engine.sync(.4,play);
  assert.equal(engine.master.gain.value,1);assert.equal(starts(context).length,Math.max(initial,1));
  assert.ok(context.sources.every(source=>source.startCall!.when>source.startCall!.calledAt));
});

test('paused inspection creates no nodes and backward discontinuity cancels the old source',async()=>{
  const {engine,context,intro,sourceIn}=await fixture();engine.sync(2,{playing:false,muted:true,discontinuity:true});assert.equal(starts(context).length,0);
  engine.sync(2,{...play,discontinuity:true});close(context.sources[0].startCall!.offset,sourceIn+2-intro);
  context.advance(101);engine.sync(0,{...play,discontinuity:true});assert.equal(context.sources[0].stopCalls.length,1);close(context.sources[1].startCall!.offset,sourceIn);close(context.sources[1].startCall!.when,101+intro);
});

test('a suspended context never schedules audible nodes and unlock schedules from the stored transport time',async()=>{
  const {engine,context,intro,sourceIn}=await fixture();context.state='suspended';engine.sync(.4,{playing:true,muted:true});assert.equal(starts(context).length,0);
  const pending=engine.unlock();await delay(20);assert.equal(starts(context).length,0,'The running state alone must not schedule audio before the clock advances.');
  context.advance(100.02);await pending;assert.equal(context.state,'running');assert.equal(engine.master.gain.value,0);assert.equal(starts(context).length,1);
  close(context.sources[0].startCall!.when,100.02+intro-.4);close(context.sources[0].startCall!.offset,sourceIn);
});

test('unlock while stopped waits for clock progression without automatically starting a voice',async()=>{
  const {engine,context}=await fixture();let completed=false;const pending=engine.unlock().then(()=>{completed=true;});
  await delay(20);assert.equal(completed,false);assert.equal(starts(context).length,0);context.advance(100.02);await pending;
  assert.equal(starts(context).length,0);assert.equal(engine.playing,false);assert.equal(engine.master.gain.value,0);
});

test('concurrent unlock calls share one clock wait and cannot schedule duplicate voices',async()=>{
  const {engine,context}=await fixture();context.state='suspended';engine.sync(.4,{playing:true,muted:true});
  const first=engine.unlock(),second=engine.unlock();assert.equal(first,second);await delay(20);assert.equal(starts(context).length,0);
  context.advance(100.02);await Promise.all([first,second]);assert.equal(starts(context).length,1);
});

test('stop during a pending unlock cannot resurrect the previous playing intent',async()=>{
  const {engine,context}=await fixture();context.state='suspended';engine.sync(.4,play);
  const pending=engine.unlock().catch(()=>undefined);await delay(10);engine.stop();context.advance(100.02);await pending;
  assert.equal(starts(context).length,0);assert.equal(engine.playing,false);assert.equal(engine.master.gain.value,0);
});

test('dispose during a pending unlock cannot schedule a source after the clock advances',async()=>{
  const {engine,context}=await fixture();context.state='suspended';engine.sync(.4,play);
  const pending=engine.unlock().catch(()=>undefined);await delay(10);await engine.dispose();context.advance(100.02);await pending;
  assert.equal(starts(context).length,0);assert.equal(engine.disposed,true);assert.equal(engine.master.gain.value,0);
});

test('disposal cancels pending audio and later sync cannot recreate a source',async()=>{
  const {engine,context}=await fixture();engine.sync(0,play);await engine.dispose();context.advance(200);engine.sync(0,play);
  assert.equal(starts(context).length,1);assert.equal(context.sources[0].stopCalls.length,1);assert.equal(engine.disposed,true);
});

for(const rate of [44100,48000]){
  test(`prepare tolerates exactly one decoded ${rate}Hz sample at the end without modifying source or plan`,async()=>{
    const end=1+1/rate,{engine,data}=await fixture({bufferRate:rate,bufferDuration:1,data:{_studio_ba_voice_fit:'source',_audio_voice_in_seconds:0,_audio_voice_out_seconds:end,_audio_voice_intro_offset_seconds:1.92}});
    assert.equal(data._audio_voice_out_seconds,end);assert.equal(engine.config._audio_voice_out_seconds,end);
    for(const insertion of engine.plan.voice){assert.equal(insertion.sourceOut,end);assert.equal(insertion.sourceIn,0);close(insertion.mainOut-insertion.mainIn,end);}
  });
  test(`prepare rejects more than one decoded ${rate}Hz sample at the end`,async()=>{
    await assert.rejects(fixture({bufferRate:rate,bufferDuration:1,data:{_studio_ba_voice_fit:'source',_audio_voice_in_seconds:0,_audio_voice_out_seconds:1+1/rate+1e-8,_audio_voice_intro_offset_seconds:1.92}}),{code:'AUDIO_DURATION'});
  });
}

test('the one-sample tolerance follows buffer rate, not a different context sample rate',async()=>{
  await fixture({contextRate:48000,bufferRate:44100,bufferDuration:1,data:{_studio_ba_voice_fit:'source',_audio_voice_in_seconds:0,_audio_voice_out_seconds:1+1/44100,_audio_voice_intro_offset_seconds:1.92}});
  await assert.rejects(fixture({contextRate:44100,bufferRate:48000,bufferDuration:1,data:{_studio_ba_voice_fit:'source',_audio_voice_in_seconds:0,_audio_voice_out_seconds:1+1/44100,_audio_voice_intro_offset_seconds:1.92}}),{code:'AUDIO_DURATION'});
});

test('one-sample tolerance never makes a passage starting at the end of its buffer valid',async()=>{
  await assert.rejects(fixture({bufferDuration:1,data:{_studio_ba_voice_fit:'source',_audio_voice_in_seconds:1,_audio_voice_out_seconds:1.04,_audio_voice_intro_offset_seconds:1.92}}),{code:'AUDIO_DURATION'});
});
