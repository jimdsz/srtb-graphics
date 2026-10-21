import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {derivationMigrationRequirement,derivationMigrationQuery,verifyDerivationMigration,guardedNativePublication} from '../scripts/derivation-migration-gate.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
async function schema(){
  const db=new DatabaseSync(':memory:');
  for(const name of ['0001_studio.sql','0002_firebase_sessions.sql','0003_preparation_profiles.sql','0004_project_derivations.sql'])db.exec(await readFile(join(root,'migrations',name),'utf8'));
  db.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,applied_at TEXT); INSERT INTO d1_migrations(name) VALUES('0004_project_derivations.sql')");
  return db;
}
const jsonRows=(rows:unknown)=>[{success:true,results:rows}];

test('the sealed 0004 schema matches real SQLite after applying the additive migrations',async()=>{
  const requirement=await derivationMigrationRequirement(root),db=await schema();
  try{
    assert.equal(requirement.name,'0004_project_derivations.sql');assert.equal(requirement.objects.length,9);
    assert.match(requirement.sha256,/^[a-f0-9]{64}$/);
    const sql=derivationMigrationQuery(requirement);
    assert.match(sql,/^SELECT /);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b/i);
    const proof=verifyDerivationMigration(requirement,db.prepare(sql).all());assert.equal(proof.verifiedObjects,9);
    db.exec('DROP TRIGGER derivation_actor_guard');
    assert.throws(()=>verifyDerivationMigration(requirement,db.prepare(sql).all()),/missing/);
  }finally{db.close();}
});

test('applied-name alone, altered guards, duplicate or malformed responses cannot pass',async()=>{
  const requirement=await derivationMigrationRequirement(root),db=await schema();
  try{
    const rows=db.prepare(derivationMigrationQuery(requirement)).all();
    assert.throws(()=>verifyDerivationMigration(requirement,rows.filter(row=>row.type!=='migration')),/missing/);
    assert.throws(()=>verifyDerivationMigration(requirement,[{type:'migration',name:requirement.name,sql:null}]),/missing/);
    assert.throws(()=>verifyDerivationMigration(requirement,rows.map(row=>row.name==='derivation_actor_guard'?{...row,sql:'CREATE TRIGGER derivation_actor_guard AFTER INSERT ON derivation_batches BEGIN SELECT 1; END'}:row)),/schema differs/);
    assert.throws(()=>verifyDerivationMigration(requirement,[...rows.slice(1),rows[1]]),/duplicate/);
    assert.throws(()=>verifyDerivationMigration(requirement,rows.map((row,index)=>index===0?null:row)),/malformed/);
    assert.throws(()=>derivationMigrationQuery({...requirement,name:"other'; DROP TABLE projects; --"}));
  }finally{db.close();}
});

test('ON publication runs the read-only target check first; every failed proof prevents the publish callback',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'srtb-migration-gate-'));t.after(async()=>{assert.equal(dirname(folder),resolve(tmpdir()));await rm(folder,{recursive:true,force:true});});
  const configFile=join(folder,'wrangler.jsonc');
  const config={name:'srtb-graphics',d1_databases:[{binding:'DB',database_name:'test-only-database',database_id:'11111111-1111-4111-8111-111111111111'}]};
  await writeFile(configFile,JSON.stringify(config));
  const requirement=await derivationMigrationRequirement(root),inventory={profile:'native-derivations',requirements:{migrations:[requirement]}},db=await schema();
  try{
    const rows=db.prepare(derivationMigrationQuery(requirement)).all(),trace:string[]=[];
    await guardedNativePublication({root,inventory,configFile,runJson:async(args:string[])=>{
      trace.push('check');assert.deepEqual(args.slice(0,5),['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config']);
      assert.equal(args[5],configFile);assert.ok(args.includes('--remote'));assert.ok(args.includes('--json'));
      assert.equal(args.at(-1),derivationMigrationQuery(requirement));return jsonRows(rows);
    },publish:async(proof:{databaseId:string})=>{trace.push('publish');assert.equal(proof.databaseId,config.d1_databases[0].database_id);}});
    assert.deepEqual(trace,['check','publish']);
    for(const response of [undefined,[],[{success:false,results:rows}],jsonRows([]),jsonRows(rows.slice(1)),jsonRows(rows.map(row=>row.type==='table'?{...row,sql:'wrong'}:row))]){
      let published=false;
      await assert.rejects(guardedNativePublication({root,inventory,configFile,runJson:async()=>response,publish:async()=>{published=true;}}));
      assert.equal(published,false);
    }
    let published=false;
    await assert.rejects(guardedNativePublication({root,inventory,configFile,runJson:async()=>{throw Error('CLI unavailable');},publish:async()=>{published=true;}}),/CLI unavailable/);
    assert.equal(published,false);
    let queried=false;
    const changed={...inventory,requirements:{migrations:[{...requirement,sha256:'f'.repeat(64)}]}};
    await assert.rejects(guardedNativePublication({root,inventory:changed,configFile,runJson:async()=>{queried=true;return jsonRows(rows);},publish:async()=>{published=true;}}),/differs from the sealed/);
    assert.equal(queried,false);assert.equal(published,false);
    await writeFile(configFile,JSON.stringify({...config,d1_databases:[{...config.d1_databases[0],database_id:'00000000-0000-4000-8000-000000000000'}]}));
    await assert.rejects(guardedNativePublication({root,inventory,configFile,runJson:async()=>{queried=true;return jsonRows(rows);},publish:async()=>{published=true;}}),/DB binding/);
    assert.equal(queried,false);assert.equal(published,false);
  }finally{db.close();}
});

test('the OFF release does not read a config or query D1 and preserves its explicit publish action',async()=>{
  let published=0;
  await guardedNativePublication({root:'not-used',inventory:{profile:'native-only'},configFile:'not-read',runJson:async()=>{throw Error('No D1 call allowed for OFF.');},publish:async(proof:null)=>{assert.equal(proof,null);published++;}});
  assert.equal(published,1);
});
