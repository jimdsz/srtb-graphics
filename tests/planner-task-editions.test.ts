import test from 'node:test';
import assert from 'node:assert/strict';
import {latestPlannerTask,linkedTasksForRow,plannerTaskBaseKey,plannerTaskChoice,taskKey,taskRequestSchema} from '../src/studio/day-planner-model';
import type {PlannerTask,PlannerTaskChoice} from '../src/studio/day-planner-model';
import {plannerSelection} from '../src/studio/day-planner-queue';

const choice=(overrides:Partial<PlannerTaskChoice>={}):PlannerTaskChoice=>({kind:'ba',format:'tv',rowIds:['programme'],...overrides});
const task=(selection:PlannerTaskChoice=choice(),overrides:Partial<PlannerTask>={}):PlannerTask=>({key:taskKey(selection),projectId:'project-'+taskKey(selection),sourceRevision:1,status:'draft',title:'Projet conservé',archived:false,...overrides});
const request=(selection:unknown)=>taskRequestSchema.safeParse({revision:2,tasks:[selection]});

test('legacy keys remain unchanged and only an explicit edition adds a canonical suffix',()=>{
  assert.equal(taskKey(choice()),'ba:tv:programme');
  assert.equal(taskKey(choice({edition:2})),'ba:tv:programme:r2');
  assert.equal(taskKey(choice({edition:10})),'ba:tv:programme:r10');
  for(const selection of [choice(),choice({edition:2}),choice({edition:Number.MAX_SAFE_INTEGER})]){
    assert.equal(request(selection).success,true);
    const key=taskKey(selection);
    assert.deepEqual(plannerTaskChoice(task(selection)),selection);
    assert.equal(plannerTaskBaseKey(key),'ba:tv:programme');
  }
});

test('edition validation refuses a first edition, nonintegers, unsafe integers and coercion',()=>{
  for(const edition of [0,1,-2,2.5,Number.MAX_SAFE_INTEGER+1,Infinity,NaN,'2',null]){
    assert.equal(request({...choice(),edition}).success,false,String(edition));
  }
});

test('encoded suffix-like row IDs, commas and Unicode round-trip without identity collisions',()=>{
  for(const rowId of ['programme:r2','a,b','Émission du soir — 你好','programme%3Ar2',' ']){
    const original=choice({rowIds:[rowId]}),updated=choice({rowIds:[rowId],edition:2});
    const base=`ba:tv:${encodeURIComponent(rowId)}`;
    assert.equal(taskKey(original),base);
    assert.equal(taskKey(updated),base+':r2');
    assert.equal(plannerTaskBaseKey(taskKey(updated)),base);
    assert.deepEqual(plannerTaskChoice(task(original)),original);
    assert.deepEqual(plannerTaskChoice(task(updated)),updated);
  }
  assert.notEqual(taskKey(choice({rowIds:['programme:r2']})),taskKey(choice({edition:2})));
  const left=choice({kind:'weekly',rowIds:['a,b','c','d','e','f','g','h'],edition:2});
  const right=choice({kind:'weekly',rowIds:['a','b,c','d','e','f','g','h'],edition:2});
  assert.notEqual(taskKey(left),taskKey(right));
  assert.deepEqual(plannerTaskChoice(task(left)),left);
  assert.deepEqual(plannerTaskChoice(task(right)),right);
});

test('seven-slot weekly identities preserve order across their base and numbered editions',()=>{
  const rowIds=['lundi:r2','mardi,soir','mercredi','jeudi','vendredi','samedi','dimanche'];
  const base=choice({kind:'weekly',format:'portrait',rowIds});
  const edition={...base,edition:10};
  assert.deepEqual(plannerTaskChoice(task(base)),base);
  assert.deepEqual(plannerTaskChoice(task(edition)),edition);
  assert.equal(plannerTaskBaseKey(taskKey(edition)),taskKey(base));
  assert.notEqual(taskKey(base),taskKey({...base,rowIds:[...rowIds].reverse()}));
});

