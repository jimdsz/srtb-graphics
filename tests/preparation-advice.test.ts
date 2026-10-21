import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import {preparationAdvice} from '../src/studio/preparation-advice';
test('preparation advice proposes explicit reversible fixes, never mutates a project',()=>{
  const t=getTemplate('BTV_BA_1P'),data={...templateDefaults(t),_titre_ligne_2:'',_titre_ligne_3:'Culture',_media_body_url:{url:'local:example',name:'Photo.png',mimeType:'image/png'},_media_body_audio_enabled:true};
  const before=structuredClone(data),advice=preparationAdvice(t,data);
  assert.deepEqual(data,before);assert.equal(advice.find(a=>a.id==='_titre_ligne_')?.patch?._titre_ligne_2,'Culture');
  assert.equal(advice.find(a=>a.id==='_media_body_url')?.patch?._media_body_audio_enabled,false);
});
test('disabled media and overridden image sources do not produce misleading audio advice',()=>{
  const t=getTemplate('BTV_PopUp'),data={...templateDefaults(t),_background_visible:false,_media_background_audio_enabled:true,_media_background_url:'image.png',_media_popup_audio_enabled:true,_media_popup_url:'image.png',_media_popup_sequence:JSON.stringify([{url:'video.mp4',start:0,end:3}])};
  assert.equal(preparationAdvice(t,data).length,0);
});
test('duplicate appointment advice is irrelevant to simple BA and never guesses recorded speech',()=>{
  const t=getTemplate('BTV_BA_1P'),data={...templateDefaults(t),_jour_1:'Demain',_heure_1:'20h30',_jour_2:'Demain',_heure_2:'20h30'};
  assert.ok(preparationAdvice(t,data).some(a=>a.id==='duplicate-dates'));
  assert.ok(!preparationAdvice(t,{...data,_studio_ba_mode:'simple'}).some(a=>a.id==='duplicate-dates'));
});
