import test from 'node:test';import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import {teamVoiceActivation,chooseSharedVoice} from '../src/studio/team-voice-choice';
test('whole short team voice fits BA intro and carton without changing the bed or announcement',()=>{
 const t=getTemplate('BTV_BA_1P'),data=templateDefaults(t),patch=teamVoiceActivation(t,data,3.5265417);
 assert.equal(patch._audio_voice_enabled,true);assert.equal(patch._audio_voice_out_seconds,3.5265417);
 assert.equal(patch._audio_voice_intro_offset_seconds,4.36-3.5265417);assert.equal(patch._audio_voice_outro_offset_seconds,68.48);
 assert.equal(patch._audio_bed_enabled,undefined);assert.equal(patch._jour_1,undefined);assert.throws(()=>teamVoiceActivation(t,data,5));
});
test('replacing a team voice starts disabled and does not attest its editorial content',()=>{
 const t=getTemplate('BTV_Ce_Soir'),p=chooseSharedVoice(t,templateDefaults(t),{id:'a',name:'demain.mp3',mime_type:'audio/mpeg',status:'ready',bytes:80000,created_at:'',created_by:''});
 assert.equal(p._audio_voice_enabled,false);assert.equal(p.humanValidated,undefined);
 const activated=teamVoiceActivation(t,p,3);assert.equal(activated._audio_voice_end_seconds,3);assert.equal(activated._audio_voice_delay_seconds,undefined);
});
