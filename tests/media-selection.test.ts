import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {popupBackgroundVisible,selectedMediaData} from '../src/studio/media-selection';
import {checkLibraryIntegrity} from '../scripts/check-library-integrity.mjs';

const local={url:`local-media:${'a'.repeat(64)}:120`,name:'Programme.mp4',mimeType:'video/mp4'};
test('an empty Pop-up background is transparent, while an explicit playlist still works',()=>{
  const template=getTemplate('BTV_PopUp'),data={...templateDefaults(template),_background_visible:true,_media_background_url:''};
  assert.equal(popupBackgroundVisible(data),false);
  assert.equal(selectedMediaData(template,data)._background_visible,false);
  assert.equal(data._background_visible,true,'do not mutate the saved source');
  assert.equal(popupBackgroundVisible({}),true,'omitted fields retain the original default');
  assert.equal(popupBackgroundVisible({...data,_media_background_sequence:JSON.stringify([{url:local,start:0,end:2}])}),true);
  assert.equal(popupBackgroundVisible({...data,_media_background_sequence:'invalid'}),true,'do not hide malformed active lists');
  assert.equal(selectedMediaData(template,{...data,_media_background_url:{url:'',name:'Empty',mimeType:'image/png'}})._background_visible,false);
});
test('disabled tracks and overridden single sources stay saved without becoming runtime dependencies',()=>{
  for(const id of ['BTV_PopUp','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE','BTV_Ce_Soir','BTV_BA_1P']){
    const template=getTemplate(id),data=templateDefaults(template);
    const prefix=id==='BTV_BA_TDS_SUIVI_DE'?'_media_programme_1':id==='BTV_BA_1P'?'_media_body':id==='BTV_PopUp'||id==='BTV_BA_TDS'?'_media_background':Object.keys(data).find(k=>k.startsWith('_media_')&&k.endsWith('_url'))!.replace(/_url$/,'');
    const image=Object.values(template.fields).find(f=>typeof f.default==='string'&&/\.png$/.test(f.default))?.default||'lib/media/test.png';
    data[prefix+'_url']=local;data[prefix+'_sequence']=JSON.stringify([{url:image,start:0,end:5}]);
    const before=JSON.stringify(data),selected=selectedMediaData(template,data);
    assert.equal(selected[prefix+'_url'],'',id);
    assert.equal(JSON.stringify(data),before,'saved media must be retained');
  }
});
test('unused background and external programmes do not validate their draft playlist for playback',()=>{
  for(const id of ['BTV_PopUp','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE']){
    const template=getTemplate(id),data=templateDefaults(template),prefix=id==='BTV_BA_TDS_SUIVI_DE'?'_media_programme_1':'_media_background';
    if(id!=='BTV_BA_TDS_SUIVI_DE')data._background_visible=false;
    data[prefix+'_url']=local;data[prefix+'_sequence']='[{"url":"","start":0,"end":5}]';
    const selected=validateProjectData(template,selectedMediaData(template,data));
    assert.equal(selected[prefix+'_sequence'],'[]');assert.equal(selected[prefix+'_url'],'');
    if(id==='BTV_BA_TDS_SUIVI_DE')data._media_mode='internal';else data._background_visible=true;
    assert.throws(()=>validateProjectData(template,selectedMediaData(template,data)),/passage 1/);
  }
});
test('disabled audio is excluded and becomes required again on activation',()=>{
  for(const id of ['BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay']){
    const t=getTemplate(id),data=templateDefaults(t),key=Object.keys(data).find(k=>/^_audio.*_url$/.test(k))!,enabled=key.replace(/_url$/,'_enabled');
    data[key]=local;data[enabled]=false;assert.equal(selectedMediaData(t,data)[key],'');
    data[enabled]=true;assert.deepEqual(selectedMediaData(t,data)[key],local);
  }
});
test('playlist limits agree with the seven engines and sub-frame cuts fail early',()=>{
  for(const id of ['BTV_Ce_Soir','BTV_PopUp','BTV_BA_1P','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE']){
    const t=getTemplate(id),key=Object.keys(t.fields).find(k=>k.endsWith('_sequence'))!,limit=['BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay'].includes(id)?8:20;
    const clip={url:local,start:1,end:2};
    assert.doesNotThrow(()=>validateProjectData(t,{[key]:JSON.stringify(Array(limit).fill(clip))}));
    assert.throws(()=>validateProjectData(t,{[key]:JSON.stringify(Array(limit+1).fill(clip))}),new RegExp(`${limit} passages`));
    assert.throws(()=>validateProjectData(t,{[key]:JSON.stringify([{...clip,end:1.001}])}),/0,04/);
  }
});
test('all shipped template resources match the ZIP delivery inventory',async()=>{assert.ok(await checkLibraryIntegrity()>1000);});
