import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {resumeAudioClock} from '../src/studio/audio-clock-ready';

class Clock {
  state:AudioContextState='running';currentTime=0;resumeCalls=0;
  async resume(){this.resumeCalls++;this.state='running';}
}

test('running with a stalled zero clock is not ready until its time advances',async()=>{
  const clock=new Clock();let completed=false;
  const pending=resumeAudioClock(clock,{timeoutMs:1000}).then(()=>{completed=true;});
  await delay(25);assert.equal(completed,false);assert.equal(clock.resumeCalls,0);
  clock.currentTime=128/48000;await pending;assert.equal(completed,true);
});

test('a previously nonzero running clock must still demonstrate new progression',async()=>{
  const clock=new Clock();clock.currentTime=120;let completed=false;
  const pending=resumeAudioClock(clock,{timeoutMs:1000}).then(()=>{completed=true;});
  await delay(25);assert.equal(completed,false);clock.currentTime+=128/44100;await pending;
});

test('resume is invoked synchronously but its resolved promise does not mean the clock is ready',async()=>{
  const clock=new Clock();clock.state='suspended';let completed=false;
  const pending=resumeAudioClock(clock,{timeoutMs:1000}).then(()=>{completed=true;});
  assert.equal(clock.resumeCalls,1,'resume must remain within the initiating user gesture.');
  await delay(25);assert.equal(clock.state,'running');assert.equal(completed,false);
  clock.currentTime=.01;await pending;
});

test('an unchanged clock rejects within the supplied timeout, without a fake success',async()=>{
  const clock=new Clock();await assert.rejects(resumeAudioClock(clock,{timeoutMs:35}),{code:'AUDIO_CLOCK_NOT_READY'});assert.equal(clock.currentTime,0);
});

test('a resume promise that never settles is also bounded by timeout',async()=>{
  const clock=new Clock();clock.state='suspended';clock.resume=()=>new Promise<void>(()=>{});
  await assert.rejects(resumeAudioClock(clock,{timeoutMs:35}),{code:'AUDIO_CLOCK_NOT_READY'});
});

test('abort before invocation rejects without attempting resume',async()=>{
  const clock=new Clock();clock.state='suspended';const controller=new AbortController();controller.abort();
  await assert.rejects(resumeAudioClock(clock,{signal:controller.signal,timeoutMs:1000}),{name:'AbortError'});assert.equal(clock.resumeCalls,0);
});

test('abort while waiting rejects even if the clock later advances',async()=>{
  const clock=new Clock(),controller=new AbortController();const pending=resumeAudioClock(clock,{signal:controller.signal,timeoutMs:1000});
  const rejected=assert.rejects(pending,{name:'AbortError'});await delay(15);controller.abort();await rejected;clock.currentTime=.02;
});

test('a context already closed rejects without trying to resume it',async()=>{
  const clock=new Clock();clock.state='closed';await assert.rejects(resumeAudioClock(clock,{timeoutMs:1000}),{code:'AUDIO_DISPOSED'});assert.equal(clock.resumeCalls,0);
});

test('closing while waiting rejects rather than treating a changed final time as ready',async()=>{
  const clock=new Clock(),pending=resumeAudioClock(clock,{timeoutMs:1000});const rejected=assert.rejects(pending,{code:'AUDIO_DISPOSED'});
  await delay(15);clock.state='closed';clock.currentTime=.02;await rejected;
});

test('a rejected resume is propagated and never authorizes playback',async()=>{
  const clock=new Clock();clock.state='suspended';const reason=Error('Device unavailable');clock.resume=()=>Promise.reject(reason);
  await assert.rejects(resumeAudioClock(clock,{timeoutMs:1000}),reason);
});
