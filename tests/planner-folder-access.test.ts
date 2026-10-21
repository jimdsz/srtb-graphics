import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseFolder,connectedFolder,rememberFolder} from '../src/studio/day-planner-folders';
import type {DirectoryHandle} from '../src/studio/day-planner-folders';

const outcome=async(pending:Promise<unknown>)=>Promise.race([
 pending.then(()=> 'resolved',error=>error instanceof DOMException?error.name:'error'),
 new Promise<string>(resolve=>setTimeout(()=>resolve('still waiting'),40)),
]);
function environment(picker?:()=>Promise<unknown>){
 const originals=['window','indexedDB'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'window',{configurable:true,value:{showDirectoryPicker:picker}});
 Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){throw new DOMException('Unavailable','SecurityError');}}});
 return ()=>{for(const [key,value] of originals)if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);};
}

test('native picker can be abandoned; a late choice never resumes the cancelled operation',async()=>{
 let finish!:(value:DirectoryHandle)=>void,calls=0;
 const handle={kind:'directory',name:'Selected'} as DirectoryHandle;
 const restore=environment(()=>{calls++;return new Promise(resolve=>finish=resolve);});
 try{
  const c=new AbortController(),pending=chooseFolder(c.signal);c.abort();
  assert.equal(await outcome(pending),'AbortError');finish(handle);await Promise.resolve();
  assert.equal(await outcome(pending),'AbortError');assert.equal(calls,1);
  await assert.rejects(chooseFolder(c.signal),{name:'AbortError'});assert.equal(calls,1);
 }finally{restore();}
});

test('cancelling a remembered access query stops before requesting permission',async()=>{
 let finish!:(value:PermissionState)=>void,requests=0;
 const handle={kind:'directory',queryPermission:()=>new Promise<PermissionState>(resolve=>finish=resolve),requestPermission:async()=>{requests++;return 'granted';}} as DirectoryHandle;
 const restore=environment();
 try{
  await rememberFolder('access@test.invalid','query',handle,false);
  const c=new AbortController(),pending=connectedFolder('access@test.invalid','query',c.signal);c.abort();
  assert.equal(await outcome(pending),'AbortError');finish('prompt');await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,0);
 }finally{restore();}
});

test('cancelling an open permission prompt ignores a late grant and allows a new attempt',async()=>{
 let finish!:(value:PermissionState)=>void,started!:()=>void,granted=false;
 const opened=new Promise<void>(resolve=>started=resolve);
 const handle={kind:'directory',queryPermission:async()=>granted?'granted':'prompt',requestPermission:()=>{started();return new Promise<PermissionState>(resolve=>finish=resolve);}} as DirectoryHandle;
 const restore=environment();
 try{
  await rememberFolder('access@test.invalid','prompt',handle,false);
  const c=new AbortController(),pending=connectedFolder('access@test.invalid','prompt',c.signal);await opened;c.abort();
  assert.equal(await outcome(pending),'AbortError');granted=true;finish('granted');await Promise.resolve();assert.equal(await outcome(pending),'AbortError');
  assert.equal(await connectedFolder('access@test.invalid','prompt',new AbortController().signal),handle);
 }finally{restore();}
});

test('a cancelled connection never opens storage or queries the folder',async()=>{
 const restore=environment();let queries=0;
 try{
  const handle={queryPermission:async()=>{queries++;return 'granted';}} as DirectoryHandle;
  await rememberFolder('access@test.invalid','pre-cancelled',handle,false);
  const c=new AbortController();c.abort();
  await assert.rejects(connectedFolder('access@test.invalid','pre-cancelled',c.signal),{name:'AbortError'});assert.equal(queries,0);
 }finally{restore();}
});
