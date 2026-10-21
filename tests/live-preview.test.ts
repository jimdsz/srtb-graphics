import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import {liveTextEdit,previewUpdateNeeded} from '../src/studio/live-preview';
import {patchTextStyle} from '../src/studio/typography-model';
import {appointmentTextVisible,chooseAppointmentDisplay} from '../src/studio/appointment-display';
import {engineData} from '../src/studio/presentation';

const ba=getTemplate('BTV_BA_1P');
test('social crop is live without rebuilding media; invalid or mixed changes are not',()=>{
  const data=templateDefaults(ba);
  assert.equal(liveTextEdit(ba,data,{...data,_studio_body_x:75},true),true);
  assert.equal(liveTextEdit(ba,data,{...data,_studio_body_fit:'contain'},true),true);
  for(const patch of [{_studio_body_x:101},{_studio_body_x:NaN},{_studio_unknown_x:10},{_studio_body_fit:'bad'},{_studio_body_x:75,_media_body_url:'other.mp4'}])assert.equal(liveTextEdit(ba,data,{...data,...patch},true),false);
  assert.equal(liveTextEdit(ba,data,{...data,_studio_body_x:75},false),false);
});
test('first custom style establishes export geometry, later styled edits reuse it',()=>{
  const before=templateDefaults(ba),styled={...before,...patchTextStyle(before,'_jour_1',{size:150})};
  assert.equal(liveTextEdit(ba,before,styled),false);
  assert.equal(liveTextEdit(ba,styled,{...styled,...patchTextStyle(styled,'_jour_1',{size:160})}),true);
  assert.equal(liveTextEdit(ba,styled,{...styled,_jour_1:'Ce soir'}),true);
  assert.equal(liveTextEdit(ba,styled,{...styled,...patchTextStyle(styled,'_jour_1',null)}),false);
  assert.equal(liveTextEdit(ba,styled,{...styled,_jour_1:''}),false);
});
test('native positions stay immediate while HTML custom-style transitions rebuild',()=>{
  for(const id of ['BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay']){
    const template=getTemplate(id),before=templateDefaults(template),field=id==='BTV_Relais_Antenne'?'_next_label':id==='BTV_Ce_Soir'?'_heading':'_title';
    assert.equal(liveTextEdit(template,before,{...before,...patchTextStyle(before,field,{x:1,y:0})}),true);
    assert.equal(liveTextEdit(template,before,{...before,...patchTextStyle(before,field,{size:115})}),false);
  }
});
test('native variants, timing, media, source font and audio controls keep full validation',()=>{
  const data=templateDefaults(ba);
  for(const patch of [{_titre_ligne_3:'TROIS'},{_out_duration_seconds:90},{_media_body_url:'missing.mp4'},{_audio_voice_enabled:!data._audio_voice_enabled}]){
    assert.equal(liveTextEdit(ba,data,{...data,...patch}),false);
  }
  assert.equal(liveTextEdit(ba,data,{...data,_titre_ligne_1:'Autre titre'},true),true);
  assert.equal(liveTextEdit(ba,data,{...data,_media_body_url:'missing.mp4'},true),false);
});
test('automatic update coalesces attempts, blocks export/suspension and does not spin on errors',()=>{
  assert.equal(previewUpdateNeeded('b','a','',true,false),true);
  assert.equal(previewUpdateNeeded('b','a','b',true,false),false);
  assert.equal(previewUpdateNeeded('c','a','b',true,false),true);
  assert.equal(previewUpdateNeeded('a','a','',true,false),false);
  assert.equal(previewUpdateNeeded('b','a','',true,true),false);
  assert.equal(previewUpdateNeeded('b','a','',false,false),false);
});
test('hiding/replacing appointment keeps saved editorial values, no forced fake hour or upload',()=>{
  const source={...templateDefaults(ba),_jour_1:'Ce soir',_heure_1:''};
  for(const display of ['hidden','logo']){
    const next={...source,...chooseAppointmentDisplay(source,display)},native=engineData(next,true);
    assert.equal(next._jour_1,'Ce soir');assert.equal(next._heure_1,'');assert.equal(appointmentTextVisible(next),false);
    for(const n of [1,2,3]){assert.equal(native[`_jour_${n}`],'');assert.equal(native[`_heure_${n}`],'');}
    assert.equal(next._studio_overlay_logo_enabled,false);
    assert.equal(engineData({...next,...chooseAppointmentDisplay(next,'text')},true)._jour_1,'Ce soir');
  }
  assert.equal(source._jour_1,'Ce soir');
});
