import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=JSON.parse(readFileSync(new URL('../public/library/v1.7.0/BTV_Semainier/source/animation.json',import.meta.url),'utf8'));
function progress(x:number,x1:number,y1:number,x2:number,y2:number){
  const cubic=(t:number,a:number,b:number)=>3*(1-t)*(1-t)*t*a+3*(1-t)*t*t*b+t*t*t;
  let low=0,high=1;for(let n=0;n<80;n++){const mid=(low+high)/2;if(cubic(mid,x1,x2)<x)low=mid;else high=mid;}
  return cubic((low+high)/2,y1,y2);
}
test('native Semainier split media still leaves a 3.14px tail at frame64',()=>{
  const top=source.layers.find((l:any)=>l.ind===72),bottom=source.layers.find((l:any)=>l.ind===73);
  assert.equal(top.nm,'BA_Sem_Rush_Intro');assert.equal(bottom.nm,top.nm);
  const first=top.ks.p.k[0],end=top.ks.p.k[1];
  assert.deepEqual([first.t,end.t,first.s,end.s],[37,67,[960,-540,0],[960,0,0]]);
  assert.deepEqual(first.o,{x:.65,y:0});assert.deepEqual(first.i,{x:.2,y:1});
  const remaining=540*(1-progress((64-37)/(67-37),first.o.x,first.o.y,first.i.x,first.i.y));
  assert.ok(Math.abs(remaining-3.140642219836358)<1e-9);
  assert.deepEqual(bottom.ks.p.k[0].s,[960,1620,0]);assert.deepEqual(bottom.ks.p.k[1].s,[960,1080,0]);
  // Same motion curve, opposite offsets: not a texture-size rounding artefact.
  assert.deepEqual(bottom.ks.p.k[0].o,first.o);assert.deepEqual(bottom.ks.p.k[0].i,first.i);
  assert.ok(remaining>3&&remaining<4);
});
test('large logo halves remain active until68 and follow their split media parents',()=>{
  for(const [ind,parent,mode]of [[74,72,2],[75,73,1]]){
    const layer=source.layers.find((l:any)=>l.ind===ind);
    assert.equal(layer.nm,'Anim_TV_Roll');assert.equal(layer.parent,parent);assert.equal(layer.tt,mode);assert.equal(layer.tp,80);
    assert.equal(layer.ip,0);assert.equal(layer.op,68);
  }
  assert.ok(Math.abs(540*(1-progress(1,.65,0,.2,1)))<1e-9);
});
