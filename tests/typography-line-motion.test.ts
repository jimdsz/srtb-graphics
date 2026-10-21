import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import * as textModel from '../src/studio/typography-model';
import {fontFamily} from '../src/studio/typography-fonts';
import {localDisplacement,nativeTextStyle} from '../src/studio/typography-position';
import {nativeLineMotion,applyNativeLineMotion} from '../src/studio/typography-line-motion';
import {nativeTextLayerHidden} from '../src/studio/typography-visibility';
import {setSvgAttribute} from '../src/studio/svg-attributes';
import {createRenvoiSignage} from '../src/studio/renvoi-signage-engine';
import {nativeSubtitleSample} from './ae-text-animator-fixture';

class Element {
  attrs=new Map<string,string>();children:Element[]=[];parentElement:Element|null=null;
  style:any={display:'',visibility:'visible',opacity:'1',translate:''};dataset:Record<string,string>={};textContent='';
  setAttribute(k:string,v:string){this.attrs.set(k,v);}getAttribute(k:string){return this.attrs.get(k)??null;}removeAttribute(k:string){this.attrs.delete(k);}
  append(...nodes:Element[]){for(const n of nodes){this.children.push(n);n.parentElement=this;}}
  replaceChildren(...nodes:Element[]){this.children=[];this.append(...nodes);}remove(){}
  getScreenCTM(){return new Matrix();}getBoundingClientRect(){return {left:0,top:0,width:1920,height:1080};}
}
class Matrix {
  a:number;b:number;c:number;d:number;e:number;f:number;
  constructor(values=[1,0,0,1,0,0]){[this.a,this.b,this.c,this.d,this.e,this.f]=values;}
  toString(){return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;}
}
async function installFixture(element:any,id:string,field:string,style:Record<string,unknown>){
  const template=broadcastTemplates.find(t=>t.id===id)!;
  const data={...templateDefaults(template),_studio_format:'tv',[field]:'Texte personnalisé',_studio_typography:JSON.stringify({['tv:'+field]:style})};
  const source=await readFile(new URL('../src/studio/typography-engine.ts',import.meta.url),'utf8');
  // Execute the current adapter, isolating only DOM/font I/O and unrelated
  // image/logo installers. Its text model, native motion and SVG writes are real.
  const code=stripTypeScriptTypes(source).replace(/^import[^\n]*\n/gm,'').replace(/^export \{[^\n]*\n/gm,'').replace(/export /g,'');
  const install=runInNewContext(code+';installTypography',{
    ...textModel,fontFamily,localDisplacement,nativeTextStyle,nativeLineMotion,applyNativeLineMotion,nativeTextLayerHidden,setSvgAttribute,createRenvoiSignage,
    prepareTextFonts:async()=>'',installRelayPlacement:()=>{},installAELogoCompatibility:()=>{},installImageSizing:()=>{},installOverlayLogo:()=>({refresh:()=>{}}),
    liveTextEdit:()=>true,textRevealParent:()=>undefined,createTextReveal:()=>undefined,
    document:{createElementNS:()=>new Element(),createElement:()=>new Element()},SVGGraphicsElement:Element,DOMMatrix:Matrix,DOMException,
    getComputedStyle:(node:Element)=>({color:'#ffffff',fontFamily:'Suisse',fontSize:'41',textAlign:'right',...node.style}),
  });
  const layer=new Element();layer.style.opacity='.5';element.layerElement=layer;
  const animation={renderer:{elements:[element]},animationData:{assets:[]},addEventListener:()=>{},removeEventListener:()=>{}};
  let loaded:any;
  const graphic=Object.assign(new Element(),{shadowRoot:new Element(),state:{animation},load:async(args:any)=>{loaded=args;return {statusCode:200};},updateAction:async()=>({statusCode:200}),dispose:async()=>{},goToTime:async()=>({statusCode:200}),stopAction:async()=>({statusCode:200}),playAction:async()=>({statusCode:200}),_draw:()=>{}});
  const controller=install(graphic,template,data);await graphic.load({data});
  const overlay=graphic.shadowRoot.children.find(n=>n.getAttribute('data-studio-typography')==='')!,group=overlay.children[0],text=group.children[0];
  return {graphic,controller,group,text,layer,loaded,data};
}

for(const variant of ['1L','2L'] as const)test(`Renvoi ${variant}: styled subtitle follows real native start/middle/end opacity and vertical reveal`,async()=>{
  const states=await Promise.all([51,60,70].map(frame=>nativeSubtitleSample('BTV_Renvoi',variant,frame)));
  const fixture=await installFixture(states[0].element,'BTV_Renvoi','subtitle',{colour:'#ffffff',font:'benin',size:120,x:13,y:17,rotation:7,tracking:2,bold:true,italic:true,case:'typed'});
  for(const state of states){
    Object.assign(states[0].element,{data:state.element.data,textProperty:state.element.textProperty,textAnimator:state.element.textAnimator});
    fixture.graphic._draw();
    const native=state.element.textAnimator.renderedLetters[0],y=Number(native.m.slice(7,-1).split(',')[5]);
    assert.equal(Number(fixture.text.getAttribute('opacity')),native.o);
    assert.equal(fixture.text.getAttribute('transform'),`translate(0 ${y})`);
    assert.equal(Number(fixture.group.getAttribute('opacity')),.5,'Layer alpha remains separate and multiplicative.');
    assert.equal(fixture.group.getAttribute('transform'),'matrix(1, 0, 0, 1, 13, 17) rotate(7)');
    assert.equal(fixture.text.getAttribute('fill'),'#ffffff');assert.equal(fixture.text.getAttribute('font-family'),'SRTB Editor Benin');
    assert.equal(fixture.text.getAttribute('font-size'),'43.2');assert.equal(fixture.text.getAttribute('letter-spacing'),'2');
    assert.equal(fixture.text.getAttribute('font-weight'),'700');assert.equal(fixture.text.getAttribute('font-style'),'italic');
    assert.equal(fixture.text.children[0].textContent,'Texte personnalisé');
  }
  assert.equal(states[0].frame,51);assert.equal(fixture.loaded.data.subtitle,'A');
  assert.equal(states[1].element.textAnimator.renderedLetters[0].o,0.8600786959771338);
  assert.equal(states[2].element.textAnimator.renderedLetters[0].o,1);
});

test('Semainier programme 1: choosing white does not bypass its native line reveal',async()=>{
  const first=await nativeSubtitleSample('BTV_Semainier',null,99),fixture=await installFixture(first.element,'BTV_Semainier','programme_1_title',{colour:'#ffffff'});
  for(const frame of [99,108,118]){
    const sample=await nativeSubtitleSample('BTV_Semainier',null,frame);Object.assign(first.element,sample.element);fixture.graphic._draw();
    assert.equal(Number(fixture.text.getAttribute('opacity')),sample.element.textAnimator.renderedLetters[0].o);
    assert.equal(fixture.text.getAttribute('transform'),'translate(0 0)');assert.equal(fixture.text.getAttribute('fill'),'#ffffff');
  }
  assert.equal((await nativeSubtitleSample('BTV_Semainier',null,99)).element.textAnimator.renderedLetters[0].o,0);
  assert.equal((await nativeSubtitleSample('BTV_Semainier',null,108)).element.textAnimator.renderedLetters[0].o,0.4473684210526315);
  assert.equal(fixture.loaded.data.programme_1_title,'A');
});

test('recognized line waits for native renderedLetters and rejects an unexpected glyph matrix',async()=>{
  const {element}=await nativeSubtitleSample('BTV_Renvoi','1L',60);
  const expected=nativeLineMotion(element,'BTV_Renvoi');assert.ok(expected&&expected.opacity>0&&expected.opacity<1);
  element.textAnimator.renderedLetters[0].m='matrix(1,0,0,1,-9000,-1.3992130756378174)';
  assert.deepEqual(nativeLineMotion(element,'BTV_Renvoi'),expected,'Placeholder horizontal alignment is never copied.');
  element.textAnimator.renderedLetters[0].m='matrix(2,0,0,1,0,0)';assert.deepEqual(nativeLineMotion(element,'BTV_Renvoi'),{opacity:0,y:0});
  element.textAnimator.renderedLetters=[];assert.deepEqual(nativeLineMotion(element,'BTV_Renvoi'),{opacity:0,y:0});
});

test('a custom multiline Semainier value stays one styled block following the single native source line',async()=>{
  const {element}=await nativeSubtitleSample('BTV_Semainier',null,108);
  const fixture=await installFixture(element,'BTV_Semainier','programme_1_title',{colour:'#007300',case:'typed',lineHeight:1.5});
  await (fixture.graphic as any).__typography.updateLive({...fixture.data,programme_1_title:'Une\nDeux'},()=>true);
  assert.equal(fixture.text.children.length,2);assert.equal(fixture.text.children[0].textContent,'Une');assert.equal(fixture.text.children[1].textContent,'Deux');
  assert.equal(fixture.text.children[1].getAttribute('y'),'61.5');assert.equal(fixture.text.getAttribute('fill'),'#007300');
  assert.equal(Number(fixture.text.getAttribute('opacity')),element.textAnimator.renderedLetters[0].o);
  assert.equal(fixture.loaded.data.programme_1_title,'A','Do not silently invent new native line selectors.');
});

test('all seven Semainier subtitles and both Renvoi variants match the narrowly qualified source contract',async()=>{
  for(const [id,path,count] of [['BTV_Semainier','source/animation.json',7],['BTV_Renvoi','source/1L/animation.json',1],['BTV_Renvoi','source/2L/animation.json',1]] as const){
    const source=JSON.parse(await readFile(new URL(`../public/library/v1.7.0/${id}/${path}`,import.meta.url),'utf8'));
    const layers=source.layers.filter((layer:any)=>layer.nm==='SOUSTEXTE');assert.equal(layers.length,count);
    for(const layer of layers)assert.deepEqual(nativeLineMotion({data:layer,textProperty:{currentData:{...layer.t.d.k[0].s,l:[{n:false}]}},textAnimator:{renderedLetters:[{o:.37,m:'matrix(1,0,0,1,-20,-2)'}]}},id),{opacity:.37,y:-2});
  }
});

test('other fields/templates keep their existing animation and clear only bridge-owned attributes',async()=>{
  const {element}=await nativeSubtitleSample('BTV_Semainier',null,108),node=new Element();node.setAttribute('fill','#007300');node.setAttribute('font-size','55');
  assert.equal(nativeLineMotion(element,'BTV_Evenement'),undefined);element.data.nm='TEXTE 1 HAUT';assert.equal(nativeLineMotion(element,'BTV_Semainier'),undefined);
  applyNativeLineMotion(node as any,{opacity:.4,y:-2});applyNativeLineMotion(node as any,undefined);
  assert.equal(node.getAttribute('opacity'),null);assert.equal(node.getAttribute('transform'),null);
  assert.equal(node.getAttribute('fill'),'#007300');assert.equal(node.getAttribute('font-size'),'55');
});

test('native-only preview and video export both install the current typography adapter',async()=>{
  for(const path of ['Preview.tsx','video/engine.ts']){
    const source=await readFile(new URL('../src/studio/'+path,import.meta.url),'utf8');
    assert.match(source,/import \{installTypography\} from ['"](?:\.\.\/|\.\/)typography-engine['"]/);
    assert.ok(/installTypography\((?:element as unknown as LegacyGraphic|graphic),template,(?:resolved|data)\)/.test(source),`${path}: current adapter installation missing`);
  }
});
