import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {deriveProjects,derivationRequestSchema,normalizeAnnouncement} from '../src/studio/derivation-model';
import type {DerivationAnnouncement} from '../src/studio/derivation-model';

const ba=getTemplate('BTV_BA_1P');
const media={url:`local-media:${'c'.repeat(64)}:123456789`,name:'Programme local.mp4',mimeType:'video/mp4'};
function source(patch:ProjectData={}){
  return {templateId:ba.id,templateVersion:ba.version,libraryVersion:ba.libraryVersion,title:'Entretien — préparation',data:{...templateDefaults(ba),
    _studio_ba_mode:'simple',_titre_ligne_1:'LE GRAND',_titre_ligne_2:'ENTRETIEN',_jour_1:'Mardi',_heure_1:'20h30',
    _jour_2:'Mercredi',_heure_2:'10h00',_jour_3:'Jeudi',_heure_3:'12h00',_media_body_url:media,
    _media_body_sequence:JSON.stringify([{url:media,start:12.04,end:18.36},{url:media,start:420,end:427.72}]),
    _audio_bed_enabled:true,_audio_voice_enabled:true,...patch} as ProjectData};
}
function announcements():DerivationAnnouncement[]{return [
  {key:'day-time',day:'Mardi',time:'20:30',formats:['tv'],voice:{mode:'pending'}},
  {key:'tomorrow',time:'20:30',formats:['tv'],voice:{mode:'pending'}},
  {key:'today',time:'20:30',formats:['tv'],voice:{mode:'pending'}},
  {key:'tonight',time:'20:30',formats:['tv'],voice:{mode:'pending'}},
  {key:'now',formats:['tv'],voice:{mode:'pending'}},
];}

test('independent: five announcements keep the complete BA, source cuts, music and original project',()=>{
  const original=source(),before=structuredClone(original),items=deriveProjects(original,[],'',announcements());
  assert.equal(items.length,5);assert.deepEqual(items.slice(0,4).map(item=>item.data._jour_1),['Mardi','Demain','Aujourd’hui','Ce soir']);
  assert.equal(items[4].templateId,'BTV_BA_TDS');assert.equal(items[4].announcement?.day,'Tout de suite');
  assert.equal(new Set(items.map(item=>item.targetKey)).size,5);
  for(const item of items.slice(0,4)){
    assert.equal(item.templateId,ba.id);assert.equal(item.templateVersion,ba.version);assert.equal(item.libraryVersion,ba.libraryVersion);
    assert.equal(item.data._studio_ba_mode,'simple');assert.equal(item.data._titre_ligne_1,'LE GRAND');assert.equal(item.data._titre_ligne_2,'ENTRETIEN');
    assert.equal(item.data._media_body_sequence,before.data._media_body_sequence);assert.deepEqual(item.data._media_body_url,before.data._media_body_url);
    assert.equal(item.data._audio_bed_enabled,true);assert.equal(item.data._audio_bed_url,before.data._audio_bed_url);
    assert.equal(item.data._audio_voice_enabled,false);assert.equal(item.data._audio_voice_url,'');assert.equal(item.announcement?.voice.status,'pending');
    assert.deepEqual([item.data._jour_2,item.data._heure_2,item.data._jour_3,item.data._heure_3],['','','','']);
  }
  const immediate=items[4];
  assert.equal(immediate.data._titre_ligne_1,'LE GRAND');assert.equal(immediate.data._titre_ligne_2,'ENTRETIEN');
  assert.equal(immediate.data._media_background_sequence,before.data._media_body_sequence);
  assert.equal(immediate.data._audio_voice_enabled,false);assert.equal(immediate.announcement?.voice.status,'pending');
  assert.equal(items[4].data._heure_1,undefined);assert.ok(items.slice(0,4).every(item=>item.data._heure_1==='20h30'));
  assert.deepEqual(original,before);
  (items[0].data._media_body_url as typeof media).name='Changed only here';
  assert.equal((items[1].data._media_body_url as typeof media).name,'Programme local.mp4');assert.deepEqual(original,before);
});

test('independent: a relative source never invents the explicit weekday',()=>{
  const original=source({_jour_1:'Ce soir'}),[day]=announcements();delete day.day;
  assert.throws(()=>deriveProjects(original,[],'',[day]),/jour/i);
  day.day='Vendredi';assert.equal(deriveProjects(original,[],'',[day])[0].data._jour_1,'Vendredi');
});

test('independent: unknown times remain deliberately hidden in non-immediate announcements',()=>{
  const original=source({_heure_1:''});
  for(const item of announcements().filter(value=>value.key!=='now')){
    delete item.time;assert.equal(deriveProjects(original,[],'',[item])[0].data._heure_1,'',item.key+' source empty time');
    item.time='';assert.equal(deriveProjects(source(),[],'',[item])[0].data._heure_1,'',item.key+' explicit empty time');
  }
});

test('independent: now rejects a contradictory time rather than ignoring the selection',()=>{
  const item=announcements()[4];item.time='20:30';assert.throws(()=>deriveProjects(source(),[],'',[item]));
});

test('independent: pinned voice resolution cannot be supplied by a client payload',()=>{
  const item=announcements()[2];item.voice={mode:'profile',profileId:'00000000-0000-4000-8000-000000000001',revision:3};
  const output=deriveProjects(source(),[],'',[item])[0];
  assert.equal(output.data._audio_voice_enabled,false);assert.equal(output.announcement?.voice.revision,3);assert.equal(output.announcement?.voice.status,'pending');
  const request={requestId:'00000000-0000-4000-8000-000000000002',name:'Five',sourceRevision:1,sourceTitle:'Programme',sourceData:source().data,targets:[],announcements:[{...item,voice:{...item.voice,status:'resolved',source:media,validatedBy:'admin@example.test'}}]};
  assert.equal(derivationRequestSchema.safeParse(request).success,false);
});

test('independent: explicit no voice is different from voice still to associate',()=>{
  const item=announcements()[1];item.voice={mode:'none'};
  const output=deriveProjects(source(),[],'',[item])[0];assert.equal(output.data._audio_voice_enabled,false);assert.equal(output.announcement?.voice.status,'none');
  assert.equal(output.data._audio_bed_enabled,true);assert.ok(output.warnings.some(value=>/choix explicite/i.test(value)));
});

test('independent: today apostrophes are compared semantically without matching a different announcement',()=>{
  assert.equal(normalizeAnnouncement('  AUJOURD’HUI  '),normalizeAnnouncement("Aujourd'hui"));
  assert.notEqual(normalizeAnnouncement('Ce soir'),normalizeAnnouncement('Demain'));
});

test('independent: one temporal variant in three formats remains three separate BA projects',()=>{
  const item=announcements()[2];item.formats=['tv','portrait','vertical'];const input=source();
  const outputs=deriveProjects(input,[],'',[item]);assert.equal(outputs.length,3);
  assert.deepEqual(outputs.map(value=>value.data._studio_format),['tv','portrait','vertical']);
  assert.ok(outputs.every(value=>value.data._jour_1==='Aujourd’hui'&&value.templateId===ba.id));
  assert.equal(new Set(outputs.map(value=>value.targetKey)).size,3);
});
