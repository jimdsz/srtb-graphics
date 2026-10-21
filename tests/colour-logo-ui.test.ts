import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import type {MediaAsset} from '../src/studio/domain';
import {patchTextColour,textColourChoices} from '../src/studio/charter-colours';
import {currentStyle,patchTextStyle,textFields,textStyles} from '../src/studio/typography-model';
import {nativeTextStyle} from '../src/studio/typography-position';
import {textStyleUndo,undoTextStyle} from '../src/studio/typography-history';
import {hasOverlayLogo,logoSourcePatch,nativeLogoFieldNames,nativeLogoSlots,overlayLogoSourcePatch} from '../src/studio/native-logo-settings';
import {overlayLogoFields} from '../src/studio/logo-model';
import CharterColourChoice from '../src/studio/CharterColourChoice';
import LogoSettings from '../src/studio/LogoSettings';
import MediaSelect from '../src/studio/MediaSelect';

function withBrowser(run:()=>void){const original=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{configurable:true,value:{}});try{run();}finally{if(original)Object.defineProperty(globalThis,'window',original);else Reflect.deleteProperty(globalThis,'window');}}

test('the visible text palette is accepted for every template and format without changing any text',()=>{
  for(const template of broadcastTemplates)for(const format of ['tv','portrait','vertical'])for(const colour of textColourChoices){
    const field=textFields(template)[0][0],data={...templateDefaults(template),_studio_format:format},before=structuredClone(data);
    const next={...data,...patchTextColour(data,field,colour.value)},saved=validateProjectData(template,next);
    assert.deepEqual(data,before);assert.equal(saved[field],before[field]);assert.equal(currentStyle(saved,field)?.colour,colour.value==='original'?undefined:colour.value);
    assert.equal(currentStyle({...saved,_studio_format:format==='tv'?'vertical':'tv'},field),undefined);
  }
});

test('restoring model colour removes only the colour override, including position-only native text',()=>{
  const template=getTemplate('BTV_PopUp'),field=textFields(template)[0][0],data=templateDefaults(template);
  const moved={...data,...patchTextStyle(data,field,{x:15,y:20})},coloured={...moved,...patchTextColour(moved,field,'#eb1905')};
  const restored={...coloured,...patchTextColour(coloured,field,'original')};
  assert.deepEqual(currentStyle(restored,field),{x:15,y:20});assert.equal(nativeTextStyle(currentStyle(restored,field)),true);
  const only={...data,...patchTextColour(data,field,'#007300')};assert.deepEqual(textStyles({...only,...patchTextColour(only,field,'original')}),{});
  assert.throws(()=>patchTextColour(data,field,'#ff00ff'),/hors charte/);
});

test('undo colour retains later text movement, other fields and other format styling',()=>{
  const template=getTemplate('BTV_PopUp'),field=textFields(template)[0][0],data=templateDefaults(template),after={...data,...patchTextColour(data,field,'#007300')};
  const undo=textStyleUndo(data,after,field),moved={...after,...patchTextStyle(after,field,{x:18}),_label:'Bientôt'};
  const reverted={...moved,...undoTextStyle(moved,undo)};assert.deepEqual(currentStyle(reverted,field),{x:18});assert.equal(reverted._label,'Bientôt');
});

test('colour controls use six labelled native radios with one selected option and no arbitrary picker',()=>{
  const html=renderToStaticMarkup(createElement(CharterColourChoice,{value:'#f0b900',onChange(){}}));
  assert.equal((html.match(/type="radio"/g)||[]).length,6);assert.equal((html.match(/checked=""/g)||[]).length,1);assert.match(html,/Couleur du texte/);assert.match(html,/Or BTV/);assert.match(html,/Du modèle/);assert.doesNotMatch(html,/type="color"/);
});

test('only the three real sponsor-capable engines expose their native logo slots',()=>{
  const counts=Object.fromEntries(broadcastTemplates.map(template=>[template.id,nativeLogoSlots(template).length]));
  assert.deepEqual(counts,{BTV_BA_1P:1,BTV_PopUp:0,BTV_BA_TDS:1,BTV_BA_TDS_SUIVI_DE:2,BTV_Ce_Soir:0,BTV_Relais_Antenne:0,BTV_Passerelle_Replay:0,BTV_Renvoi:0,BTV_Evenement:0,BTV_Semainier:0});
  for(const template of broadcastTemplates)for(const key of nativeLogoFieldNames(template))assert.ok(template.fields[key]);
});

