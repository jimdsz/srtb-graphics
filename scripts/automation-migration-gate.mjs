import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const baseline=['0001_studio.sql','0002_firebase_sessions.sql','0003_preparation_profiles.sql','0004_project_derivations.sql','0005_day_planner.sql','0006_project_privacy.sql'];
const additions=['0007_password_recovery.sql','0008_channel_workspaces.sql','0009_team_assignments.sql','0010_approved_habits.sql','0011_channel_names_validation.sql','0012_member_access_removal.sql','0013_member_permanent_deletion.sql','0014_commercial_workspace.sql'];
const normalize=sql=>sql.replace(/\s+/g,' ').trim().replace(/;$/,'');
const schema=db=>db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>({...row,sql:normalize(row.sql)}));

/** Derive exact post-ALTER SQL using SQLite itself, never a permissive regex. */
export async function automationMigrationRequirement(root){
 const db=new DatabaseSync(':memory:'),sources=[];let before;
 try{
  for(const name of [...baseline,...additions]){
   const bytes=await readFile(resolve(root,'migrations',name));
   sources.push({name,sha256:createHash('sha256').update(bytes).digest('hex')});
   db.exec(bytes.toString('utf8'));
   if(name===baseline.at(-1))before=new Map(schema(db).map(row=>[row.name,row.sql]));
  }
  const objects=schema(db).filter(row=>before.get(row.name)!==row.sql);
  const requirement={version:1,sources,objects};validateAutomationRequirement(requirement);return requirement;
 }finally{db.close();}
}
export function validateAutomationRequirement(r){
 const sourceNames=[...baseline,...additions];
 if(r?.version!==1||!Array.isArray(r.sources)||r.sources.length!==sourceNames.length||r.sources.some((s,i)=>s.name!==sourceNames[i]||!/^[a-f\d]{64}$/.test(s.sha256))||!Array.isArray(r.objects)||!r.objects.length||new Set(r.objects.map(o=>o.name)).size!==r.objects.length||r.objects.some(o=>!['table','index','trigger'].includes(o.type)||!/^[a-z_]+$/.test(o.name)||typeof o.sql!=='string'||!o.sql))throw Error('Manifeste des espaces de production invalide.');
 for(const name of ['members','member_removed_inactive','member_removed_inactive_insert','projects','media','preparation_profiles','planner_documents','channels','channel_members','programmes','recovery_barriers','planner_assignments','habit_observations','habit_decisions','planner_team_task_guard','channels_name_key_unique','projects_channel_validation','member_purge_clock','member_purge_jobs','member_purge_previews','member_purge_objects','member_purge_guards','member_purge_reinvite','member_delete_last_admin','planner_assignment_update_guard'])if(!r.objects.some(o=>o.name===name))throw Error('Objet de production absent du manifeste : '+name);
}
export function verifyAutomationMigration(r,rows){
 validateAutomationRequirement(r);
 if(!Array.isArray(rows)||rows.length!==r.objects.length+r.sources.length)throw Error('Migrations de production absentes ou incomplètes.');
 for(const obj of r.objects){const found=rows.filter(row=>row.name===obj.name);if(found.length!==1||found[0].type!==obj.type||typeof found[0].sql!=='string'||normalize(found[0].sql)!==obj.sql)throw Error('Schéma de production différent : '+obj.name);}
 for(const source of r.sources)if(rows.filter(row=>row.type==='migration'&&row.name===source.name&&row.sql===null).length!==1)throw Error('Migration non enregistrée : '+source.name);
 return {migrations:additions,verifiedObjects:r.objects.length};
}
export async function checkAutomationPublicationMigration(root,inventory,configFile,runJson){
 const r=inventory.requirements?.automation;validateAutomationRequirement(r);
 if(JSON.stringify(r)!==JSON.stringify(await automationMigrationRequirement(root)))throw Error('Migrations modifiées depuis la construction.');
 const config=JSON.parse(await readFile(configFile,'utf8'));
 if(config.name!=='srtb-graphics'||config.d1_databases?.find(v=>v.binding==='DB')?.database_id!=='859ca314-fa49-41f1-b1f5-11993e80feab')throw Error('Base SRTB de production non confirmée.');
 const query=`SELECT type,name,sql FROM sqlite_master WHERE name IN (${r.objects.map(o=>`'${o.name}'`).join(',')}) UNION ALL SELECT 'migration',name,NULL FROM d1_migrations WHERE name IN (${r.sources.map(s=>`'${s.name}'`).join(',')})`;
 const result=await runJson(['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config',configFile,'--remote','--json','--command',query]);
 if(result?.length!==1||result[0]?.success!==true)throw Error('Contrôle distant des espaces de production non confirmé.');
 return verifyAutomationMigration(r,result[0].results);
}
