import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain.ts';
import {hasSupplementalVoice,voiceFields,supplementalVoiceTemplates} from '../src/studio/voice-fields.ts';
import {selectedMediaData} from '../src/studio/media-selection.ts';
import {previewData} from '../src/studio/preview-data.ts';
import {replaceMedia} from '../src/studio/media-trim.ts';

test('each model has an independent voice selection with a bounded volume and source range',()=>{
  for(const template of broadcastTemplates){
    const fields=template.fields;
    for(const key of ['_audio_voice_enabled','_audio_voice_url'])assert.ok(key in fields,template.id+key);
    assert.equal(fields._audio_voice_url['x-control'],'audio');
    const defaults=templateDefaults(template);
    assert.deepEqual(validateProjectData(template,defaults),defaults);
  }
});
test('supplemental voice extensions are additive, silent by default and version limited',()=>{
  assert.deepEqual([...supplementalVoiceTemplates].sort(),['BTV_PopUp','BTV_BA_TDS_SUIVI_DE','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay','BTV_Renvoi','BTV_Evenement','BTV_Semainier'].sort());
  assert.deepEqual(voiceFields('BTV_BA_1P'),{});
  assert.deepEqual(voiceFields('BTV_BA_TDS'),{});
  assert.deepEqual(voiceFields('UNKNOWN'),{});
  for(const id of supplementalVoiceTemplates){
    const template=getTemplate(id),defaults=templateDefaults(template);
    assert.equal(hasSupplementalVoice(template),true);
    assert.equal(hasSupplementalVoice({...template,libraryVersion:'2.0.0'}),false);
    assert.equal(defaults._audio_voice_enabled,false);
    assert.equal(defaults._audio_voice_url,'');
    assert.equal(defaults._audio_voice_end_seconds,0);
    assert.equal(defaults._audio_voice_delay_seconds,0);
  }
});
test('disabled local voice is never resolved or opened by the selected media copy',()=>{
  for(const id of supplementalVoiceTemplates){
    const template=getTemplate(id),data={...templateDefaults(template),_audio_voice_url:'lib/voice.wav'};
    assert.equal(selectedMediaData(template,data)._audio_voice_url,'');
    assert.equal(data._audio_voice_url,'lib/voice.wav');
    assert.equal(previewData({...data,_audio_voice_enabled:true},true)._audio_voice_enabled,false);
    assert.equal(previewData({...data,_audio_voice_enabled:true},false)._audio_voice_enabled,true);
  }
});
test('replacing a voice resets only its source markers and asks for explicit activation',()=>{
  for(const id of supplementalVoiceTemplates){
    const template=getTemplate(id),next=replaceMedia('_audio_voice_url',{url:'lib/voice.wav',name:'Voix.wav',mimeType:'audio/wav'},template.fields);
    assert.deepEqual(Object.keys(next).sort(),['_audio_voice_url','_audio_voice_start_seconds','_audio_voice_end_seconds','_audio_voice_enabled'].sort());
    assert.equal(next._audio_voice_start_seconds,0);assert.equal(next._audio_voice_end_seconds,0);assert.equal(next._audio_voice_enabled,false);
  }
});
