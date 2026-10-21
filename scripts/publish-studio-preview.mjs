import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyNativeInventory} from './native-release-audit.mjs';
import {automationMigrationRequirement,verifyAutomationMigration} from './automation-migration-gate.mjs';
import {derivationMigrationRequirement,verifyDerivationMigration} from './derivation-migration-gate.mjs';
import {plannerMigrationRequirement,verifyPlannerMigration} from './planner-migration-gate.mjs';
import {privacyMigrationRequirement,verifyPrivacyMigration} from './project-privacy-gate.mjs';

// Isolated qualification only. Production retains its separate publication gates.
export function assertPreviewTarget(config){
 const db=config.env?.preview?.d1_databases;
 if(config.name!=='srtb-graphics'||db?.length!==1||db[0].binding!=='DB'||db[0].database_id!=='ab7f4504-0ad1-4882-b3db-255699012855'||db[0].database_name!=='srtb-graphics-studio-preview'||config.env.preview.vars?.APP_ENV!=='production'||config.env.preview.vars?.AUTH_MODE!=='firebase'||config.env.preview.vars?.STORAGE_PROVIDER!=='b2'||config.d1_databases?.some(item=>item.database_id===db[0].database_id))throw Error('Recette refusée : cible isolée et sécurité stricte requises.');
 return db[0];
}
export async function verifyPreviewSchema(root,inventory,rows){
 const automation=await automationMigrationRequirement(root),derivation=await derivationMigrationRequirement(root),planner=await plannerMigrationRequirement(root),privacy=await privacyMigrationRequirement(root);
 if(inventory.profile!=='native-derivations'||JSON.stringify(automation)!==JSON.stringify(inventory.requirements?.automation)||JSON.stringify([derivation])!==JSON.stringify(inventory.requirements?.migrations)||JSON.stringify(planner)!==JSON.stringify(inventory.requirements?.planner)||JSON.stringify(privacy)!==JSON.stringify(inventory.requirements?.privacy))throw Error('Les migrations ne correspondent pas au paquet scellé.');
 const select=(objects,migrations)=>rows.filter(row=>row.type==='migration'?migrations.includes(row.name):['table','index','trigger'].includes(row.type)&&objects.some(o=>o.name===row.name));
 verifyAutomationMigration(automation,select(automation.objects,automation.sources.map(s=>s.name)));
 verifyDerivationMigration(derivation,select(derivation.objects,[derivation.name]));
 verifyPlannerMigration({...planner,objects:planner.objects.map(o=>automation.objects.find(a=>a.name===o.name)||o)},select(planner.objects,[planner.name]));
 verifyPrivacyMigration(privacy,[...select(privacy.objects,[privacy.name]),...rows.filter(r=>r.type==='column'||r.type==='copied')]);
}
async function publish(){
 if(process.argv.slice(2).join(' ')!=='--derivations --preview')throw Error('Publication de recette : --derivations --preview requis.');
 const root=resolve(import.meta.dirname,'..'),configFile=resolve(root,'.pages-studio-native/wrangler.jsonc');
 const env={...process.env,CLOUDFLARE_ACCOUNT_ID:'8d1be9102f391f34a6f4bde342eafc2f',WRANGLER_LOG_PATH:resolve(root,'.tools/wrangler-logs')};
 const run=(args,json=false)=>{const r=spawnSync(process.execPath,args,{cwd:root,env,...(json?{encoding:'utf8',maxBuffer:2*1024*1024}:{stdio:'inherit'})});if(r.error||r.status!==0)throw Error('Publication de recette interrompue.');return json?JSON.parse(r.stdout):undefined;};
 run(['scripts/check-studio-native-release.mjs','--derivations','--check']);
 assertPreviewTarget(JSON.parse(await readFile(configFile,'utf8')));
 const inventory=await verifyNativeInventory(resolve(root,'dist-studio-native'),resolve(root,'.tools/native-release/graph.json'),resolve(root,'.tools/native-release/inventory.json'),'native-derivations');
 // Metadata only: no credentials, session tokens or user content are queried.
 const sql=`SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL UNION ALL SELECT 'migration',name,NULL FROM d1_migrations UNION ALL SELECT 'column',name,type||':'||"notnull"||':'||dflt_value FROM pragma_table_info('projects') WHERE name='visibility' UNION ALL SELECT 'copied','planner_tasks',CAST(COUNT(*) AS TEXT) FROM planner_tasks old WHERE NOT EXISTS(SELECT 1 FROM planner_personal_tasks p WHERE p.plan_id=old.plan_id AND p.task_key=old.task_key AND p.actor=old.actor AND p.project_id=old.project_id)`;
 const result=run(['node_modules/wrangler/bin/wrangler.js','d1','execute','srtb-graphics-studio-preview','--config',configFile,'--env','preview','--remote','--json','--command',sql],true);
 if(result?.length!==1||result[0]?.success!==true)throw Error('Schéma de recette non confirmé.');
 await verifyPreviewSchema(root,inventory,result[0].results);
 await verifyNativeInventory(resolve(root,'dist-studio-native'),resolve(root,'.tools/native-release/graph.json'),resolve(root,'.tools/native-release/inventory.json'),'native-derivations');
 run(['node_modules/wrangler/bin/wrangler.js','pages','deploy','--cwd','.pages-studio-native','--project-name','srtb-graphics','--branch','codex-production-premium','--commit-dirty=true','--commit-message','Recette isolée — chaînes, préparation et récupération']);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await publish();
