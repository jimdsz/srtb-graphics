import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installAELogoCompatibility,nativeLogoColourEffect} from '../src/studio/ae-logo-compatibility';
import type {LegacyGraphic} from '../src/studio/video/engine';
const base=new URL('../public/library/v1.7.0/',import.meta.url);
const read=async(path:string)=>JSON.parse(await readFile(new URL(path,base),'utf8'));
const template=(id='BTV_Evenement')=>({id,version:'1.0.0',libraryVersion:'1.7.0',module:`/library/v1.7.0/${id}/graphic-v2.mjs`});

test('AE logo operands, matrices, mattes and timing exactly match the established BA compositing reference',async()=>{
  const reference=await read('BTV_BA_1P/lib/lottie-template.json');
  for(const id of ['BTV_Evenement','BTV_Semainier']){
    const source=await read(id+'/source/animation.json');
    const logos=source.assets.filter((a:any)=>['Anim_TV_Roll','Anim_TV_Roll_Color OUT'].includes(a.nm));
    assert.equal(logos.length,id==='BTV_Evenement'?1:2);
    for(const comp of logos)assert.deepEqual(comp.layers,reference.assets.find((a:any)=>a.nm===comp.nm).layers,id+'/'+comp.nm);
  }
});

test('adapter is version pinned, preserving all unrelated engines',()=>{
  for(const pin of [{...template(),version:'1.0.1'},{...template(),libraryVersion:'1.8.0'},template('BTV_Renvoi')]){
    const graphic={async _update(){return 1;}};const update=graphic._update;
    installAELogoCompatibility(graphic as unknown as LegacyGraphic,pin);assert.equal(graphic._update,update);
  }
});

test('Semainier colour exit admits only the two exact native Fill effects',async()=>{
  const source=await read('BTV_Semainier/source/animation.json');
  for(const comp of source.assets.filter((a:any)=>['Anim_TV_Roll','Anim_TV_Roll_Color OUT'].includes(a.nm))){
    for(const layer of comp.layers){const coloured=comp.nm==='Anim_TV_Roll_Color OUT'&&[4,7].includes(layer.ind);assert.equal(nativeLogoColourEffect(layer,comp.nm),coloured);}
  }
  const comp=source.assets.find((a:any)=>a.nm==='Anim_TV_Roll_Color OUT'),v=comp.layers.find((l:any)=>l.ind===4);
  assert.equal(nativeLogoColourEffect(v,'Anim_TV_Roll'),null);
  for(const mutate of [(l:any)=>{l.ef[0].ef[2].v.k[1].s[0]=0;},(l:any)=>{l.ef[0].ef[5].v.k=5;},(l:any)=>{l.ef[0].ef[2].v.x='expression';},(l:any)=>{l.ef.push(l.ef[0]);}]){const changed=structuredClone(v);mutate(changed);assert.equal(nativeLogoColourEffect(changed,comp.nm),null);}
});

test('pre-existing AE V clipping is an exact half-plane subtraction of the native straight-edged rectangle',async()=>{
  const source=await read('BTV_Evenement/source/animation.json'),comp=source.assets.find((a:any)=>a.nm==='Anim_TV_Roll');
  const items=comp.layers.find((l:any)=>l.nm==='V').shapes[0].it,shape=items[0].ks;
  const rectangle=items[1].it.find((s:any)=>s.ty==='rc'),transform=items[1].it.find((s:any)=>s.ty==='tr');
  const [width,height]=rectangle.s.k,[x,y]=transform.p.k,edge=y-height/2;
  assert.equal(rectangle.s.a,0);assert.equal(transform.p.a,0);assert.equal(transform.r.k,0);assert.deepEqual(transform.s.k,[100,100]);
  assert.equal(shape.a,1);
  for(const key of shape.k){
    assert.equal(key.h,1,'Held keys: clipping is never interpolated between unequal vertex counts');
    for(const path of key.s){assert.equal(path.c,true);assert(path.i.concat(path.o).every((p:number[])=>p.every(n=>n===0)));
      assert(path.v.every(([px,py]:number[])=>px>x-width/2&&px<x+width/2&&py<y+height/2));
    }
  }
  const {repairAEMergePaths}=await import(new URL('_shared/ae-live-media.mjs',base).href);
  const repaired=repairAEMergePaths(structuredClone(source)),v=repaired.assets.find((a:any)=>a.id===comp.id).layers.find((l:any)=>l.nm==='V');
  for(const key of v.shapes[0].it[0].ks.k)for(const path of key.s)assert(path.v.every((p:number[])=>p[1]<=edge));
  assert.deepEqual(v.shapes[0].it.map((s:any)=>s.ty),['sh','fl','tr']);
});

test('portable delivery relocation does not disable the same logo correction',()=>{
  const graphic={async _update(){}};const update=graphic._update;
  installAELogoCompatibility(graphic as unknown as LegacyGraphic,{...template(),module:'file:///delivery/graphic.mjs'});assert.notEqual(graphic._update,update);
});

test('social clock-only scenes remain lightweight and need no hidden logo renderer',async()=>{
  const animation={renderer:{elements:[]},currentFrame:0},graphic={animation,async _update(){return 'social';}};
  installAELogoCompatibility(graphic as unknown as LegacyGraphic,template());assert.equal(await graphic._update(),'social');assert.equal(graphic.animation,animation);
});

test('update wrapper is idempotent and preserves arguments, return values and retry after rejection',async()=>{
  const calls:unknown[]=[];
  const graphic={async _update(value:unknown){assert.equal(this,graphic);calls.push(value);if(value==='failure')throw Error('native failure');return value;}};
  installAELogoCompatibility(graphic as unknown as LegacyGraphic,template());const update=graphic._update;
  installAELogoCompatibility(graphic as unknown as LegacyGraphic,template());assert.equal(graphic._update,update);
  assert.equal(await graphic._update('first'),'first');await assert.rejects(graphic._update('failure'),/native failure/);
  assert.equal(await graphic._update('retry'),'retry');assert.deepEqual(calls,['first','failure','retry']);
});
