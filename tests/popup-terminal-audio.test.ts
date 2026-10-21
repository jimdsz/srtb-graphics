import test from 'node:test';
import assert from 'node:assert/strict';
import {audioEvents} from '../src/studio/video/audio';
import {makeTimeline,graphicTime,TIMINGS} from '../src/studio/video/timeline';
import {previewTimeline} from '../src/studio/preview-timeline';
import type {PreparedGraphic,LegacyGraphic,Track} from '../src/studio/video/engine';
import type {BroadcastTemplate,ProjectData} from '../src/studio/domain';

function prepared(format='tv'):PreparedGraphic{
  const track=(type:string):Track=>({clips:[{type,source:'/fixture.'+type,start:0,end:60,length:60}],loop:false});
  const data:ProjectData={_out_mode:'duration',_out_duration_seconds:12,_studio_format:format,_background_visible:true,_audio_enabled:true,_media_background_audio_enabled:true,_media_popup_audio_enabled:true};
  return {graphic:{},data,tracks:{audio:track('audio'),background:track('video'),popup:track('video')},timeline:makeTimeline('BTV_PopUp',data,{},12)} as unknown as PreparedGraphic;
}

test('TV terminal hold does not extend popup, background or audio source events',()=>{
  const tv=prepared(),social=prepared('vertical');
  assert.equal(tv.timeline.duration,13.04);
  assert.equal(tv.timeline.timing.out,.84);
  const describe=(p:PreparedGraphic)=>audioEvents(p,'BTV_PopUp',false).map(e=>({url:e.url,at:e.at,start:e.start,duration:e.duration,rate:e.rate,gain:[e.gain(e.at),e.gain(e.at+e.duration)]}));
  assert.deepEqual(describe(tv),describe(social));
  const events=audioEvents(tv,'BTV_PopUp',false);
  assert.equal(Math.max(...events.map(e=>e.at+e.duration)),12.84);
  assert.ok(events.every(e=>e.at+e.duration<=tv.timeline.duration-.2+1e-9));
});

test('explicit preview OUT retains five terminal samples, including an early manual OUT',()=>{
  const g={tracks:{}} as unknown as LegacyGraphic,t={id:'BTV_PopUp'} as BroadcastTemplate;
  for(const outAt of [.4,12]){
    const timeline=previewTimeline(g,t,{_out_mode:'manual'},outAt);
    assert.equal(timeline.terminalHoldFrames,5);
    assert.equal(timeline.frames,Math.round((outAt+.84)*25)+5);
    assert.ok(Math.abs(timeline.duration-(outAt+1.04))<1e-9);
    assert.equal(graphicTime(timeline,timeline.duration-.04),266/25);
  }
});

test('the final native frame stays fixed during and after hold without changing OUT timing',()=>{
  const timeline=prepared().timeline;
  assert.equal(TIMINGS.BTV_PopUp.out,.84);
  assert.equal(timeline.terminalHoldFrames,5);
  for(const time of [12.8,12.84,12.88,13,13.04,60])assert.equal(graphicTime(timeline,time),266/25);
  for(const format of ['portrait','vertical']){
    const social=prepared(format).timeline;
    assert.equal(social.terminalHoldFrames,0);
    assert.equal(social.frames,321);
    assert.equal(graphicTime(social,13.04),9.84+13.04-12);
  }
});

test('the export duration limit counts terminal hold without truncating it',()=>{
  const data={_out_mode:'duration',_out_duration_seconds:598.96};
  assert.equal(makeTimeline('BTV_PopUp',data,{},12).frames,15000);
  assert.throws(()=>makeTimeline('BTV_PopUp',{...data,_out_duration_seconds:599}, {},12),/10 minutes/);
  assert.equal(makeTimeline('BTV_PopUp',{...data,_out_duration_seconds:599}, {},12,false).frames,15001);
});
