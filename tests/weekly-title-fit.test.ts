import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getTemplate} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import {applyWeeklyTitleFit,canFitWeeklyTitle,proposeWeeklyTitleFit,weeklyTitleFitRequest,WEEKLY_TITLE_AREA,WEEKLY_TITLE_RIGHT_INK_ALLOWANCE} from '../src/studio/weekly-title-fit';
import {currentStyle,DEFAULT_TEXT_CASE,patchTextStyle,textStyles} from '../src/studio/typography-model';
import {textStyleUndo,undoTextStyle} from '../src/studio/typography-history';

const template=getTemplate('BTV_Semainier'),field='programme_1_title';
const data:ProjectData={_studio_format:'tv',[field]:'LE GRAND DOCUMENTAIRE',programme_1_category:'LUNDI 19H30'};
const styled=(style:Parameters<typeof patchTextStyle>[2])=>({...data,...patchTextStyle(data,field,style)});
const request=(value=data)=>weeklyTitleFitRequest(template,value,field)!;
const metric=(width:number)=>(percent:number)=>({x:-width*percent/100,y:-31*percent/100,width:width*percent/100,height:40*percent/100});

test('weekly fitting is limited to the seven pinned TV programme titles',()=>{
  for(let n=1;n<=7;n++)assert.equal(canFitWeeklyTitle(template,data,`programme_${n}_title`),true);
  for(const name of ['programme_0_title','programme_8_title','programme_1_category','intro_top','final_bottom'])assert.equal(canFitWeeklyTitle(template,data,name),false);
  for(const format of ['portrait','vertical'])assert.equal(weeklyTitleFitRequest(template,{...data,_studio_format:format},field),null);
  for(const changed of [{...template,id:'BTV_Evenement'},{...template,version:'2.0.0'},{...template,libraryVersion:'1.8.0'}])assert.equal(weeklyTitleFitRequest(changed,data,field),null);
});

test('short titles keep their current size; long titles offer a measured whole percentage without changing source data',()=>{
  const before=structuredClone(data),short=proposeWeeklyTitleFit(request(),metric(924.14));
  assert.equal(short.kind,'unchanged');assert.deepEqual(data,before);
  const long=proposeWeeklyTitleFit(request(),metric(2922.398));
  assert.equal(long.kind,'resize');if(long.kind!=='resize')assert.fail();assert.equal(long.size,57);
  assert.ok(WEEKLY_TITLE_AREA.anchorX-2922.398*.57>=WEEKLY_TITLE_AREA.left);
  assert.ok(WEEKLY_TITLE_AREA.anchorX-2922.398*.58<WEEKLY_TITLE_AREA.left);
  assert.deepEqual(data,before);
});

test('a short right-aligned title tolerates small terminal ink overshoot without shrinking or moving it',()=>{
  // Horizontal ink overshoots observed in the real Chromium/Suisse fixture.
  // Their rounding does not scale proportionally with the requested font size.
  for(const [size,right]of [[100,1.128113],[57,1.250397],[10,.973825]]){
    const short={...data,[field]:'TITRE COURT',[DEFAULT_TEXT_CASE]:'upper',...(size===100?{}:patchTextStyle(data,field,{size}))};
    const proposal=proposeWeeklyTitleFit(request(short),measured=>{assert.equal(measured,size);const width=263.604187*size/100;return {x:-width,y:-31*size/100,width:width+right,height:41.3333*size/100};});
    assert.equal(proposal.kind,'unchanged');assert.equal(proposal.current,size);
    if(size===100)assert.equal(currentStyle(short,field),undefined);
  }
});

test('terminal ink allowance is small and does not relax left overflow or outside manual placement',()=>{
  assert.equal(WEEKLY_TITLE_RIGHT_INK_ALLOWANCE,2);
  const rightLimit=WEEKLY_TITLE_AREA.right-WEEKLY_TITLE_AREA.anchorX+WEEKLY_TITLE_RIGHT_INK_ALLOWANCE;
  const excessive=proposeWeeklyTitleFit(request(),()=>({x:-100,y:-30,width:100+rightLimit+.01,height:40}));
  assert.equal(excessive.kind,'unavailable');
  const leftOverflow=proposeWeeklyTitleFit(request(),()=>({x:WEEKLY_TITLE_AREA.left-WEEKLY_TITLE_AREA.anchorX-.01,y:-30,width:100,height:40}));
  assert.equal(leftOverflow.kind,'unavailable');
  const moved=proposeWeeklyTitleFit(request(styled({x:1})),()=>{assert.fail('Ink allowance must not extend the anchor zone');});
  assert.equal(moved.kind,'unavailable');
});

test('proposal uses actual bounds including overhang, line height and fixed tracking rather than an advance ratio',()=>{
  const italic=request(styled({italic:true,tracking:20,size:150}));
  const measured:number[]=[];
  const proposal=proposeWeeklyTitleFit(italic,size=>{measured.push(size);const width=900*size/100+800;return {x:-width,y:-30,width,height:40};});
  assert.equal(proposal.kind,'resize');if(proposal.kind!=='resize')assert.fail();assert.equal(proposal.size,98);
  assert.ok(measured.includes(proposal.size));
  // Fixed negative spacing can make a larger size fit even when the minimum does not.
  const nonMonotonic=proposeWeeklyTitleFit(request(styled({tracking:-10})),size=>({x:size===70?-100:-3000,y:-30,width:100,height:40}));
  assert.equal(nonMonotonic.kind,'resize');if(nonMonotonic.kind!=='resize')assert.fail();assert.equal(nonMonotonic.size,70);
  const multiLine=proposeWeeklyTitleFit(request({...data,[field]:'TITRE\nSUITE'}),size=>({x:-200,y:-30,width:200,height:180*size/100}));
  assert.equal(multiLine.kind,'resize');if(multiLine.kind!=='resize')assert.fail();assert.equal(multiLine.size,61);
});

