import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plannerProject,plannerSignature} from '../src/studio/day-planner-project';
import {taskKey,taskRequestSchema} from '../src/studio/day-planner-model';
import type {Plan,PlannerTaskChoice} from '../src/studio/day-planner-model';
import {isMediaField} from '../src/studio/domain';

const plan:Plan={kind:'plan',name:'Recette son',source:'fixture.xlsx',sourceHash:'a'.repeat(64),rows:Array.from({length:7},(_,i)=>({id:String(i),sheet:'RECETTE',cell:'A'+i,raw:'',title:'Programme '+i,subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:`2026-09-${String(i+7).padStart(2,'0')}`,time:'20:30:00',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null}))};
for(const kind of ['ba','tds','renvoi','event','weekly'] as const)for(const format of ['tv','portrait','vertical'] as const){
 test(`planner signature is explicit and native: ${kind}/${format}`,()=>{
  const choice:PlannerTaskChoice={kind,format,rowIds:kind==='weekly'?plan.rows.map(r=>r.id):['0']};
  const before=JSON.stringify(plan),silent=plannerProject(plan,choice),enabled=plannerProject(plan,{...choice,signature:true}),patch=plannerSignature(kind)!;
  for(const [key,value]of Object.entries(patch))assert.deepEqual(enabled.data[key],value);
  assert.equal(enabled.data._audio_voice_enabled,false);assert.equal(enabled.data._audio_voice_url,'');
  for(const [key,field]of Object.entries(enabled.template.fields))if(isMediaField(key,field)&&!Object.hasOwn(patch,key))assert.equal(enabled.data[key],'');
  assert.deepEqual(plannerProject(plan,{...choice,signature:false}),silent);
  assert.equal(taskKey({...choice,signature:true}),taskKey(choice));
  assert.equal(JSON.stringify(plan),before);assert.equal(enabled.data._studio_format,format);
 });
}
test('a pop-up never borrows a BA signature',()=>{
 assert.equal(plannerSignature('popup'),undefined);
 assert.throws(()=>plannerProject(plan,{kind:'popup',format:'tv',rowIds:['0'],signature:true}),/signature sonore native/);
});
test('old requests remain accepted; arbitrary signature URLs and coerced choices are rejected',()=>{
 const task={kind:'ba',format:'tv',rowIds:['0']},request={revision:1,tasks:[task]};
 assert.deepEqual(taskRequestSchema.parse(request),request);
 for(const signature of ['true',1,{},'/public/other.wav'])assert.equal(taskRequestSchema.safeParse({...request,tasks:[{...task,signature}]}).success,false);
});
