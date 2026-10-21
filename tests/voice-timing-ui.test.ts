import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {BA_CARTON_START,voicePlacementPatch,voiceRangePatch,voiceTimingFieldNames,voiceTimingKeys} from '../src/studio/voice-timing-model';
import {dbToGain,gainLabel,gainToDb,soundFieldNames,soundTracks} from '../src/studio/sound-level-model';
import {manualAnnouncementVoice,ManualVoicePlacement} from '../src/studio/DerivationAnnouncements';
import {baVoicePlacement} from '../src/studio/ba-voice-placement';
import VoiceTimingSettings from '../src/studio/VoiceTimingSettings';
import SoundSettings from '../src/studio/SoundSettings';
import LogoSettings from '../src/studio/LogoSettings';
import {overlayLogoGeometry} from '../src/studio/logo-model';

function browser(run:()=>void){const old=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{}});try{run();}finally{if(old)Object.defineProperty(globalThis,'window',old);else Reflect.deleteProperty(globalThis,'window');}}
function unchanged(before:ProjectData,after:ProjectData,patch:ProjectData){for(const key of Object.keys(before))if(!Object.hasOwn(patch,key))assert.deepEqual(after[key],before[key],key);}

test('all seven models expose source marks separately from their actual voice placement fields',()=>{
  for(const template of broadcastTemplates){
    const keys=voiceTimingKeys(template)!;assert.ok(keys,template.id);
    for(const key of voiceTimingFieldNames(template))assert.ok(template.fields[key],key);
    assert.equal(keys.ba,template.id==='BTV_BA_1P');
    assert.equal(keys.placement.length,keys.ba?2:1);
  }
});

test('manual BA intro edit changes only that cue and explicit mode, not file marks, other cue, gains or media',()=>{
  const template=getTemplate('BTV_BA_1P'),before=templateDefaults(template),snapshot=structuredClone(before),patch=voicePlacementPatch(template,'intro',.7654321),next={...before,...patch};
  assert.deepEqual(patch,{_audio_voice_intro_offset_seconds:.7654321,_studio_ba_voice_fit:'manual'});
  validateProjectData(template,next);unchanged(before,next,patch);assert.deepEqual(before,snapshot);
});

test('carton UI seconds are relative to OUT and convert once to the absolute source timeline',()=>{
  const template=getTemplate('BTV_BA_1P'),data=templateDefaults(template),patch=voicePlacementPatch(template,'outro',1.2),next={...data,...patch};
  assert.equal(patch._audio_voice_outro_offset_seconds,BA_CARTON_START+1.2);
  assert.equal(next._audio_voice_intro_offset_seconds,data._audio_voice_intro_offset_seconds);
  assert.equal(next._studio_ba_voice_fit,'manual');validateProjectData(template,next);
  assert.equal(voicePlacementPatch(template,'outro',0)._audio_voice_outro_offset_seconds,64.8);
});

test('editing accepted-fit file marks keeps precise seconds and cue positions, explicitly enters manual mode',()=>{
  const template=getTemplate('BTV_BA_1P'),before={...templateDefaults(template),_studio_ba_voice_fit:'fit-complete'},patch=voiceRangePatch(template,before,{end:3.526541666666667}),next={...before,...patch};
  assert.deepEqual(patch,{_audio_voice_out_seconds:3.526541666666667,_studio_ba_voice_fit:'manual'});unchanged(before,next,patch);validateProjectData(template,next);
  assert.deepEqual(voiceRangePatch(template,{...before,_studio_ba_voice_fit:'source'},{start:.1}),{_audio_voice_in_seconds:.1});
  assert.throws(()=>voiceRangePatch(template,before,{start:-1}),/repère/);assert.throws(()=>voicePlacementPatch(template,'intro',NaN),/départ/);
});

test('single voice tracks preserve full-file sentinel and change only their delay',()=>{
  for(const template of broadcastTemplates.filter(template=>template.id!=='BTV_BA_1P')){
    const before=templateDefaults(template),patch=voiceRangePatch(template,before,{start:.123,end:0}),next={...before,...patch};
    assert.deepEqual(patch,{_audio_voice_start_seconds:.123,_audio_voice_end_seconds:0});validateProjectData(template,next);
    const delay=voicePlacementPatch(template,'delay',.8);assert.deepEqual(delay,{_audio_voice_delay_seconds:.8});unchanged(before,{...before,...delay},delay);
  }
});

