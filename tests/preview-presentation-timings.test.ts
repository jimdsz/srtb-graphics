import test from 'node:test';
import assert from 'node:assert/strict';
import {PreviewPresentationTimings} from '../src/studio/preview-presentation-timings';

test('presentation diagnostics summarize the observation, not just its final cheap frame',()=>{
  const timings=new PreviewPresentationTimings();
  timings.record({started:0,presented:200,captureMs:10,packageMs:150,decodeMs:40});
  for(let i=1;i<=20;i++)timings.record({started:i*1000,presented:i*1000+40,captureMs:2,packageMs:35,decodeMs:3});
  timings.record({started:21000,presented:21004,captureMs:1,packageMs:2,decodeMs:1});
  const report=timings.snapshot(1000);
  assert.equal(report.samples,21);assert.equal(report.package.p95Ms,35);assert.equal(report.package.maxMs,35);
  assert.equal(report.preparation.p95Ms,40);assert.equal(report.hrefSwapGap.p95Ms,1000);assert.equal(report.hrefSwapGapsOver80ms,20);
  assert.equal(report.truncated,false);assert.equal(timings.snapshot(22000).samples,0);
});
test('presentation diagnostics keep a bounded history and indicate truncated observations',()=>{
  const timings=new PreviewPresentationTimings();
  for(let i=0;i<600;i++)timings.record({started:i*40,presented:i*40+20,captureMs:2,packageMs:15,decodeMs:3});
  assert.equal(timings.snapshot().samples,512);assert.equal(timings.snapshot().truncated,true);
  const recent=timings.snapshot(590*40);assert.equal(recent.samples,10);assert.equal(recent.truncated,false);
  assert.equal(recent.hrefSwapGap.meanMs,40);assert.equal(recent.preparation.meanMs,20);
});
test('invalid preparation samples never contaminate diagnostics',()=>{
  const timings=new PreviewPresentationTimings(),frame={started:10,presented:20,captureMs:2,packageMs:5,decodeMs:3};
  for(const invalid of [{started:-1},{presented:9},{captureMs:NaN},{packageMs:-1},{decodeMs:Infinity}])timings.record({...frame,...invalid});
  assert.equal(timings.snapshot().samples,0);timings.record(frame);assert.equal(timings.snapshot().samples,1);
});
