import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const migrationName='0004_project_derivations.sql';
const objectNames=new Map([
  ['derivation_batches','table'],['derivation_batches_source','index'],['project_derivations','table'],
  ...['derivation_source_guard','derivation_actor_guard','derivation_media_guard','derivation_voice_guard','derivation_batch_immutable','project_derivation_immutable'].map(name=>[name,'trigger']),
]);
const normalize=sql=>sql.replace(/\s+/g,' ').trim().replace(/;$/,'');
const fail=message=>{throw Error('Derivation migration gate: '+message);};

export function validateDerivationRequirement(requirement){
  if(requirement?.name!==migrationName||!/^[a-f0-9]{64}$/.test(requirement.sha256)||!Array.isArray(requirement.objects)||requirement.objects.length!==objectNames.size)fail('invalid required migration manifest');
  const seen=new Set();
  for(const item of requirement.objects){
    if(!item||objectNames.get(item.name)!==item.type||seen.has(item.name)||typeof item.sql!=='string'||!item.sql.trim())fail('invalid required schema object');
    seen.add(item.name);
  }
  return requirement;
}
export async function derivationMigrationRequirement(root){
  const bytes=await readFile(resolve(root,'migrations',migrationName)),source=bytes.toString('utf8');
  const starts=[...source.matchAll(/^CREATE (TABLE|INDEX|TRIGGER) ([a-z_]+)\b/gm)];
  const objects=starts.map((match,index)=>({type:match[1].toLowerCase(),name:match[2],sql:normalize(source.slice(match.index,starts[index+1]?.index??source.length))}));
  return validateDerivationRequirement({name:migrationName,sha256:createHash('sha256').update(bytes).digest('hex'),objects});
}
export function derivationMigrationQuery(requirement){
  validateDerivationRequirement(requirement);
  // All identifiers below come from the fixed validated allowlist. No project,
  // member, voice, media, credential or session data is read by this query.
  return `SELECT type,name,sql FROM sqlite_master WHERE name IN (${[...objectNames.keys()].map(name=>`'${name}'`).join(',')}) UNION ALL SELECT 'migration' AS type,name,NULL AS sql FROM d1_migrations WHERE name='${migrationName}'`;
}
export function verifyDerivationMigration(requirement,rows){
  validateDerivationRequirement(requirement);
  if(!Array.isArray(rows)||rows.length!==requirement.objects.length+1)fail('migration or required schema objects missing');
  const expected=new Map(requirement.objects.map(item=>[item.name,item])),seen=new Set();let applied=false;
  for(const row of rows){
    if(!row||typeof row.name!=='string'||seen.has(row.name))fail('malformed or duplicate schema response');
    seen.add(row.name);
    if(row.type==='migration'&&row.name===migrationName&&row.sql===null){applied=true;continue;}
    const item=expected.get(row.name);
    if(!item||row.type!==item.type||typeof row.sql!=='string'||normalize(row.sql)!==item.sql)fail('schema differs from the sealed migration: '+row.name);
  }
  if(!applied)fail('required migration not recorded as applied');
  return {name:requirement.name,sha256:requirement.sha256,verifiedObjects:expected.size};
}

/** Runs only SELECT at the instant an explicitly requested ON publication starts.
 * The caller supplies a CLI adapter; tests supply an in-memory SQLite adapter. */
export async function checkDerivationPublicationMigration(root,inventory,configFile,runJson){
  if(inventory.profile!=='native-derivations')fail('activated native profile required');
  const expected=await derivationMigrationRequirement(root),recorded=inventory.requirements?.migrations;
  if(!Array.isArray(recorded)||recorded.length!==1||JSON.stringify(recorded[0])!==JSON.stringify(expected))fail('local migration differs from the sealed release requirements');
  const config=JSON.parse(await readFile(configFile,'utf8'));
  const databases=config.d1_databases?.filter(item=>item.binding==='DB');
  if(config.name!=='srtb-graphics'||databases?.length!==1||typeof databases[0].database_name!=='string'||!databases[0].database_name||!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(databases[0].database_id)||databases[0].database_id.startsWith('00000000')||databases[0].migrations_table&&databases[0].migrations_table!=='d1_migrations')fail('explicit production DB binding with standard migration ledger required');
  const result=await runJson(['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config',configFile,'--remote','--json','--command',derivationMigrationQuery(expected)]);
  if(!Array.isArray(result)||result.length!==1||result[0]?.success!==true||!Array.isArray(result[0].results))fail('remote schema verification did not succeed');
  return {...verifyDerivationMigration(expected,result[0].results),databaseId:databases[0].database_id};
}

export async function guardedNativePublication({root,inventory,configFile,runJson,publish}){
  if(!['native-only','native-derivations'].includes(inventory.profile))fail('unknown publication profile');
  const proof=inventory.profile==='native-derivations'?await checkDerivationPublicationMigration(root,inventory,configFile,runJson):null;
  return publish(proof);
}
