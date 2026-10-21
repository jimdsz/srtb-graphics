import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,expect,it,inject} from 'vitest';
import {api} from '../../server/router';
import {broadcastTemplates,templateDefaults} from '../../src/studio/domain';
import type {Member} from '../../src/studio/domain';

const origin='https://studio.example';
const admin:Member={email:'admin@example.com',name:'Jimmy de Souza',role:'admin',active:1};
const call=(method:'GET'|'DELETE'|'POST',body?:unknown,actor:Member=admin)=>api(new Request(origin+'/api/graphics/members',{method,headers:{Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,actor);

beforeAll(async()=>{
  await applyD1Migrations(env.DB,inject('migrations'));
});

it('retire un membre de l’équipe, conserve son identité et révoque ses sessions',async()=>{
  const email='delete-me@example.test';
  await env.DB.prepare('INSERT INTO members(email,name,role,updated_by) VALUES(?,?,?,?)').bind(email,'À supprimer','designer',admin.email).run();
  await env.DB.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind('delete-session',email,'firebase-delete',Date.now()+3600000,Date.now()).run();
  const response=await call('DELETE',{email});
  expect(response).not.toBeNull();
  expect(response!.status).toBe(200);
  expect(await env.DB.prepare('SELECT active,removed_at FROM members WHERE email=?').bind(email).first()).toEqual({active:0,removed_at:expect.any(String)});
  expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM app_sessions WHERE email=?').bind(email).first()).toEqual({count:0});
  expect(await env.DB.prepare("SELECT action,target FROM activity WHERE action='member.access_removed' AND target=?").bind(email).first()).toEqual({action:'member.access_removed',target:email});
  expect((await (await call('GET'))!.json()) as Member[]).not.toEqual(expect.arrayContaining([expect.objectContaining({email})]));
  expect(await response!.json()).toMatchObject({notice:expect.stringContaining('identifiant de connexion sont conservés')});
  await expect(call('DELETE',{email})).rejects.toMatchObject({status:404});
});

it('protège le compte courant et retire les accès liés sans effacer les projets',async()=>{
  await expect(call('DELETE',{email:admin.email})).rejects.toMatchObject({status:409});

  const email='linked-member@example.test';
  await env.DB.prepare('INSERT INTO members(email,name,role,updated_by) VALUES(?,?,?,?)').bind(email,'Membre lié','designer',admin.email).run();
  const template=broadcastTemplates[0];
  await env.DB.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),'Projet lié',template.id,template.version,template.libraryVersion,JSON.stringify(templateDefaults(template)),email,email).run();
  const before=await env.DB.prepare('SELECT * FROM projects WHERE created_by=?').bind(email).all();
  expect((await call('DELETE',{email}))!.status).toBe(200);
  expect(await env.DB.prepare('SELECT active FROM members WHERE email=?').bind(email).first()).toEqual({active:0});
  expect((await env.DB.prepare('SELECT * FROM projects WHERE created_by=?').bind(email).all()).results).toEqual(before.results);
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});

it('réautorise la même adresse sans doublon ni changement d’identité ni résurrection des sessions',async()=>{
  const email='restore-member@example.test',uid='restore-identity';
  await env.DB.prepare('INSERT INTO members(email,name,role,firebase_uid,updated_by) VALUES(?,?,?,?,?)').bind(email,'Retour','designer',uid,admin.email).run();
  await env.DB.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind('old-restore-session',email,uid,Date.now()+3600000,Date.now()).run();
  await call('DELETE',{email});
  const result=await call('POST',{email:email.toUpperCase(),name:'De retour',role:'broadcaster',active:true});
  expect(result!.status).toBe(200);
  expect(await result!.json()).toMatchObject({notice:expect.stringContaining('conserve son identifiant')});
  expect(await env.DB.prepare('SELECT name,role,active,firebase_uid,removed_at FROM members WHERE email=?').bind(email).first()).toEqual({name:'De retour',role:'broadcaster',active:1,firebase_uid:uid,removed_at:null});
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM app_sessions WHERE email=?').bind(email).first()).toEqual({n:0});
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM members WHERE email=?').bind(email).first()).toEqual({n:1});
});

it('une désactivation ordinaire reste visible et seul un administrateur peut retirer un accès',async()=>{
  const email='suspended-still-listed@example.test';
  await call('POST',{email,name:'Suspendu',role:'designer',active:false});
  expect(await (await call('GET'))!.json()).toEqual(expect.arrayContaining([expect.objectContaining({email,active:0})]));
  await expect(call('DELETE',{email},{email,name:'Designer',role:'designer',active:1})).rejects.toMatchObject({status:403});
  expect(await env.DB.prepare('SELECT removed_at FROM members WHERE email=?').bind(email).first()).toEqual({removed_at:null});
});

it('les invariants SQL interdisent un membre supprimé actif et conservent le dernier administrateur',async()=>{
  await expect(env.DB.prepare("INSERT INTO members(email,name,role,active,removed_at,updated_by) VALUES('invalid-removed@example.test','Invalide','designer',1,'now',?)").bind(admin.email).run()).rejects.toThrow('removed_member_active');
  await expect(env.DB.prepare('UPDATE members SET active=0,removed_at=? WHERE email=?').bind('now',admin.email).run()).rejects.toThrow('last_admin');
});
