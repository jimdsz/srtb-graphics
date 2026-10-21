import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import DerivationAnnouncements,{AnnouncementVoicePlacementText,ManualVoicePlacement} from '../src/studio/DerivationAnnouncements';
import {baVoicePlacement} from '../src/studio/ba-voice-placement';
import {BA_CARTON_START} from '../src/studio/voice-timing-model';
import {initialAnnouncementFields,announcementCue,withAnnouncementFormat,announcementFromClassifiedVoice,announcementVoiceLabel} from '../src/studio/derivation-announcement-ui';
import {deriveProjects,derivationAnnouncementKeys} from '../src/studio/derivation-model';
import type {DerivationAnnouncement} from '../src/studio/derivation-model';
import {getTemplate,templateDefaults} from '../src/studio/domain';
const template=getTemplate('BTV_BA_1P'),data={...templateDefaults(template),_jour_1:'Lundi',_heure_1:'8h05'};
const item=(key:DerivationAnnouncement['key'],patch:Partial<DerivationAnnouncement>={}):DerivationAnnouncement=>({key,time:key==='now'?'':'08:05',formats:['tv'],voice:{mode:'pending'},...patch});
const html=(value:DerivationAnnouncement[])=>renderToStaticMarkup(createElement(DerivationAnnouncements,{data,value,onChange(){},onFive(){},disabled:false,fileFormat:'mp4',onFileFormat(){},onPlacementValidity(){}}));

test('reopening restores the retained explicit weekday and hour, not the source BA',()=>{
  const values=[item('day-time',{day:'Vendredi',time:'21:45'}),item('now')];
  assert.deepEqual(initialAnnouncementFields(data,values),{day:'Vendredi',time:'21:45',mixedTimes:false});
  const markup=html(values);
  assert.match(markup,/<option selected="">Vendredi<\/option>/);
  assert.match(markup,/type="time" value="21:45"/);
  assert.equal(announcementCue('day-time',values[0].day),'Vendredi');
  assert.notEqual(announcementCue('day-time',values[0].day),data._jour_1);
});

test('an explicit empty hour survives reopening and a one-digit source hour normalizes',()=>{
  assert.equal(initialAnnouncementFields(data,[]).time,'08:05');
  assert.equal(initialAnnouncementFields(data,[item('today',{time:''})]).time,'');
  assert.equal(initialAnnouncementFields({...data,_heure_1:''},[]).time,'');
  const markup=html([item('day-time',{day:'Mardi',time:''})]);
  assert.match(markup,/Heure commune · hors Tout de suite \(facultative\)/);
  assert.match(markup,/type="time" value=""/);
  assert.doesNotMatch(markup,/value="08:05"/);
});

test('different retained hours are not falsely displayed as one common source hour',()=>{
  const values=[item('tomorrow',{time:'20:30'}),item('today',{time:''})],before=structuredClone(values);
  assert.deepEqual(initialAnnouncementFields(data,values),{day:'Lundi',time:'',mixedTimes:true});
  assert.deepEqual(values,before);
  assert.match(html(values),/Heures différentes conservées par annonce/);
});

test('classified voice proposes its attested cue and pin without replacing the chosen time or formats',()=>{
  const profile={id:'00000000-0000-4000-8000-000000000001',revision:3,name:'Filename says Monday but is irrelevant',data:{cue:{kind:'announcement' as const,value:'Aujourd’hui' as const}}};
  for(const time of ['', '21:45']){
    const values=[item('today',{time,formats:['tv','portrait']})],before=structuredClone(values);
    const proposed=announcementFromClassifiedVoice(profile,values,'08:05');
    assert.deepEqual(proposed,{key:'today',time,formats:['tv','portrait'],voice:{mode:'profile',profileId:profile.id,revision:3}});
    assert.deepEqual(values,before);
  }
  assert.equal(announcementFromClassifiedVoice({...profile,data:{cue:{kind:'announcement',value:'Vendredi'}}},[],'')?.day,'Vendredi');
  assert.equal(announcementFromClassifiedVoice({...profile,data:{cue:{kind:'time',value:'20:30'}}},[],'08:05'),null);
  assert.equal(announcementFromClassifiedVoice({...profile,data:{cue:{kind:'announcement',value:'Tout de suite'}}},[],'08:05')?.time,'');
});

