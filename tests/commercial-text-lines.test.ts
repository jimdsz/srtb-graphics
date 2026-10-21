import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMERCIAL_MAX_TEXT_LINES,DEFAULT_COMMERCIAL_DATA,commercialPageStyle,commercialTextSlots,normalizeCommercialData,validateCommercialData} from '../src/studio/commercial/model';
import type {CommercialData,CommercialSequence,CommercialTextStyle} from '../src/studio/commercial/model';
import {measureCommercialLayout,prepareCommercial} from '../src/studio/commercial/render';
import {readablePageLayout,splitCommercialPages} from '../src/studio/commercial/readable-layout';

function measuredContext():CanvasRenderingContext2D {
  return {font:'48px Test',letterSpacing:'0px',measureText(text:string){
    const size=Number(this.font.match(/([\d.]+)px/)?.[1]??48),spacing=Number.parseFloat(this.letterSpacing)||0,glyphs=[...text];
    const weight=this.font.includes('700 ')?1.2:1,family=this.font.includes('SRTB Editor Benin')?1.22:1;
    return {width:glyphs.reduce((sum,c)=>sum+size*(/\s/u.test(c)?.25:c==='W'?.9:/[A-ZÉÀ]/u.test(c)?.6:.47),0)*weight*family+Math.max(0,glyphs.length-1)*spacing,actualBoundingBoxAscent:size*.72,actualBoundingBoxDescent:size*.18};
  }} as unknown as CanvasRenderingContext2D;
}
const previous={document:globalThis.document,FontFace:globalThis.FontFace,fetch:globalThis.fetch};
const loadedFonts:string[]=[];
Object.assign(globalThis,{
  document:{fonts:{add(){}},createElement(){return {width:0,height:0,getContext:measuredContext};}},
  FontFace:class {constructor(private family:string){}async load(){loadedFonts.push(this.family);return this;}},
  fetch:async(url:string)=>{assert.equal(url,'/commercial-assets/BeninSemiBold-Regular.otf');return new Response(new Uint8Array([1,2,3]));}
});
test.after(()=>Object.assign(globalThis,previous));
function fixture(mode:'summary'|'full'|undefined='summary',layout:CommercialSequence['layout']='central',body='Une ligne.\nDeuxième ligne.\nTroisième ligne.'):CommercialData {
  const data=normalizeCommercialData(DEFAULT_COMMERCIAL_DATA);
  if(mode)data.textMode=mode;
  data.sequenceTiming='manual';
  data.sequences=[{id:'sequence',layout,duration:8,pages:layout==='columns'?[{title:'Gauche',body},{title:'Droite',body}]:[{title:'Le message',body}]}];
  return data;
}

test('all five layouts and both readable modes count three body rows independently from titles',async()=>{
  assert.equal(COMMERCIAL_MAX_TEXT_LINES,3);
  for(const mode of ['summary','full'] as const)for(const layout of ['central','columns','left','right','final'] as const){
    const data=fixture(mode,layout),before=JSON.stringify(data),result=await measureCommercialLayout(data);
    assert.deepEqual(result.errors,[],`${mode}/${layout}`);
    assert.deepEqual(result.textLines,data.sequences![0].pages.map((_,index)=>({index,lines:3,maxLines:3})));
    assert.equal(JSON.stringify(data),before);
    data.sequences![0].pages=data.sequences![0].pages.map(page=>({...page,body:page.body+'\nQuatrième ligne.'}));
    const overflow=await measureCommercialLayout(data);
    assert.ok(overflow.textLines.every(item=>item.lines===4&&item.maxLines===3));
    assert.equal(overflow.errors.filter(error=>error.includes('Résumez')).length,data.sequences![0].pages.length);
  }
  assert.ok(loadedFonts.length>=3,'Actual measurement waits for all template font loads');
});

test('automatic wrapping, font size, tracking, case and weight determine the counter',async()=>{
  const data=fixture('summary','central','mot '.repeat(46)),before=JSON.stringify(data);
  const plain=await measureCommercialLayout(data);
  assert.equal(plain.textLines[0].lines,3);assert.deepEqual(plain.errors,[]);
  const original=data.sequences![0].pages[0],base=commercialPageStyle(original,0);
  for(const patch of [{bodyScale:1.5},{tracking:.15},{bodyCase:'upper' as const},{bodyBold:true},{bodyFont:'benin'}] satisfies Partial<CommercialTextStyle>[]){
    const changed={...data,sequences:[{...data.sequences![0],pages:[{...original,style:{...base,...patch}}]}]};
    const measured=await measureCommercialLayout(changed);
    assert.ok(measured.textLines[0].lines>3,JSON.stringify(patch));
    assert.ok(measured.errors.some(error=>error.includes('Résumez')));
  }
  assert.ok(loadedFonts.includes('SRTB Editor Benin'),'The selected face is loaded before its metrics are counted');
  assert.equal(JSON.stringify(data),before);
  const wrapped=fixture('full','columns',('W'.repeat(24)+'\n').repeat(3).trimEnd());
  assert.equal(wrapped.sequences![0].pages[0].body.split('\n').length,3);
  assert.ok((await measureCommercialLayout(wrapped)).textLines.every(item=>item.lines>3));
});

