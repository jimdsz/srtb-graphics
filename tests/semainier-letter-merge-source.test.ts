import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {installAELogoCompositing,nativeLogoLetterMerge} from '../src/studio/ae-logo-compatibility.ts';

const read=(path:string)=>JSON.parse(readFileSync(new URL('../public/library/v1.7.0/'+path,import.meta.url),'utf8'));
const source=read('BTV_Semainier/source/animation.json');
const letter=(name:string)=>source.assets.find((a:any)=>a.nm===name).layers.find((l:any)=>l.nm==='é');
const expected='843df337d33213a9189c313d1df079dc9ad8853c8c5aa82b00381d7795001d56';

test('the two Semainier É operands have identical nested black fills, Add merge and outer white fill',()=>{
  for(const name of ['BENINTV_Roll','BTV_to_BENINTV_Gauche']){
    const shapes=letter(name).shapes;
    assert.equal(createHash('sha256').update(JSON.stringify(shapes)).digest('hex'),expected);
    assert.deepEqual(shapes.map((s:any)=>s.ty),['gr','gr','mm','fl']);
    assert.equal(shapes[2].mm,2);
    assert.deepEqual(shapes[3].c.k,[1,1,1,1]);
    for(const group of shapes.slice(0,2)){
      const inner=group.it[0].it;
      assert.deepEqual(inner.map((s:any)=>s.ty),['sh','fl','tr']);
      assert.deepEqual(inner[1].c.k,[0,0,0,1]);
    }
  }
});

test('the actual frozen SVG search skips Merge Add and paints both black operands after outer white',()=>{
  const runtime=readFileSync(new URL('../public/library/v1.7.0/BTV_Semainier/lib/lottie-web.esm.mjs',import.meta.url),'utf8');
  const marker='SVGShapeElement.prototype.searchShapes=',start=runtime.indexOf(marker),end=runtime.indexOf('SVGShapeElement.prototype',start+marker.length);
  assert.ok(start>=0&&end>start);
  const code=runtime.slice(start+marker.length,end).replace(/,\s*$/,'');
  const modifiers:string[]=[];
  const search=runInNewContext('('+code+')',{ShapeModifiers:{getModifier(type:string){modifiers.push(type);throw Error('Unexpected modifier '+type);}}});
  type Node={parentNode?:Node;children:Node[];colour?:number[];appendChild:(child:Node)=>void};
  const node=(colour?:number[]):Node=>({children:[],colour,appendChild(child){child.parentNode=this;this.children.push(child);}});
  const root=node(),styles:any[]=[];
  const renderer={searchShapes:search,searchProcessedElement:()=>0,addProcessedElement:()=>{},
    createStyleElement(data:any){const style={closed:false,pElem:node(data.c.k)};styles.push(style);return {style};},
    createGroupElement(){return {gr:node(),it:[],prevViewData:[]};},
    createTransformElement(){return {transform:{}};},createShapeElement(){return {};},setElementStyles(){} };
  search.call(renderer,structuredClone(letter('BTV_to_BENINTV_Gauche').shapes),[],[],root,0,[],true);
  const painted:number[][]=[];
  const walk=(n:Node)=>{if(n.colour)painted.push(n.colour);for(const child of n.children)walk(child);};walk(root);
  assert.deepEqual(modifiers,[],'mm:2 has no registered/evaluated modifier in this renderer');
  assert.deepEqual(painted,[[1,1,1,1],[0,0,0,1],[0,0,0,1]]);
  assert.equal(styles.length,3);
});

test('the independent BA PNG is not a discriminating colour reference for this isolated É',()=>{
  const ba=read('BTV_BA_1P/lib/lottie-template.json');
  const baLetter=ba.assets.find((a:any)=>a.nm==='BENINTV_Roll').layers.find((l:any)=>l.nm==='é');
  assert.deepEqual(baLetter.shapes,letter('BTV_to_BENINTV_Gauche').shapes);
  const parent=ba.assets.find((a:any)=>a.nm==='Outro_vert').layers.find((l:any)=>l.nm==='BENINTV_Roll');
  const colour=parent.ef.find((e:any)=>e.mn==='ADBE Fill').ef.find((e:any)=>e.mn==='ADBE Fill-0002').v;
  assert.deepEqual(colour.k,[1,1,1,1]);assert.equal(colour.a,0);
  assert.equal(source.layers.find((l:any)=>l.ind===12&&l.nm==='BTV_to_BENINTV_Gauche').ef,undefined);
});

