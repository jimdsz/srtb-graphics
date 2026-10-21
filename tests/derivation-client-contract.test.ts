import {afterEach,test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {CLIENT_CAPABILITIES_HEADER,DERIVATIONS_CAPABILITY,supportsDerivations} from '../src/studio/client-capabilities';
import type {request} from '../src/studio/api';
import type {sessionState} from '../src/studio/session-state';

afterEach(()=>mock.restoreAll());

test('capabilities are exact, comma-delimited public tokens, never substring matches',()=>{
  for(const value of ['', 'derivations-v10', 'not-derivations-v1', 'DERIVATIONS-V1', 'derivations-v1;admin=true']){
    assert.equal(supportsDerivations(new Headers({[CLIENT_CAPABILITIES_HEADER]:value})),false,value);
  }
  for(const value of [DERIVATIONS_CAPABILITY,'other-v1, derivations-v1','derivations-v1, future-v2']){
    assert.equal(supportsDerivations(new Headers({[CLIENT_CAPABILITIES_HEADER]:value})),true,value);
  }
});

for(const enabled of [false,true])test(`compiled ${enabled?'ON':'OFF'} API sets its own capability and keeps request/session semantics`,async()=>{
  const compiled=await build({stdin:{contents:"export {request} from './src/studio/api';export {sessionState} from './src/studio/session-state';",resolveDir:fileURLToPath(new URL('../',import.meta.url)),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',define:{__SRTB_DERIVATIONS__:String(enabled)}});
  const client=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`) as {request:typeof request;sessionState:typeof sessionState};
  client.sessionState.open();
  const calls:{path:string;init:RequestInit}[]=[];
  mock.method(globalThis,'fetch',async(path:string,init:RequestInit)=>{calls.push({path,init});return Response.json({ok:true});});
  const input=new Headers({'X-Request-Test':'preserved',[CLIENT_CAPABILITIES_HEADER]:'forged-v99'});
  for(const path of ['/me','/projects','/projects/child/export','/preparation-profiles/voice-catalogue'])await client.request(path,{method:'POST',body:'{}',headers:input});
  assert.equal(input.get(CLIENT_CAPABILITIES_HEADER),'forged-v99','never mutate the caller header object');
  for(const {init} of calls){
    const headers=new Headers(init.headers);
    assert.equal(headers.get(CLIENT_CAPABILITIES_HEADER),enabled?DERIVATIONS_CAPABILITY:null);
    assert.equal(headers.get('X-Request-Test'),'preserved');assert.equal(headers.get('Content-Type'),'application/json');
    assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');
  }
  assert.equal(calls[0].path,'/api/me');assert.equal(calls[1].path,'/api/graphics/projects');
  mock.restoreAll();
  const message='Ce projet nécessite l’interface récente. Conservez cet onglet et ses brouillons ; ouvrez Graphics dans un nouvel onglet.';
  mock.method(globalThis,'fetch',async()=>Response.json({error:message},{status:409}));
  const before=client.sessionState.snapshot();
  await assert.rejects(client.request('/projects/child'),{status:409,message});
  assert.equal(client.sessionState.snapshot(),before,'compatibility refusal must not expire or suspend the session');
  client.sessionState.end('logout');
});
