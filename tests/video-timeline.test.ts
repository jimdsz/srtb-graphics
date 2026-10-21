import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTimeline,graphicTime,TIMINGS} from '../src/studio/video/timeline.ts';
import {playlistEvents} from '../src/studio/video/audio.ts';
test('all catalogue timelines retain complete OUT and integer frames',()=>{
  for(const [id,t]of Object.entries(TIMINGS)){
    const line=makeTimeline(id,{_out_mode:'duration',_out_duration_seconds:t.stop},{},0);
    const nativeFrames=Math.round((t.stop+t.out)*25),hold=id==='BTV_PopUp'?5:0;
    assert.equal(line.terminalHoldFrames,hold);assert.equal(line.frames,nativeFrames+hold);assert.equal(line.duration,line.frames/25);
    assert.equal(graphicTime(line,line.outAt),t.kind==='signature'?line.outAt:t.stop);
  }
});
test('BA long hold does not accelerate OUT or the media clock',()=>{
  const t=makeTimeline('BTV_BA_1P',{_out_mode:'duration',_out_duration_seconds:120},{},0);
  assert.equal(t.frames,3203);assert.ok(Math.abs(graphicTime(t,100)-64.76)<1e-8);assert.ok(Math.abs(graphicTime(t,121)-65.8)<1e-8);
});
test('popup holds its entry pose, not an arbitrary native frame',()=>{
  const t=makeTimeline('BTV_PopUp',{_out_mode:'duration',_out_duration_seconds:12},{},0);
  assert.equal(graphicTime(t,5),3.16);assert.equal(graphicTime(t,12),9.84);assert.equal(t.frames,326);
});
test('media-end honours playlist offsets, rate-derived lengths and complete entry',()=>{
  assert.equal(makeTimeline('BTV_BA_1P',{_out_mode:'media_end'},{body:30},0).outAt,33);
  assert.equal(makeTimeline('BTV_PopUp',{_out_mode:'media_end',_out_media_track:'popup'},{popup:5},0).outAt,5.64);
  assert.equal(makeTimeline('BTV_BA_TDS_SUIVI_DE',{_out_mode:'media_end',_out_media_track:'all'},{programme_1:12,programme_2:20},0).outAt,33.8);
  assert.equal(makeTimeline('BTV_BA_TDS',{_out_mode:'media_end',_out_media_track:'background'},{background:1},0).outAt,15.28);
});
test('invalid or overlong timelines fail instead of silently truncating',()=>{
  assert.throws(()=>makeTimeline('BTV_BA_1P',{_out_mode:'media_end'},{},0));
  assert.throws(()=>makeTimeline('BTV_Relais_Antenne',{_out_mode:'manual'},{},10000));
  assert.throws(()=>makeTimeline('unknown',{},{},0));
});
test('long preview media keep their duration without removing the export limit',()=>{
  const data={_out_mode:'media_end',_out_media_track:'background'};
  const preview=makeTimeline('BTV_BA_TDS',data,{background:3600},12,false);
  assert.equal(preview.outAt,3600);assert.equal(preview.duration,3600.72);
  assert.throws(()=>makeTimeline('BTV_BA_TDS',data,{background:3600},12),/10 minutes/);
});
const clips=[{type:'video',source:'/a.mp4',start:2,end:4,length:2},{type:'video',source:'/b.mp4',start:5,end:8,length:3}];
test('audio segments preserve IN/OUT, delay, rate and ordered cuts',()=>{
  const segments=playlistEvents({clips,loop:false},1,10,()=>.5);
  assert.deepEqual(segments.map(s=>[s.url,s.at,s.start,s.duration]),[['/a.mp4',1,2,2],['/b.mp4',3,5,3]]);
  const slow=playlistEvents({clips,loop:false,rate:.5},0,10,()=>1);
  assert.deepEqual(slow.map(s=>[s.at,s.duration,s.rate]),[[0,4,.5],[4,6,.5]]);
});
test('looping audio and OUT discontinuity preserve the chosen segment',()=>{
  const segments=playlistEvents({clips,loop:true},0,8,()=>1,4);
  assert.deepEqual(segments.map(s=>[s.at,s.start,s.duration]),[[0,7,1],[1,2,2],[3,5,3],[6,2,2]]);
});
test('images never manufacture an audio track',()=>{
  assert.equal(playlistEvents({clips:[{type:'image',start:0,end:2,length:2}],loop:false},0,10,()=>1).length,0);
});
