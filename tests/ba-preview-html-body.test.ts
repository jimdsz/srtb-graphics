import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {baHTMLBodyPhase,baHTMLBodyStructure} from '../src/studio/ba-preview-html-body';
test('HTML body starts after the intro and ends with the native body',()=>{
  for(const seconds of [-1,0,5.56,66.16,72.92,NaN])assert.equal(baHTMLBodyPhase(seconds),false);
  for(const seconds of [5.6,8,64.8,66.12])assert.equal(baHTMLBodyPhase(seconds),true);
});
test('pinned native BA supports the body ordering and exact lower-half clip',async()=>{
  const data=JSON.parse(await readFile('public/library/v1.7.0/BTV_BA_1P/lib/lottie-template.json','utf8'));
  assert.equal(baHTMLBodyStructure(data),true);
  const lower=data.layers.find((layer:any)=>layer.ind===25),upper=data.layers.find((layer:any)=>layer.ind===26);
  assert.equal(lower.nm,'BA_1P_Rush_Corps');assert.equal(upper.nm,lower.nm);assert.equal(upper.refId,lower.refId);
  assert.equal(lower.tt,undefined);assert.equal(upper.tt,undefined);assert.equal(upper.masksProperties,undefined);
  assert.equal(lower.masksProperties.length,1);const mask=lower.masksProperties[0];
  assert.equal(mask.mode,'a');assert.equal(mask.inv,false);assert.equal(mask.pt.a,0);assert.equal(mask.o.k,100);assert.equal(mask.x.k,0);
  assert.deepEqual(mask.pt.k.v,[[0,540],[0,1080],[1920,1080],[1920,540]]);
  assert.deepEqual(mask.pt.k.i,[[0,0],[0,0],[0,0],[0,0]]);assert.deepEqual(mask.pt.k.o,mask.pt.k.i);
  // A later AE index paints behind the body; only the non-painted split matte
  // survives after frame 140. Reordering all body layers below SVG is unsafe
  // during the intro, which is why HTML presentation explicitly excludes it.
  const behind=data.layers.filter((layer:any)=>layer.ind>26&&layer.ip<1654&&layer.op>140);
  assert.deepEqual(behind.map((layer:any)=>[layer.ind,layer.td]),[[48,1]]);
});
test('unknown body masks, ordering, effects and matte sources retain the SVG fallback',async()=>{
  const native=JSON.parse(await readFile('public/library/v1.7.0/BTV_BA_1P/lib/lottie-template.json','utf8'));
  for(const mutate of [
    (data:any)=>{data.w=1080;},
    (data:any)=>{data.layers.find((layer:any)=>layer.ind===25).masksProperties[0].pt.a=1;},
    (data:any)=>{data.layers.find((layer:any)=>layer.ind===25).masksProperties[0].inv=true;},
    (data:any)=>{data.layers.find((layer:any)=>layer.ind===25).masksProperties[0].pt.k.v[0][1]=500;},
    (data:any)=>{data.layers.find((layer:any)=>layer.ind===26).tt=1;},
    (data:any)=>{data.layers.find((layer:any)=>layer.ind===26).ef=[{}];},
    (data:any)=>{data.layers.find((layer:any)=>layer.ind===26).ddd=1;},
    (data:any)=>{data.layers.find((layer:any)=>layer.ind===48).td=0;},
    (data:any)=>{data.layers.push({...data.layers.find((layer:any)=>layer.ind===26)});},
    (data:any)=>{data.layers.reverse();},
  ]){const data=structuredClone(native);mutate(data);assert.equal(baHTMLBodyStructure(data),false);}
  const completed=structuredClone(native);completed.__complete=true;
  const path=completed.layers.find((layer:any)=>layer.ind===25).masksProperties[0].pt.k;
  path.i=structuredClone(path.v);path.o=structuredClone(path.v);assert.equal(baHTMLBodyStructure(completed),true);
  path.o[0][0]=1;assert.equal(baHTMLBodyStructure(completed),false);
  for(const data of [null,{},[],{layers:[],assets:[],w:1920,h:1080}])assert.equal(baHTMLBodyStructure(data),false);
});
