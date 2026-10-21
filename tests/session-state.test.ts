import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSessionState} from '../src/studio/session-state';

test('termination is synchronous and idempotent; stale generations cannot reopen it',()=>{
  const state=createSessionState(),epoch=state.snapshot().epoch;let changes=0;
  const off=state.subscribe(()=>changes++);
  assert.equal(state.end('logout'),true);assert.equal(state.current(epoch),false);
  assert.equal(state.end('expired'),false);assert.equal(changes,1);
  state.open();assert.equal(state.current(epoch),false);assert.equal(state.end('expired',epoch),false);
  assert.equal(state.snapshot().ended,false);off();state.end('logout');assert.equal(changes,2);
});
test('an old expiry timer cannot close an explicitly reopened session',async()=>{
  const state=createSessionState();state.lifetime(10,state.snapshot().epoch);state.end('logout');state.open();
  await new Promise(resolve=>setTimeout(resolve,35));assert.equal(state.snapshot().ended,false);state.end('logout');
});
test('late shorter lifetimes cannot undo a confirmed renewal',async()=>{
  const state=createSessionState(),epoch=state.snapshot().epoch;
  state.lifetime(60,epoch);state.lifetime(1,epoch);
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(state.snapshot().ended,false);state.end('logout');
});

test('a deadline can recheck the shared session renewed by a different tab',async()=>{
  const state=createSessionState();let checks=0;
  const off=state.onDeadline(epoch=>{checks++;state.lifetime(1000,epoch);});
  state.lifetime(5,state.snapshot().epoch);
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(checks,1);assert.equal(state.snapshot().ended,false);
  off();state.end('logout');
});

test('uncertain deadline suspends permissions without ending or changing the in-memory draft generation',async()=>{
  const state=createSessionState(),epoch=state.snapshot().epoch;let checks=0;
  state.onDeadline(()=>checks++);state.lifetime(5,epoch);
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(checks,1);assert.equal(state.current(epoch),true);assert.equal(state.permitted(epoch),false);
  assert.equal(state.snapshot().ended,false);assert.equal(state.snapshot().suspended,true);
  state.lifetime(Number.NaN,epoch);assert.equal(state.permitted(epoch),false);
  state.lifetime(1000,epoch);assert.equal(state.permitted(epoch),true);assert.equal(state.snapshot().epoch,epoch);
  state.end('logout');
});

test('zero remaining lifetime never authorizes access and positive old-generation responses cannot restore it',()=>{
  const state=createSessionState(),epoch=state.snapshot().epoch;
  state.onDeadline(()=>{});state.lifetime(0,epoch);assert.equal(state.permitted(epoch),false);
  state.end('expired',epoch);state.lifetime(1000,epoch);assert.equal(state.snapshot().ended,true);
  state.open();state.lifetime(0,epoch);assert.equal(state.snapshot().suspended,false);state.end('logout');
});

test('a resumed session does not re-authorize an asynchronous action captured before suspension',()=>{
  const state=createSessionState(),epoch=state.snapshot().epoch;
  const action=state.permission();assert.equal(action(),true);
  state.onDeadline(()=>{});state.lifetime(0,epoch);assert.equal(action(),false);
  state.lifetime(1000,epoch);assert.equal(state.permitted(epoch),true);assert.equal(action(),false);
  const next=state.permission();assert.equal(next(),true);state.end('expired');assert.equal(next(),false);
});

test('a BFCache restore stays suspended until fresh server proof; a terminated session cannot resume',()=>{
  const state=createSessionState(),epoch=state.snapshot().epoch;
  state.lifetime(10000,epoch);const oldAction=state.permission();state.suspend();
  assert.equal(state.permitted(epoch),false);assert.equal(oldAction(),false);
  state.lifetime(9000,epoch);assert.equal(state.permitted(epoch),true);assert.equal(oldAction(),false);
  state.end('logout');state.lifetime(10000,epoch);assert.equal(state.snapshot().ended,true);
});
