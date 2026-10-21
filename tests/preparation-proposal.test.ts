import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain.ts';
import type {BroadcastTemplate,ProjectData} from '../src/studio/domain.ts';
import {programmeDataSchema} from '../src/studio/preparation-profile-model.ts';
import type {PreparationProfile,ProgrammeData,VoiceData} from '../src/studio/preparation-profile-model.ts';
import {applyPreparation,programmeTargets,proposePreset,proposeProgramme,proposeVoice,undoPreparation,voicePatch} from '../src/studio/preparation-proposal.ts';
import {simpleBaDefaults} from '../src/studio/presentation.ts';

const ba=getTemplate('BTV_BA_1P');
const popup=getTemplate('BTV_PopUp');
const audioSource={url:'/api/graphics/media/12345678-1234-4234-8234-123456789abc/content',name:'Annonce.wav',mimeType:'audio/wav'};
function programme(overrides:Partial<ProgrammeData>={}):ProgrammeData{
  return programmeDataSchema.parse({title:'Nouveau programme',palette:['#007300'],appointments:[],...overrides});
}
function voice(cue:VoiceData['cue']={kind:'announcement',value:'Ce soir'}):VoiceData{
  return {source:audioSource,start:1.2,end:3.6,label:'Voix validée',cue,humanValidated:true};
}
function preset(template:BroadcastTemplate,data:ProjectData=templateDefaults(template)):PreparationProfile{
  return {id:'12345678-1234-4234-8234-123456789abc',kind:'preset',name:'Favori',favorite:true,archived:false,revision:1,
    template_id:template.id,template_version:template.version,library_version:template.libraryVersion,data,
    created_by:'test@example.com',updated_by:'test@example.com',created_at:'2026-09-23T00:00:00Z',updated_at:'2026-09-23T00:00:00Z',validated_by:null,validated_at:null};
}

test('programme mappings cover every catalogue template and existing title/time fields',()=>{
  const expected:Record<string,string[]>={BTV_BA_1P:['main'],BTV_PopUp:['main'],BTV_BA_TDS:['main'],BTV_BA_TDS_SUIVI_DE:['1','2'],BTV_Ce_Soir:['1','2','3'],BTV_Relais_Antenne:['current','next'],BTV_Passerelle_Replay:['main'],BTV_Renvoi:['main'],BTV_Evenement:['main'],BTV_Semainier:['1','2','3','4','5','6','7']};
  assert.deepEqual(broadcastTemplates.map(template=>template.id).sort(),Object.keys(expected).sort());
  for(const template of broadcastTemplates){
    const targets=programmeTargets(template);assert.deepEqual(targets.map(target=>target.id),expected[template.id]);
    for(const target of targets){for(const key of target.title)assert.ok(key in template.fields,key);if(target.day)assert.ok(target.day in template.fields,target.day);if(target.time)assert.ok(target.time in template.fields,target.time);}
  }
  assert.deepEqual(programmeTargets({...popup,id:'UNKNOWN'}),[]);
  assert.deepEqual(programmeTargets({...popup,fields:{}}),[]);
});

test('multi-programme templates require an explicit valid target, never a default slot',()=>{
  for(const id of ['BTV_BA_TDS_SUIVI_DE','BTV_Ce_Soir','BTV_Relais_Antenne']){
    const template=getTemplate(id),current=templateDefaults(template);
    for(const target of ['','main','unknown'])assert.throws(()=>proposeProgramme(template,current,'Fiche',programme(),target),/explicitement/);
  }
});

test('a Ce Soir programme replaces only the selected programme title and first time',()=>{
  const template=getTemplate('BTV_Ce_Soir'),current=templateDefaults(template);
  const proposal=proposeProgramme(template,current,'Fiche',programme({appointments:[{announcement:'Demain',time:'21:45'},{announcement:'Samedi',time:'22:00'}]}),'2');
  assert.equal(proposal.patch._title_2,'Nouveau programme');assert.equal(proposal.patch._time_2,'21h45');
  assert.equal(proposal.patch._title_1,undefined);assert.equal(proposal.patch._title_3,undefined);assert.equal(proposal.patch._time_1,undefined);
  assert.ok(proposal.warnings.some(warning=>warning.includes('premier horaire')));
});

