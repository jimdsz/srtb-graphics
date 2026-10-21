import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {broadcastTemplates,getTemplate,templateDefaults} from '../src/studio/domain';
import {inspectorQuery,inspectorSearchPanels,matchesInspectorQuery,matchesInspectorField} from '../src/studio/inspector-search';
import TextSettings from '../src/studio/TextSettings';

for(const template of broadcastTemplates)for(const format of ['tv','portrait','vertical']){
  test(`${template.id} ${format}: voice search finds choice/timing and gain, without unrelated panels`,()=>{
    const data={...templateDefaults(template),_studio_format:format};
    const panels=inspectorSearchPanels(template,data,' VoIx ');
    assert.equal(panels.voice,true);assert.equal(panels.sound,true);
    assert.deepEqual(Object.entries(panels).filter(([,found])=>found).map(([name])=>name),['sound','voice']);
    assert.deepEqual(data,{...templateDefaults(template),_studio_format:format},'Searching must not modify saved settings');
  });
}

test('gain and calage find their dedicated groups, including internal audio field names',()=>{
  const template=getTemplate('BTV_PopUp'),data=templateDefaults(template);
  const found=(query:string)=>Object.entries(inspectorSearchPanels(template,data,query)).filter(([,match])=>match).map(([key])=>key);
  assert.deepEqual(found('gain'),['sound']);assert.deepEqual(found('calage'),['voice']);
  assert.deepEqual(found('_audio_voice_volume'),['sound']);
  assert.deepEqual(found('_audio_voice_delay_seconds'),['voice']);
});

test('unmatched queries and whitespace do not masquerade as results',()=>{
  const template=getTemplate('BTV_BA_1P'),data=templateDefaults(template);
  assert.equal(Object.values(inspectorSearchPanels(template,data,'introuvable-78291')).some(Boolean),false);
  assert.equal(inspectorQuery(' \t\n '),'');
  assert.equal(inspectorQuery('  DÉCALAGE    voix  '),'decalage voix');
  assert.equal(matchesInspectorQuery('VOIX décalage','Décalage de la voix'),true);
  assert.equal(matchesInspectorQuery('VOIX décalage','Volume de la voix'),false);
});

test('montage and everyday editing terms find the real sequence controls',()=>{
  for(const template of broadcastTemplates){
    for(const [name,field] of Object.entries(template.fields).filter(([name])=>name.endsWith('_sequence'))){
      for(const query of ['montage','assembler','enchaîner','extraits','dupliquer']){
        assert.equal(matchesInspectorField(query,name,field,field['x-section']||''),true,`${template.id} ${name} ${query}`);
      }
    }
  }
  assert.equal(matchesInspectorField('montage','_title',{title:'Titre'},'Textes'),false);
});

test('only controls implemented for the selected model and format are indexed',()=>{
  const ba=getTemplate('BTV_BA_1P'),popup=getTemplate('BTV_PopUp');
  assert.equal(inspectorSearchPanels(ba,templateDefaults(ba),'masquer rendez-vous').appointment,true);
  assert.equal(inspectorSearchPanels(popup,templateDefaults(popup),'masquer rendez-vous').appointment,false);
  assert.equal(inspectorSearchPanels(popup,templateDefaults(popup),'transparence').popupBackground,true);
  assert.equal(inspectorSearchPanels(ba,templateDefaults(ba),'transparence').popupBackground,false);
  assert.equal(inspectorSearchPanels(ba,{...templateDefaults(ba),_studio_format:'tv'},'placement').placement,false);
  assert.equal(inspectorSearchPanels(ba,{...templateDefaults(ba),_studio_format:'vertical'},'placement').placement,true);
});

test('logo, text and layout queries remain independently reachable',()=>{
  const template=getTemplate('BTV_BA_1P'),data=templateDefaults(template);
  assert.equal(inspectorSearchPanels(template,data,'logo').logos,true);
  assert.equal(inspectorSearchPanels(template,data,'police').typography,true);
  assert.equal(inspectorSearchPanels(template,data,'répartition').textLayout,true);
  assert.equal(inspectorSearchPanels(template,data,'police').voice,false);
});

test('BA title help describes the live preview separately from saving the shared project',()=>{
  const template=getTemplate('BTV_BA_1P');
  for(const format of ['tv','portrait','vertical']){
    const html=renderToStaticMarkup(createElement(TextSettings,{template,data:{...templateDefaults(template),_studio_format:format},onChange(){},disabled:false}));
    assert.match(html,/modifications s’affichent automatiquement dans l’aperçu/);
    assert.match(html,/Le projet partagé ne change qu’à l’enregistrement/);
    assert.doesNotMatch(html,/Appliquez les réglages/);
  }
});
