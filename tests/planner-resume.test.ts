import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlannerLinkedProject,loadPlannerList,loadPlannerPreparation,plannerMediaState} from '../src/studio/planner-resume';
import type {Plan,PlannerRecord} from '../src/studio/day-planner-model';
import type {Project} from '../src/studio/domain';

const record:PlannerRecord<Plan>={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',revision:3,archived:false,createdBy:'test',updatedBy:'test',updatedAt:'2026-09-25T00:00:00Z',data:{kind:'plan',name:'Journée',source:'test.xlsx',sourceHash:'a'.repeat(64),rows:[{id:'one',sheet:'Lundi',cell:'A1',raw:'',title:'Magazine',subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:30:00',duration:1000,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null}]}};
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};};
const project:Project={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'BA test',template_id:'BTV_BA_1P',template_version:'1.0.0',library_version:'v1.7.0',status:'draft',revision:1,data:{},created_by:'test',updated_by:'test',created_at:'',updated_at:'',archived:0};

for(const kind of ['list','project'] as const){
 test(`${kind} metadata read stops immediately, ignores late replies and can retry`,async()=>{
  const c=new AbortController(),gate=deferred<any>();let inner:AbortSignal|undefined,published=0;
  const value=kind==='list'?{documents:[],next:null}:project;
  const read=(signal:AbortSignal)=>kind==='list'?loadPlannerList(s=>{inner=s;return gate.promise;},signal):loadPlannerLinkedProject(project.id,async(_id,s)=>{inner=s;return gate.promise;},signal);
  const pending=read(c.signal).then(()=>published++);await Promise.resolve();c.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.ok(inner?.aborted);
  gate.resolve(value);await Promise.resolve();assert.equal(published,0);
  assert.deepEqual(await read(new AbortController().signal),value);
 });
 test(`${kind} metadata read bounds a hung transport and preserves access errors`,async()=>{
  let inner:AbortSignal|undefined;
  const read=(operation:(s:AbortSignal)=>Promise<any>,signal:AbortSignal,timeoutMs=10)=>kind==='list'?loadPlannerList(operation,signal,timeoutMs):loadPlannerLinkedProject(project.id,(_id,s)=>operation(s!),signal,timeoutMs);
  await assert.rejects(read(s=>{inner=s;return new Promise(()=>{});},new AbortController().signal),/ne répond/);assert.ok(inner?.aborted);
  const denied=Object.assign(Error('Session expirée'),{status:401});
  await assert.rejects(read(async()=>{throw denied;},new AbortController().signal),e=>e===denied);
  const c=new AbortController();c.abort();let called=false;
  await assert.rejects(read(async()=>{called=true;},c.signal),{name:'AbortError'});assert.equal(called,false);
 });
}
test('linked-project read rejects another project instead of opening it',async()=>{
 await assert.rejects(loadPlannerLinkedProject('other',async()=>project,new AbortController().signal),/ne correspond pas/);
});

test('saved local media and shared references have different, non-probing availability states',()=>{
  const media={url:`local-media:${'a'.repeat(64)}:10`,name:'Programme.mp4',mimeType:'video/mp4'};
  assert.equal(plannerMediaState(null,()=>{throw Error('No probe');}),'missing');
  assert.equal(plannerMediaState(media,()=>false),'reconnect');
  assert.equal(plannerMediaState(media,()=>true),'local');
  assert.equal(plannerMediaState({...media,url:'/api/graphics/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/content'},()=>{throw Error('No shared download');}),'shared');
});
test('read starts both branches together and returns an unchanged complete snapshot',async()=>{
  const data=structuredClone(record),gate=deferred<PlannerRecord<Plan>>(),started:string[]=[];
  const request=loadPlannerPreparation(record.id,{get:async()=>{started.push('plan');return gate.promise;},tasks:async()=>{started.push('tasks');return {tasks:[]};}},new AbortController().signal);
  await Promise.resolve();assert.deepEqual(started,['plan','tasks']);gate.resolve(data);
  const result=await request;assert.deepEqual(result,{record:data,tasks:[]});assert.deepEqual(data,record);
});
test('stop rejects ignored-abort transports; late replies cannot return a new snapshot',async()=>{
  const c=new AbortController(),gate=deferred<PlannerRecord<Plan>>(),signals:AbortSignal[]=[];let completed=false;
  const api={get:async(_id:string,s?:AbortSignal)=>{signals.push(s!);return gate.promise;},tasks:async(_id:string,s?:AbortSignal)=>{signals.push(s!);return {tasks:[]};}};
  const pending=loadPlannerPreparation(record.id,api,c.signal).then(value=>{completed=true;return value;});
  await Promise.resolve();c.abort();await assert.rejects(pending,{name:'AbortError'});assert.ok(signals.every(s=>s.aborted));
  gate.resolve(record);await Promise.resolve();assert.equal(completed,false);
  assert.deepEqual(await loadPlannerPreparation(record.id,api,new AbortController().signal),{record,tasks:[]});
});
test('timeout bounds both reads and preserves authentication errors without partial snapshots',async()=>{
  let sibling:AbortSignal|undefined;const api={get:async(_id:string,s?:AbortSignal)=>{sibling=s;return new Promise<PlannerRecord<Plan>>(()=>{});},tasks:async()=>({tasks:[]})};
  await assert.rejects(loadPlannerPreparation(record.id,api,new AbortController().signal,10),/préparation ne répond pas/);assert.ok(sibling?.aborted);
  const denied=Object.assign(Error('Accès suspendu'),{status:403});
  await assert.rejects(loadPlannerPreparation(record.id,{...api,tasks:async()=>{throw denied;}},new AbortController().signal),e=>e===denied);assert.ok(sibling?.aborted);
});
test('pre-aborted reads never start and stale, archived or wrong-kind documents cannot replace a list',async()=>{
  const c=new AbortController();c.abort();
  await assert.rejects(loadPlannerPreparation(record.id,{get:async()=>{throw Error('Must not start');},tasks:async()=>{throw Error('Must not start');}},c.signal),{name:'AbortError'});
  for(const invalid of [{...record,id:'other'},{...record,archived:true},{...record,data:{...record.data,kind:'directory'}}]){
    await assert.rejects(loadPlannerPreparation(record.id,{get:async()=>invalid as PlannerRecord<Plan>,tasks:async()=>({tasks:[]})},new AbortController().signal),/retirée/);
  }
});