test('multi-line programme mapping clears only the chosen title continuation lines',()=>{
  const template=getTemplate('BTV_BA_TDS_SUIVI_DE'),current=templateDefaults(template);
  const proposal=proposeProgramme(template,current,'Fiche',programme(),'2'),next=applyPreparation(current,proposal,'draft',false);
  assert.equal(next._p2_titre_ligne_1,'Nouveau programme');assert.equal(next._p2_titre_ligne_2,'');assert.equal(next._p2_titre_ligne_3,'');
  for(const key of ['_p1_titre_ligne_1','_p1_titre_ligne_2','_p1_sous_titre','_p2_sous_titre'])assert.equal(next[key],current[key]);
});

test('unsupported programme day, time, colour and logo are warned about rather than mapped to arbitrary fields',()=>{
  const template=getTemplate('BTV_BA_TDS'),current=templateDefaults(template);
  const proposal=proposeProgramme(template,current,'Fiche',programme({appointments:[{announcement:'Lundi',time:'12:00'}],logo:{...audioSource,name:'Logo.png',mimeType:'image/png'}}),'main');
  assert.ok(proposal.warnings.some(warning=>warning.includes('rendez-vous compatible')));
  assert.ok(proposal.warnings.some(warning=>warning.includes('couleur actuelle')));
  assert.ok(proposal.warnings.some(warning=>warning.includes('sponsors ne sont pas modifiés')));
  assert.ok(Object.keys(proposal.patch).every(key=>key.startsWith('_titre_ligne_')));
  assert.equal(applyPreparation(current,proposal,'draft',false)._color_artwork,'original');
});

test('simple BA uses one appointment and preserves hidden appointments',()=>{
  const current={...simpleBaDefaults(templateDefaults(ba)),_jour_2:'Samedi',_heure_2:'18h00',_audio_voice_enabled:true};
  const proposal=proposeProgramme(ba,current,'Fiche',programme({appointments:[{announcement:'Demain',time:'20:30'},{announcement:'Lundi',time:'21:00'}]}),'main');
  const next=applyPreparation(current,proposal,'draft',false);
  assert.equal(next._jour_1,'Demain');assert.equal(next._heure_1,'20h30');assert.equal(next._audio_voice_enabled,false);
  assert.equal(next._jour_2,'Samedi');assert.equal(next._heure_2,'18h00');
  assert.ok(proposal.warnings.some(warning=>warning.includes('supplémentaires')));
});

test('multiple BA leaves unprovided appointments intact and reports that preservation',()=>{
  const current=templateDefaults(ba),proposal=proposeProgramme(ba,current,'Fiche',programme({appointments:[{announcement:'Lundi',time:'19:30'}]}),'main');
  const next=applyPreparation(current,proposal,'draft',false);
  assert.equal(next._jour_2,current._jour_2);assert.equal(next._heure_2,current._heure_2);
  assert.ok(proposal.warnings.some(warning=>warning.includes('autres rendez-vous')));
});

test('preset application requires exact template, template version and library version',()=>{
  const current=templateDefaults(popup),profile=preset(popup,{...current,_title:'Favori du studio'});
  for(const [key,value]of [['template_id','BTV_Ce_Soir'],['template_version','999.0.0'],['library_version','999.0.0']] as const){
    assert.throws(()=>proposePreset(popup,current,{...profile,[key]:value}),/autre modèle ou.*version/);
  }
  assert.deepEqual(proposePreset(popup,current,profile).patch,{_title:'Favori du studio'});
});

test('presets reject archived or wrong-kind profiles and unsupported fields',()=>{
  const current=templateDefaults(popup),profile=preset(popup);
  assert.throws(()=>proposePreset(popup,current,{...profile,archived:true}),/actif/);
  assert.throws(()=>proposePreset(popup,current,{...profile,kind:'programme',data:programme()}),/favori actif/);
  assert.throws(()=>proposePreset(popup,current,preset(popup,{...current,_unknown_field:'Do not import'})),/Champ inconnu/);
});

test('prototype-named JSON fields are rejected, never treated as inherited template definitions',()=>{
  for(const key of ['constructor','toString','__proto__']){
    const input=JSON.parse(`{"${key}":"not a template field"}`);
    assert.equal(Object.hasOwn(input,key),true);
    assert.throws(()=>validateProjectData(popup,input),/Champ inconnu/,`validateProjectData must reject ${key}`);
    assert.throws(()=>proposePreset(popup,templateDefaults(popup),preset(popup,input)),/Champ inconnu/,`proposePreset must reject ${key}`);
  }
  assert.equal(Object.getPrototypeOf(templateDefaults(popup)),Object.prototype);
});

