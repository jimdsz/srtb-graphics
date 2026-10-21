import test from 'node:test';
import assert from 'node:assert/strict';
import catalogue from '../src/studio/catalogue.generated.json';
import catalogueExtensions from '../src/studio/catalogue.extensions.json';
import {broadcastTemplates,getTemplate,validateProjectData} from '../src/studio/domain';
import {dimensions,engineData,presentation,simpleBaDefaults,changeAnnouncement,locateClip,ANNOUNCEMENTS,projectTemplateName,announcementPreset} from '../src/studio/presentation';
import {cropGeometry,socialTrackTimes} from '../src/studio/social-renderer';
import {stripSupplementalVoice} from '../src/studio/supplemental-voice';

test('announcement selector recognizes imported and uppercase labels without changing saved text or voice',()=>{
  for(const label of ANNOUNCEMENTS){
    for(const value of [label,label.toLocaleUpperCase('fr'),label.toLocaleLowerCase('fr'),` ${label} `])assert.equal(announcementPreset(value),label);
  }
  assert.equal(announcementPreset("AUJOURD'HUI"),'Aujourd’hui');
  for(const value of ['',null,undefined,'Lundi 14 septembre','CE LUNDI'])assert.equal(announcementPreset(value),undefined);
  const data={_jour_1:'LUNDI',_audio_voice_enabled:true};
  assert.equal(announcementPreset(data._jour_1),'Lundi');
  assert.deepEqual(data,{_jour_1:'LUNDI',_audio_voice_enabled:true});
});

test('old projects remain TV; native payloads add inert AE montage and sound defaults alongside explicit adapters',()=>{
  assert.equal(presentation({}),'tv');assert.deepEqual(dimensions({}),{label:'Télévision · 16:9',width:1920,height:1080});
  const nativeCatalogue=[...catalogue,...catalogueExtensions];
  for(const t of broadcastTemplates){
    const native=nativeCatalogue.find(c=>c.id===t.id)!,expected=Object.fromEntries(Object.entries(native.fields).map(([key,f])=>[key,f.default??'']));
    if(t.id==='BTV_BA_1P')expected._studio_ba_voice_fit='source';
    if(t.id==='BTV_Renvoi')Object.assign(expected,{_renvoi_rating_visible:true,_renvoi_ad_visible:true});
    if(['BTV_Renvoi','BTV_Evenement','BTV_Semainier'].includes(t.id))for(const key of Object.keys(native.fields).filter(k=>/^_media_.+_url$/.test(k))){
      for(const suffix of ['start_seconds','end_seconds'])expected[key.replace(/url$/,suffix)]=0;
      expected[key.replace(/url$/,'sequence')]='[]';expected[key.replace(/url$/,'audio_enabled')]=false;expected[key.replace(/url$/,'volume')]=1;
    }
    // Legacy validation retains the original case; templateDefaults is for new
    // projects and deliberately applies the operator's uppercase convention.
    assert.deepEqual(stripSupplementalVoice(t,engineData(validateProjectData(t,{}))),expected);
  }
});

