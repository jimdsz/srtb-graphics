import test from 'node:test';
import assert from 'node:assert/strict';
import {canChangeTaskOwner,defaultTaskFilter} from '../src/studio/planner-task-presentation';
import type {TeamTask} from '../src/studio/planner-task-presentation';
import type {Member} from '../src/studio/domain';
const staff:Member={email:'lea@example.test',name:'Léa',role:'designer',active:1};
const task:TeamTask={key:'ba:tv:row-1',owner:staff.email,ownerName:staff.name,revision:1,state:'assigned'};
test('task landing follows responsibility for staff and keeps a team view for reviewers',()=>{
 assert.equal(defaultTaskFilter('designer',2),'mine');assert.equal(defaultTaskFilter('designer',0),'free');
 assert.equal(defaultTaskFilter('admin',0),'all');assert.equal(defaultTaskFilter('broadcaster',3),'all');
});
test('only unstarted work exposes assignment actions; staff cannot move a colleague task',()=>{
 assert.equal(canChangeTaskOwner(staff),true);assert.equal(canChangeTaskOwner(staff,task),true);
 assert.equal(canChangeTaskOwner(staff,{...task,owner:'other@example.test'}),false);
 for(const role of ['designer','admin','broadcaster'] as const)for(const state of ['draft','submitted','approved','rejected','archived','unknown'])assert.equal(canChangeTaskOwner({...staff,role},{...task,state}),false,`${role}: ${state}`);
 assert.equal(canChangeTaskOwner({...staff,role:'admin'},{...task,owner:'other@example.test'}),true);
});
