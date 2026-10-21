import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assignmentChoices,assignmentRows} from '../src/studio/planner-team';
import type {Plan} from '../src/studio/day-planner-model';
const plan:Plan={kind:'plan',name:'La semaine',source:'grille.xlsx',sourceHash:'a'.repeat(64),rows:Array.from({length:7},(_,i)=>({id:`row-${i}`,sheet:'JOUR',cell:'A1',raw:'',title:`Émission ${i}`,subtitle:'',category:'',airDate:'2026-09-29',broadcastDate:'2026-09-29',time:'20:30:00',duration:1200,included:true,kinds:['ba'],formats:['tv'],media:null,location:null,issues:[]}))};
test('assignments list only current recipes and formats, never excluded or withdrawn rows',()=>{
 const next=structuredClone(plan);next.rows[0].included=false;next.rows[1].sourceRemoved=true;next.rows[2].kinds=[];next.rows[3].kinds=['ba','ba'];
 assert.equal(assignmentChoices(next).length,4);
 assert.deepEqual(assignmentRows(next).map(r=>r.key),['ba:tv:row-3','ba:tv:row-4','ba:tv:row-5','ba:tv:row-6']);
});
test('weekly assignments keep the confirmed seven-programme order and selected formats',()=>{
 const weekly={rowIds:plan.rows.map(r=>r.id).reverse(),formats:['tv','vertical'] as ('tv'|'vertical')[]};
 const choices=assignmentChoices({...plan,weekly});
 assert.equal(choices.length,9);assert.equal(choices[7].kind,'weekly');assert.deepEqual(choices[7].rowIds,weekly.rowIds);
 assert.equal(assignmentRows({...plan,weekly:{rowIds:plan.rows.map(r=>r.id),formats:['tv']}}).at(-1)?.label,'Semainier · TV');
});
