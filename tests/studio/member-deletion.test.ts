import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,beforeEach,afterEach,expect,it,inject,vi} from 'vitest';
import {api} from '../../server/router';
import type {Member} from '../../src/studio/domain';
import {broadcastTemplates,templateDefaults} from '../../src/studio/domain';
import type {MemberDeletionPreview,MemberDeletionJob} from '../../src/studio/member-deletion';
import {memberInvitationLockKey} from '../../server/member-invitation';

const provider=vi.hoisted(()=>({lookup:vi.fn(),remove:vi.fn()}));
vi.mock('../../server/firebase-account-admin',()=>({firebaseAccountAdmin:vi.fn(async()=>provider)}));
const origin='https://studio.example',admin:Member={email:'admin@example.com',name:'Jimmy',role:'admin',active:1};
let email='purge@example.test',uid='target-uid';
const other:Member={email:'other@example.test',name:'Autre',role:'designer',active:1};
function call(path:string,body?:unknown,actor=admin){return api(new Request(origin+'/api/graphics/members/deletion'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,actor);}
async function preview(){return (await (await call('/preview',{email}))!.json()) as MemberDeletionPreview;}
async function begin(){const p=await preview();return (await (await call('/confirm',{token:p.token,email,acknowledge:true}))!.json()) as {job:MemberDeletionJob};}
async function run(id:string){for(let i=0;i<10;i++){const result=await (await call('/continue',{id}))!.json() as {job:MemberDeletionJob|null};if(!result.job)return;}throw Error('Cleanup did not finish');}
async function project(owner:string,title='Projet',data:object={}){const t=broadcastTemplates[0],id=crypto.randomUUID();await env.DB.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)').bind(id,title,t.id,t.version,t.libraryVersion,JSON.stringify({...templateDefaults(t),...data}),owner,owner).run();return id;}
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));});
beforeEach(async()=>{
  email=crypto.randomUUID()+'@example.test';uid=crypto.randomUUID();other.email=crypto.randomUUID()+'@example.test';
  vi.clearAllMocks();let present=true;provider.lookup.mockImplementation(async()=>present?uid:null);provider.remove.mockImplementation(async()=>{present=false;});
  for(const [e,name]of [[email,'Membre effacé'],[other.email,other.name]])await env.DB.prepare('INSERT INTO members(email,name,role,firebase_uid,updated_by) VALUES(?,?,?,?,?)').bind(e,name,'designer',e===email?uid:crypto.randomUUID(),admin.email).run();
});
afterEach(async()=>{const job=await env.DB.prepare('SELECT id FROM member_purge_jobs').first<{id:string}>();if(job){provider.lookup.mockResolvedValue(null);provider.remove.mockResolvedValue(undefined);await run(job.id);}});
it('efface le compte, les contenus partagés et leurs historiques sans supprimer le montage du collègue',async()=>{
  const owned=await project(email,'Projet partagé'),surviving=await project(other.email,'Projet du collègue');
  await env.DB.prepare("UPDATE projects SET visibility='team',revision=revision+1 WHERE id=?").bind(owned).run();
  const media=crypto.randomUUID(),key='uploads/'+media;await env.MEDIA!.put(key,'media-test');
  await env.DB.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES(?,?,?,'image/png',10,'ready',?)").bind(media,key,'Logo partagé',email).run();
  await env.DB.prepare('UPDATE projects SET data_json=?,updated_by=?,revision=revision+1 WHERE id=?').bind(JSON.stringify({logo:'/api/graphics/media/'+media+'/content'}),email,surviving).run();
  await env.DB.prepare('INSERT INTO comments(id,project_id,revision,author,body) VALUES(?,?,1,?,?)').bind(crypto.randomUUID(),surviving,email,'Commentaire à effacer').run();
  await env.DB.prepare('INSERT INTO app_sessions VALUES(?,?,?,?,?)').bind('old-session',email,'target-uid',Date.now()+600000,Date.now()).run();
  const p=await preview();expect(p.impact.projects.map(x=>x.id)).toEqual([owned]);expect(p.impact.media.map(x=>x.id)).toEqual([media]);expect(p.impact.affected.map(x=>x.id)).toContain(surviving);
  expect(await env.MEDIA!.head(key)).not.toBeNull();expect(provider.remove).not.toHaveBeenCalled();
  const {job}=await (await call('/confirm',{token:p.token,email,acknowledge:true}))!.json() as {job:MemberDeletionJob};
  expect(await env.DB.prepare('SELECT * FROM app_sessions WHERE email=?').bind(email).first()).toBeNull();
  await run(job.id);
  for(const [table,field]of [['members','email'],['projects','created_by'],['media','created_by'],['comments','author'],['activity','actor'],['revisions','actor']])expect(await env.DB.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${field}=?`).bind(email).first()).toEqual({n:0});
  expect(await env.MEDIA!.head(key)).toBeNull();expect(provider.remove).toHaveBeenCalledExactlyOnceWith(uid,email);
  expect(await env.DB.prepare('SELECT title,created_by,updated_by FROM projects WHERE id=?').bind(surviving).first()).toEqual({title:'Projet du collègue',created_by:other.email,updated_by:'deleted-contributor@system.invalid'});
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  const created=await api(new Request(origin+'/api/graphics/members',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,name:'Nouveau membre',role:'designer',active:true})}),env,admin);expect(created!.status).toBe(200);
  expect(await env.DB.prepare('SELECT firebase_uid,removed_at FROM members WHERE email=?').bind(email).first()).toEqual({firebase_uid:null,removed_at:null});
  expect(await env.DB.prepare('SELECT * FROM app_sessions WHERE email=?').bind(email).first()).toBeNull();
});
it('le bilan périmé, un autre administrateur ou une mauvaise confirmation ne peut déclencher l’effacement',async()=>{
  const p=await preview();await project(email,'Ajout après bilan');
  await expect(call('/confirm',{token:p.token,email,acknowledge:true})).rejects.toMatchObject({status:409});
  expect(provider.remove).not.toHaveBeenCalled();expect(await env.DB.prepare('SELECT * FROM member_purge_jobs').first()).toBeNull();
  await expect(call('/confirm',{token:p.token,email,acknowledge:false})).rejects.toBeDefined();
  await expect(call('/preview',{email:admin.email})).rejects.toMatchObject({status:409});
  await expect(call('/preview',{email},other)).rejects.toMatchObject({status:403});
});
it('inclut les annonces commerciales dans le bilan et efface leurs révisions sans références orphelines',async()=>{
  await env.DB.prepare("UPDATE members SET tool_scope='commercial' WHERE email=?").bind(email).run();
  const id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO commercial_projects(id,title,data_json,created_by,updated_by) VALUES(?,?,?,?,?)').bind(id,'Annonce à supprimer','{}',email,email).run();
  const p=await preview();expect(p.impact.projects).toContainEqual({id,name:'Annonce à supprimer',channel:'Annonces commerciales'});
  await env.DB.prepare('UPDATE commercial_projects SET revision=revision+1 WHERE id=?').bind(id).run();
  await expect(call('/confirm',{token:p.token,email,acknowledge:true})).rejects.toMatchObject({status:409});
  const {job}=await begin();await run(job.id);
  expect(await env.DB.prepare('SELECT id FROM commercial_projects WHERE id=?').bind(id).first()).toBeNull();
  expect((await env.DB.prepare('SELECT * FROM commercial_revisions WHERE project_id=?').bind(id).all()).results).toEqual([]);
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
it('un transfert actif empêche de commencer, puis seule l’adresse supprimée reste bloquée pendant le nettoyage',async()=>{
  const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by,operation_until) VALUES(?,?,'x','image/png',10,'uploading',?,?)").bind(id,'uploads/'+id,email,Date.now()+60000).run();
  const p=await preview();await expect(call('/confirm',{token:p.token,email,acknowledge:true})).rejects.toMatchObject({status:409});
  await env.DB.prepare('UPDATE media SET operation_until=0 WHERE id=?').bind(id).run();await begin();
  expect(await project(other.email)).toEqual(expect.any(String));
  await expect(env.DB.prepare('INSERT INTO members(email,name,role,updated_by) VALUES(?,?,?,?)').bind(email,'Retour trop tôt','designer',admin.email).run()).rejects.toThrow('member_purge_busy');
  await expect(api(new Request(origin+'/api/graphics/members',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,name:'Retour',role:'designer',active:true})}),env,admin)).rejects.toMatchObject({status:409});
});
it('reprend après une erreur fournisseur sans annoncer un succès ni perdre son état',async()=>{
  const {job}=await begin();provider.remove.mockRejectedValueOnce(new Error('provider unavailable'));
  await expect(call('/continue',{id:job.id})).rejects.toThrow('provider unavailable');
  expect(await env.DB.prepare('SELECT identity_deleted,lease_token FROM member_purge_jobs').first()).toEqual({identity_deleted:0,lease_token:null});
  await run(job.id);expect(await env.DB.prepare('SELECT * FROM members WHERE email=?').bind(email).first()).toBeNull();
});
it('ne poursuit pas sur une identité remplacée entre bilan et confirmation',async()=>{
  const p=await preview();provider.lookup.mockResolvedValue('new-uid');await expect(call('/confirm',{token:p.token,email,acknowledge:true})).rejects.toMatchObject({status:409});expect(provider.remove).not.toHaveBeenCalled();
});
it('refuse une suppression pendant une invitation et autorise un nouveau bilan après son terme',async()=>{
  const key=await memberInvitationLockKey(email);
  await env.DB.prepare('INSERT INTO login_limits(key,count,expires_at) VALUES(?,1,?)').bind(key,Date.now()+120000).run();
  await expect(preview()).rejects.toMatchObject({status:409});
  expect(provider.lookup).not.toHaveBeenCalled();expect(provider.remove).not.toHaveBeenCalled();
  await env.DB.prepare('DELETE FROM login_limits WHERE key=?').bind(key).run();
  expect((await preview()).impact.email).toBe(email);
});
it('la garde atomique bloque une invitation commencée après la prélecture de suppression',async()=>{
  const p=await preview(),key=await memberInvitationLockKey(email);
  provider.lookup.mockImplementationOnce(async()=>{
    await env.DB.prepare('INSERT INTO login_limits(key,count,expires_at) VALUES(?,1,?)').bind(key,Date.now()+120000).run();
    return uid;
  });
  try{
    await expect(call('/confirm',{token:p.token,email,acknowledge:true})).rejects.toMatchObject({status:409});
    expect(await env.DB.prepare('SELECT id FROM member_purge_jobs').first()).toBeNull();
    expect(await env.DB.prepare('SELECT email FROM members WHERE email=?').bind(email).first()).toEqual({email});
    expect(provider.remove).not.toHaveBeenCalled();
  }finally{await env.DB.prepare('DELETE FROM login_limits WHERE key=?').bind(key).run();}
});
it('efface les fiches et préparations créées, anonymise les contributions aux autres',async()=>{
  const plan=crypto.randomUUID(),profile=crypto.randomUUID(),programme=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO planner_documents(id,kind,name,data_json,created_by,updated_by) VALUES(?,'plan','Journée','{}',?,?)").bind(plan,email,email).run();
  await env.DB.prepare("INSERT INTO preparation_profiles(id,kind,name,data_json,created_by,updated_by) VALUES(?,'programme','Fiche','{}',?,?)").bind(profile,email,email).run();
  await env.DB.prepare("INSERT INTO programmes(id,channel_id,name,identity,data_json,updated_by) VALUES(?,'benin-tv','Émission','emission','{}',?)").bind(programme,email).run();
  const otherPlan=crypto.randomUUID();await env.DB.prepare("INSERT INTO planner_documents(id,kind,name,data_json,created_by,updated_by) VALUES(?,'plan','Autre journée','{}',?,?)").bind(otherPlan,other.email,email).run();
  const {job}=await begin();await run(job.id);
  expect(await env.DB.prepare('SELECT id FROM planner_documents WHERE id=?').bind(plan).first()).toBeNull();expect(await env.DB.prepare('SELECT id FROM preparation_profiles WHERE id=?').bind(profile).first()).toBeNull();expect(await env.DB.prepare('SELECT id FROM programmes WHERE id=?').bind(programme).first()).toBeNull();
  expect(await env.DB.prepare('SELECT updated_by FROM planner_documents WHERE id=?').bind(otherPlan).first()).toEqual({updated_by:'deleted-contributor@system.invalid'});
  expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
it('préserve les attributions d’un collègue suspendu et couvre aussi les autres chaînes',async()=>{
  const plan=crypto.randomUUID(),second=crypto.randomUUID(),projectId=crypto.randomUUID(),t=broadcastTemplates[0];
  await env.DB.prepare("INSERT INTO planner_documents(id,kind,name,data_json,created_by,updated_by) VALUES(?,'plan','Journée collègue','{}',?,?)").bind(plan,other.email,other.email).run();
  await env.DB.prepare("INSERT INTO planner_assignments(plan_id,task_key,owner,updated_by) VALUES(?,'tache',?,?)").bind(plan,other.email,email).run();
  await env.DB.prepare('UPDATE members SET active=0 WHERE email=?').bind(other.email).run();
  await env.DB.prepare("INSERT INTO channels(id,name,name_key,accent,timezone,created_by) VALUES(?,'Chaîne test','chaine test','#E3C343','Africa/Porto-Novo',?)").bind(second,email).run();
  await env.DB.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by,channel_id) VALUES(?,?,?,?,?,?,?,?,?)').bind(projectId,'Autre chaîne',t.id,t.version,t.libraryVersion,JSON.stringify(templateDefaults(t)),email,email,second).run();
  const p=await preview();expect(p.impact.projects).toEqual([expect.objectContaining({id:projectId,channel:'Chaîne test'})]);expect(p.impact.assignments).toBe(0);
  const {job}=await (await call('/confirm',{token:p.token,email,acknowledge:true}))!.json() as {job:MemberDeletionJob};await run(job.id);
  expect(await env.DB.prepare('SELECT owner,updated_by FROM planner_assignments WHERE plan_id=?').bind(plan).first()).toEqual({owner:other.email,updated_by:'deleted-contributor@system.invalid'});
  expect(await env.DB.prepare('SELECT created_by FROM channels WHERE id=?').bind(second).first()).toEqual({created_by:'deleted-contributor@system.invalid'});
  expect(await env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first()).toBeNull();expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
it('un bilan expiré pendant le contrôle fournisseur ne peut plus être confirmé',async()=>{
  const p=await preview();provider.lookup.mockImplementationOnce(async()=>{await env.DB.prepare('UPDATE member_purge_previews SET expires_at=0 WHERE token=?').bind(p.token).run();return uid;});
  await expect(call('/confirm',{token:p.token,email,acknowledge:true})).rejects.toMatchObject({status:409});expect(await env.DB.prepare('SELECT email FROM members WHERE email=?').bind(email).first()).not.toBeNull();expect(provider.remove).not.toHaveBeenCalled();
});
it('la nouvelle identité apparue après l’effacement est protégée et empêche le faux succès',async()=>{
  const {job}=await begin();await call('/continue',{id:job.id});provider.lookup.mockResolvedValue('replacement-identity');
  await expect(call('/continue',{id:job.id})).rejects.toMatchObject({status:409});expect(provider.remove).toHaveBeenCalledTimes(1);expect(await env.DB.prepare('SELECT id FROM member_purge_jobs').first()).toEqual({id:job.id});
});