test('empty bodies count zero, CRLF is one break, and an internal empty row consumes space',async()=>{
  for(const body of ['', ' \t\r\n ']){
    const measured=await measureCommercialLayout(fixture('summary','central',body));
    assert.deepEqual(measured.textLines,[{index:0,lines:0,maxLines:3}]);assert.deepEqual(measured.errors,[]);
  }
  assert.equal((await measureCommercialLayout(fixture('summary','central','Un\r\nDeux\r\nTrois'))).textLines[0].lines,3);
  const blankRow=await measureCommercialLayout(fixture('summary','central','Un\n\nDeux\nTrois'));
  assert.equal(blankRow.textLines[0].lines,4);assert.ok(blankRow.errors.some(error=>error.includes('Résumez')));
  const twoLineTitle=fixture('summary','columns','Un\nDeux\nTrois');
  twoLineTitle.sequences![0].pages[0].title='Une rencontre pour les familles';
  assert.equal(readablePageLayout(measuredContext(),twoLineTitle.sequences![0].pages[0],'columns').title.lines.length,2);
  assert.deepEqual((await measureCommercialLayout(twoLineTitle)).textLines,[{index:0,lines:3,maxLines:3},{index:1,lines:3,maxLines:3}]);
});

test('legacy drafts retain all text and native fitting while export rejects more than three rows',async()=>{
  for(const layout of ['central','columns','left','right','final'] as const){
    const data=fixture(undefined,layout);delete data.textMode;
    assert.deepEqual((await measureCommercialLayout(data)).errors,[]);
    data.sequences![0].pages[0].body='Un\nDeux\nTrois\nQuatre';
    const before=JSON.stringify(data),saved=normalizeCommercialData(JSON.parse(before));
    assert.equal(saved.textMode,undefined);
    assert.equal(saved.sequences![0].pages[0].body,data.sequences![0].pages[0].body);
    assert.deepEqual(validateCommercialData(saved,{draft:true}),[]);
    const measured=await measureCommercialLayout(saved);
    assert.equal(measured.textLines[0].lines,4);assert.equal(measured.textLines[0].maxLines,3);
    await assert.rejects(prepareCommercial(saved,new AbortController().signal),/4 lignes \(3 maximum\).*Résumez/);
    assert.equal(JSON.stringify(data),before);
  }
  const legacy=normalizeCommercialData(DEFAULT_COMMERCIAL_DATA);
  legacy.pages=legacy.pages.map(page=>({...page,body:'Un\nDeux\nTrois\nQuatre'}));
  const measured=await measureCommercialLayout(legacy);
  assert.deepEqual(measured.textLines,[0,1,2,3].map(index=>({index,lines:4,maxLines:3})));
  assert.equal(legacy.sequences,undefined);
});

test('explicit pagination obeys three rendered rows without loss, smaller type or source mutation',async()=>{
  for(const mode of ['summary','full'] as const){
    const text='  À Cotonou, présentez votre activité en quelques mots.\r\n\r\n'+('Précisez votre message essentiel, votre identité et votre contact. '.repeat(6))+'\tFin.  ';
    const data=fixture(mode,'columns',text);
    data.sequences![0].pages[1].body='Une courte information.';
    const before=JSON.stringify(data),split=await splitCommercialPages(data,{index:0}),measurement=await measureCommercialLayout(split);
    assert.equal(JSON.stringify(data),before);
    assert.equal(commercialTextSlots(split).filter(slot=>slot.page.title==='Gauche').map(slot=>slot.page.body).join(''),text);
    assert.equal(commercialTextSlots(split).filter(slot=>slot.page.title==='Droite').map(slot=>slot.page.body).join(''),'Une courte information.');
    assert.ok(measurement.textLines.every(item=>item.lines<=item.maxLines&&item.maxLines<=3));
    assert.deepEqual(measurement.errors,[]);assert.equal(split.sequences![0].id,'sequence');
    assert.ok(split.sequences!.flatMap(sequence=>sequence.pages).every(page=>!page.style?.bodyScale||page.style.bodyScale===1));
    assert.deepEqual(await splitCommercialPages(split),split);
  }
});

test('readable export rejects overflow before loading footage and preserves stored draft source',async()=>{
  for(const mode of ['summary','full'] as const){
    const data=fixture(mode,'central','Un\nDeux\nTrois\nQuatre'),before=JSON.stringify(data);
    assert.deepEqual(validateCommercialData(data,{draft:true}),[]);
    assert.equal(normalizeCommercialData(data).sequences![0].pages[0].body,data.sequences![0].pages[0].body);
    await assert.rejects(prepareCommercial(data,new AbortController().signal),/4 lignes \(3 maximum\).*Résumez/);
    assert.equal(JSON.stringify(data),before);
  }
});
