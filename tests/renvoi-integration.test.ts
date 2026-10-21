import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,templateDefaults,validateProjectData} from '../src/studio/domain';
import {TIMINGS,makeTimeline,graphicTime} from '../src/studio/video/timeline';
import {socialTrackTimes} from '../src/studio/social-renderer';

const template=broadcastTemplates.find(item=>item.id==='BTV_Renvoi')!;

test('Renvoi publié expose les variantes AE 1L/2L, média, son et voix standard',()=>{
  assert.ok(template);
  assert.deepEqual(template.fields.variant.enum,['1L','2L']);
  assert.equal(template.fields._media_renvoi_url['x-control'],'media');
  assert.equal(template.fields._audio_url['x-control'],'audio');
  assert.equal(template.fields._audio_voice_url['x-control'],'audio');
});

test('Renvoi publié conserve le hold puis toute la sortie de 2,60 s',()=>{
  const data=validateProjectData(template,templateDefaults(template),true);
  const timeline=makeTimeline(template.id,data,{},7.4,false);
  assert.deepEqual(TIMINGS.BTV_Renvoi,{entry:2.8,stop:7.4,out:2.6,kind:'signature'});
  assert.equal(timeline.duration,10);
  assert.ok(Math.abs(graphicTime(timeline,5)-5)<1e-6);
  assert.ok(Math.abs(graphicTime(timeline,9.96)-9.96)<1e-6);
});

test('Renvoi publié alimente le recadrage social avec le média du renvoi',()=>{
  assert.deepEqual(socialTrackTimes(template.id,4,7.4),{renvoi:4});
});