test('explicit BA voice adaptation crosses both render boundaries and can reset to the source plan',()=>{
  const template=getTemplate('BTV_BA_1P'),source=validateProjectData(template,{_studio_ba_voice_fit:'fit-complete'});
  for(const typography of [false,true]){
    assert.equal(engineData(source,typography)._studio_ba_voice_fit,'fit-complete');
    assert.equal(engineData({...source,_studio_ba_voice_fit:'source'},typography)._studio_ba_voice_fit,'source');
    assert.ok(!('_studio_format' in engineData(source,typography)));
  }
  assert.throws(()=>validateProjectData(template,{_studio_ba_voice_fit:'automatic'}));
  assert.throws(()=>validateProjectData(getTemplate('BTV_BA_TDS'),{_studio_ba_voice_fit:'fit-complete'}));
});
test('formats are constrained, persisted and never leaked to the TV engine',()=>{
  for(const t of broadcastTemplates)for(const format of ['tv','portrait','vertical']){
    const saved=validateProjectData(t,{_studio_format:format});assert.equal(saved._studio_format,format);assert.ok(!('_studio_format'in engineData(saved)));
  }
  assert.throws(()=>validateProjectData(getTemplate('BTV_BA_1P'),{_studio_format:'fake'}));
  assert.throws(()=>validateProjectData(getTemplate('BTV_BA_1P'),{_studio_body_x:101}));
});
test('simple BA clears secondary dates without replacing the source media',()=>{
  const old=validateProjectData(getTemplate('BTV_BA_1P'),{}),simple=simpleBaDefaults(old);
  assert.equal(simple._jour_1,'Ce soir');assert.equal(simple._audio_voice_enabled,false);
  for(const n of [2,3]){assert.equal(simple[`_jour_${n}`],'');assert.equal(simple[`_heure_${n}`],'');}
  assert.equal(simple._media_body_url,old._media_body_url);assert.equal(old._jour_2,'vendredi');
  assert.equal(projectTemplateName(getTemplate('BTV_BA_1P'),simple),'Bande-annonce simple · un rendez-vous');
  assert.equal(projectTemplateName(getTemplate('BTV_BA_1P'),old),getTemplate('BTV_BA_1P').name);
});
test('a changed announcement cannot retain the old active day voice',()=>{
  for(const day of ANNOUNCEMENTS)assert.equal(changeAnnouncement({_jour_1:'Autre',_audio_voice_enabled:true},day)._audio_voice_enabled,false);
  assert.equal(changeAnnouncement({_jour_1:'Ce soir',_audio_voice_enabled:true},'Ce soir')._audio_voice_enabled,true);
});
test('media crop never stretches source and focal positions stay bounded',()=>{
  const box={x:0,y:0,w:1080,h:1350};
  const fill=cropGeometry(1920,1080,box,50,50);assert.equal(fill.w/fill.h,1920/1080);assert.equal(fill.h,1350);assert.ok(fill.x<0);
  const left=cropGeometry(1920,1080,box,0,50),right=cropGeometry(1920,1080,box,100,50);assert.equal(left.x,0);assert.equal(right.x+right.w,1080);
  const fit=cropGeometry(1920,1080,box,50,50,true);assert.equal(fit.w,1080);assert.ok(fit.y>0);
});
test('social playlists keep source offsets, rate, looping and BA OUT clocks',()=>{
  const clips=[{start:30,length:2},{start:600,length:4}];
  assert.deepEqual(locateClip(clips,2,false),{index:1,time:600});
  assert.deepEqual(locateClip(clips,7,true),{index:0,time:31});
  assert.deepEqual(locateClip(clips,2,false,.5),{index:0,time:31});
  assert.deepEqual(socialTrackTimes('BTV_BA_1P',12,10),{pack:2});
  assert.deepEqual(socialTrackTimes('BTV_BA_TDS_SUIVI_DE',15,24),{programme_1:15,programme_2:1.1999999999999993});
  assert.deepEqual(Object.keys(socialTrackTimes('BTV_BA_1P',5,10)),['intro','body']);
  assert.deepEqual(Object.keys(socialTrackTimes('BTV_BA_1P',10.5,10)),['body','pack']);
  assert.deepEqual(socialTrackTimes('BTV_BA_1P',17,10),{pack:6.4});
  assert.deepEqual(socialTrackTimes('BTV_BA_1P',18.12,10),{});
});
test('simple mode preserves hidden appointments in the project, not in the engine payload',()=>{
  const saved=validateProjectData(getTemplate('BTV_BA_1P'),{_studio_ba_mode:'simple',_jour_2:'Vendredi',_heure_2:'20h30'});
  assert.equal(saved._jour_2,'Vendredi');assert.equal(engineData(saved)._jour_2,'');
  assert.equal(engineData({...saved,_studio_ba_mode:'multiple'})._jour_2,'Vendredi');
});
