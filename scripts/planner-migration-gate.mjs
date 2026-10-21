import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {automationMigrationRequirement} from './automation-migration-gate.mjs';
const name='0005_day_planner.sql';
const names=['planner_documents','planner_listing','planner_revisions','planner_created','planner_updated','planner_tasks','planner_task_guard'];
const normalize=sql=>sql.replace(/\s+/g,' ').trim().replace(/;$/,'');
export async function plannerMigrationRequirement(root){
 const bytes=await readFile(resolve(root,'migrations',name)),source=bytes.toString('utf8'),starts=[...source.matchAll(/^CREATE (TABLE|INDEX|TRIGGER) ([a-z_]+)\b/gm)];
 const requirement={name,sha256:createHash('sha256').update(bytes).digest('hex'),objects:starts.map((m,i)=>({type:m[1].toLowerCase(),name:m[2],sql:normalize(source.slice(m.index,starts[i+1]?.index??source.length))}))};
 validatePlannerRequirement(requirement);return requirement;
}
export function validatePlannerRequirement(r){if(r?.name!==name||!/^([a-f\d]{64})$/.test(r.sha256)||!Array.isArray(r.objects)||r.objects.length!==names.length||new Set(r.objects.map(o=>o.name)).size!==names.length||r.objects.some(o=>!names.includes(o.name)||!['table','index','trigger'].includes(o.type)||typeof o.sql!=='string'||!o.sql))throw Error('Manifeste de migration du planning invalide.');}
export function verifyPlannerMigration(r,rows){
 validatePlannerRequirement(r);
 if(!Array.isArray(rows)||rows.length!==r.objects.length+1)throw Error('Migration planning absente ou incomplète.');
 for(const obj of r.objects){const found=rows.filter(row=>row.name===obj.name);if(found.length!==1||found[0].type!==obj.type||normalize(found[0].sql)!==obj.sql)throw Error('Schéma planning différent : '+obj.name);}
 if(rows.filter(row=>row.type==='migration'&&row.name===name&&row.sql===null).length!==1)throw Error('Migration planning non enregistrée.');
 return {name,sha256:r.sha256,verifiedObjects:r.objects.length};
}
export async function checkPlannerPublicationMigration(root,inventory,configFile,runJson){
 const r=inventory.requirements?.planner;if(!r)return null;
 const expected=await plannerMigrationRequirement(root);if(JSON.stringify(r)!==JSON.stringify(expected))throw Error('La migration planning a changé après la construction.');
 const config=JSON.parse(await readFile(configFile,'utf8')),db=config.d1_databases?.find(v=>v.binding==='DB');
 if(config.name!=='srtb-graphics'||db?.database_id!=='859ca314-fa49-41f1-b1f5-11993e80feab')throw Error('Base SRTB Graphics de production non confirmée.');
 // 0008 adds the channel column without rebuilding the planning table. Accept
 // only the exact post-migration SQL sealed alongside this build.
 let effective=r;
 if(inventory.requirements?.automation){
  const automation=await automationMigrationRequirement(root);
  if(JSON.stringify(automation)!==JSON.stringify(inventory.requirements.automation))throw Error('Migrations de production modifiées après construction.');
  effective={...r,objects:r.objects.map(o=>automation.objects.find(a=>a.name===o.name)||o)};
 }
 const query=`SELECT type,name,sql FROM sqlite_master WHERE name IN (${names.map(n=>`'${n}'`).join(',')}) UNION ALL SELECT 'migration',name,NULL FROM d1_migrations WHERE name='${name}'`;
 const result=await runJson(['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config',configFile,'--remote','--json','--command',query]);
 if(result?.length!==1||result[0]?.success!==true)throw Error('Contrôle distant du planning non confirmé.');return verifyPlannerMigration(effective,result[0].results);
}
