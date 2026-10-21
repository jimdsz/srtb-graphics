import {test,beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {request,api} from '../src/studio/api';
import {exportSnapshot} from '../src/studio/export-snapshot';
import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import type {Project} from '../src/studio/domain';
import {sessionState} from '../src/studio/session-state';
beforeEach(()=>sessionState.open());
afterEach(()=>{mock.restoreAll();sessionState.end('logout');});

test('member writes exclude server invitation metadata and resend uses its own endpoint',async()=>{
  const spy=mock.method(globalThis,'fetch',async()=>Response.json({ok:true,notice:'Envoi demandé'}));
  await api.member({email:'invite@example.test',name:'Membre',role:'designer',active:1,has_connected:true,invitation:{status:'requested',at:'2026-10-21T10:00:00Z'}});
  const [path,init]=spy.mock.calls[0].arguments as unknown as [string,RequestInit];
  assert.equal(path,'/api/graphics/members');
  assert.deepEqual(JSON.parse(String(init.body)),{email:'invite@example.test',name:'Membre',role:'designer',active:true});
  await api.inviteMember('invite@example.test');
  const [invitePath,inviteInit]=spy.mock.calls[1].arguments as unknown as [string,RequestInit];
  assert.equal(invitePath,'/api/graphics/members/invitation');
  assert.deepEqual(JSON.parse(String(inviteInit.body)),{email:'invite@example.test'});
});

test('an invitation deadline releases the form without retrying or claiming failure of the saved access',async()=>{
  mock.method(AbortSignal,'timeout',()=>AbortSignal.abort(new DOMException('timed out','TimeoutError')));
  const spy=mock.method(globalThis,'fetch',async(_input:unknown,init:RequestInit)=>{init.signal!.throwIfAborted();throw Error('unreachable');});
  await assert.rejects(api.inviteMember('invite@example.test'),{status:0,message:/peut-être déjà été enregistré/});
  assert.equal(spy.mock.callCount(),1);
});
test('network failure gives a recoverable message and does not replay a write',async()=>{
  const spy=mock.method(globalThis,'fetch',async()=>{throw new TypeError('Failed to fetch');});
  await assert.rejects(request('/projects/id',{method:'PUT',body:'{}'}),{status:0,message:/action non confirmée/});
  assert.equal(spy.mock.callCount(),1);
});
test('member deletion timeout is recoverable and never retries automatically',async()=>{
  mock.method(AbortSignal,'timeout',()=>AbortSignal.abort(new DOMException('timed out','TimeoutError')));
  const spy=mock.method(globalThis,'fetch',async(_input:unknown,init:RequestInit)=>{init.signal!.throwIfAborted();throw Error('unreachable');});
  await assert.rejects(api.deletionContinue('00000000-0000-4000-8000-000000000001'),{status:0,message:/reprenez la suppression/});assert.equal(spy.mock.callCount(),1);
});
test('truncated JSON does not masquerade as a successful save',async()=>{
  mock.method(globalThis,'fetch',async()=>new Response('{"id":',{headers:{'Content-Type':'application/json'}}));
  await assert.rejects(request('/projects/id'),{status:502,message:/Réponse incomplète/});
});
test('temporary server errors are not presented as expired sessions',async()=>{
  mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status:503,headers:{'Content-Type':'text/html'}}));
  await assert.rejects(request('/projects/id'),{status:503,message:/Service momentanément indisponible/});
  assert.equal(sessionState.snapshot().ended,false);assert.equal(sessionState.snapshot().suspended,false);
});
test('an actual login page retains the session recovery message',async()=>{
  mock.method(globalThis,'fetch',async()=>new Response('<html>',{headers:{'Content-Type':'text/html'}}));
  await assert.rejects(request('/projects/id'),{status:401,message:/session doit être renouvelée/});
  assert.equal(sessionState.snapshot().ended,true);
});

