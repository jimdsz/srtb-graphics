import test from 'node:test';
import assert from 'node:assert/strict';
import {audioEvents} from '../src/studio/video/audio';
import {makeTimeline} from '../src/studio/video/timeline';
import {assertNativeVoiceFits,installNativeVoiceFit,supplementalVoicePlan} from '../src/studio/supplemental-voice';
import {packageDocuments} from '../src/studio/delivery-runtime';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import type {PreparedGraphic,LegacyGraphic} from '../src/studio/video/engine';
import type {DeliveryPlan} from '../src/studio/delivery-plan';

const ba={id:'BTV_BA_1P',libraryVersion:'1.7.0'},tds={...ba,id:'BTV_BA_TDS'};
const buffer={duration:10,sampleRate:48000,length:480000,numberOfChannels:2} as AudioBuffer;
function baFixture(outAt=7.6){
  const data:ProjectData={_audio_voice_enabled:true,_audio_voice_gain:1,_out_mode:'duration',_out_duration_seconds:outAt};
  const graphic={data,tracks:{},audio:{buffers:{voice:{buffer}},plan:{voice:[{id:'voice_intro',mainIn:8,mainOut:9.68,sourceIn:0,sourceOut:1.68,envelope:[[0,0],[10,0]]},{id:'voice_outro',mainIn:68.48,mainOut:70.16,sourceIn:0,sourceOut:1.68,envelope:[[64.8,0],[72.92,0]]}]}}};
  return {graphic,tracks:{},data,timeline:makeTimeline(ba.id,data,{},outAt)} as unknown as PreparedGraphic;
}
function tdsFixture(delay=14){
  const data:ProjectData={_audio_voice_enabled:true,_audio_voice_start_seconds:.125,_audio_voice_end_seconds:3.725,_audio_voice_delay_seconds:delay,_audio_voice_volume:.4,_out_mode:'duration',_out_duration_seconds:15.28};
  const graphic={config:data,tracks:{},sound:{voice:{node:{src:'voice.wav',duration:5}}}};
  return {graphic,tracks:{},data,timeline:makeTimeline(tds.id,data,{},15.28)} as unknown as PreparedGraphic;
}
test('BA manual placement past actual OUT is refused before offline events, never clipped',()=>{
  const fixture=baFixture();assert.throws(()=>audioEvents(fixture,ba.id,false),/Aucun son n’a été coupé/);assert.throws(()=>assertNativeVoiceFits(fixture.graphic,ba),/Aucun son n’a été coupé/);
});
test('BA fitting placement keeps complete intro/outro source duration and exact output cue',()=>{
  const fixture=baFixture(12),events=audioEvents(fixture,ba.id,false);assert.equal(events.length,2);assert.ok(Math.abs(events[0].duration-1.68)<1e-10);assert.equal(events[0].at,8);assert.ok(Math.abs(events[1].at-15.68)<1e-10);assert.ok(Math.abs(events[1].duration-1.68)<1e-10);assert.doesNotThrow(()=>assertNativeVoiceFits(fixture.graphic,ba));
});
test('operator OUT always remains executable, with a non-blocking warning for an interrupted native voice',async()=>{
  const fixture=baFixture(),g=fixture.graphic;g.data._out_mode='manual';g._running=true;g.state={phase:'onair'};g._times=()=>({elapsed:9});let starts=0,stops=0;const warnings:string[]=[];
  g.dispatchEvent=(event:Event)=>{assert.equal(event.type,'broadcast-audio-warning');warnings.push((event as CustomEvent).detail.message);return true;};g.playAction=async()=>{starts++;};g.stopAction=async()=>{stops++;};
  installNativeVoiceFit(g,ba);await g.playAction();assert.equal(starts,1);await g.stopAction();assert.equal(stops,1);assert.match(warnings[0],/interrompue volontairement/);
  g._times=()=>({elapsed:10});await g.stopAction();assert.equal(stops,2);await g.stopAction({skipAnimation:true});assert.equal(stops,3,'Explicit clear remains available.');assert.equal(warnings.length,1);
});
test('TDS complete voice is refused if it exceeds real sound end, not playlist-truncated',()=>{
  const fixture=tdsFixture();assert.throws(()=>audioEvents(fixture,tds.id,false),/Aucun son/);assert.throws(()=>assertNativeVoiceFits(fixture.graphic,tds),/Aucun son/);
});
test('TDS full selected voice is kept at fractional offset/delay and its independent volume',()=>{
  const fixture=tdsFixture(2.123456),events=audioEvents(fixture,tds.id,false);assert.equal(events.length,1);assert.equal(events[0].start,.125);assert.equal(events[0].at,2.123456);assert.equal(events[0].duration,3.6);assert.equal(events[0].rate,1);assert.equal(events[0].gain(3),.4);
});
test('supplemental voice adds one complete event alongside the existing bed without altering it',()=>{
  const data:ProjectData={_audio_voice_enabled:true,_audio_voice_url:'voice.wav',_audio_voice_start_seconds:.125,_audio_voice_end_seconds:3.725,_audio_voice_delay_seconds:.5,_audio_voice_volume:.4,_audio_bed_enabled:true,_audio_bed_start_seconds:0,_audio_bed_volume:.2,_audio_bed_loop:true,_out_mode:'duration',_out_duration_seconds:25};
  const id='BTV_BA_TDS_SUIVI_DE',fixture={graphic:{audioBed:{src:'bed.wav',duration:40}},data,tracks:{},timeline:makeTimeline(id,data,{},25),supplementalVoice:{buffer,plan:supplementalVoicePlan({id,libraryVersion:'1.7.0'},data,buffer)!}} as unknown as PreparedGraphic;
  const events=audioEvents(fixture,id,false);assert.equal(events.length,3);assert.equal(events[0].duration,3.6);assert.equal(events[0].at,.5);assert.equal(events[0].gain(1),.4);assert.equal(events[1].url,'bed.wav');assert.equal(events[1].duration,25);assert.equal(events[1].gain(1),.2);assert.equal(events[2].start,24.28);
});
test('PopUp terminal hold cannot be used to hide an overlong supplemental voice',()=>{
  const data:ProjectData={_audio_voice_enabled:true,_audio_voice_url:'voice.wav',_audio_voice_start_seconds:0,_audio_voice_end_seconds:4.12,_audio_voice_delay_seconds:0,_out_mode:'manual',_studio_format:'tv'},id='BTV_PopUp';
  const fixture={graphic:{},data,tracks:{},timeline:makeTimeline(id,data,{},3.2),supplementalVoice:{buffer,plan:supplementalVoicePlan({id,libraryVersion:'1.7.0'},data,buffer)!}} as unknown as PreparedGraphic;
  assert.equal(fixture.timeline.duration,4.24);assert.throws(()=>audioEvents(fixture,id,false),/4.040/);
});
test('packaged HTML includes the same versioned voice/transport module and no second native BA/TDS voice',()=>{
  for(const id of ['BTV_PopUp','BTV_BA_TDS_SUIVI_DE','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay','BTV_BA_1P','BTV_BA_TDS']){
    const template=getTemplate(id),plan={format:'srtb-review-package',version:1,filename:'fixture.zip',project:{id:'fixture',title:'Fixture',revision:1,templateId:id,templateVersion:template.version,libraryVersion:template.libraryVersion},data:templateDefaults(template),files:[],totalBytes:0} as DeliveryPlan;
    const docs=packageDocuments(plan,template),runtime=docs['srtb-project.mjs'];assert.ok(docs['studio-supplemental-voice-v1.mjs']);assert.match(runtime,/installNativeVoiceFit\(graphic/);
    if(['BTV_BA_1P','BTV_BA_TDS'].includes(id))assert.doesNotMatch(runtime,/installSupplementalVoice\(graphic/);else{assert.match(runtime,/installSupplementalVoice\(graphic/);assert.match(runtime,/installPortableTransport\(graphic/);assert.match(runtime,/export const pause=/);assert.match(runtime,/transport\.dispose\(\)/);}
  }
});
