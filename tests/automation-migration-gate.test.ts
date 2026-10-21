import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {automationMigrationRequirement,verifyAutomationMigration} from '../scripts/automation-migration-gate.mjs';
import {plannerMigrationRequirement,verifyPlannerMigration} from '../scripts/planner-migration-gate.mjs';

test('new migrations preserve populated legacy projects, histories, media and permissions',async()=>{
 const root=resolve('.'),requirement=await automationMigrationRequirement(root),db=new DatabaseSync(':memory:');
 try{
  for(const source of requirement.sources.slice(0,6))db.exec(await readFile(resolve(root,'migrations',source.name),'utf8'));
  db.exec(`INSERT INTO members(email,name,role,active,updated_by) VALUES('suspended@example.test','Suspendu','designer',0,'admin@example.com');
   INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by,visibility,status) VALUES('old-project','Retouches','BTV_BA_1P','1.0.0','1.7.0','{"title":"Ne pas écraser","crop":42}','admin@example.com','admin@example.com','team','approved');
   INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES('old-media','old/key','Original','video/mp4',456,'ready','admin@example.com');
   INSERT INTO preparation_profiles(id,kind,name,data_json,created_by,updated_by) VALUES('old-profile','programme','Ancienne fiche','{}','admin@example.com','admin@example.com');
   INSERT INTO planner_documents(id,kind,name,data_json,created_by,updated_by) VALUES('old-plan','plan','Lundi','{}','admin@example.com','admin@example.com');`);
  const tables=['projects','media','preparation_profiles','planner_documents','members','revisions','planner_revisions','preparation_profile_revisions'];
  const before=new Map(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all().map(row=>({...row}))]));
  for(const source of requirement.sources.slice(6))db.exec(await readFile(resolve(root,'migrations',source.name),'utf8'));
  for(const table of tables){const rows=db.prepare(`SELECT * FROM ${table}`).all().map(({channel_id,removed_at,tool_scope,...row})=>row);assert.deepEqual(rows,before.get(table),table+' content and revision unchanged');}
  for(const table of ['members','media'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE tool_scope<>'graphics'`).get()?.n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM members WHERE removed_at IS NOT NULL').get()?.n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM channel_members WHERE channel_id='benin-tv'").get()?.n,2);
  assert.equal(db.prepare('SELECT active FROM members WHERE email=?').get('suspended@example.test')?.active,0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  const rows=[...db.prepare('SELECT type,name,sql FROM sqlite_master').all().filter(r=>requirement.objects.some(o=>o.name===r.name)),...requirement.sources.map(s=>({type:'migration',name:s.name,sql:null}))];
  assert.equal(verifyAutomationMigration(requirement,rows).verifiedObjects,requirement.objects.length);
  assert.throws(()=>verifyAutomationMigration(requirement,rows.slice(1)));
  assert.throws(()=>verifyAutomationMigration(requirement,rows.filter(r=>r.name!=='0010_approved_habits.sql')));
  assert.throws(()=>verifyAutomationMigration(requirement,rows.filter(r=>r.name!=='0011_channel_names_validation.sql')));
  assert.throws(()=>verifyAutomationMigration(requirement,rows.filter(r=>r.name!=='0012_member_access_removal.sql')));
  assert.throws(()=>verifyAutomationMigration(requirement,rows.filter(r=>r.name!=='0013_member_permanent_deletion.sql')));
  assert.throws(()=>verifyAutomationMigration(requirement,rows.filter(r=>r.name!=='0014_commercial_workspace.sql')));
  assert.throws(()=>verifyAutomationMigration(requirement,rows.filter(r=>r.name!=='member_purge_jobs')));
  assert.throws(()=>verifyAutomationMigration(requirement,rows.map(r=>r.name==='member_purge_reinvite'?{...r,sql:'SELECT 1'}:r)));
  assert.throws(()=>verifyAutomationMigration(requirement,rows.filter(r=>r.name!=='channels_name_key_unique')));
  assert.throws(()=>verifyAutomationMigration(requirement,rows.map(r=>r.name==='planner_team_task_guard'?{...r,sql:'SELECT 1'}:r)));
  const planner=await plannerMigrationRequirement(root),effective={...planner,objects:planner.objects.map(o=>requirement.objects.find(a=>a.name===o.name)||o)};
  const plannerRows=[...db.prepare('SELECT type,name,sql FROM sqlite_master').all().filter(r=>planner.objects.some(o=>o.name===r.name)),{type:'migration',name:planner.name,sql:null}];
  assert.throws(()=>verifyPlannerMigration(planner,plannerRows));
  assert.equal(verifyPlannerMigration(effective,plannerRows).verifiedObjects,7);
 }finally{db.close();}
});
