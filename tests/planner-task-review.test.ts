import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingPlannerEditions,plannerCreationNotice,plannerTaskReview,reusePlannerChoices,updatedPlannerChoices} from '../src/studio/planner-task-review';
import {taskKey} from '../src/studio/day-planner-model';
import type {PlannerTask,PlannerTaskChoice} from '../src/studio/day-planner-model';

const ba:PlannerTaskChoice={kind:'ba',format:'tv',rowIds:['a']};
const weekly:PlannerTaskChoice={kind:'weekly',format:'vertical',rowIds:['a','b','c','d','e','f','g']};
const saved=(choice:PlannerTaskChoice,revision:number):PlannerTask=>({key:taskKey(choice),projectId:`project-${taskKey(choice)}`,title:'Ancien titre — 20h30',status:'approved',archived:false,sourceRevision:revision});

for(const choice of [ba,weekly]){
 test(`${choice.kind}: ordinary preparation finds the newest edition without changing projects`,()=>{
  const original=saved(choice,1),updated=saved({...choice,edition:3},3),tasks=[updated,original],before=structuredClone(tasks);
  assert.deepEqual(reusePlannerChoices([choice],tasks),[{...choice,edition:3}]);
  assert.deepEqual(reusePlannerChoices([{...choice,edition:2}],tasks),[{...choice,edition:2}]);
  assert.deepEqual(tasks,before);
 });
 test(`${choice.kind}: explicit refreshed proposals preserve old drafts, use only newer list revisions and retry once`,()=>{
  const original=saved(choice,1),tasks=[original];
  assert.deepEqual(updatedPlannerChoices([choice],tasks,1),{choices:[choice],changed:0});
  const refreshed=updatedPlannerChoices([choice],tasks,2);
  assert.deepEqual(refreshed,{choices:[{...choice,edition:2}],changed:1});
  assert.deepEqual(updatedPlannerChoices(refreshed.choices,tasks,2),{choices:refreshed.choices,changed:0});
  assert.deepEqual(updatedPlannerChoices([choice],[...tasks,saved({...choice,edition:2},2)],2),{choices:[{...choice,edition:2}],changed:1});
  assert.equal(original.status,'approved');assert.equal(original.title,'Ancien titre — 20h30');
});
}
test('interrupted r2 requires explicit r3 choice after an edit, with zero or some completed tasks',()=>{
 const choices=[{...ba,edition:2},{...weekly,edition:2}],originals=[saved(ba,1),saved(weekly,1)];
 for(const tasks of [originals,[...originals,saved(choices[0],2)]]){
  const resumed=reusePlannerChoices(choices,tasks);
  assert.deepEqual(resumed,choices);
  assert.equal(pendingPlannerEditions(resumed,tasks,3).length,tasks.length===2?2:1);
  const accepted=updatedPlannerChoices(resumed,tasks,3);
  assert.deepEqual(accepted.choices,choices.map(c=>({...c,edition:3})));
  assert.equal(pendingPlannerEditions(accepted.choices,tasks,3).length,0);
 }
});
test('explicit restart finds an existing current edition instead of retrying a missing older one',()=>{
 const pending={...ba,edition:2},current={...ba,edition:3},tasks=[saved(ba,1),saved(current,3)];
 assert.equal(pendingPlannerEditions([pending],tasks,3).length,1);
 assert.deepEqual(updatedPlannerChoices([pending],tasks,3),{choices:[current],changed:1});
 assert.deepEqual(pendingPlannerEditions([current],tasks,4),[]);
});
test('mixed selection refreshes only existing older work; new formats remain first editions',()=>{
 const portrait={...ba,format:'portrait' as const},tasks=[saved(ba,1)],choices=[ba,portrait];
 assert.deepEqual(updatedPlannerChoices(choices,tasks,2),{choices:[{...ba,edition:2},portrait],changed:1});
 assert.deepEqual(reusePlannerChoices(choices,tasks),choices);
 for(const revision of [0,1,NaN,Infinity,2.5])assert.equal(updatedPlannerChoices(choices,tasks,revision).changed,0);
});
test('review indicates uncommitted/global revision changes without claiming content is stale',()=>{
 const task=saved(ba,1);
 assert.equal(plannerTaskReview(task,1),'Créé depuis la liste r1');
 assert.match(plannerTaskReview(task,2),/liste actuelle r2 : à vérifier/);
 assert.match(plannerTaskReview(task,1,true),/modifications non enregistrées à vérifier/);
 assert.doesNotMatch(plannerTaskReview(task,2),/obsolète|mis à jour/);
});
test('completion reports new confirmations separately from unchanged, possibly archived drafts',()=>{
 assert.match(plannerCreationNotice(0,2),/2 projets existants retrouvés, sans modification/);
 assert.doesNotMatch(plannerCreationNotice(0,2),/prêts|nouveaux/);
 assert.match(plannerCreationNotice(1,0),/1 nouveau brouillon confirmé/);
 assert.match(plannerCreationNotice(2,3),/2 nouveaux brouillons confirmés · 3 projets existants retrouvés/);
});
