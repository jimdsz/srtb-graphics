import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {Project} from '../src/studio/domain';
import {defaultDerivationOptions,derivationIntent,foreignLibraryFields} from '../src/studio/derivation-workbench';
const template=getTemplate('BTV_BA_1P');
const project:Project={id:'00000000-0000-4000-8000-000000000001',title:'Partagé',data:templateDefaults(template),template_id:template.id,template_version:template.version,library_version:template.libraryVersion,revision:7,status:'draft',archived:0,created_at:'2026-09-23T00:00:00.000Z',updated_at:'2026-09-23T00:00:00.000Z',created_by:'qa@example.test',updated_by:'qa@example.test'};
test('intent captures unsaved source with CAS revision, never mutates saved project or subsequent draft',()=>{
  const data=structuredClone(project.data);data._titre_ligne_1='Non enregistré';
  const intent=derivationIntent(template,project,'Brouillon affiché',data,'Campagne',['ba-vertical'],'','00000000-0000-4000-8000-000000000002');
  data._titre_ligne_1='Modification ultérieure';
  assert.equal(intent.sourceRevision,7);assert.equal(intent.sourceTitle,'Brouillon affiché');assert.equal(intent.sourceData._titre_ligne_1,'Non enregistré');assert.equal(project.title,'Partagé');assert.notEqual(project.data._titre_ligne_1,'Non enregistré');assert.equal(intent.replayUrl,undefined);
});
test('intent rejects provisional blobs, empty names, duplicate outputs and unrecognized data',()=>{
  const call=(data=project.data,title='Nom',targets=['ba-vertical'] as ('ba-vertical')[])=>derivationIntent(template,project,title,data,'Campagne',targets,'','00000000-0000-4000-8000-000000000002');
  assert.throws(()=>call({...project.data,_media_body_url:{url:'blob:http://localhost/x',name:'test.mp4',mimeType:'video/mp4'}}));
  assert.throws(()=>call(project.data,''));assert.throws(()=>call(project.data,'Nom',['ba-vertical','ba-vertical']));assert.throws(()=>call({...project.data,unknown:'x'}));
});
test('reuse refusal recognizes source-library descriptors and playlists including inactive alternates',()=>{
  const popup=getTemplate('BTV_PopUp'),data=templateDefaults(popup),url='/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4';
  assert.deepEqual(foreignLibraryFields(popup,data),[]);
  data._media_popup_url={url,name:'Programme.mp4',mimeType:'video/mp4'};
  data._background_visible=false;data._media_background_sequence=JSON.stringify([{url,start:0,end:1}]);
  assert.deepEqual(foreignLibraryFields(popup,data).sort(),['_media_background_sequence','_media_popup_url']);
  assert.deepEqual(foreignLibraryFields(template,{...project.data,_media_body_url:url}),[]);
});
test('private/local media require no inherited library grant; format defaults do not promise MP4 alpha',()=>{
  const popup=getTemplate('BTV_PopUp');
  for(const url of ['/api/graphics/media/00000000-0000-4000-8000-000000000002/content',`local-media:${'a'.repeat(64)}:12`])assert.deepEqual(foreignLibraryFields(popup,{...templateDefaults(popup),_media_popup_url:{url,name:'Media.mp4',mimeType:'video/mp4'}}),[]);
  assert.equal(defaultDerivationOptions(project).format,'mp4');assert.equal(defaultDerivationOptions({template_id:popup.id,data:templateDefaults(popup)}).format,'mov');assert.equal(defaultDerivationOptions({template_id:popup.id,data:templateDefaults(popup)}).audio,false);
});
test('new programme recipes retain enabled audio in MP4 defaults',()=>{
  for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier']){
    const t=getTemplate(id),options=defaultDerivationOptions({template_id:id,data:templateDefaults(t)});
    assert.equal(options.format,'mp4');assert.equal(options.audio,true);
  }
});
