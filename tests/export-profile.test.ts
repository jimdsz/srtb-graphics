import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ExportProfile} from '../src/studio/video/export-profile';

test('profiling aggregates every raster pass without double-counting nested durations as exclusive',()=>{
  let time=0;const profile=new ExportProfile(()=>time);
  profile.frame(0,0,'intro');
  time=5;profile.record('raster.bitmap',0);
  time=8;profile.record('raster.clone',0);
  time=12;profile.record('raster.svgDecode',8);
  time=14;profile.record('raster.total',0);
  time=15;profile.record('raster.clone',14);
  time=19;profile.record('raster.total',14);
  profile.count('raster.passes',2);profile.endFrame();
  const result=profile.snapshot();
  assert.deepEqual(result.stages['raster.total'],{calls:2,ms:19,maxMs:14});
  assert.deepEqual(result.stages['raster.clone'],{calls:2,ms:9,maxMs:8});
  assert.equal(result.stages['raster.bitmap']?.ms,5);
  assert.equal(result.frames[0].stages['raster.total']?.calls,2);
  assert.equal(result.counters['raster.passes'],2);
  assert.match(result.accounting,/Do not add nested stages/);
});

test('setup and phases remain separate; recording never retains mutable snapshots',()=>{
  let time=10;const profile=new ExportProfile(()=>time);
  time=20;profile.record('prepare',10);profile.frame(250,10,'body');
  time=24;profile.record('encoder.add',20);profile.frame(300,64.8,'out');
  time=31;profile.record('decode.frame',24);const first=profile.snapshot();
  assert.equal(first.phases.setup.prepare?.ms,10);
  assert.equal(first.phases.body['encoder.add']?.ms,4);
  assert.equal(first.phases.out['decode.frame']?.ms,7);
  assert.deepEqual(first.frames.map(frame=>frame.frame),[250,300]);
  first.frames[1].stages['decode.frame']!.ms=999;
  assert.equal(profile.snapshot().frames[1].stages['decode.frame']?.ms,7);
});

test('frame detail is bounded while full-run stage totals continue',()=>{
  let time=0;const profile=new ExportProfile(()=>time,2);
  for(let frame=0;frame<5;frame++){profile.frame(frame,frame/25,'intro');const start=time;time++;profile.record('frame.total',start);profile.endFrame();}
  const result=profile.snapshot();assert.equal(result.frames.length,2);assert.equal(result.omittedFrames,3);
  assert.deepEqual(result.stages['frame.total'],{calls:5,ms:5,maxMs:1});
});

test('instrumentation is explicit and retains all native render/encode verification guards',async()=>{
  const source=await readFile(new URL('../src/studio/video/export.ts',import.meta.url),'utf8');
  assert.match(source,/profile\?:ExportProfile/);assert.match(source,/await verify\(blob,report,proofs,signal,mixed\?\.buffer\)/);
  assert.match(source,/await addFrame\(frame\)/);assert.match(source,/if\(!NATIVE_ONLY_EXPORT&&needsOpaqueCbrFallback\(nativeFloor\)\)/);
  assert.doesNotMatch(source,/new ExportProfile|localStorage|sessionStorage/);
  const engine=await readFile(new URL('../src/studio/video/engine.ts',import.meta.url),'utf8');
  assert.match(engine,/fastBody=error\/a\.length<\.12/);assert.match(engine,/index%25===0/);
  const raster=await readFile(new URL('../src/studio/video/raster.ts',import.meta.url),'utf8');
  assert.match(raster,/opaque\?'image\/jpeg':'image\/png',1/);assert.match(raster,/this\.underlayAccepted=error\/a\.length<\.12/);
  assert.doesNotMatch(raster,/bitmapOpacity|bitmap-opacity|bitmap\.opacity/);
});
