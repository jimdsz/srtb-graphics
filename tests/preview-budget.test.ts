import test from 'node:test';
import assert from 'node:assert/strict';
import {PreviewBudget} from '../src/studio/preview-budget';
test('preview starts bounded, adapts only after sustained cost and cannot degrade below 640',()=>{
 const b=new PreviewBudget(8);assert.equal(b.edge,1280);assert.equal(new PreviewBudget(4).edge,960);
 for(let i=0;i<7;i++)assert.equal(b.observe(30),false);assert.equal(b.edge,1280);
 assert.equal(b.observe(30),true);assert.equal(b.edge,960);
 for(let i=0;i<8;i++)b.observe(30);assert.equal(b.edge,640);
 for(let i=0;i<50;i++)assert.equal(b.observe(100),false);assert.equal(b.edge,640);
});
test('one expensive frame, invalid timings and fast frames never cause a downshift',()=>{
 const b=new PreviewBudget();for(let i=0;i<100;i++){b.observe(30);b.observe(2);b.observe(NaN);b.observe(-1);}assert.equal(b.edge,1280);
});
test('asynchronous presentation adapts after eight distinct slow frames, despite fast draw submissions',()=>{
 const b=new PreviewBudget(4),sample={presented:0,encodeMs:90};
 for(let i=1;i<=8;i++){sample.presented=i;assert.equal(b.observePresentation(sample),i===8);for(let j=0;j<5;j++)b.observe(1);}
 assert.equal(b.edge,640);
});
test('stale presentation samples, first-load outliers and invalid counters do not degrade preview',()=>{
 const b=new PreviewBudget(4),sample={presented:1,encodeMs:200};b.observePresentation(sample);
 for(let i=0;i<100;i++)assert.equal(b.observePresentation(sample),false);
 assert.equal(b.edge,960);
 sample.presented=2;sample.encodeMs=10;b.observePresentation(sample);
 for(let i=3;i<40;i++){sample.presented=i;sample.encodeMs=i%2?50:10;b.observePresentation(sample);}
 for(const presented of [0,-1,NaN,Infinity,.5])assert.equal(b.observePresentation({presented,encodeMs:100}),false);
 assert.equal(b.edge,960);
});
test('a new media publisher starts a fresh counter, and preview cannot drop below its minimum',()=>{
 const b=new PreviewBudget(4),intro={presented:300,encodeMs:5},body={presented:0,encodeMs:80};b.observePresentation(intro);
 for(let i=1;i<=40;i++){body.presented=i;b.observePresentation(body);}assert.equal(b.edge,640);
});