test('choosing a custom logo enables only its slot, switches BA away from original and preserves other choices',()=>{
  const image={url:'/api/graphics/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/content',name:'Logo.png',mimeType:'image/png'};
  for(const template of broadcastTemplates)for(const slot of nativeLogoSlots(template)){
    const before=templateDefaults(template),patch=logoSourcePatch(template,slot.key,image),next={...before,...patch};
    validateProjectData(template,next);assert.deepEqual(next[slot.key],image);assert.equal(next[slot.visible],true);if(slot.original)assert.equal(next[slot.original],false);
    for(const key of Object.keys(before))if(!Object.hasOwn(patch,key))assert.deepEqual(next[key],before[key]);
    const hidden={...next,[slot.visible]:false};assert.deepEqual(hidden[slot.key],image);
    const cleared=logoSourcePatch(template,slot.key,'');assert.equal(cleared[slot.visible],false);
    assert.throws(()=>logoSourcePatch(template,slot.key,{...image,mimeType:'video/mp4'}),/image/);
  }
  assert.throws(()=>logoSourcePatch(getTemplate('BTV_PopUp'),'_sponsor_url',image),/n’existe pas/);
});

test('logo panel preserves the distinction between sponsor, channel logo and unavailable independent animation',()=>withBrowser(()=>{
  for(const record of broadcastTemplates){
    const template={...record,fields:Object.fromEntries(Object.entries(record.fields).filter(([key])=>!key.startsWith('_studio_overlay_logo_')))};
    const html=renderToStaticMarkup(createElement(LogoSettings,{template,data:templateDefaults(template),media:[],onChange(){},disabled:false}));
    if(!nativeLogoSlots(template).length){assert.equal(html,'');continue;}
    assert.match(html,/logo de la chaîne reste inchangé/);assert.match(html,/Aucun effet d’apparition indépendant/);assert.match(html,/Choisir sur cet ordinateur/);
    assert.match(html,/PNG, JPEG ou WebP/);assert.doesNotMatch(html,/type="file"[^>]*accept="[^"]*mp4/);
  }
}));

test('the additive logo UI is available only with the real schema, defaults off and retains native sponsors',()=>withBrowser(()=>{
  for(const record of broadcastTemplates){
    const template={...record,fields:{...record.fields,...overlayLogoFields()}},data=templateDefaults(template);
    assert.equal(hasOverlayLogo(template),true);assert.equal(data._studio_overlay_logo_enabled,false);
    const html=renderToStaticMarkup(createElement(LogoSettings,{template,data,media:[],onChange(){},disabled:false}));
    assert.match(html,/Logo supplémentaire · facultatif/);assert.match(html,/Afficher ce logo supplémentaire/);assert.match(html,/Sans animation/);assert.match(html,/Fondu/);assert.match(html,/Glissement/);
    assert.doesNotMatch(html.split('native-logo-details')[0],/checked=""/);
    if(nativeLogoSlots(template).length)assert.match(html,/Sponsors du modèle/);
    const image={url:'/api/graphics/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/content',name:'Logo.png',mimeType:'image/png'};
    const patch=overlayLogoSourcePatch(image),next={...data,...patch};validateProjectData(template,next);
    assert.deepEqual(patch,{_studio_overlay_logo_url:image,_studio_overlay_logo_enabled:false});
    for(const slot of nativeLogoSlots(template)){assert.deepEqual(next[slot.key],data[slot.key]);assert.equal(next[slot.visible],data[slot.visible]);}
    const shown={...next,_studio_overlay_logo_enabled:true},hidden={...shown,_studio_overlay_logo_enabled:false};assert.deepEqual(hidden._studio_overlay_logo_url,image);
  }
}));

test('shared image selector excludes audio, video, failed and uploading files',()=>withBrowser(()=>{
  const media:MediaAsset[]=[['1','image/png','ready'],['2','audio/mpeg','ready'],['3','video/mp4','ready'],['4','image/png','uploading'],['5','image/png','failed']].map(([id,mime_type,status])=>({id,name:'FILE_'+id,mime_type,status:status as MediaAsset['status'],bytes:100,created_by:'fixture',created_at:''}));
  const html=renderToStaticMarkup(createElement(MediaSelect,{id:'image',value:'',field:{'x-control':'image'},media,onChange(){}}));
  assert.match(html,/FILE_1/);for(const id of [2,3,4,5])assert.doesNotMatch(html,new RegExp('FILE_'+id));
}));
