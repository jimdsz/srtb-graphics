import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import {deriveProjects} from '../src/studio/derivation-model';
import {plannerProject} from '../src/studio/day-planner-project';
import type {Plan,PlannerRow} from '../src/studio/day-planner-model';

const media={url:`local-media:${'d'.repeat(64)}:987654321`,name:'Programme réseau.mp4',mimeType:'video/mp4'};
const row:PlannerRow={id:'programme',sheet:'LUNDI',cell:'A7',raw:'',title:'Grand entretien',subtitle:'Épisode 31',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:30:00',duration:1800,included:true,kinds:['renvoi','event'],formats:['tv'],issues:[],media,location:null,excerpt:{source:media.url,start:120.04,end:125.28,duration:1800}};
const plan:Plan={kind:'plan',name:'Lundi',source:'conducteur.xlsx',sourceHash:'e'.repeat(64),rows:[row]};

for(const kind of ['renvoi','event'] as const)test(`planner → ${kind} → linked pop-up preserves the reviewed source window in all source formats`,()=>{
  for(const format of ['tv','portrait','vertical'] as const){
    const generated=plannerProject(plan,{kind,format,rowIds:[row.id]}),before=structuredClone(generated.data);
    const source={templateId:generated.template.id,templateVersion:generated.template.version,libraryVersion:generated.template.libraryVersion,title:generated.title,data:generated.data};
    const popup=deriveProjects(source,['popup-follow'])[0];
    assert.equal(popup.templateId,'BTV_PopUp');
    assert.deepEqual(popup.data._media_popup_url,media);
    assert.equal(popup.data._media_popup_start_seconds,120.04);
    assert.equal(popup.data._media_popup_end_seconds,125.28);
    assert.equal(popup.data._media_popup_loop,false);
    assert.equal(popup.data._media_popup_sequence,'[]');
    assert.equal(popup.data._background_visible,false);
    assert.equal(popup.data._media_popup_audio_enabled,false);
    assert.equal(popup.data._audio_voice_enabled,false);
    assert.equal(popup.data._title,'Grand entretien');
    assert.ok(String(popup.data._label).toLowerCase().includes('lundi'));
    assert.ok(String(popup.data._label).toLowerCase().includes('20h30'));
    assert.ok(!popup.warnings.some(w=>w.includes('commence au début')));
    assert.deepEqual(generated.data,before);
  }
});

test('linked AE pop-ups retain end-only or start-only windows and private descriptors; untrimmed legacy choices stay unchanged',()=>{
  for(const id of ['BTV_Renvoi','BTV_Evenement']){
    const template=getTemplate(id),track=id==='BTV_Renvoi'?'renvoi':'event';
    for(const [start,end] of [[0,5.28],[120.04,0],[0,0]]){
      const data={...templateDefaults(template),[`_media_${track}_url`]:{...media,url:'/api/graphics/media/00000000-0000-4000-8000-000000000001/content'},[`_media_${track}_start_seconds`]:start,[`_media_${track}_end_seconds`]:end};
      const [popup,vertical]=deriveProjects({templateId:id,templateVersion:template.version,libraryVersion:template.libraryVersion,title:'Passage',data},['popup-follow','ba-vertical']);
      assert.equal(popup.data._media_popup_start_seconds,start);assert.equal(popup.data._media_popup_end_seconds,end);
      assert.equal(popup.data._media_popup_loop,start!==0||end!==0?false:templateDefaults(getTemplate('BTV_PopUp'))._media_popup_loop);
      assert.deepEqual(popup.data._media_popup_url,data[`_media_${track}_url`]);
      assert.deepEqual(vertical.data,{...data,_studio_format:'vertical'});
    }
  }
});

test('AE pop-up source remains required and referenced in its own library',()=>{
  for(const id of ['BTV_Renvoi','BTV_Evenement']){
    const template=getTemplate(id),track=id==='BTV_Renvoi'?'renvoi':'event',data={...templateDefaults(template),[`_media_${track}_url`]:'lib/media/programme.mp4', [`_media_${track}_start_seconds`]:10,[`_media_${track}_end_seconds`]:15};
    const source={templateId:id,templateVersion:template.version,libraryVersion:template.libraryVersion,title:'Passage',data};
    assert.equal(deriveProjects(source,['popup-follow'])[0].data._media_popup_url,`/library/v${template.libraryVersion}/${id}/lib/media/programme.mp4`);
    assert.throws(()=>deriveProjects({...source,data:{...data,[`_media_${track}_url`]:''}},['popup-follow']),/média principal/);
  }
});
