import test from 'node:test';
import assert from 'node:assert/strict';
import {graphicTime,makeTimeline} from '../src/studio/video/timeline';

// Independent contract from the AE reference: native OUT contains frames
// 246..266 inclusive. Frame 265 still has a 34px band, frame 266 is empty.
// A terminal hold must never replace or skip any of those motion samples.
test('popup TV retains all 21 native OUT samples then holds the actual final state',()=>{
  const timeline=makeTimeline('BTV_PopUp',{_out_mode:'duration',_out_duration_seconds:12,_studio_format:'tv'}, {},12);
  assert.equal(timeline.frames,326);
  assert.equal(timeline.duration,13.04);
  for(let frame=300;frame<=320;frame++){
    assert.ok(Math.abs(graphicTime(timeline,frame/25)*25-(246+frame-300))<1e-6,'native sample '+frame);
  }
  for(let frame=321;frame<timeline.frames;frame++){
    assert.ok(Math.abs(graphicTime(timeline,frame/25)*25-266)<1e-6,'terminal hold '+frame);
  }
});

test('legacy projects without an explicit format receive the TV terminal hold',()=>{
  const timeline=makeTimeline('BTV_PopUp',{_out_mode:'manual'}, {},12);
  assert.equal(timeline.frames,326);
  assert.equal(timeline.outAt,12);
});

test('preview and delivery expose the same popup endpoint',()=>{
  const data={_out_mode:'duration',_out_duration_seconds:12,_studio_format:'tv'};
  const preview=makeTimeline('BTV_PopUp',data,{},12,false);
  const delivery=makeTimeline('BTV_PopUp',data,{},12,true);
  assert.deepEqual(preview,delivery);
});

test('popup hold does not retime social animations or other templates',()=>{
  for(const format of ['portrait','vertical']){
    assert.equal(makeTimeline('BTV_PopUp',{_out_mode:'duration',_out_duration_seconds:12,_studio_format:format},{},12).frames,321);
  }
  assert.equal(makeTimeline('BTV_BA_1P',{_out_mode:'duration',_out_duration_seconds:12},{},12).frames,503);
  assert.equal(makeTimeline('BTV_Ce_Soir',{_out_mode:'duration',_out_duration_seconds:12},{},12).frames,330);
});
