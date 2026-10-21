import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {ABTransformMismatch,preparePolygonProbe,verifyEvaluatedPolygon,evaluatedPathData,exactRgbaReplay,verifyExactGroupTransform} from './ae-logo-mask-ab-model';
const sourceUrl=new URL('../public/library/v1.7.0/BTV_BA_1P/lib/lottie-template.json',import.meta.url);
const readSource=async()=>JSON.parse(await readFile(sourceUrl,'utf8'));
const {repairAEMergePaths}=await import(new URL('../public/library/v1.7.0/_shared/ae-live-media.mjs',import.meta.url).href);
const evaluated=(raw:any)=>({_length:raw.v.length,c:raw.c,...Object.fromEntries(['v','i','o'].map(key=>[key,raw.v.map((p:number[],n:number)=>Float32Array.from(p.map((value,axis)=>value+(key==='v'?0:raw[key][n][axis]))))]))}) as any;

test('frozen exact clipping keeps the raw source and V transform intact at held frame 10',async()=>{
  const source=await readSource(),before=JSON.stringify(source),prepared=preparePolygonProbe(source,repairAEMergePaths);
  assert.equal(JSON.stringify(source),before);assert.equal(prepared.evidence.localFrame,10);assert.equal(prepared.evidence.heldSourceKey,11);
  const exactEdge=834.097-788.547/2;
  assert.equal(prepared.evidence.clipEdge,exactEdge);assert.deepEqual(prepared.groupTransform.p.k,[0,-103.117]);
  assert.deepEqual(prepared.expectedShape.v.slice(0,4),prepared.originalShape.v.slice(0,4));
  assert.equal(prepared.expectedShape.v.length,7);assert.equal(prepared.expectedShape.v[4][1],exactEdge);assert.equal(prepared.expectedShape.v[5][1],exactEdge);
  assert.deepEqual(prepared.expectedShape.v[6],prepared.originalShape.v[6]);
  assert.ok(prepared.expectedShape.v[4][0]<-107.484);assert.ok(prepared.expectedShape.v[5][0]>105.543);
  assert.deepEqual(prepared.expectedShape.i,Array.from({length:7},()=>[0,0]));assert.deepEqual(prepared.expectedShape.o,prepared.expectedShape.i);
});
test('qualification rejects changed clock, interpolated keys, rectangle rotation and insufficient rectangle coverage',async()=>{
  for(const mutate of [
    (v:any)=>{v.st=1;},(v:any)=>{v.shapes[0].it[0].ks.k[0].h=0;},
    (v:any)=>{v.shapes[0].it[1].it.find((i:any)=>i.ty==='tr').r.k=1;},
    (v:any)=>{v.shapes[0].it[0].ks.k[0].s[0].v[0][0]=1000;},
    (v:any)=>{v.shapes[0].it[0].ks.k[0].s[0].i[0][0]=1;},
  ]){const source=await readSource();mutate(source.assets.find((a:any)=>a.nm==='Anim_TV_Roll').layers.find((l:any)=>l.ind===4));assert.throws(()=>preparePolygonProbe(source,repairAEMergePaths));}
  assert.throws(()=>preparePolygonProbe({assets:[]},repairAEMergePaths));
});
test('path serializer uses absolute evaluated tangents and rejects a relative-tangent impostor',async()=>{
  const {expectedShape}=preparePolygonProbe(await readSource(),repairAEMergePaths),live=evaluated(expectedShape);
  const evidence=verifyEvaluatedPolygon(live,expectedShape);assert.equal(evidence.vertices.length,7);
  const d=evaluatedPathData(live);assert.ok(d.startsWith(`M${Math.fround(251.324)},-540 C${Math.fround(251.324)},-540`));
  const wrong=evaluated(expectedShape);wrong.i=expectedShape.i;assert.throws(()=>verifyEvaluatedPolygon(wrong,expectedShape),/differs at i/);
  wrong.c=false;assert.throws(()=>evaluatedPathData(wrong),/closed/);
  const changed=evaluated(expectedShape);changed.v[4][0]+=1;assert.throws(()=>verifyEvaluatedPolygon(changed,expectedShape),/differs at v/);
});
test('A2 repeatability has no tolerance, including invisible RGB and one alpha level',()=>{
  const a=new Uint8ClampedArray([255,255,255,0,0,115,0,255]);assert.equal(exactRgbaReplay(a,a).exact,true);
  for(const index of [0,7]){const b=a.slice();b[index]--;const measured=exactRgbaReplay(a,b);assert.deepEqual(measured,{exact:false,pixels:2,changedPixels:1,maxChannelDifference:1});}
  assert.throws(()=>exactRgbaReplay(a,new Uint8ClampedArray(4)),/dimensions/);
});
test('group-transform guard describes exact changed and added paths without tolerating them',()=>{
  const expected={p:{a:0,k:[0,-103.117]},ty:'tr'},actual=structuredClone(expected);actual.p.k[1]++;
  assert.throws(()=>verifyExactGroupTransform(actual,expected,'native'),(error:unknown)=>error instanceof ABTransformMismatch&&JSON.stringify(error.differences).includes('V.group.transform.p.k[1]'));
  assert.throws(()=>verifyExactGroupTransform({...expected,newRuntimeKey:0},expected,'native'),(error:unknown)=>error instanceof ABTransformMismatch&&JSON.stringify(error.differences).includes('V.group.transform.newRuntimeKey'));
  verifyExactGroupTransform(structuredClone(expected),expected,'native');
  assert.throws(()=>verifyExactGroupTransform({...expected,_render:false},expected,'native'),/V.group.transform._render/);
});
test('the actual frozen SVG search adds exactly _render=true to the native group transform',async()=>{
  const {groupTransform}=preparePolygonProbe(await readSource(),repairAEMergePaths),actual=structuredClone(groupTransform);
  const runtime=await readFile(new URL('../public/library/v1.7.0/BTV_BA_1P/lib/lottie-web.esm.mjs',import.meta.url),'utf8');
  const marker='SVGShapeElement.prototype.searchShapes=',start=runtime.indexOf(marker),end=runtime.indexOf('SVGShapeElement.prototype',start+marker.length);
  assert.ok(start>=0&&end>start,'Locate the real frozen SVG search function.');
  const code=runtime.slice(start+marker.length,end).replace(/,\s*$/,'');
  const search=runInNewContext('('+code+')');
  const received:any[]=[];search.call({searchProcessedElement:()=>0,createTransformElement:(data:any)=>{received.push(data);return {transform:{}};},addProcessedElement:()=>{}},[actual],[],[],{},0,[],true);
  assert.deepEqual(actual,{...groupTransform,_render:true});assert.equal(received[0],actual);
  const normalizations=verifyExactGroupTransform(actual,groupTransform,'native');assert.equal(normalizations.length,1);
  const shifted=structuredClone(actual);shifted.p.k[1]+=1;
  assert.throws(()=>verifyExactGroupTransform(shifted,groupTransform,'native'),/V.group.transform.p.k\[1\]/);
});