test('both parsers reject malformed keys and alternate spellings of a canonical identity',()=>{
  const invalid=[
    '', 'ba', 'ba:tv', 'ba:tv:', ':tv:programme', 'ba::programme',
    'unknown:tv:programme', 'BA:tv:programme', 'ba:square:programme',
    'ba:tv:programme:r0', 'ba:tv:programme:r1', 'ba:tv:programme:r-2',
    'ba:tv:programme:r2.5', 'ba:tv:programme:r02', 'ba:tv:programme:r+2',
    'ba:tv:programme:r2e1', 'ba:tv:programme:r9007199254740992',
    'ba:tv:programme:rInfinity', 'ba:tv:programme:rNaN',
    'ba:tv:programme:r2:r3', 'ba:tv:programme:r2:',
    'ba:tv:%', 'ba:tv:%FF', 'ba:tv:%61', 'ba:tv:a%2cb',
    'ba:tv:programme%3ar2', 'ba:tv:Émission', 'ba:tv:a b',
    'ba:tv:'+encodeURIComponent('a'.repeat(101)),
    'ba:tv:a,b', 'weekly:tv:a', 'weekly:tv:a,b,c,d,e,f,f',
    'weekly:tv:a,,b', 'weekly:tv:a,b,c,d,e,f,g,h',
  ];
  for(const key of invalid){
    assert.equal(plannerTaskBaseKey(key),undefined,key);
    assert.equal(plannerTaskChoice(task(choice(),{key})),undefined,key);
  }
});

test('latest linked task prioritizes source revision and then numeric edition, including archived projects',()=>{
  const base=task(choice(),{sourceRevision:3});
  const second=task(choice({edition:2}),{sourceRevision:4});
  const tenth=task(choice({edition:10}),{sourceRevision:4,archived:true,status:'approved'});
  const unrelated=task(choice({rowIds:['another']}),{sourceRevision:99});
  const wrongFormat=task(choice({format:'vertical'}),{sourceRevision:99});
  const malformed=task(choice(),{key:'ba:tv:programme:r02',sourceRevision:99});
  const tasks=[unrelated,tenth,malformed,base,wrongFormat,second];
  assert.equal(latestPlannerTask(choice(),tasks),tenth);
  assert.equal(latestPlannerTask(choice({edition:2}),tasks),tenth);
  assert.equal(latestPlannerTask(choice({edition:10,signature:true}),[...tasks].reverse()),tenth);
  const newerBase={...base,sourceRevision:5};
  assert.equal(latestPlannerTask(choice({edition:10}),[tenth,newerBase,second]),newerBase);
  assert.equal(latestPlannerTask(choice(),[unrelated,wrongFormat,malformed]),undefined);
  assert.equal(latestPlannerTask(choice(),[]),undefined);
});

test('signature preferences do not create another identity or appear in a parsed task choice',()=>{
  const selection=choice({edition:2});
  assert.equal(taskKey({...selection,signature:true}),taskKey({...selection,signature:false}));
  assert.deepEqual(plannerTaskChoice(task({...selection,signature:true})),selection);
  const existing=task(selection);
  const result=plannerSelection([{...selection,signature:true},{...selection,signature:false}],[existing]);
  assert.equal(result.total,1);assert.equal(result.existing,1);assert.equal(result.pending.length,0);
});

test('row links retain all project editions, including archived ones, but exclude weekly and unrelated tasks',()=>{
  const rowId='programme:r2,été',base=choice({rowIds:[rowId]});
  const initial=task(base),second=task({...base,edition:2});
  const tenth=task({...base,format:'vertical',edition:10},{archived:true});
  const popup=task({...base,kind:'popup',edition:2});
  const weekly=task({...base,kind:'weekly',rowIds:[rowId,'b','c','d','e','f','g'],edition:2});
  const other=task(choice({rowIds:['programme']}));
  const invalid=task(base,{key:taskKey(base)+':r02'});
  const tasks=[weekly,tenth,other,initial,invalid,popup,second];
  assert.deepEqual(linkedTasksForRow(rowId,tasks),[tenth,initial,popup,second]);
  assert.deepEqual(linkedTasksForRow('absent',tasks),[]);
});

test('each new edition consumes one project in the 2000-project quota while an existing edition remains resumable',()=>{
  const ledger=Array.from({length:1999},(_,i)=>task(choice(i===0?{}:{edition:i+1})));
  const newEdition=choice({edition:2000});
  const atLimit=plannerSelection([newEdition,{...newEdition,signature:true}],ledger);
  assert.equal(atLimit.total,1);assert.equal(atLimit.pending.length,1);assert.equal(atLimit.existing,0);
  assert.throws(()=>plannerSelection([newEdition,choice({edition:2001})],ledger),/2 000/);
  const full=[...ledger,task(newEdition)];
  const resumed=plannerSelection([newEdition],full);
  assert.equal(resumed.existing,1);assert.equal(resumed.pending.length,0);
  assert.throws(()=>plannerSelection([choice({edition:2001})],full),/2 000/);
});
