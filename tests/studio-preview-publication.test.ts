import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assertPreviewTarget,verifyPreviewSchema} from '../scripts/publish-studio-preview.mjs';
import {automationMigrationRequirement} from '../scripts/automation-migration-gate.mjs';
import {derivationMigrationRequirement} from '../scripts/derivation-migration-gate.mjs';
import {plannerMigrationRequirement} from '../scripts/planner-migration-gate.mjs';
import {privacyMigrationRequirement} from '../scripts/project-privacy-gate.mjs';
test('preview publication cannot select production or bypass Firebase security',()=>{
 const preview={database_id:'ab7f4504-0ad1-4882-b3db-255699012855',database_name:'srtb-graphics-studio-preview',binding:'DB'};
 const config={name:'srtb-graphics',d1_databases:[{database_id:'859ca314-fa49-41f1-b1f5-11993e80feab'}],env:{preview:{d1_databases:[preview],vars:{AUTH_MODE:'firebase',APP_ENV:'production',STORAGE_PROVIDER:'b2'}}}};
 assert.equal(assertPreviewTarget(config).database_id,preview.database_id);
 for(const mutate of [(c:any)=>c.env.preview.d1_databases[0].database_id=c.d1_databases[0].database_id,(c:any)=>c.env.preview.vars.AUTH_MODE='development',(c:any)=>c.env.preview.vars.APP_ENV='development',(c:any)=>c.env.preview.d1_databases.push(preview)]){const c=structuredClone(config);mutate(c);assert.throws(()=>assertPreviewTarget(c));}
});
test('preview checks sealed migrations and rejects missing privacy/derivation/schema objects',async()=>{
 const root=resolve('.'),automation=await automationMigrationRequirement(root),db=new DatabaseSync(':memory:');
 try{
  for(const s of automation.sources)db.exec(await readFile(resolve(root,'migrations',s.name),'utf8'));
  const inventory={profile:'native-derivations',requirements:{automation,migrations:[await derivationMigrationRequirement(root)],planner:await plannerMigrationRequirement(root),privacy:await privacyMigrationRequirement(root)}};
  const rows=[...db.prepare('SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL').all(),...automation.sources.map(s=>({type:'migration',name:s.name,sql:null})),{type:'column',name:'visibility',sql:"TEXT:1:'private'"},{type:'copied',name:'planner_tasks',sql:'0'}];
  await verifyPreviewSchema(root,inventory,rows);
  for(const missing of ['channels','planner_personal_task_guard','derivation_actor_guard','planner_tasks'])await assert.rejects(verifyPreviewSchema(root,inventory,rows.filter(r=>r.name!==missing)));
  await assert.rejects(verifyPreviewSchema(root,{...inventory,profile:'native-only'},rows));
  await assert.rejects(verifyPreviewSchema(root,inventory,rows.map(r=>r.type==='copied'?{...r,sql:'1'}:r)));
 }finally{db.close();}
});
