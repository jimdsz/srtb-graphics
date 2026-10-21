import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {cataloguePreviewData} from '../src/studio/catalogue-preview';
import {DEFAULT_TEXT_CASE,defaultTextCaseData,textContentPatch,textFields,currentStyle,patchTextStyle,shapedText} from '../src/studio/typography-model';
import {nativeTextStyle} from '../src/studio/typography-position';

test('all ten new-project and catalogue defaults use uppercase editorial text without custom overlays',()=>{
  assert.equal(broadcastTemplates.length,10);
  for(const template of broadcastTemplates){
    const schema=structuredClone(template.fields),data=templateDefaults(template),catalogue=cataloguePreviewData(template);
    assert.equal(data[DEFAULT_TEXT_CASE],'upper');assert.equal(data._studio_typography,'{}');
    for(const [key]of textFields(template)){
      assert.equal(data[key],String(data[key]).toLocaleUpperCase('fr'),template.id+key);
      assert.equal(catalogue[key],data[key]);assert.equal(currentStyle(data,key),undefined);assert.equal(nativeTextStyle(currentStyle(data,key)),true);
    }
    assert.deepEqual(validateProjectData(template,data),data);assert.deepEqual(template.fields,schema);
  }
});

test('newly typed text and dates render uppercase in all formats without rewriting the draft or validated data',()=>{
  for(const template of broadcastTemplates)for(const format of ['tv','portrait','vertical']){
    const data={...templateDefaults(template),_studio_format:format};
    for(const [key,field]of textFields(template))data[key]=(field.maxLength??2048)<30?'20h30':'Été à Cotonou\njeudi 20h30';
    const before=structuredClone(data),validated=validateProjectData(template,data),view=defaultTextCaseData(template,validated);
    for(const [key]of textFields(template))assert.equal(view[key],String(data[key]).toLocaleUpperCase('fr'),template.id+format+key);
    assert.deepEqual(data,before);assert.deepEqual(validated,before);assert.equal(view._studio_typography,'{}');
  }
});

test('explicit casing wins only in its chosen format and keeps source text available in the others',()=>{
  const template=getTemplate('BTV_PopUp');let data={...templateDefaults(template),_subtitle:'Été au Bénin'};
  data={...data,...patchTextStyle(data,'_subtitle',{case:'typed',x:12,size:85})};
  const portrait={...data,_studio_format:'portrait'};
  data={...data,...patchTextStyle(portrait,'_subtitle',{case:'lower',font:'suisse'})};
  const before=structuredClone(data);
  for(const [format,expected] of [['tv','Été au Bénin'],['portrait','été au bénin'],['vertical','ÉTÉ AU BÉNIN']]){
    const selected={...data,_studio_format:format},view=defaultTextCaseData(template,selected);
    assert.equal(shapedText(view._subtitle,currentStyle(selected,'_subtitle')||{}),expected);
  }
  const original={...data,...patchTextStyle(data,'_subtitle',{case:'original'})};
  assert.equal(defaultTextCaseData(template,original)._subtitle,'Été au Bénin');
  assert.deepEqual(data,before);assert.equal(data._subtitle,'Été au Bénin');
});

test('URLs, names, JSON, enum values, timing and media descriptors are never uppercased',()=>{
  for(const template of broadcastTemplates){
    const raw=Object.fromEntries(Object.entries(template.fields).map(([key,field])=>[key,field.default??'']));
    const data={...raw,[DEFAULT_TEXT_CASE]:'upper'},view=defaultTextCaseData(template,data),editorial=new Set(textFields(template).map(([key])=>key));
    for(const [key,value]of Object.entries(data))if(!editorial.has(key))assert.deepEqual(view[key],value,template.id+key);
  }
});

test('older projects missing the marker retain their casing, styling and historic popup background',()=>{
  const popup=getTemplate('BTV_PopUp'),old={_title:'Titre Mixte',_subtitle:'Été au Bénin',_studio_typography:'{}'},copy=structuredClone(old);
  const data=validateProjectData(popup,old);
  assert.equal(data[DEFAULT_TEXT_CASE],'original');assert.equal(data._title,old._title);assert.equal(data._subtitle,old._subtitle);
  assert.equal(data._background_visible,true);assert.equal(data._media_background_url,popup.fields._media_background_url.default);
  assert.strictEqual(defaultTextCaseData(popup,data),data);assert.deepEqual(old,copy);
  // The normal save/duplicate path carries the compatibility marker forward.
  assert.equal(validateProjectData(popup,{...templateDefaults(popup),...data})[DEFAULT_TEXT_CASE],'original');
});

test('new popup has no background source or playlist while its small programme image is unchanged',()=>{
  const template=getTemplate('BTV_PopUp'),data=templateDefaults(template);
  assert.equal(data._background_visible,false);assert.equal(data._media_background_url,'');assert.equal(data._media_background_sequence,'[]');
  assert.equal(data._media_popup_url,template.fields._media_popup_url.default);
  const catalogue=cataloguePreviewData(template);assert.equal(catalogue._background_visible,false);assert.equal(catalogue._media_background_url,'');
  const explicit=validateProjectData(template,{...data,_background_visible:true,_media_background_url:'lib/media/default-background.png'});
  assert.equal(explicit._background_visible,true);assert.equal(explicit._media_background_url,'lib/media/default-background.png');
});

test('the default-case marker is validated, original is an explicit opt-out, and creation defaults are independent',()=>{
  const template=getTemplate('BTV_PopUp'),first=templateDefaults(template);first._subtitle='Ne pas propager';
  assert.notEqual(templateDefaults(template)._subtitle,first._subtitle);
  assert.throws(()=>validateProjectData(template,{[DEFAULT_TEXT_CASE]:'lower'}),/hors charte/);
  const original=validateProjectData(template,{...templateDefaults(template),[DEFAULT_TEXT_CASE]:'original',_title:'Comme saisi'});
  assert.equal(defaultTextCaseData(template,original)._title,'Comme saisi');
});

test('advanced content editing keeps the new default, preserves explicit styles and retains old editing behaviour',()=>{
  const template=getTemplate('BTV_PopUp'),data=templateDefaults(template),patch=textContentPatch(data,'_subtitle','Été au Bénin');
  assert.deepEqual(patch,{_subtitle:'Été au Bénin'});assert.equal(defaultTextCaseData(template,{...data,...patch})._subtitle,'ÉTÉ AU BÉNIN');
  const styled={...data,...patchTextStyle(data,'_subtitle',{case:'typed',size:85})};
  const next={...styled,...textContentPatch(styled,'_subtitle','Comme saisi')};
  assert.deepEqual(currentStyle(next,'_subtitle'),{case:'typed',size:85});assert.equal(defaultTextCaseData(template,next)._subtitle,'Comme saisi');
  const legacy=validateProjectData(template,{_subtitle:'Ancien texte'}),changed={...legacy,...textContentPatch(legacy,'_subtitle','Conserver la saisie')};
  assert.deepEqual(currentStyle(changed,'_subtitle'),{size:100,case:'typed'});
});
