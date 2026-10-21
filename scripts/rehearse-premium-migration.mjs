import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {automationMigrationRequirement} from './automation-migration-gate.mjs';
const root=resolve(import.meta.dirname,'..'),backup=resolve(root,'.tools/production-before-premium-20260929.sql');
const db=new DatabaseSync(':memory:');
const quote=id=>'"'+id.replaceAll('"','""')+'"';
const hash=rows=>createHash('sha256').update(JSON.stringify(rows,(_,v)=>typeof v==='bigint'?String(v):v)).digest('hex');
try{
 db.exec(await readFile(backup,'utf8'));
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all();
 const before=tables.map(({name})=>{
  const columns=db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c=>c.name);
  const query=`SELECT ${columns.map(quote).join(',')} FROM ${quote(name)} ORDER BY ${columns.map(quote).join(',')}`;
  return {name,query,hash:hash(db.prepare(query).all())};
 });
 const requirement=await automationMigrationRequirement(root);
 for(const source of requirement.sources.slice(6))db.exec(await readFile(resolve(root,'migrations',source.name),'utf8'));
 for(const snapshot of before)if(hash(db.prepare(snapshot.query).all())!==snapshot.hash)throw Error('Données historiques modifiées : '+snapshot.name);
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Référence invalide après migration.');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Base incohérente.');
 const oldMembers=db.prepare('SELECT count(*) n FROM members').get().n;
 if(db.prepare("SELECT count(*) n FROM channel_members WHERE channel_id='benin-tv'").get().n!==oldMembers)throw Error('Accès BTV historiques incomplets.');
 console.log(`PASS sauvegarde restaurée en mémoire, ${before.length} tables historiques inchangées, migrations 0007–0010, accès BTV et intégrité vérifiés. Aucun contenu utilisateur affiché.`);
}finally{db.close();}