test('proposals contain only changes and do not mutate the draft',()=>{
  const current=templateDefaults(popup),snapshot=structuredClone(current);
  const proposal=proposeProgramme(popup,current,'Fiche',programme(),'main');
  assert.deepEqual(current,snapshot);assert.deepEqual(proposal.baseline,snapshot);assert.notEqual(proposal.baseline,current);
  const applied=applyPreparation(current,proposal,'draft',false);assert.notEqual(applied,current);assert.deepEqual(current,snapshot);
  assert.deepEqual(proposePreset(popup,current,preset(popup)).patch,{});
});

test('applying a proposal refuses a stale baseline even when the edit is unrelated to its patch',()=>{
  const current=templateDefaults(popup),proposal=proposeProgramme(popup,current,'Fiche',programme(),'main');
  assert.throws(()=>applyPreparation({...current,_subtitle:'Changed after comparison'},proposal,'draft',false),/changé depuis/);
  assert.equal(applyPreparation(current,proposal,'draft',false)._title,'Nouveau programme');
});

test('apply and undo are both restricted to active drafts',()=>{
  const current=templateDefaults(popup),proposal=proposeProgramme(popup,current,'Fiche',programme(),'main');
  const applied=applyPreparation(current,proposal,'draft',false),undo={before:current,patch:proposal.patch};
  for(const status of ['submitted','approved','rejected','unknown']){
    assert.throws(()=>applyPreparation(current,proposal,status,false),/brouillon actif/);
    assert.throws(()=>undoPreparation(applied,undo,status,false),/brouillon actif/);
  }
  assert.throws(()=>applyPreparation(current,proposal,'draft',true),/brouillon actif/);
  assert.throws(()=>undoPreparation(applied,undo,'draft',true),/brouillon actif/);
});

test('undo restores applied fields while preserving unrelated subsequent edits',()=>{
  const current=templateDefaults(popup),proposal=proposeProgramme(popup,current,'Fiche',programme(),'main');
  const applied=applyPreparation(current,proposal,'draft',false),edited={...applied,_subtitle:'Conserver cette correction'};
  const undone=undoPreparation(edited,{before:current,patch:proposal.patch},'draft',false);
  assert.equal(undone._title,current._title);assert.equal(undone._color_panel,current._color_panel);assert.equal(undone._subtitle,'Conserver cette correction');
  assert.equal(edited._title,'Nouveau programme');
});

test('undo refuses to overwrite a subsequently edited applied field',()=>{
  const current=templateDefaults(popup),proposal=proposeProgramme(popup,current,'Fiche',programme(),'main');
  const edited={...applyPreparation(current,proposal,'draft',false),_title:'Correction volontaire'};
  assert.throws(()=>undoPreparation(edited,{before:current,patch:proposal.patch},'draft',false),/retouché depuis/);
  assert.equal(edited._title,'Correction volontaire');
});

test('undo removes a newly introduced field rather than leaving an undefined value',()=>{
  const before={_title:'Original'},patch={_color_panel:'vert'},current={...before,...patch,_subtitle:'Conserver'};
  const undone=undoPreparation(current,{before,patch},'draft',false);
  assert.deepEqual(undone,{_title:'Original',_subtitle:'Conserver'});assert.equal(Object.hasOwn(undone,'_color_panel'),false);
});

test('voice mapping uses each compatible model’s exact trim fields without changing levels or offsets',()=>{
  const recorded=voice();
  assert.deepEqual(voicePatch(ba,recorded),{_audio_voice_url:audioSource,_audio_voice_enabled:true,_audio_voice_in_seconds:1.2,_audio_voice_out_seconds:3.6});
  assert.deepEqual(voicePatch(getTemplate('BTV_BA_TDS'),recorded),{_audio_voice_url:audioSource,_audio_voice_enabled:true,_audio_voice_start_seconds:1.2,_audio_voice_end_seconds:3.6});
  const current={...simpleBaDefaults(templateDefaults(ba)),_audio_voice_gain:.7,_audio_voice_intro_offset_seconds:2};
  const next=applyPreparation(current,proposeVoice(ba,current,'Voix',recorded),'draft',false);
  assert.equal(next._audio_voice_gain,.7);assert.equal(next._audio_voice_intro_offset_seconds,2);
});

