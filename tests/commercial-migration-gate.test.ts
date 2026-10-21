import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {commercialMigrationName,commercialMigrationRequirement,verifyCommercialMigration} from '../scripts/commercial-migration-gate.mjs';

test('commercial migration preserves existing accounts and Graphics projects, and seals exact schema and guards',async()=>{
  const root=resolve('.'),db=new DatabaseSync(':memory:');
  try{
    const files=(await readdir(resolve(root,'migrations'))).filter(name=>name.endsWith('.sql')).sort();
    for(const name of files.filter(name=>name!==commercialMigrationName))db.exec(await readFile(resolve(root,'migrations',name),'utf8'));
    const email='admin@example.com';
    db.prepare("INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) VALUES('original','Original','BTV_BA_1P','1','1','{}',?,?)").run(email,email);
    db.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES('original-media','uploads/original','Original.wav','audio/wav',12,'ready',?)").run(email);
    db.exec(await readFile(resolve(root,'migrations',commercialMigrationName),'utf8'));
    assert.equal(db.prepare("SELECT title FROM projects WHERE id='original'").get().title,'Original');
    assert.equal(db.prepare("SELECT tool_scope FROM media WHERE id='original-media'").get().tool_scope,'graphics');
    assert.equal(db.prepare('SELECT role FROM members WHERE email=?').get(email).role,'admin');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    const requirement=await commercialMigrationRequirement(root),names=new Set(requirement.objects.map(item=>item.name));
    const rows=[...db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL").all().filter(row=>names.has(row.name)),{type:'migration',name:commercialMigrationName,sql:null}];
    assert.equal(verifyCommercialMigration(requirement,rows).verifiedObjects,20);
    assert.throws(()=>verifyCommercialMigration(requirement,rows.filter(row=>row.name!=='members')));
    assert.throws(()=>verifyCommercialMigration(requirement,rows.filter(row=>row.type!=='migration')));
    assert.throws(()=>verifyCommercialMigration(requirement,rows.map(row=>row.name==='media'?{...row,sql:row.sql.replace(/tool_scope/g,'wrong_scope')}:row)));
    assert.throws(()=>db.prepare("INSERT INTO members(email,name,role,tool_scope,updated_by) VALUES('bad@example.test','Bad','admin','commercial',?)").run(email),/invalid_commercial_role/);
  }finally{db.close();}
});
