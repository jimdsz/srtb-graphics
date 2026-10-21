import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const name='0006_project_privacy.sql';
const names=['projects_owner_listing','planner_personal_tasks','planner_personal_task_guard'];
const normalize=sql=>sql.replace(/\s+/g,' ').trim().replace(/;$/,'');
export async function privacyMigrationRequirement(root){
 const bytes=await readFile(resolve(root,'migrations',name)),source=bytes.toString('utf8');
 const objects=[...source.matchAll(/CREATE (?:TRIGGER [a-z_]+\b[\s\S]*?END;|(?:TABLE|INDEX) [a-z_]+\b[\s\S]*?;)/g)].map(m=>{const [,type,name]=m[0].match(/^CREATE (\w+) (\w+)/);return {type:type.toLowerCase(),name,sql:normalize(m[0])};});
 const requirement={name,sha256:createHash('sha256').update(bytes).digest('hex'),objects};validatePrivacyRequirement(requirement);return requirement;
}
export function validatePrivacyRequirement(r){if(r?.name!==name||!/^[a-f\d]{64}$/.test(r.sha256)||r.objects?.length!==3||new Set(r.objects.map(o=>o.name)).size!==3||r.objects.some(o=>!names.includes(o.name)||!o.sql))throw Error('Manifeste de confidentialité invalide.');}
export function verifyPrivacyMigration(r,rows){
 validatePrivacyRequirement(r);if(!Array.isArray(rows)||rows.length!==6)throw Error('Migration de confidentialité absente ou incomplète.');
 for(const o of r.objects){const found=rows.filter(row=>row.name===o.name);if(found.length!==1||found[0].type!==o.type||normalize(found[0].sql)!==o.sql)throw Error('Schéma de confidentialité différent : '+o.name);}
 for(const [type,n,sql] of [['migration',name,null],['column','visibility',"TEXT:1:'private'"],['copied','planner_tasks','0']])if(rows.filter(row=>row.type===type&&row.name===n&&String(row.sql)===String(sql)).length!==1)throw Error('Confidentialité non confirmée : '+n);
 return {name,verifiedObjects:3};
}
export async function checkPrivacyPublicationMigration(root,inventory,configFile,runJson){
 const r=inventory.requirements?.privacy;validatePrivacyRequirement(r);
 if(JSON.stringify(r)!==JSON.stringify(await privacyMigrationRequirement(root)))throw Error('Migration modifiée après la construction.');
 const config=JSON.parse(await readFile(configFile,'utf8'));
 if(config.name!=='srtb-graphics'||config.d1_databases?.find(v=>v.binding==='DB')?.database_id!=='859ca314-fa49-41f1-b1f5-11993e80feab')throw Error('Base cible non confirmée.');
 const query=`SELECT type,name,sql FROM sqlite_master WHERE name IN (${names.map(n=>`'${n}'`).join(',')}) UNION ALL SELECT 'migration',name,NULL FROM d1_migrations WHERE name='${name}' UNION ALL SELECT 'column',name,type||':'||\"notnull\"||':'||dflt_value FROM pragma_table_info('projects') WHERE name='visibility' UNION ALL SELECT 'copied','planner_tasks',CAST(COUNT(*) AS TEXT) FROM planner_tasks old WHERE NOT EXISTS(SELECT 1 FROM planner_personal_tasks p WHERE p.plan_id=old.plan_id AND p.task_key=old.task_key AND p.actor=old.actor AND p.project_id=old.project_id)`;
 const result=await runJson(['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config',configFile,'--remote','--json','--command',query]);
 if(result?.length!==1||result[0]?.success!==true)throw Error('Contrôle distant de confidentialité non confirmé.');return verifyPrivacyMigration(r,result[0].results);
}