test('all models accept a dedicated voice without replacing their existing music',()=>{
  for(const template of broadcastTemplates.filter(template=>!['BTV_BA_1P','BTV_BA_TDS'].includes(template.id))){
    assert.deepEqual(voicePatch(template,voice()),{_audio_voice_url:audioSource,_audio_voice_enabled:true,_audio_voice_start_seconds:1.2,_audio_voice_end_seconds:3.6});
    const target=programmeTargets(template)[0].id,proposal=proposeProgramme(template,templateDefaults(template),'Fiche',programme(),target,voice());
    assert.equal(proposal.patch._audio_voice_enabled,true);
    assert.ok(Object.keys(proposal.patch).filter(key=>key.startsWith('_audio')).every(key=>key.startsWith('_audio_voice')));
  }
  const fields={...ba.fields};delete fields._audio_voice_out_seconds;
  assert.throws(()=>voicePatch({...ba,fields},voice()),/voix annonce compatible/);
});

test('voice and pinned programme voice must match the BA day or time being applied',()=>{
  const current=simpleBaDefaults(templateDefaults(ba));
  assert.doesNotThrow(()=>proposeVoice(ba,current,'Voix',voice()));
  assert.doesNotThrow(()=>proposeVoice(ba,current,'Voix',voice({kind:'time',value:'20:30'})));
  assert.throws(()=>proposeVoice(ba,current,'Voix',voice({kind:'announcement',value:'Demain'})),/autre jour/);
  assert.throws(()=>proposeVoice(ba,current,'Voix',voice({kind:'time',value:'19:00'})),/autre horaire/);
  const nextProgramme=programme({appointments:[{announcement:'Demain',time:'19:00'}]});
  assert.throws(()=>proposeProgramme(ba,current,'Fiche',nextProgramme,'main',voice()),/autre jour/);
  const proposal=proposeProgramme(ba,current,'Fiche',nextProgramme,'main',voice({kind:'announcement',value:'Demain'}));
  assert.equal(proposal.patch._jour_1,'Demain');assert.equal(proposal.patch._audio_voice_enabled,true);
});

test('voice day and time compatibility normalizes case and spacing but never merges distinct announcements',()=>{
  const current={...templateDefaults(ba),_jour_1:'  vEnDrEdI  ',_heure_1:' 8 H 30 '};
  assert.doesNotThrow(()=>proposeVoice(ba,current,'Voix',voice({kind:'announcement',value:'Vendredi'})));
  assert.doesNotThrow(()=>proposeVoice(ba,current,'Voix',voice({kind:'time',value:'08:30'})));
  assert.throws(()=>proposeVoice(ba,current,'Voix',voice({kind:'announcement',value:'Ce soir'})),/autre jour/);
  assert.doesNotThrow(()=>proposeProgramme(ba,current,'Fiche',programme(),'main',voice({kind:'announcement',value:'Vendredi'})));
});

test('a programme time-only change disables the old voice unless a matching pinned voice replaces it',()=>{
  const current={...simpleBaDefaults(templateDefaults(ba)),_audio_voice_enabled:true},nextProgramme=programme({appointments:[{announcement:'Ce soir',time:'21:00'}]});
  const proposal=proposeProgramme(ba,current,'Fiche',nextProgramme,'main');
  assert.equal(proposal.patch._audio_voice_enabled,false);
  const withVoice=proposeProgramme(ba,current,'Fiche',nextProgramme,'main',voice({kind:'time',value:'21:00'}));
  assert.equal(applyPreparation(current,withVoice,'draft',false)._audio_voice_enabled,true);
});

test('a semantically unchanged programme appointment keeps its existing voice enabled',()=>{
  const current={...templateDefaults(ba),_jour_1:' vendredi ',_heure_1:'14H00',_audio_voice_enabled:true};
  const proposal=proposeProgramme(ba,current,'Fiche',programme({appointments:[{announcement:'Vendredi',time:'14:00'}]}),'main');
  assert.equal(proposal.patch._audio_voice_enabled,undefined);
  assert.equal(applyPreparation(current,proposal,'draft',false)._audio_voice_enabled,true);
});

test('voice validation requires human confirmation, valid audio and a nonempty trim range',()=>{
  assert.throws(()=>voicePatch(ba,{...voice(),humanValidated:false} as unknown as VoiceData));
  assert.throws(()=>voicePatch(ba,{...voice(),source:{...audioSource,mimeType:'image/png'}}));
  assert.throws(()=>voicePatch(ba,{...voice(),start:5,end:5}));
});
