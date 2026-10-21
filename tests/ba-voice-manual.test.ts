import test from 'node:test';
import assert from 'node:assert/strict';
import {baVoicePlacement,baVoiceDucking} from '../src/studio/ba-voice-placement';
import {getTemplate,validateProjectData} from '../src/studio/domain';
import {derivationAnnouncementSchema} from '../src/studio/derivation-announcements';

test('manual voice placement preserves sub-frame source duration and independent cues',()=>{
  const duration=169274/48000,offsets={intro:2.137,outro:65.123},plan=baVoicePlacement(duration,'manual',offsets);
  assert.equal(plan.intro,offsets.intro);assert.equal(plan.outro,offsets.outro);
  assert.equal(plan.duration,duration);assert.equal(plan.introEnd,offsets.intro+duration);assert.equal(plan.outroEnd,offsets.outro+duration);
  assert.equal(validateProjectData(getTemplate('BTV_BA_1P'),{_studio_ba_voice_fit:'manual'})._studio_ba_voice_fit,'manual');
});
test('manual voice placement refuses truncation and preserves legacy limits',()=>{
  assert.throws(()=>baVoicePlacement(3.6,'manual',{intro:6.1,outro:65}),/passage entier/);
  assert.throws(()=>baVoicePlacement(3.6,'manual',{intro:1,outro:69.4}),/passage entier/);
  assert.throws(()=>baVoicePlacement(1,'manual',{intro:-.01,outro:64.8}),/personnalisé/);
  assert.throws(()=>baVoicePlacement(1,'manual',{intro:0,outro:64.79}),/personnalisé/);
  assert.throws(()=>baVoicePlacement(3.6,'source'),/explicitement/);
  assert.deepEqual(baVoicePlacement(8.12,'manual',{intro:0,outro:64.8}),{intro:0,outro:64.8,duration:8.12,introEnd:8.12,outroEnd:72.92,adapted:true});
});
test('manual jingle duck follows each cue without rewriting it or touching source trim',()=>{
  const data={_studio_ba_voice_fit:'manual',_audio_voice_enabled:true,_audio_voice_in_seconds:1.125,_audio_voice_out_seconds:3.625,_audio_voice_intro_offset_seconds:3.25,_audio_voice_outro_offset_seconds:65.125};
  const copy=structuredClone(data),duck=baVoiceDucking(data)!;
  assert.deepEqual(data,copy);
  assert.deepEqual(duck.intro,[[2.85,0],[3.25,-10],[5.75,-10],[6.15,0]]);
  assert.deepEqual(duck.outro,[[64.725,0],[65.125,-10],[67.625,-10],[68.025,0]]);
  assert.equal(baVoiceDucking({...data,_audio_voice_enabled:false}),undefined);
});
test('derivation request can explicitly retain manual timing without supplying arbitrary new keys',()=>{
  const input={key:'today',time:'20:30',formats:['tv'],voice:{mode:'profile',profileId:'330897c0-9ec9-40d7-b4b9-f7e77428142e',revision:1,placement:'manual'}};
  assert.equal(derivationAnnouncementSchema.parse(input).voice.mode,'profile');
  assert.equal(derivationAnnouncementSchema.safeParse({...input,voice:{...input.voice,introOffset:1}}).success,false);
});
