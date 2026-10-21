import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {modelSignature,derivedSignature,inactiveTDSSignature} from '../src/studio/signature-sound';
import {cataloguePreviewData} from '../src/studio/catalogue-preview';
import {deriveProjects} from '../src/studio/derivation-model';

for(const id of ['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'])test(`${id}: native music reset never changes voice, media or editorial fields`,()=>{
  const template=getTemplate(id),patch=modelSignature(template)!;
  assert.ok(patch._audio_bed_url);assert.equal(patch._audio_bed_enabled,true);
  assert.ok(Object.keys(patch).every(key=>key.startsWith('_audio_bed_')));
  assert.doesNotThrow(()=>validateProjectData(template,{...templateDefaults(template),...patch}));
});

test('unrelated engines do not receive a made-up native signature',()=>assert.equal(modelSignature(getTemplate('BTV_Relais_Antenne')),undefined));

for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier'])test(`${id}: explicitly authorized private jingle, no voice or project mutation`,()=>{
  const template=getTemplate(id),before=structuredClone(templateDefaults(template)),patch=modelSignature(template)!;
  assert.equal(patch._audio_enabled,true);assert.equal(patch._audio_volume,1);
  assert.deepEqual(Object.keys(patch).sort(),['_audio_enabled','_audio_url','_audio_volume']);
  assert.equal(typeof patch._audio_url,'object');
  const file=patch._audio_url as {url:string;name:string;mimeType:string};
  assert.match(file.url,/^\/api\/graphics\/media\/[a-f\d-]+\/content$/);assert.equal(file.mimeType,'audio/wav');
  assert.doesNotThrow(()=>validateProjectData(template,{...before,...patch}));
  assert.deepEqual(templateDefaults(template),before);assert.equal(before._audio_enabled,false);
  assert.equal(modelSignature({...template,libraryVersion:'future'}),undefined);
});

for(const enabled of [true,false])test(`TDS recipes retain the source music activation (${enabled}), not its voice or BA timing`,()=>{
  const template=getTemplate('BTV_BA_1P'),data={...templateDefaults(template),_audio_bed_enabled:enabled,_audio_bed_gain:.5,_audio_voice_enabled:true};
  const source={templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,title:'Annonce',data};
  const before=structuredClone(source);
  const outputs=[...deriveProjects(source,['tds']),...deriveProjects(source,[],'',[{key:'now',formats:['tv','portrait','vertical'],voice:{mode:'none'}}])];
  assert.equal(outputs.length,4);
  for(const child of outputs){
    assert.equal(child.data._audio_bed_enabled,enabled);assert.equal(child.data._audio_bed_url,'lib/audio/BTV_BA TDS -23LUFS.wav');
    assert.equal(child.data._audio_bed_start_seconds,0);assert.equal(child.data._audio_bed_end_seconds,15);assert.equal(child.data._audio_bed_delay_seconds,0);
    assert.equal(child.data._audio_voice_enabled,false);assert.equal(child.data._audio_voice_url,'');assert.equal(child.data._media_background_audio_enabled,false);
    if(enabled)assert.equal(child.data._audio_bed_volume,.5);
    assert.ok(child.warnings.some(warning=>warning.includes('Signature sonore')));
  }
  assert.deepEqual(source,before);
});

test('gain conversion preserves mute and explicitly reports native amplification limit',()=>{
  const target=getTemplate('BTV_BA_TDS');
  assert.equal(derivedSignature({_audio_bed_enabled:true,_audio_bed_gain:0},target).patch._audio_bed_volume,0);
  const limited=derivedSignature({_audio_bed_enabled:true,_audio_bed_gain:4},target);
  assert.equal(limited.patch._audio_bed_volume,1);assert.match(limited.warning,/limité/);
});

for(const id of ['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'])test(`${id}: new projects and library have their native sound; saved silence can be restored explicitly`,()=>{
  const template=getTemplate(id),defaults=templateDefaults(template);
  assert.equal(defaults._audio_bed_enabled,true);
  assert.equal(cataloguePreviewData(template)._audio_bed_enabled,true);
  assert.equal(defaults._audio_voice_enabled,false);
  const old={...defaults,_audio_bed_enabled:false,_audio_voice_enabled:true,_audio_voice_url:'lib/voice.wav'};
  const saved=validateProjectData(template,old),before=structuredClone(saved);
  assert.equal(saved._audio_bed_enabled,false);
  assert.equal(inactiveTDSSignature(template,defaults),undefined);
  const restored={...saved,...inactiveTDSSignature(template,saved)};
  assert.equal(restored._audio_bed_enabled,true);
  assert.equal(restored._audio_voice_enabled,true);
  assert.equal(restored._audio_voice_url,'lib/voice.wav');
  assert.deepEqual(saved,before);
  assert.equal(inactiveTDSSignature({...template,libraryVersion:'future'},saved),undefined);
});