test('gain controls bind only existing fields and respect each schema maximum without enabling tracks',()=>{
  for(const template of broadcastTemplates){
    const before=templateDefaults(template),tracks=soundTracks(template);assert.ok(tracks.length);
    assert.equal(new Set(soundFieldNames(template)).size,soundFieldNames(template).length);
    for(const track of tracks){
      assert.ok(template.fields[track.key]);if(!track.level)continue;
      for(const db of [-60,-30,-6,0,12.1]){
        const patch={[track.level]:dbToGain(db,track.maximum)},next={...before,...patch};
        assert.ok(patch[track.level]>=0&&patch[track.level]<=track.maximum);validateProjectData(template,next);unchanged(before,next,patch);assert.equal(next[track.key],before[track.key]);
      }
    }
  }
  assert.equal(dbToGain(-60,4),0);assert.equal(dbToGain(0,4),1);assert.equal(dbToGain(12.1,4),4);
  assert.ok(Math.abs(gainToDb(dbToGain(-6,1))+6)<1e-9);assert.equal(gainLabel(0),'Silence');assert.equal(gainLabel(1),'0.0 dB');assert.equal(gainLabel(4),'+12.0 dB');
});

test('voice UI has two distinct coordinate spaces and no automatic-fit action or eager player',()=>browser(()=>{
  for(const template of broadcastTemplates){
    const data=templateDefaults(template),html=renderToStaticMarkup(createElement(VoiceTimingSettings,{template,data,media:[],onChange(){},disabled:false}));
    assert.match(html,/Passage à utiliser dans le fichier/);assert.match(html,/Placement dans l’animation/);assert.match(html,/IN du fichier/);assert.match(html,/OUT du fichier/);
    assert.doesNotMatch(html,/<audio|<video|Normaliser|type="range"/);
    if(template.id==='BTV_BA_1P'){assert.match(html,/Introduction · départ après IN/);assert.match(html,/Carton · départ après OUT/);assert.match(html,/value="3.68"/);}
    else{assert.match(html,/fin réellement décodée/);assert.match(html,/Départ après IN/);}
    const levels=renderToStaticMarkup(createElement(SoundSettings,{template,data,onChange(){},disabled:false}));
    assert.match(levels,/Pistes &amp; niveaux/);assert.match(levels,/pas une normalisation mesurée/);assert.match(levels,/aria-valuetext=/);assert.doesNotMatch(levels,/>Normaliser</);
  }
}));

test('derivation manual reuse is an explicit opt-in preserving the exact pinned voice revision',()=>{
  const data={...templateDefaults(getTemplate('BTV_BA_1P')),_studio_ba_voice_fit:'manual',_audio_voice_intro_offset_seconds:.5,_audio_voice_outro_offset_seconds:65.1};
  const voice={mode:'profile' as const,profileId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',revision:4};
  const html=renderToStaticMarkup(createElement(ManualVoicePlacement,{data,voice,onChange(){},disabled:false}));
  assert.match(html,/Reprendre mon calage personnalisé/);assert.doesNotMatch(html,/checked=""/);assert.match(html,/0.300 s après OUT/);
  const accepted=manualAnnouncementVoice(data,voice,true);assert.deepEqual(accepted,{...voice,placement:'manual'});assert.deepEqual(voice,{mode:'profile',profileId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',revision:4});
  assert.deepEqual(manualAnnouncementVoice(data,accepted,false),{...voice,placement:'source'});
  assert.throws(()=>manualAnnouncementVoice({...data,_studio_ba_voice_fit:'fit-complete'},voice,true),/personnalisé/);
  assert.throws(()=>manualAnnouncementVoice(data,{mode:'pending'},true),/fiche voix/);
  assert.throws(()=>baVoicePlacement(9,'manual',{intro:.5,outro:65.1}),/passage entier/);
});

test('logo panel reports measured offsets separately from requested offsets and does not invent hidden geometry',()=>browser(()=>{
  const template=getTemplate('BTV_PopUp'),data={...templateDefaults(template),_studio_overlay_logo_enabled:true,_studio_overlay_logo_x:20,_studio_overlay_logo_y:20};
  const layout=overlayLogoGeometry(data,1920,1080,500,100),html=renderToStaticMarkup(createElement(LogoSettings,{template,data,media:[],onChange(){},disabled:false,layout}));
  assert.match(html,new RegExp(`horizontal ${layout.x.toFixed(2)} %`));assert.match(html,/après limitation aux marges/);assert.match(html,/value="20"/);
  const hidden=renderToStaticMarkup(createElement(LogoSettings,{template,data:{...data,_studio_overlay_logo_enabled:false},media:[],onChange(){},disabled:false,layout}));
  assert.match(hidden,/Logo masqué/);assert.doesNotMatch(hidden,/Dernier aperçu mesuré/);
}));
