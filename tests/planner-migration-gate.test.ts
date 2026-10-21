import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {plannerMigrationRequirement,verifyPlannerMigration} from '../scripts/planner-migration-gate.mjs';
test('the sealed planner migration matches SQLite and refuses missing or altered objects',async()=>{
 const root=resolve('.'),db=new DatabaseSync(':memory:');
 try{
  db.exec(await readFile(resolve(root,'migrations/0001_studio.sql'),'utf8'));db.exec(await readFile(resolve(root,'migrations/0005_day_planner.sql'),'utf8'));
  const requirement=await plannerMigrationRequirement(root),rows=[...db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name LIKE 'planner_%'").all(),{type:'migration',name:requirement.name,sql:null}];
  assert.equal(verifyPlannerMigration(requirement,rows).verifiedObjects,7);assert.throws(()=>verifyPlannerMigration(requirement,rows.slice(1)));
  assert.throws(()=>verifyPlannerMigration(requirement,rows.map(r=>r.name==='planner_task_guard'?{...r,sql:'SELECT 1'}:r)));
 }finally{db.close();}
});
