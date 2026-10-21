import test from 'node:test';
import assert from 'node:assert/strict';
import {previewData,previewSeconds} from '../src/studio/preview-data';
import {cataloguePreviewData,REPLAY_DEMO_URL} from '../src/studio/catalogue-preview';
import {getTemplate,templateDefaults} from '../src/studio/domain';
const data={_media_body_audio_enabled:true,_audio_bed_enabled:true,_audio_voice_enabled:false,_title:'Texte'};
test('inspection displays the selected BA frame without replacing the running media clock',()=>{
  assert.equal(previewSeconds({phase:'inspection',elapsed:0,frame:496}),19.84);
  assert.equal(previewSeconds({phase:'onair',elapsed:90,frame:1400}),90);
  assert.equal(previewSeconds({elapsed:3}),3);assert.equal(previewSeconds({frame:25}),1);
  assert.equal(previewSeconds({elapsed:NaN}),undefined);
});
test('native preview mute preserves video configuration and lazily loads sound',()=>{
  const initial=previewData(data,true,true);
  assert.equal(initial._media_body_audio_enabled,true);assert.equal(initial._audio_bed_enabled,false);
  assert.deepEqual(previewData(data,false,true),data);assert.deepEqual(previewData(data,true,true,true),data);
  assert.equal(data._audio_bed_enabled,true);
});
test('legacy preview without master mute continues to silence all tracks',()=>{
  const muted=previewData(data,true,false,true);assert.equal(muted._media_body_audio_enabled,false);assert.equal(muted._audio_bed_enabled,false);
  assert.deepEqual(previewData(data,false,false),data);
});
test('library replay has an explicit demonstration QR without changing project defaults',()=>{
  const replay=getTemplate('BTV_Passerelle_Replay');assert.equal(cataloguePreviewData(replay)._replay_url,REPLAY_DEMO_URL);assert.equal(templateDefaults(replay)._replay_url,'');
  const popup=getTemplate('BTV_PopUp');assert.deepEqual(cataloguePreviewData(popup),templateDefaults(popup));
});
