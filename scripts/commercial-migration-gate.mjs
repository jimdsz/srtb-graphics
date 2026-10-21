import {readFile} from 'node:fs/promises';
import {automationMigrationRequirement} from './automation-migration-gate.mjs';

export const commercialMigrationName='0014_commercial_workspace.sql';
const required=['members','media','media_tool_owner','member_default_channel','member_commercial_role_insert','member_commercial_role_update','member_tool_scope_changed','media_tool_scope_immutable','commercial_projects','commercial_revisions','commercial_projects_owner','commercial_project_created','commercial_project_updated','commercial_project_owner_immutable'];
const normalize=sql=>sql.replace(/\s+/g,' ').trim().replace(/;$/,'');
export async function commercialMigrationRequirement(root){
  const automation=await automationMigrationRequirement(root);
  return fromAutomation(automation);
}
function fromAutomation(automation){
  const source=automation?.sources?.find(item=>item.name===commercialMigrationName);
  const objects=automation?.objects?.filter(item=>required.includes(item.name)||item.name.startsWith('purge_clock_commercial_'));
  if(!source||!/^[a-f\d]{64}$/.test(source.sha256)||!objects||required.some(name=>!objects.some(item=>item.name===name))||objects.length!==required.length+6)throw Error('Migration commerciale absente ou incomplète dans le manifeste scellé.');
  return {version:1,name:commercialMigrationName,sha256:source.sha256,objects};
}
export function verifyCommercialMigration(requirement,rows){
  if(requirement?.version!==1||requirement.name!==commercialMigrationName||!Array.isArray(requirement.objects)||requirement.objects.length!==required.length+6||!Array.isArray(rows)||rows.length!==requirement.objects.length+1)throw Error('Schéma commercial incomplet. Publication refusée.');
  for(const object of requirement.objects){
    const found=rows.filter(row=>row.name===object.name);
    if(found.length!==1||found[0].type!==object.type||typeof found[0].sql!=='string'||normalize(found[0].sql)!==object.sql)throw Error('Schéma commercial différent : '+object.name);
  }
  if(rows.filter(row=>row.type==='migration'&&row.name===commercialMigrationName&&row.sql===null).length!==1)throw Error('Migration commerciale non enregistrée.');
  return {name:commercialMigrationName,sha256:requirement.sha256,verifiedObjects:requirement.objects.length};
}
export async function checkCommercialPublicationMigration(root,inventory,configFile,runJson){
  const requirement=fromAutomation(inventory.requirements?.automation),expected=await commercialMigrationRequirement(root);
  if(JSON.stringify(requirement)!==JSON.stringify(expected))throw Error('La migration commerciale a changé depuis la construction.');
  const config=JSON.parse(await readFile(configFile,'utf8'));
  if(config.name!=='srtb-graphics'||config.d1_databases?.find(item=>item.binding==='DB')?.database_id!=='859ca314-fa49-41f1-b1f5-11993e80feab')throw Error('Base SRTB de production non confirmée.');
  const query=`SELECT type,name,sql FROM sqlite_master WHERE name IN (${requirement.objects.map(item=>`'${item.name}'`).join(',')}) UNION ALL SELECT 'migration',name,NULL FROM d1_migrations WHERE name='${commercialMigrationName}'`;
  const result=await runJson(['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config',configFile,'--remote','--json','--command',query]);
  if(result?.length!==1||result[0]?.success!==true)throw Error('Contrôle distant des annonces non confirmé. Aucune publication effectuée.');
  return verifyCommercialMigration(requirement,result[0].results);
}