test('a pinned revision absent from the loaded catalogue is visibly pinned, never falsely pending',()=>{
  const voice={mode:'profile' as const,profileId:'00000000-0000-4000-8000-000000000001',revision:7};
  assert.equal(announcementVoiceLabel(voice),'Voix épinglée · r7 · révision non chargée');
  assert.equal(announcementVoiceLabel(voice,'Aujourd’hui attesté'),'Aujourd’hui attesté · r7');
  assert.equal(announcementVoiceLabel({mode:'pending'}),'Voix à associer');
  const markup=html([item('today',{voice})]);
  assert.match(markup,/<option disabled="" value="00000000-0000-4000-8000-000000000001:7" selected="">Voix épinglée/);
  assert.match(markup,/aucune voix plus récente ne la remplace/);
});

test('individual social formats allow five TV announcements plus two socials and one popup, exactly eight',()=>{
  const values=derivationAnnouncementKeys.map(key=>item(key,key==='day-time'?{day:'Vendredi'}:{}));
  const before=structuredClone(values);
  values[2]=withAnnouncementFormat(values[2],'portrait',true);
  values[3]=withAnnouncementFormat(values[3],'vertical',true);
  assert.deepEqual(values[0],before[0]);assert.deepEqual(values[1],before[1]);assert.deepEqual(values[4],before[4]);
  const source={templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,title:'Programme',data};
  const children=deriveProjects(source,['popup-1'],'',values);
  assert.equal(children.length,8);
  assert.ok(children.some(child=>child.targetKey==='ba-today-portrait'));
  assert.ok(children.some(child=>child.targetKey==='ba-tonight-vertical'));
  assert.ok(children.some(child=>child.targetKey==='popup-1'));
  assert.equal(children.filter(child=>child.announcement?.format==='tv').length,5);
  assert.throws(()=>deriveProjects(source,['popup-1','ba-vertical'],'',values));
  assert.deepEqual(withAnnouncementFormat(values[2],'portrait',true),values[2]);
  assert.deepEqual(withAnnouncementFormat(values[2],'portrait',false),before[2]);
});

test('limit is explained before selection and each active announcement exposes independently named formats',()=>{
  assert.match(html([]),/8 sorties maximum par ensemble/);
  const markup=html([item('today'),item('tonight')]);
  assert.equal((markup.match(/<legend>Formats de cette annonce<\/legend>/g)||[]).length,2);
  for(const name of ['4:5 pour Aujourd’hui','9:16 pour Ce soir','TV · 16:9 pour Aujourd’hui'])assert.ok(markup.includes(`aria-label="${name}"`));
  assert.match(markup,/Formats communs à toutes les annonces choisies/);
});

test('voice proposal displays IN/OUT-relative marks without changing the AE source placement',()=>{
  const placement=Object.freeze(baVoicePlacement(3.6,'fit-complete')),before={...placement};
  const markup=renderToStaticMarkup(createElement(AnnouncementVoicePlacementText,{placement}));
  assert.equal(markup,'3,600 s : intro +0,760 → +4,360 s après IN ; carton +3,680 → +7,280 s après OUT.');
  assert.doesNotMatch(markup,/68,480|72,080/);assert.deepEqual(placement,before);
  assert.equal(placement.outro,68.48);assert.equal(placement.outroEnd,72.08);
  assert.equal(Number((placement.outro-BA_CARTON_START).toFixed(3)),3.68);
  // A user's OUT at 12 s produces actual starts/ends 15.68/19.28 s;
  // neither that OUT nor the AE source origin is presented as a user offset.
  assert.equal(Number((12+placement.outro-BA_CARTON_START).toFixed(3)),15.68);
  assert.equal(Number((12+placement.outroEnd-BA_CARTON_START).toFixed(3)),19.28);
  const manual=renderToStaticMarkup(createElement(ManualVoicePlacement,{data:{...data,_studio_ba_voice_fit:'manual',_audio_voice_intro_offset_seconds:placement.intro,_audio_voice_outro_offset_seconds:placement.outro},voice:{mode:'profile',profileId:'00000000-0000-4000-8000-000000000001',revision:1},disabled:false,onChange(){}}));
  assert.match(manual,/3\.680 s après OUT/);
});

test('proposal labels derive both ends from the supplied placement, not fixed source literals',()=>{
  const placement=baVoicePlacement(1.2,'manual',{intro:2.4,outro:BA_CARTON_START+1});
  assert.equal(renderToStaticMarkup(createElement(AnnouncementVoicePlacementText,{placement})),'1,200 s : intro +2,400 → +3,600 s après IN ; carton +1,000 → +2,200 s après OUT.');
});
