import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain.ts';
import {deriveProjects,derivationChoices} from '../src/studio/derivation-model.ts';
for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier'])test(`${id}: explicit, independent social recipes`,()=>{
  const template=getTemplate(id),data=templateDefaults(template),source={templateId:id,templateVersion:template.version,libraryVersion:template.libraryVersion,title:'Programme',data};
  const initial=structuredClone(data),children=deriveProjects(source,['ba-vertical','ba-portrait']);
  assert.deepEqual(children.map(c=>c.data._studio_format),['vertical','portrait']);assert.deepEqual(data,initial);
  assert.ok(children.every(c=>c.templateId===id&&c.data!==data));
  assert.equal(derivationChoices(data,id).filter(c=>c.selected).length,2);
  assert.throws(()=>deriveProjects(source,['tds']),/recette/);
  children[0].data._studio_format='tv';assert.equal(children[1].data._studio_format,'portrait');
});
test('event popup preserves title, appointment and source; clears unrelated example background/audio',()=>{
  const template=getTemplate('BTV_Evenement'),data={...templateDefaults(template),title_1:'CONCERT',title_2:'EN DIRECT',day:'Vendredi',time:'',_media_event_url:{url:'local-media:'+'a'.repeat(64)+':123456',name:'Programme.mp4',mimeType:'video/mp4'}};
  const source={templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,title:'Concert',data};
  const child=deriveProjects(source,['popup-follow'])[0];assert.equal(child.templateId,'BTV_PopUp');assert.equal(child.data._title,'CONCERT\nEN DIRECT');assert.equal(child.data._label,'Vendredi');assert.equal(child.data._background_visible,false);assert.deepEqual(child.data._media_popup_url,data._media_event_url);
});
