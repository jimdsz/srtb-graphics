import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {deriveProjects,derivationChoices} from '../src/studio/derivation-model';

const ba=getTemplate('BTV_BA_1P');
function source(patch:ProjectData={}){
  return {templateId:ba.id,templateVersion:ba.version,libraryVersion:ba.libraryVersion,title:'Rendez-vous SRTB',data:{...templateDefaults(ba),...patch}};
}

test('independent pack review: simple BA never resurrects hidden second and third appointments',()=>{
  const input=source({_studio_ba_mode:'simple',_jour_1:'Ce soir',_heure_1:'20h30',_jour_2:'Lundi',_heure_2:'09h00',_jour_3:'Mardi',_heure_3:'10h00'});
  assert.deepEqual(derivationChoices(input.data).filter(choice=>choice.key.startsWith('popup')).map(choice=>choice.key),['popup-1']);
  assert.throws(()=>deriveProjects(input,['popup-2']));
  assert.equal(deriveProjects(input,['popup-1'])[0].data._label,'Ce soir · 20h30');
});

test('independent pack review: three genuine appointments produce three distinct labels, one programme',()=>{
  const input=source({_studio_ba_mode:'multiple',_titre_ligne_1:'GRAND',_titre_ligne_2:'ENTRETIEN',_titre_ligne_3:'SPÉCIAL',_jour_1:'Vendredi',_heure_1:'14h00',_jour_2:'Vendredi',_heure_2:'20h35',_jour_3:'Samedi',_heure_3:'09h00'});
  const variants=deriveProjects(input,['popup-1','popup-2','popup-3']);
  assert.deepEqual(variants.map(v=>v.data._label),['Vendredi · 14h00','Vendredi · 20h35','Samedi · 09h00']);
  assert.ok(variants.every(v=>v.data._title==='GRAND\nENTRETIEN\nSPÉCIAL'));
});

test('independent pack review: popup is transparent, timed, silent, and uses the SOURCE library',()=>{
  const input=source({_couleur_thematique:'rouge',_sous_titre_visible:false});
  const output=deriveProjects(input,['popup-1'])[0];
  assert.equal(output.templateId,'BTV_PopUp');
  assert.equal(output.data._background_visible,false);
  assert.equal(output.data._media_background_url,'');
  assert.equal(output.data._media_background_sequence,'[]');
  assert.equal(output.data._subtitle,'');
  assert.equal(output.data._color_panel,'rouge');
  assert.equal(output.data._out_mode,'duration');
  assert.equal(output.data._out_duration_seconds,12);
  assert.equal(output.data._media_popup_audio_enabled,false);
  assert.equal(output.data._media_popup_url,`/library/v${ba.libraryVersion}/${ba.id}/lib/media/programme.mp4`);
});

test('independent pack review: local selections remain portable references and ordered cuts stay exact',()=>{
  const local={url:`local-media:${'b'.repeat(64)}:987654321`,name:'Programme sur disque réseau.mp4',mimeType:'video/mp4'};
  const cuts=[{url:local,start:120.04,end:125.28},{url:local,start:380,end:384.52}];
  const input=source({_media_body_url:local,_media_body_sequence:JSON.stringify(cuts)});
  const output=deriveProjects(input,['popup-1'])[0];
  assert.equal(output.data._media_popup_url,'');
  assert.deepEqual(JSON.parse(String(output.data._media_popup_sequence)),cuts);
  assert.equal(JSON.stringify(output.data).includes('blob:'),false);
});

test('independent pack review: choosing socials does not overwrite source or another variant',()=>{
  const input=source({_studio_ba_mode:'multiple',_audio_voice_enabled:true});
  const baseline=structuredClone(input);
  const outputs=deriveProjects(input,['ba-vertical','ba-portrait']);
  assert.equal(outputs[0].data._studio_format,'vertical');
  assert.equal(outputs[1].data._studio_format,'portrait');
  assert.equal(outputs[0].data._audio_voice_enabled,true);
  outputs[0].data._titre_ligne_1='UNE RETOUCHE';
  assert.deepEqual(input,baseline);
  assert.notEqual(outputs[1].data._titre_ligne_1,'UNE RETOUCHE');
});

test('independent pack review: incompatible speed is explained instead of silently changed',()=>{
  const input=source({_media_body_rate:0.5});
  assert.throws(()=>deriveProjects(input,['popup-1']),/vitesse/);
  assert.equal(deriveProjects(input,['ba-vertical'])[0].data._media_body_rate,0.5);
});

test('independent pack review: no appointment never invents a day or programme schedule',()=>{
  const input=source({_jour_1:'',_heure_1:'',_jour_2:'',_heure_2:'',_jour_3:'',_heure_3:''});
  assert.equal(deriveProjects(input,['popup-follow'])[0].data._label,'À SUIVRE');
  assert.ok(!derivationChoices(input.data).some(choice=>/ce-soir|suivi|relais/.test(choice.key)));
});

test('independent pack review: replay requires explicit safe HTTPS and no copied announcement audio',()=>{
  const input=source();
  for(const url of ['', 'http://srtb.bj','https://user:secret@srtb.bj','javascript:alert(1)'])assert.throws(()=>deriveProjects(input,['replay'],url));
  const output=deriveProjects(input,['replay'],'https://srtb.bj/replay');
  assert.equal(output[0].data._replay_url,'https://srtb.bj/replay');
  assert.equal(output[0].data._audio_enabled,false);
});
