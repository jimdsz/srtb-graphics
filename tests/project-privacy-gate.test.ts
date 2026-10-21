import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {privacyMigrationRequirement,verifyPrivacyMigration} from '../scripts/project-privacy-gate.mjs';
test('privacy migration keeps projects and default private; publication refuses altered or missing schema',async()=>{
 const db=new DatabaseSync(':memory:'),root=resolve('.');
 try{
  for(const migration of ['0001_studio.sql','0005_day_planner.sql','0006_project_privacy.sql'])db.exec(await readFile(resolve(root,'migrations',migration),'utf8'));
  const r=await privacyMigrationRequirement(root),rows=[...db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name IN ('projects_owner_listing','planner_personal_tasks','planner_personal_task_guard')").all(),{type:'migration',name:r.name,sql:null},{type:'column',name:'visibility',sql:"TEXT:1:'private'"},{type:'copied',name:'planner_tasks',sql:'0'}];
  assert.equal(verifyPrivacyMigration(r,rows).verifiedObjects,3);
  assert.throws(()=>verifyPrivacyMigration(r,rows.slice(1)));
  assert.throws(()=>verifyPrivacyMigration(r,rows.map(row=>row.type==='column'?{...row,sql:"TEXT:1:'team'"}:row)));
  assert.throws(()=>verifyPrivacyMigration(r,rows.map(row=>row.type==='copied'?{...row,sql:'1'}:row)));
 }finally{db.close();}
});
