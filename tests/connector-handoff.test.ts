import test from 'node:test';
import assert from 'node:assert/strict';
import {readConnectorHandoff,captureConnectorHandoff,pendingConnectorHandoff,clearConnectorHandoff} from '../src/studio/connector-handoff';
test('handoff accepts only the one-use code, never an owner token, URL, path or redirect',()=>{
 assert.deepEqual(readConnectorHandoff('#connect-media=123456ABCDEF',100),{code:'123456ABCDEF',expires:300100});
 for(const hash of ['#connect-media='+'a'.repeat(64),'#connect-media=123456ABCDEF&redirect=https://other.test','#connect-media=C:/media','#connect-media=%31%32','#connect-media=bad','#other=123456ABCDEF'])assert.equal(readConnectorHandoff(hash),null);
});
test('handoff is removed from the URL before sign-in, held in memory and clearable',()=>{
 let replaced='';Object.assign(globalThis,{window:{location:{hash:'#connect-media=123456ABCDEF',pathname:'/graphics',search:'?v=test'},history:{state:null,replaceState:(_state:unknown,_title:string,url:string)=>{replaced=url;}}}});
 captureConnectorHandoff();assert.equal(replaced,'/graphics?v=test');assert.equal(pendingConnectorHandoff()?.code,'123456ABCDEF');clearConnectorHandoff();assert.equal(pendingConnectorHandoff(),null);
 window.location.hash='#connect-media='+'a'.repeat(64);captureConnectorHandoff();assert.equal(pendingConnectorHandoff(),null);assert.equal(replaced,'/graphics?v=test');
});