test('request preserves imported font and styles and follows the renderer casing rules',()=>{
  const font='local-font:'+'a'.repeat(64),value={...styled({font,fontName:'Import.otf',x:-200,y:-20,case:'lower',bold:true,italic:true,tracking:3,lineHeight:1.3,align:'center',colour:'#f0b900'}),[DEFAULT_TEXT_CASE]:'upper'};
  const own=request(value);assert.equal(own.text,'le grand documentaire');
  for(const [key,v]of Object.entries(currentStyle(value,field)!))assert.equal(own.style[key as keyof typeof own.style],v);
  assert.equal(request({...data,[DEFAULT_TEXT_CASE]:'upper',[field]:'Titre saisi'}).text,'TITRE SAISI');
  assert.equal(request({...styled({case:'typed'}),[DEFAULT_TEXT_CASE]:'upper',[field]:'Titre saisi'}).text,'Titre saisi');
  assert.equal(request({...styled({case:'original'}),[DEFAULT_TEXT_CASE]:'upper',[field]:'Titre saisi'}).text,'Titre saisi');
});

test('unsupported rotation, outside anchors and impossible geometry give no applicable change',()=>{
  for(const value of [styled({rotation:1}),styled({x:250}),styled({x:-1800}),styled({y:100}),{...data,[field]:'  '}]){
    const proposal=proposeWeeklyTitleFit(request(value),()=>{assert.fail('No font measurement needed for this placement');});
    assert.equal(proposal.kind,'unavailable');assert.throws(()=>applyWeeklyTitleFit(template,value,field,proposal),/ne peut pas/);
  }
  const impossible=proposeWeeklyTitleFit(request(),metric(20000));assert.equal(impossible.kind,'unavailable');
  assert.throws(()=>proposeWeeklyTitleFit(request(),()=>({x:0,y:0,width:NaN,height:0})),/mesure exploitable/);
  // A valid manual offset is retained and reduces the width available to the title.
  const moved=proposeWeeklyTitleFit(request(styled({x:-300,y:-20})),metric(2922.398));
  assert.equal(moved.kind,'resize');if(moved.kind!=='resize')assert.fail();assert.equal(moved.size,47);
});

test('text, any selected style, casing, field and format changes invalidate a proposal before application',()=>{
  const proposal=proposeWeeklyTitleFit(request(),metric(2922.398));
  for(const changed of [{...data,[field]:'Autre titre'},styled({x:-1}),styled({colour:'#000000'}),styled({font:'benin'}),{...data,[DEFAULT_TEXT_CASE]:'upper'},{...data,_studio_format:'portrait'}])assert.throws(()=>applyWeeklyTitleFit(template,changed,field,proposal),/a changé/);
  assert.throws(()=>applyWeeklyTitleFit(template,data,'programme_2_title',proposal),/a changé/);
  assert.throws(()=>applyWeeklyTitleFit({...template,version:'1.0.1'},data,field,proposal),/a changé/);
  const unrelated={...data,programme_2_title:'Autre programme',programme_1_category:'MARDI 21H00'};
  assert.equal(currentStyle({...unrelated,...applyWeeklyTitleFit(template,unrelated,field,proposal)},field)?.size,57);
});

test('explicit application changes only size and the existing undo restores it without losing later edits',()=>{
  const before=styled({font:'suisse',x:-100,y:-10,case:'typed',colour:'#f0b900',size:120,tracking:1}),snapshot=structuredClone(before);
  const proposal=proposeWeeklyTitleFit(request(before),metric(2922.398)),patch=applyWeeklyTitleFit(template,before,field,proposal),after={...before,...patch};
  assert.deepEqual(Object.keys(patch),['_studio_typography']);assert.deepEqual(before,snapshot);
  assert.equal(after[field],before[field]);assert.equal(after.programme_1_category,before.programme_1_category);
  assert.deepEqual({...currentStyle(after,field),size:120},currentStyle(before,field));
  const undo=textStyleUndo(before,after,field),later={...after,...patchTextStyle(after,field,{x:-150})};
  const restored={...later,...undoTextStyle(later,undo)};assert.deepEqual(currentStyle(restored,field),{...currentStyle(before,field),x:-150});
  const native=proposeWeeklyTitleFit(request(),metric(2922.398)),nativeAfter={...data,...applyWeeklyTitleFit(template,data,field,native)};
  assert.deepEqual(textStyles({...nativeAfter,...undoTextStyle(nativeAfter,textStyleUndo(data,nativeAfter,field))}),{});
});

test('native measurement constants match all seven frozen SOUSTEXTE stable transforms',async()=>{
  const animation=JSON.parse(await readFile(new URL('../public/library/v1.7.0/BTV_Semainier/source/animation.json',import.meta.url),'utf8'));
  const titles=animation.layers.filter((layer:any)=>layer.nm==='SOUSTEXTE');assert.equal(titles.length,7);
  for(const layer of titles){const doc=layer.t.d.k[0].s;assert.equal(layer.parent,undefined);assert.equal(doc.f,'SuisseIntl');assert.equal(doc.s,WEEKLY_TITLE_AREA.fontSize);assert.equal(doc.j,1);
    assert.deepEqual(layer.ks.s.k,[100,100,100]);assert.equal(layer.ks.p.k[0]-layer.ks.a.k[0],WEEKLY_TITLE_AREA.anchorX);assert.equal(layer.ks.p.k[1]-layer.ks.a.k[1],WEEKLY_TITLE_AREA.anchorY);
  }
});
