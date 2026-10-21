import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderSlot,withRenderSlot,renderSlot} from '../src/studio/render-slot';
test('one shared renderer, FIFO, cancelled waits removed, idempotent release',async()=>{
 const slot=createRenderSlot(),a=new AbortController(),b=new AbortController(),c=new AbortController(),order:string[]=[];
 const release=await slot.acquire(a.signal);assert.equal(slot.snapshot(),true);
 const blocked=slot.acquire(b.signal);const rejected=assert.rejects(blocked,{name:'AbortError'});b.abort();await rejected;
 const next=slot.acquire(c.signal).then(done=>{order.push('next');return done;});await Promise.resolve();assert.deepEqual(order,[]);
 release();const finish=await next;release();assert.equal(slot.snapshot(),true);finish();assert.equal(slot.snapshot(),false);
});
test('render exception releases the shared slot',async()=>{
 await assert.rejects(withRenderSlot(new AbortController().signal,async()=>{throw Error('render failed');}),/render failed/);
 assert.equal(renderSlot.snapshot(),false);
 assert.equal(await withRenderSlot(new AbortController().signal,async()=>42),42);
});
