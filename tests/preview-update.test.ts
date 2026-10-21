import test from 'node:test';
import assert from 'node:assert/strict';
import {updatePreviewAtPosition} from '../src/studio/preview-update';
import type {PreviewTransport} from '../src/studio/preview-transport';
const ba={id:'BTV_BA_1P',version:'1.0.3',libraryVersion:'1.7.0'};
function fixture(playing=true,phase='onair'){
  const calls:string[]=[],controls={snapshot:()=>({playing,phase,seconds:10.125,outAt:9}),pause:async()=>{calls.push('pause');},clear:async()=>{calls.push('clear');},seek:async(seconds:number,outAt:number)=>{calls.push(`seek:${seconds}:${outAt}`);},resume:async()=>{calls.push('resume');}} as unknown as PreviewTransport;
  return {calls,controls};
}
test('BA preserves visible frame throughout asynchronous update and resumes without clear or destructive seek',async()=>{
  const {calls,controls}=fixture();let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;});
  const update=updatePreviewAtPosition(ba,controls,async()=>{calls.push('update');await pending;},()=>{});
  await Promise.resolve();await Promise.resolve();assert.deepEqual(calls,['pause','update']);finish();await update;assert.deepEqual(calls,['pause','update','resume']);
});
test('BA update failure leaves old frame paused and never resumes a failed update',async()=>{
  const {calls,controls}=fixture();await assert.rejects(updatePreviewAtPosition(ba,controls,async()=>{throw Error('source unavailable');},()=>{}),/source unavailable/);assert.deepEqual(calls,['pause']);
});
test('BA inspection remains silent while successful update keeps its position',async()=>{
  const {calls,controls}=fixture(false,'paused');await updatePreviewAtPosition(ba,controls,async()=>{calls.push('update');},()=>{});assert.deepEqual(calls,['pause','update']);
});
test('legacy keeps clear/update/seek/resume sequence and exact OUT anchor',async()=>{
  const {calls,controls}=fixture();await updatePreviewAtPosition({...ba,id:'BTV_PopUp'},controls,async()=>{calls.push('update');},()=>{});assert.deepEqual(calls,['clear','update','seek:10.125:9','resume']);
});
test('legacy update failure restores the accepted paused frame and does not replay the failed edit',async()=>{
  const {calls,controls}=fixture();await assert.rejects(updatePreviewAtPosition({...ba,id:'BTV_PopUp'},controls,async()=>{calls.push('update');throw Error('invalid title');},()=>{}),/invalid title/);
  assert.deepEqual(calls,['clear','update','seek:10.125:9']);
});
test('session suspension during update cannot resume or seek',async()=>{
  const {calls,controls}=fixture();let allowed=true;await assert.rejects(updatePreviewAtPosition(ba,controls,async()=>{allowed=false;},()=>{if(!allowed)throw Error('session');}),/session/);assert.deepEqual(calls,['pause']);
});
