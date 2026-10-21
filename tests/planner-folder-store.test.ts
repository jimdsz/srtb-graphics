import test from 'node:test';
import assert from 'node:assert/strict';
import {folderStore} from '../src/studio/planner-folder-store';
import {rememberFolder,connectedFolder,forgetFolder} from '../src/studio/day-planner-folders';
import type {DirectoryHandle} from '../src/studio/day-planner-folders';

function fake(){
 const operation:any={},store:any={},request:any={};let closes=0,aborts=0,opens=0;
 const tx:any={objectStore:()=>store,abort(){aborts++;tx.onabort?.();}};
 const db:any={transaction:()=>tx,close(){closes++;},objectStoreNames:{contains:()=>true}};
 request.result=db;
 const factory={open(){opens++;return request;}} as unknown as IDBFactory;
 return {operation,store,request,tx,db,factory,get closes(){return closes;},get aborts(){return aborts;},get opens(){return opens;}};
}
test('read resolves only on commit and closes the connection',async()=>{
 const f=fake();let settled=false;
 const pending=folderStore('readonly',()=>f.operation,{factory:f.factory}).then(v=>{settled=true;return v;});
 f.request.onsuccess();f.operation.result={name:'programme'};f.operation.onsuccess();await Promise.resolve();assert.equal(settled,false);
 f.tx.oncomplete();assert.deepEqual(await pending,{name:'programme'});assert.equal(f.closes,1);assert.equal(f.aborts,0);
});
test('DataCloneError thrown by put settles instead of leaving the interface busy',async()=>{
 const f=fake(),error=new DOMException('Cannot clone this handle','DataCloneError');
 const pending=folderStore('readwrite',()=>{throw error;},{factory:f.factory});
 const checked=assert.rejects(pending,error);f.request.onsuccess();await checked;assert.equal(f.aborts,1);assert.equal(f.closes,1);
});
test('transaction creation failure closes the connection and rejects',async()=>{
 const f=fake();f.db.transaction=()=>{throw new DOMException('Denied','SecurityError');};
 const pending=folderStore('readwrite',()=>f.operation,{factory:f.factory});
 const checked=assert.rejects(pending,{name:'SecurityError'});f.request.onsuccess();await checked;assert.equal(f.closes,1);
});
test('request failure, transaction abort and database open failure all settle',async()=>{
 for(const failure of ['request','transaction','open']){
  const f=fake(),pending=folderStore('readwrite',()=>f.operation,{factory:f.factory});
  const checked=assert.rejects(pending);
  if(failure==='open')f.request.onerror();
  else{f.request.onsuccess();if(failure==='request')f.operation.onerror();else f.tx.onabort();}
  await checked;assert.equal(f.closes,failure==='open'?0:1);
 }
});
test('blocked open rejects and a late success closes without starting an operation',async()=>{
 const f=fake();let operations=0;
 const pending=folderStore('readwrite',()=>{operations++;return f.operation;},{factory:f.factory});
 const checked=assert.rejects(pending,/bloquée/);f.request.onblocked();await checked;f.request.onsuccess();assert.equal(f.closes,1);assert.equal(operations,0);
});
test('stalled open and transaction are bounded; timed-out transactions cannot later report success',async()=>{
 for(const opened of [false,true]){
  const f=fake(),pending=folderStore('readwrite',()=>f.operation,{factory:f.factory,timeoutMs:20});
  const checked=assert.rejects(pending,/ne répond pas/);if(opened)f.request.onsuccess();await checked;
  if(opened){assert.equal(f.aborts,1);f.tx.oncomplete();}else f.request.onsuccess();
  assert.equal(f.closes,1);
 }
});
test('unavailable IndexedDB rejects without an uncaught callback error',async()=>{
 const factory={open(){throw new DOMException('Unavailable','SecurityError');}} as unknown as IDBFactory;
 await assert.rejects(folderStore('readonly',()=>{throw Error('unreachable');},{factory}),{name:'SecurityError'});
});
test('optional persistence failure keeps the granted folder usable for this member, without widening permissions',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
 let query=0,requested=0,denied=false;
 const handle={queryPermission:async()=>{query++;return denied?'denied':'granted';},requestPermission:async()=>{requested++;return 'denied';}} as DirectoryHandle;
 Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){throw new DOMException('Denied','SecurityError');}}});
 try{
  assert.match(await rememberFolder('Designer@example.test','folder-test',handle,true),/cette session/);
  assert.equal(await connectedFolder('designer@example.test','folder-test'),handle);assert.equal(query,1);assert.equal(requested,0);
  assert.equal(await connectedFolder('another@example.test','folder-test'),null);
  denied=true;await assert.rejects(connectedFolder('designer@example.test','folder-test'),/Autorisez/);assert.equal(requested,1);
  assert.match(await rememberFolder('designer@example.test','folder-test',handle,false),/n’a pas pu être effacée/);
  await assert.rejects(forgetFolder('designer@example.test','folder-test'));assert.equal(await connectedFolder('designer@example.test','folder-test'),null);
 }finally{if(previous)Object.defineProperty(globalThis,'indexedDB',previous);else Reflect.deleteProperty(globalThis,'indexedDB');}
});
