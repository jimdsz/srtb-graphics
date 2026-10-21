import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlannerQueue,plannerSelection} from '../src/studio/day-planner-queue';
import {taskKey} from '../src/studio/day-planner-model';
import type {Plan,PlannerRecord,PlannerRow,PlannerTask,PlannerTaskChoice} from '../src/studio/day-planner-model';

function fixture(count=32){
 const rows:PlannerRow[]=Array.from({length:count},(_,i)=>({id:String(i),sheet:'LUNDI',cell:'B'+i,raw:'',title:'PROGRAMME '+i,subtitle:'Épisode '+i,category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv','portrait','vertical'],issues:[],media:null,location:null}));
 const record:PlannerRecord<Plan>={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',revision:2,data:{kind:'plan',name:'Journée',source:'grille.xlsx',sourceHash:'a'.repeat(64),rows},createdBy:'test@example.test',updatedBy:'test@example.test',updatedAt:'2026-09-24T12:00:00Z',archived:false};
 const choices:PlannerTaskChoice[]=rows.flatMap(row=>row.kinds.flatMap(kind=>row.formats.map(format=>({kind,format,rowIds:[row.id]}))));
 return {record,choices};
}
const task=(c:PlannerTaskChoice):PlannerTask=>({key:taskKey(c),projectId:taskKey(c),sourceRevision:2,status:'draft',title:'Titre conservé',archived:false});
function mockAPI(){
 const ledger=new Map<string,PlannerTask>(),batches:PlannerTaskChoice[][]=[];
 let reads=0,concurrent=0,maxConcurrent=0;
 const api={tasks:async()=>{reads++;return {tasks:[...ledger.values()]};},create:async(_id:string,_revision:number,choices:PlannerTaskChoice[],options?:{response?:'requested';signal?:AbortSignal})=>{
  assert.equal(options?.response,'requested');assert.ok(options.signal);assert.ok(choices.length<=8);batches.push(choices);concurrent++;maxConcurrent=Math.max(concurrent,maxConcurrent);await Promise.resolve();
  for(const c of choices)if(!ledger.has(taskKey(c)))ledger.set(taskKey(c),task(c));concurrent--;return {tasks:choices.map(c=>ledger.get(taskKey(c))!)};
 }};
 return {api,ledger,batches,reads:()=>reads,maxConcurrent:()=>maxConcurrent};
}
test('one daily selection prepares 192 drafts in sequential batches of eight with measured progress',async()=>{
 const f=fixture(),m=mockAPI(),progress:number[]=[];
 const result=await createPlannerQueue({...f,api:m.api,signal:new AbortController().signal,onProgress:s=>progress.push(s.completed)});
 assert.equal(result.completed,192);assert.equal(result.tasks.length,192);assert.equal(m.batches.length,24);assert.equal(m.maxConcurrent(),1);assert.equal(m.reads(),1);
 assert.deepEqual(progress,Array.from({length:25},(_,i)=>i*8));
});
test('a full weekly selection of 1260 requests does not require manual 120-item splits',async()=>{
 const f=fixture(210),m=mockAPI();
 const result=await createPlannerQueue({...f,api:m.api,signal:new AbortController().signal,onProgress:()=>{}});
 assert.equal(result.completed,1260);assert.equal(m.batches.length,158);assert.equal(m.batches.at(-1)!.length,4);
});
test('deduplicates choices and counts the complete existing ledger towards the 2000-project guard',()=>{
 const f=fixture(1);assert.equal(plannerSelection([...f.choices,...f.choices],[]).total,6);
 const old=Array.from({length:1999},(_,i)=>({...task(f.choices[0]),key:'old:'+i}));
 assert.equal(plannerSelection([f.choices[0]],old).pending.length,1);assert.throws(()=>plannerSelection(f.choices,old),/2 000/);
 assert.equal(plannerSelection([f.choices[0]],[...old,task(f.choices[0])]).existing,1);
});
test('graceful stop acknowledges the in-flight batch; restart reads the ledger and skips edited projects',async()=>{
 const f=fixture(),m=mockAPI(),controller=new AbortController();let completed=0;
 const send=m.api.create;m.api.create=async(...args)=>{controller.abort();return send(...args);};
 await assert.rejects(createPlannerQueue({...f,api:m.api,signal:controller.signal,onProgress:s=>completed=s.completed}),{name:'AbortError'});
 assert.equal(completed,8);assert.equal(m.ledger.size,8);assert.equal(m.batches.length,1);
 const edited={...m.ledger.values().next().value!,title:'Montage relu et approuvé',status:'approved',archived:true};m.ledger.set(edited.key,edited);m.api.create=send;
 const result=await createPlannerQueue({...f,api:m.api,signal:new AbortController().signal,onProgress:()=>{}});
 assert.equal(result.completed,192);assert.equal(m.ledger.get(edited.key),edited);assert.equal(m.batches.length,24);assert.equal(m.reads(),2);
});
test('lost response after commit never triggers blind retries; restart discovers the saved batch',async()=>{
 const f=fixture(),m=mockAPI(),send=m.api.create;let completed=0;
 m.api.create=async(...args)=>{await send(...args);throw Error('Connexion interrompue');};
 await assert.rejects(createPlannerQueue({...f,api:m.api,signal:new AbortController().signal,onProgress:s=>completed=s.completed}),/Connexion/);
 assert.equal(completed,0);assert.equal(m.ledger.size,8);assert.equal(m.batches.length,1);
 m.api.create=send;const result=await createPlannerQueue({...f,api:m.api,signal:new AbortController().signal,onProgress:()=>{}});
 assert.equal(result.completed,192);assert.equal(m.batches.length,24);assert.equal(m.ledger.size,192);
});
test('request timeout is bounded even when a transport ignores abort; response remains unconfirmed',async()=>{
 const f=fixture(1),m=mockAPI();let signal:AbortSignal|undefined;
 m.api.create=async(_id,_revision,_choices,options)=>{signal=options?.signal;return new Promise(()=>{});};
 await assert.rejects(createPlannerQueue({...f,api:m.api,signal:new AbortController().signal,onProgress:()=>{},timeoutMs:10}),/non confirmée/);
 assert.equal(signal?.aborted,true);assert.equal(m.ledger.size,0);
});
test('partial batch response, stale revision and expired session stop the queue without false success',async()=>{
 const f=fixture(),m=mockAPI();let progress=0;
 m.api.create=async()=>({tasks:[task(f.choices[0])]});
 await assert.rejects(createPlannerQueue({...f,api:m.api,signal:new AbortController().signal,onProgress:s=>progress=s.completed}),/incomplète/);assert.equal(progress,0);
 for(const status of [401,403,409,429]){let calls=0;m.api.create=async()=>{calls++;throw Object.assign(Error('Refus'),{status});};
  await assert.rejects(createPlannerQueue({...f,api:m.api,signal:new AbortController().signal,onProgress:()=>{}}),{status});assert.equal(calls,1);
 }
});
test('validates all missing projects before the first write, but never revalidates existing edited projects',async()=>{
 const f=fixture(),m=mockAPI();f.record.data.rows.at(-1)!.time='';
 await assert.rejects(createPlannerQueue({...f,api:m.api,signal:new AbortController().signal,onProgress:()=>{}}),/horaires/);assert.equal(m.batches.length,0);
 for(const c of f.choices.filter(c=>c.rowIds[0]==='31'))m.ledger.set(taskKey(c),task(c));
 const result=await createPlannerQueue({...f,api:m.api,signal:new AbortController().signal,onProgress:()=>{}});assert.equal(result.completed,192);
});
test('stop during the final batch returns complete only when every requested project is confirmed',async()=>{
 const f=fixture(1),m=mockAPI(),controller=new AbortController(),send=m.api.create;
 m.api.create=async(...args)=>{controller.abort();return send(...args);};
 assert.equal((await createPlannerQueue({...f,api:m.api,signal:controller.signal,onProgress:()=>{}})).completed,6);
});