test('the pinned contours have the same winding and common translation: nonzero compound fill is their union',()=>{
  const shapes=letter('BTV_to_BENINTV_Gauche').shapes;
  for(const group of shapes.slice(0,2)){
    const points=group.it[0].it[0].ks.k.v as number[][];
    const twiceArea=points.reduce((sum,[x,y],i)=>{const next=points[(i+1)%points.length];return sum+x*next[1]-y*next[0];},0);
    assert.ok(twiceArea>0,'No opposite winding that could cancel the overlap');
    const tr=group.it[1];assert.deepEqual(tr.p.k.map((n:number,i:number)=>n-tr.a.k[i]),[960,540]);
  }
});

test('guard admits only the exact letter and the two demonstrated Lottie tangent representations',()=>{
  const original=letter('BTV_to_BENINTV_Gauche');
  assert.equal(nativeLogoLetterMerge(original,'BTV_to_BENINTV_Gauche'),true);
  assert.equal(nativeLogoLetterMerge(original,'unknown'),false);
  assert.equal(nativeLogoLetterMerge({...original,ind:5},'BTV_to_BENINTV_Gauche'),false);
  const completed=structuredClone(original);
  for(const group of completed.shapes.slice(0,2)){const p=group.it[0].it[0].ks.k;p.i=structuredClone(p.v);p.o=structuredClone(p.v);p.__converted=true;group.it[1]._render=true;}
  assert.equal(nativeLogoLetterMerge(completed,'BTV_to_BENINTV_Gauche'),true);
  for(const change of [(l:any)=>{l.shapes[2].mm=3;},(l:any)=>{l.shapes[0].it[0].it[1].c.k[0]=.1;},(l:any)=>{l.shapes[3].c.k[0]=0;},
    (l:any)=>{l.shapes[0].it[0].it[0].ks.k.v[0][0]+=1;},(l:any)=>{l.shapes[1].it[0].it[0].ks.k.i[0][0]=.1;},
    (l:any)=>{l.shapes[0].it[1].p.k[0]+=1;},(l:any)=>{l.shapes[0].it[1].o.a=1;},(l:any)=>{l.ef=[{}];},(l:any)=>{l.shapes.push({ty:'st'});}]){
    const next=structuredClone(original);change(next);assert.equal(nativeLogoLetterMerge(next,'BTV_to_BENINTV_Gauche'),null);
  }
});

test('installation suppresses only consumed paints, preserves data, is idempotent, and restores exact attributes',()=>{
  const makeNode=()=>{const attrs=new Map<string,string>();return {localName:'path',getAttribute:(key:string)=>attrs.get(key)??null,setAttribute:(key:string,value:string)=>attrs.set(key,value),removeAttribute:(key:string)=>attrs.delete(key)};};
  const black=[makeNode(),makeNode()],white=makeNode();black[0].setAttribute('display','inline');
  const data=structuredClone(letter('BTV_to_BENINTV_Gauche')),before=JSON.stringify(data);
  const element={data,itemsData:[...black.map(pElem=>({it:[{it:[{}, {style:{pElem}}]}]})),{}, {style:{pElem:white}}]};
  const listeners=new Map<string,unknown>();
  const animation={animationData:{assets:[{id:'letter-comp',nm:'BTV_to_BENINTV_Gauche'}]},renderer:{globalData:{defs:{}},svgElement:{namespaceURI:'http://www.w3.org/2000/svg'},elements:[{data:{refId:'letter-comp'},elements:[element]}]},addEventListener:(name:string,fn:unknown)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)};
  const adapter=installAELogoCompositing(animation);assert.equal(adapter.letterCount,1);assert.equal(adapter.count,0);
  assert.equal(installAELogoCompositing(animation),adapter);adapter.refresh();
  for(const node of black){assert.equal(node.getAttribute('display'),'none');assert.equal(node.getAttribute('data-studio-ae-logo-merge-paint'),'consumed');}
  assert.equal(white.getAttribute('display'),null);assert.equal(JSON.stringify(data),before);
  adapter.dispose();assert.equal(black[0].getAttribute('display'),'inline');assert.equal(black[1].getAttribute('display'),null);
  assert.equal(black[0].getAttribute('data-studio-ae-logo-merge-paint'),null);assert.equal(listeners.size,0);
  const again=installAELogoCompositing(animation);assert.equal(again.letterCount,1);again.dispose();
});
