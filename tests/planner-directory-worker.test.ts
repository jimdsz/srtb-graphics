import test from 'node:test';
import assert from 'node:assert/strict';
import {directoryMediaWorker} from '../src/studio/planner-team-worker';
import {TeamMediaMatcher} from '../src/studio/planner-team-search';
import {mediaProposals} from '../src/studio/day-planner-assistant';
import type {DirectoryIndex,PlannerRecord,PlannerRow} from '../src/studio/day-planner-model';

const rows:PlannerRow[]=Array.from({length:60},(_,i)=>({id:String(i),title:`Émission série ${String(i).padStart(4,'0')}`,subtitle:'',sheet:'LUNDI',cell:`B${i+1}`,raw:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:30:00',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null}));
const directory:PlannerRecord<DirectoryIndex>={id:'11111111-1111-4111-8111-111111111111',revision:1,data:{kind:'directory',name:'Test',files:rows.map(r=>({name:r.title+' 07-09-2026.mp4',path:r.title+' 07-09-2026.mp4',size:100,modified:1})),partial:false,scannedAt:'2026-09-25T00:00:00Z'},createdBy:'test',updatedBy:'test',updatedAt:'2026-09-25T00:00:00Z',archived:false};

test('single-folder worker keeps matching semantics, isolates metadata and always releases the worker',async t=>{
 let matcher:TeamMediaMatcher,terminated=0,started=0,mode='normal';
 class FakeWorker {
  onmessage:((event:{data:unknown})=>void)|null=null;onerror:(()=>void)|null=null;
  constructor(){started++;}
  terminate(){terminated++;}
  postMessage(message:any){
   const m=structuredClone(message);
   queueMicrotask(()=>{
    if(mode==='stall')return;
    if(mode==='crash'){this.onerror?.();return;}
    if(mode==='reject'){this.onmessage?.({data:{id:m.id,error:'Index invalide'}});return;}
    if(m.type==='init')matcher=new TeamMediaMatcher(m.rows,m.rules);
    if(m.type==='directory')matcher.add(m.directory);
    this.onmessage?.({data:{id:m.id,proposals:m.type==='result'?matcher.result(m.complete):undefined}});
   });
  }
 }
 const original=Object.getOwnPropertyDescriptor(globalThis,'Worker');
 Object.defineProperty(globalThis,'Worker',{configurable:true,writable:true,value:FakeWorker});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'Worker',original);else Reflect.deleteProperty(globalThis,'Worker');});
 const before=structuredClone({rows,directory});
 const expected=mediaProposals(rows,directory,[]);
 const actual=await directoryMediaWorker(rows,directory,[],new AbortController().signal);
 assert.equal(actual.length,60);
 actual.forEach((p,i)=>{assert.deepEqual(p.matches.map(m=>m.file.path),expected[i].matches.map(m=>m.file.path));assert.equal(p.matches.find(m=>m.key===p.suggested)?.file.path||'',expected[i].suggested);});
 assert.deepEqual({rows,directory},before);assert.equal(terminated,1);
 const partial=await directoryMediaWorker(rows,{...directory,data:{...directory.data,partial:true}},[],new AbortController().signal);
 assert.ok(partial.every(p=>!p.suggested&&p.matches.length>0));assert.equal(terminated,2);
 for(const failure of ['crash','reject']){mode=failure;await assert.rejects(directoryMediaWorker(rows,directory,[],new AbortController().signal));}
 assert.equal(terminated,4);
 mode='stall';const c=new AbortController(),pending=directoryMediaWorker(rows,directory,[],c.signal);c.abort();await assert.rejects(pending);assert.equal(terminated,5);
 await assert.rejects(directoryMediaWorker(rows,directory,[],c.signal));assert.equal(started,5);
 mode='normal';assert.equal((await directoryMediaWorker(rows,directory,[],new AbortController().signal)).length,60);assert.equal(terminated,6);
});
