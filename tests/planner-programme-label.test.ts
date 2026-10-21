import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plannerProgrammeLabel,plannerProgrammeSchedule} from '../src/studio/planner-programme-label';

test('programme occurrence labels distinguish the same title on different days without rewriting data',()=>{
  const first={title:'THE RIVER',airDate:'2026-09-10',time:'19:00:00'},second={...first,airDate:'2026-09-11'};
  const before=JSON.stringify([first,second]);
  assert.equal(plannerProgrammeLabel(first),'THE RIVER · jeudi 10 sept. · 19:00');
  assert.equal(plannerProgrammeLabel(second),'THE RIVER · vendredi 11 sept. · 19:00');
  assert.equal(JSON.stringify([first,second]),before);
});
test('programme occurrence labels remain usable when a date or time is being edited',()=>{
  assert.equal(plannerProgrammeSchedule({airDate:'',time:''}),'Date à préciser · Heure à préciser');
  assert.equal(plannerProgrammeSchedule({airDate:'2026-02-30',time:'04:30:00'}),'Date à préciser · 04:30');
  assert.equal(plannerProgrammeSchedule({airDate:'2026-09-08',time:'04:30:00'}),'mardi 8 sept. · 04:30');
});