test('every API 401 closes the private gate even with an invalid response body',async()=>{
  mock.method(globalThis,'fetch',async()=>new Response('{',{status:401,headers:{'Content-Type':'application/json'}}));
  await assert.rejects(request('/media'));
  assert.equal(sessionState.snapshot().ended,true);
});
test('an ordinary permission denial does not sign out an authenticated member',async()=>{
  mock.method(globalThis,'fetch',async()=>Response.json({error:'Action réservée au diffuseur'},{status:403}));
  await assert.rejects(request('/projects/id/status'),{status:403});
  assert.equal(sessionState.snapshot().ended,false);
  await assert.rejects(request('/me'),{status:403});
  assert.equal(sessionState.snapshot().ended,true);
});
test('late responses cannot restore a closed session or end a newer login',async()=>{
  let resolve!:(response:Response)=>void;
  mock.method(globalThis,'fetch',()=>new Promise<Response>(done=>{resolve=done;}));
  const pending=request('/me');sessionState.end('logout');resolve(Response.json({name:'old account'}));
  await assert.rejects(pending,{status:401});
  sessionState.open();const old=request('/projects');sessionState.open();
  resolve(Response.json({error:'Old request'},{status:401}));await assert.rejects(old,{status:401});
  assert.equal(sessionState.snapshot().ended,false);
});
test('known remaining lifetime closes an idle session without waiting for another API call',async()=>{
  mock.method(globalThis,'fetch',async()=>Response.json({name:'Test'},{headers:{'X-SRTB-Session-Remaining-Ms':'15'}}));
  await request('/me');await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(sessionState.snapshot().ended,true);
  assert.equal(sessionState.snapshot().reason,'expired');
});
test('user cancellation remains an AbortError',async()=>{
  const task=new AbortController();task.abort();
  mock.method(globalThis,'fetch',async()=>{task.signal.throwIfAborted();});
  await assert.rejects(request('/projects/id',{signal:task.signal}),{name:'AbortError'});
});
test('direct export serializes a working snapshot before subsequent edits',async()=>{
  const t=broadcastTemplates[0];
  const project:Project={id:'00000000-0000-4000-8000-000000000001',title:'Au lancement',template_id:t.id,template_version:t.version,library_version:t.libraryVersion,data:templateDefaults(t),revision:1,status:'draft',archived:0,created_at:'',updated_at:'',created_by:'test',updated_by:'test'};
  const spy=mock.method(globalThis,'fetch',async()=>Response.json({snapshot:{purpose:'working-copy'}}));
  const data=JSON.stringify(project.data),pending=exportSnapshot(project,new AbortController().signal);
  project.title='Saisie suivante';project.data={};
  await pending;
  const [path,init]=spy.mock.calls[0].arguments as unknown as [string,RequestInit];
  assert.equal(path,`/api/graphics/projects/${project.id}/export`);assert.equal(init.method,'POST');
  const body=JSON.parse(String(init.body));assert.equal(body.title,'Au lancement');assert.equal(JSON.stringify(body.data),data);
  assert.equal(spy.mock.callCount(),1);
});

test('a transient deadline error retains generation but blocks business requests until positive server proof',async()=>{
  const epoch=sessionState.snapshot().epoch,stop=sessionState.onDeadline(()=>{});
  try{
    sessionState.lifetime(0,epoch);
    let mode:'unavailable'|'missing'|'valid'='unavailable';
    const spy=mock.method(globalThis,'fetch',async()=>mode==='unavailable'?Response.json({error:'Panne temporaire'},{status:503}):Response.json({name:'Test'},{headers:mode==='valid'?{'X-SRTB-Session-Remaining-Ms':'10000'}:{}}));
    await assert.rejects(request('/projects/id',{method:'PUT',body:'{}'}),{status:503});assert.equal(spy.mock.callCount(),0);
    await assert.rejects(request('/me'),{status:503});assert.equal(sessionState.current(epoch),true);assert.equal(sessionState.permitted(epoch),false);
    mode='missing';await assert.rejects(request('/me'),{status:503});assert.equal(sessionState.permitted(epoch),false);
    mode='valid';await request('/me');assert.equal(sessionState.permitted(epoch),true);assert.equal(sessionState.snapshot().epoch,epoch);
    await request('/projects/id');assert.equal(spy.mock.callCount(),4);
  }finally{stop();}
});

test('a real 401 during suspended verification closes the session instead of retaining private work indefinitely',async()=>{
  const stop=sessionState.onDeadline(()=>{});
  try{sessionState.lifetime(0,sessionState.snapshot().epoch);mock.method(globalThis,'fetch',async()=>Response.json({error:'Révoqué'},{status:401}));await assert.rejects(request('/me'),{status:401});assert.equal(sessionState.snapshot().ended,true);}
  finally{stop();}
});

test('network delay cannot stretch a server lifetime or let an expired response reopen the gate',async()=>{
  const stop=sessionState.onDeadline(()=>{});
  try{
    sessionState.lifetime(0,sessionState.snapshot().epoch);
    mock.method(globalThis,'fetch',async()=>{await new Promise(resolve=>setTimeout(resolve,20));return Response.json({name:'late'},{headers:{'X-SRTB-Session-Remaining-Ms':'5'}});});
    await assert.rejects(request('/me'),{status:503});assert.equal(sessionState.snapshot().suspended,true);
  }finally{stop();}
});
