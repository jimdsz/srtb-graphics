import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {baSocialDirect,baSocialSelectedData,baSocialUnusedField} from '../src/studio/ba-social-direct';
import {baSocialNativeData} from '../src/studio/ba-social-engine';
import {makeTimeline,graphicTime,TIMINGS,socialExcerptEnd} from '../src/studio/video/timeline';
import {socialSignature} from '../src/studio/social-motion';
import {socialTrackTimes} from '../src/studio/social-renderer';
import {selectedMediaData} from '../src/studio/media-selection';
import {audioEvents} from '../src/studio/video/audio';
import {teamVoiceActivation} from '../src/studio/team-voice-choice';
import {voiceTimingWarning} from '../src/studio/voice-timing-model';
import {assertNativeVoiceFits} from '../src/studio/supplemental-voice';

const id='BTV_BA_1P',template=getTemplate(id);
test('a voice exceeding the real social source end is refused, including manual playback',()=>{
  const data={...templateDefaults(template),_studio_format:'vertical',_out_mode:'manual',_audio_voice_enabled:true,_media_body_loop:false};
  const graphic:any={__baSocialData:data,media:{tracks:{body:{length:3.2,clips:[]}}},audio:{plan:{voice:[{id:'voice-intro',mainIn:0,mainOut:5,sourceIn:0,sourceOut:5}]}}};
  assert.throws(()=>assertNativeVoiceFits(graphic,template),/voix off complète/);
  graphic.__baSocialData={...data,_media_body_loop:true};assert.doesNotThrow(()=>assertNativeVoiceFits(graphic,template));
});
test('legacy TV duration never freezes the tail of non-looping social BA excerpts',()=>{
  for(const format of ['portrait','vertical'])for(const mode of ['simple','multiple'])for(const outMode of ['duration','manual','media_end']){
    const data={...templateDefaults(template),_studio_format:format,_studio_ba_mode:mode,_out_mode:outMode,_out_duration_seconds:64.8,_media_body_loop:false};
    const line=makeTimeline(id,data,{body:3.2},64.8);
    assert.equal(line.duration,3.2);assert.equal(line.frames,80);assert.equal(graphicTime(line,3.16),3.16);
    assert.deepEqual(socialTrackTimes(id,3.2,line.outAt),{});
    if(outMode!=='media_end')assert.equal(makeTimeline(id,{...data,_media_body_loop:true},{body:3.2},64.8).duration,64.8,'intentional looping is preserved');
    assert.equal(socialExcerptEnd(id,data,{body:3.2}),3.2);
  }
  assert.equal(makeTimeline(id,{_studio_format:'tv',_out_mode:'duration',_out_duration_seconds:64.8},{body:3.2},0).duration,72.92);
  assert.equal(makeTimeline(id,{_studio_format:'vertical',_out_mode:'duration',_out_duration_seconds:1},{body:3.2},0).duration,1,'explicit shorter cut is preserved');
});
test('social voice picker accepts a complete long voice without moving the saved TV OUT placement',()=>{
  const data={...templateDefaults(template),_studio_format:'vertical',_out_mode:'duration',_out_duration_seconds:80};
  const patch=teamVoiceActivation(template,data,5),active={...data,...patch};
  assert.equal(patch._audio_voice_intro_offset_seconds,0);assert.equal(patch._audio_voice_outro_offset_seconds,undefined);
  assert.equal(voiceTimingWarning(template,active),'');assert.equal(voiceTimingWarning(template,{...active,_audio_voice_intro_offset_seconds:64}),'');
  assert.match(voiceTimingWarning(template,{...active,_audio_voice_intro_offset_seconds:78}),/dépasse/);
  assert.throws(()=>teamVoiceActivation(template,{...data,_studio_format:'tv'},5),/4,04/);
});
test('only social BA simple/multiple use the direct policy; TV and TDS are unchanged',()=>{
  for(const format of ['portrait','vertical'])for(const mode of ['simple','multiple'])assert.ok(baSocialDirect(id,{_studio_format:format,_studio_ba_mode:mode}));
  assert.equal(baSocialDirect(id,{}),false);assert.equal(baSocialDirect(id,{_studio_format:'tv'}),false);assert.equal(baSocialDirect('BTV_BA_TDS',{_studio_format:'vertical'}),false);
});
test('direct timeline has no intro offset or outro; trims/rate-derived duration are retained',()=>{
  for(const format of ['portrait','vertical'])for(const length of [.04,1,3,12,75]){
    const data={_studio_format:format,_out_mode:'media_end'},line=makeTimeline(id,data,{body:length},10);
    assert.equal(line.duration,length);assert.equal(line.outAt,length);assert.equal(line.timing.out,0);assert.equal(line.frames,Math.round(length*25));
    for(const at of [0,.04,length-.04]){assert.equal(graphicTime(line,at),at);assert.deepEqual(socialTrackTimes(id,at,line.outAt),at<length?{body:at}:{});assert.equal(socialSignature(id,at,line),undefined);}
    assert.deepEqual(socialTrackTimes(id,length,line.outAt),{});
    assert.equal(makeTimeline(id,{...data,_out_mode:'manual'},{},length).duration,length);
    assert.equal(makeTimeline(id,{...data,_out_mode:'duration',_out_duration_seconds:length},{},0).duration,length);
  }
  const tv=makeTimeline(id,{_studio_format:'tv',_out_mode:'media_end'},{body:12},0);assert.equal(tv.outAt,15);assert.equal(tv.duration,23.12);assert.deepEqual(tv.timing,TIMINGS[id]);
});
test('disabled TV sources never need local resolution; project and body settings remain intact',()=>{
  const data={...templateDefaults(template),_studio_format:'vertical',_out_duration_seconds:3,_media_body_start_seconds:2,_media_body_end_seconds:5,_media_body_rate:1.5};
  const saved=JSON.stringify(data),selected=selectedMediaData(template,data),native=baSocialNativeData(selected);
  assert.equal(JSON.stringify(data),saved);assert.equal(selected._media_intro_url,'');assert.equal(selected._media_pack_url,'');assert.equal(selected._audio_bed_enabled,false);
  assert.equal(native._media_body_start_seconds,2);assert.equal(native._media_body_end_seconds,5);assert.equal(native._media_body_rate,1.5);
  assert.match(String(native._media_intro_url),/^data:image\/svg\+xml/);assert.equal(validateProjectData(template,data)._out_duration_seconds,3);
  assert.throws(()=>validateProjectData(template,{...data,_studio_format:'tv'}),/hors limites/);
  assert.equal(baSocialSelectedData(data)._audio_voice_enabled,data._audio_voice_enabled);
  assert.ok(baSocialUnusedField('_media_intro_rate'));assert.ok(baSocialUnusedField('_audio_bed_url'));assert.equal(baSocialUnusedField('_media_body_rate'),false);
});
test('direct audio starts at source IN, joins all clips at their speed, no jingle or ending VO',()=>{
  const data={...templateDefaults(template),_studio_format:'vertical',_out_mode:'media_end',_audio_bed_enabled:true,_audio_voice_enabled:true,_media_body_audio_enabled:true,_media_body_volume:.6,_audio_voice_gain:.8};
  const tracks={body:{clips:[{url:'body-a.mp4',start:2,end:6,length:4,type:'video'},{url:'body-b.mp4',start:9,end:11,length:2,type:'video'}],loop:false,rate:2}};
  const timeline=makeTimeline(id,data,{body:3},0),buffer={} as AudioBuffer;
  const prepared:any={data,tracks,timeline,graphic:{audio:{buffers:{voice:{buffer}},plan:{voice:[{id:'voice-intro',mainIn:.2,mainOut:1.2,sourceIn:4,sourceOut:5,envelope:[[.2,0]]},{id:'voice-outro',mainIn:68.48,mainOut:69.48}]}}}};
  const events=audioEvents(prepared,id,false);assert.equal(events.length,3);
  assert.deepEqual(events.slice(0,2).map(({at,start,duration,rate})=>({at,start,duration,rate})),[{at:0,start:2,duration:2,rate:2},{at:2,start:9,duration:1,rate:2}]);
  assert.equal(events[0].gain(0),.6);assert.equal(events[2].buffer,buffer);assert.equal(events[2].at,.2);assert.equal(events[2].duration,1);
  assert.equal(audioEvents({...prepared,data:{...data,_audio_voice_enabled:false,_media_body_audio_enabled:false}},id,false).length,0,'explicit silence is respected');
});
