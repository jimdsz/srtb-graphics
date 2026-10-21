import {z} from 'zod';
import type {Member} from '../src/studio/domain';
import type {DeletionItem,MemberDeletionImpact,MemberDeletionJob} from '../src/studio/member-deletion';
import {firebaseAccountAdmin} from './firebase-account-admin';
import {assertNoMemberInvitation,memberInvitationLockKey} from './member-invitation';
import {purgeUploadedMedia,verifyMediaPurgeAccess} from './storage';
import {HttpError,json,readJson} from './http';

const neutral='deleted-contributor@system.invalid';
const emailSchema=z.email().max(254).transform(v=>v.toLowerCase());
type Target={email:string;name:string;role:string;active:number;firebase_uid:string|null};
type Job={id:string;email:string;uid:string|null;impact_json:string;identity_deleted:number;lease_token:string|null;lease_until:number};
const changed=()=>new HttpError(409,'Des contenus ou des accès ont changé. Rechargez le bilan avant de confirmer la suppression.');
export const purgeBusy=()=>new HttpError(409,'Une suppression définitive reste à terminer dans Équipe & accès. Finalisez-la avant de réutiliser cette adresse ou de supprimer un autre membre.');
const ownedProjects="SELECT id FROM projects WHERE created_by=?";
const ownedPlans="SELECT id FROM planner_documents WHERE created_by=?";
const ownedProfiles="SELECT id FROM preparation_profiles WHERE created_by=?";
const ownedProgrammes="SELECT programme_id FROM programme_revisions WHERE revision=1 AND actor=?";
const ownedDecisions=`SELECT id FROM habit_decisions WHERE id IN (SELECT decision_id FROM habit_decision_revisions WHERE revision=1 AND actor=?) OR rule_id IN (${ownedPlans})`;
const affectedBatches=`SELECT id FROM derivation_batches WHERE created_by=? OR source_project_id IN (${ownedProjects}) OR instr(lower(voice_refs_json),?)>0`;
async function target(db:D1Database,email:string,actor:Member){
  if(email===actor.email.toLowerCase()||email===neutral)throw new HttpError(409,'Votre propre compte et les références système ne peuvent pas être supprimés.');
  await assertNoMemberInvitation(db,email);
  const row=await db.prepare('SELECT email,name,role,active,firebase_uid FROM members WHERE email=?').bind(email).first<Target>();
  if(!row)throw new HttpError(404,'Ce membre n’existe plus.');
  if(row.role==='admin'&&row.active&&(await db.prepare("SELECT COUNT(*) n FROM members WHERE role='admin' AND active=1").first<{n:number}>())!.n<=1)throw new HttpError(409,'Le dernier administrateur actif doit être conservé.');
  return row;
}
async function impact(db:D1Database,row:Target):Promise<MemberDeletionImpact>{
  const list=async(sql:string,...args:string[])=>{
    const rows=(await db.prepare(sql+' ORDER BY 3,2,1 LIMIT 2001').bind(...args).all<DeletionItem>()).results;
    if(rows.length>2000)throw new HttpError(409,'Ce compte dépasse la taille du bilan interactif. Une suppression accompagnée est nécessaire ; aucun contenu n’a été effacé.');return rows;
  };
  const select=(table:string,label='name')=>`SELECT x.id,x.${label} AS name,c.name AS channel FROM ${table} x JOIN channels c ON c.id=x.channel_id`;
  const email=row.email;
  const [projects,media,profiles,preparations,programmes]=await Promise.all([
    list(select('projects','title')+' WHERE x.created_by=?',email),list(select('media')+' WHERE x.created_by=?',email),
    list(select('preparation_profiles')+' WHERE x.created_by=?',email),list(select('planner_documents')+' WHERE x.created_by=?',email),
    list(select('programmes')+` WHERE x.id IN (${ownedProgrammes})`,email),
  ]);
  projects.push(...await list("SELECT id,title AS name,'Annonces commerciales' AS channel FROM commercial_projects WHERE created_by=?",email));
  const affected:DeletionItem[]=[];
  // Include current AND historic references: restoring a revision must not hide
  // the consequence of deleting a shared asset. Match UUIDs/URLs conservatively.
  for(const [table,label,history,fk] of [['projects','title','revisions','project_id'],['preparation_profiles','name','preparation_profile_revisions','profile_id'],['planner_documents','name','planner_revisions','document_id'],['programmes','name','programme_revisions','programme_id']]){
    const own=table==='programmes'?`x.id NOT IN (${ownedProgrammes})`:'x.created_by<>?';
    const found=await list(select(table,label)+` WHERE ${own} AND (EXISTS(SELECT 1 FROM ${history} r JOIN media m ON m.created_by=? AND instr(r.data_json,m.id)>0 WHERE r.${fk}=x.id) OR EXISTS(SELECT 1 FROM ${history} r JOIN preparation_profiles p ON p.created_by=? AND instr(r.data_json,p.id)>0 WHERE r.${fk}=x.id))`,email,email,email);
    affected.push(...found);
  }
  affected.push(...await list(select('projects','title')+` WHERE x.created_by<>? AND (x.id IN (SELECT project_id FROM project_derivations WHERE batch_id IN (${affectedBatches})) OR x.id IN (SELECT project_id FROM planner_personal_tasks WHERE plan_id IN (${ownedPlans})))`,email,email,email,email,email));
  const count=async(sql:string,...args:string[])=>(await db.prepare(sql).bind(...args).first<{n:number}>())!.n;
  return {email,name:row.name,projects,media,profiles,preparations,programmes,affected:[...new Map(affected.map(item=>[item.id,item])).values()],
    comments:await count(`SELECT COUNT(*) n FROM comments WHERE author=? OR project_id IN (${ownedProjects})`,email,email),assignments:await count(`SELECT COUNT(*) n FROM planner_assignments WHERE owner=? OR plan_id IN (${ownedPlans})`,email,email)};
}
async function status(db:D1Database):Promise<MemberDeletionJob|null>{
  const job=await db.prepare('SELECT * FROM member_purge_jobs WHERE slot=1').first<Job>();if(!job)return null;
  const n=(await db.prepare('SELECT COUNT(*) n FROM member_purge_objects WHERE job_id=?').bind(job.id).first<{n:number}>())!.n;
  return {id:job.id,email:job.email,mediaRemaining:n,identityDeleted:!!job.identity_deleted};
}
export async function assertNoMemberPurge(db:D1Database){if(await db.prepare('SELECT id FROM member_purge_jobs WHERE slot=1').first())throw purgeBusy();}

function eraseMetadata(db:D1Database,job:Pick<Job,'email'|'impact_json'>){
  const email=job.email,sql:D1PreparedStatement[]=[];
  const add=(query:string,...values:(string|number|null)[])=>sql.push(db.prepare(query).bind(...values));
  // Anonymous shared provenance has no credentials and is hidden from all
  // member pickers. Never attribute someone else's edit to the administrator.
  add("INSERT OR IGNORE INTO members(email,name,role,active,removed_at,updated_by) VALUES(?,'Contribution anonyme','designer',0,'system','system')",neutral);
  add('DELETE FROM channel_members WHERE email=?',neutral);
  add(`DELETE FROM project_derivations WHERE project_id IN (${ownedProjects}) OR batch_id IN (${affectedBatches})`,email,email,email,email);
  add(`DELETE FROM derivation_batches WHERE id IN (${affectedBatches})`,email,email,email);
  for(const table of ['planner_tasks','planner_personal_tasks'])add(`DELETE FROM ${table} WHERE actor=? OR project_id IN (${ownedProjects}) OR plan_id IN (${ownedPlans})`,email,email,email);
  add(`DELETE FROM planner_assignments WHERE owner=? OR plan_id IN (${ownedPlans})`,email,email);
  add(`DELETE FROM habit_observations WHERE actor=? OR plan_id IN (${ownedPlans})`,email,email);
  add(`DELETE FROM habit_decision_revisions WHERE decision_id IN (${ownedDecisions})`,email,email);
  add(`DELETE FROM habit_decisions WHERE id IN (${ownedDecisions})`,email,email);
  add(`DELETE FROM comments WHERE author=? OR project_id IN (${ownedProjects})`,email,email);
  add(`DELETE FROM revisions WHERE project_id IN (${ownedProjects})`,email);
  add('DELETE FROM projects WHERE created_by=?',email);
  add('DELETE FROM commercial_revisions WHERE project_id IN (SELECT id FROM commercial_projects WHERE created_by=?)',email);
  add('DELETE FROM commercial_projects WHERE created_by=?',email);
  add(`DELETE FROM preparation_profile_revisions WHERE profile_id IN (${ownedProfiles})`,email);
  add('DELETE FROM preparation_profiles WHERE created_by=?',email);
  add(`DELETE FROM planner_revisions WHERE document_id IN (${ownedPlans})`,email);
  add('DELETE FROM planner_documents WHERE created_by=?',email);
  // Programme creator is preserved in revision one; delete parent AFTER child.
  add(`DELETE FROM programme_revisions WHERE programme_id IN (SELECT value FROM json_each(?))`,JSON.stringify((JSON.parse(job.impact_json) as MemberDeletionImpact).programmes.map(p=>p.id)));
  add('DELETE FROM programmes WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify((JSON.parse(job.impact_json) as MemberDeletionImpact).programmes.map(p=>p.id)));
  // Metadata of surviving, independently owned productions loses the identity,
  // not their authors' work. Revision triggers require an explicit next revision.
  for(const table of ['projects','commercial_projects','planner_documents','programmes'])add(`UPDATE ${table} SET updated_by=?,revision=revision+1 WHERE updated_by=?`,neutral,email);
  add('UPDATE preparation_profiles SET updated_by=CASE WHEN updated_by=? THEN ? ELSE updated_by END,validated_by=CASE WHEN validated_by=? THEN ? ELSE validated_by END,revision=revision+1 WHERE updated_by=? OR validated_by=?',email,neutral,email,neutral,email,email);
  for(const table of ['revisions','commercial_revisions','preparation_profile_revisions','planner_revisions','programme_revisions','habit_decision_revisions'])add(`UPDATE ${table} SET actor=? WHERE actor=?`,neutral,email);
  add('UPDATE preparation_profile_revisions SET validated_by=? WHERE validated_by=?',neutral,email);
  add('UPDATE habit_decisions SET actor=?,revision=revision+1 WHERE actor=?',neutral,email);
  add('UPDATE channels SET created_by=? WHERE created_by=?',neutral,email);
  add('UPDATE planner_assignments SET updated_by=?,revision=revision+1 WHERE updated_by=?',neutral,email);
  add('UPDATE members SET updated_by=? WHERE updated_by=?',neutral,email);
  add('DELETE FROM app_sessions WHERE email=?',email);
  add('DELETE FROM media_parts WHERE media_id IN (SELECT id FROM media WHERE created_by=?)',email);
  add('DELETE FROM media WHERE created_by=?',email);
  add('DELETE FROM recovery_barriers WHERE email=?',email);
  add('DELETE FROM channel_members WHERE email=?',email);
  add('DELETE FROM members WHERE email=?',email);
  const owned=JSON.parse(job.impact_json) as MemberDeletionImpact;
  const ids=[...owned.projects,...owned.media,...owned.profiles,...owned.preparations,...owned.programmes].map(v=>v.id);
  add('DELETE FROM activity WHERE actor=? OR target=? OR instr(lower(detail),?)>0 OR target IN (SELECT value FROM json_each(?))',email,email,email,JSON.stringify(ids));
  add('DELETE FROM member_purge_previews WHERE email=? OR actor=?',email,email);
  return sql;
}

export async function memberDeletionRoutes(request:Request,env:Env,actor:Member):Promise<Response|null>{
  const path=new URL(request.url).pathname;if(!path.startsWith('/api/members/deletion'))return null;
  if(actor.role!=='admin')throw new HttpError(403,'Suppression définitive réservée aux administrateurs.');
  if(request.method==='GET'&&path==='/api/members/deletion')return json({job:await status(env.DB),configured:!!env.FIREBASE_ACCOUNT_DELETER});
  if(request.method!=='POST')throw new HttpError(405,'Action non disponible.');
  if(path==='/api/members/deletion/preview'){
    await assertNoMemberPurge(env.DB);
    const {email}=z.object({email:emailSchema}).strict().parse(await readJson(request));
    // Arm the clock BEFORE reading any impact data. No preview means no extra
    // writes for ordinary production operations or for the preceding release.
    const token=crypto.randomUUID(),expiresAt=Date.now()+5*60000;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM member_purge_previews WHERE actor=? OR expires_at<?').bind(actor.email,Date.now()),
      env.DB.prepare("INSERT INTO member_purge_previews VALUES(?,?,?,0,NULL,'{}',?)").bind(token,actor.email,email,expiresAt),
    ]);
    try{
    const version=(await env.DB.prepare('SELECT version FROM member_purge_clock WHERE id=1').first<{version:number}>())!.version;
    const row=await target(env.DB,email,actor),admin=await firebaseAccountAdmin(env),uid=await admin.lookup(email);
    if(row.firebase_uid&&uid&&row.firebase_uid!==uid)throw changed();
    const report=await impact(env.DB,row);
    const serialized=JSON.stringify(report);
    if(new TextEncoder().encode(serialized).byteLength>900000)throw new HttpError(409,'Ce bilan est trop volumineux pour une suppression interactive. Aucun contenu n’a été effacé.');
    await verifyMediaPurgeAccess(env,(await env.DB.prepare('SELECT object_key FROM media WHERE created_by=?').bind(email).all<{object_key:string}>()).results.map(v=>v.object_key));
    if((await env.DB.prepare('SELECT version FROM member_purge_clock WHERE id=1').first<{version:number}>())!.version!==version)throw changed();
    const recorded=await env.DB.prepare('UPDATE member_purge_previews SET version=?,uid=?,impact_json=? WHERE token=? AND expires_at>? AND (SELECT version FROM member_purge_clock WHERE id=1)=?').bind(version,uid,serialized,token,Date.now(),version).run();
    if(!recorded.meta.changes)throw changed();
    return json({token,expiresAt,impact:report});
    }catch(error){await env.DB.prepare('DELETE FROM member_purge_previews WHERE token=?').bind(token).run();throw error;}
  }
  if(path==='/api/members/deletion/confirm'){
    const input=z.object({token:z.uuid(),email:emailSchema,acknowledge:z.literal(true)}).strict().parse(await readJson(request));
    const preview=await env.DB.prepare("SELECT * FROM member_purge_previews WHERE token=? AND actor=? AND email=? AND expires_at>? AND impact_json<>'{}'").bind(input.token,actor.email,input.email,Date.now()).first<{email:string;version:number;uid:string|null;impact_json:string}>();
    if(!preview)throw changed();await target(env.DB,preview.email,actor);
    const admin=await firebaseAccountAdmin(env);if(await admin.lookup(preview.email)!==preview.uid)throw changed();
    await verifyMediaPurgeAccess(env,(await env.DB.prepare('SELECT object_key FROM media WHERE created_by=?').bind(preview.email).all<{object_key:string}>()).results.map(v=>v.object_key));
    const id=crypto.randomUUID(),guard=crypto.randomUUID(),invitationLock=await memberInvitationLockKey(preview.email);
    try{await env.DB.batch([
      env.DB.prepare('INSERT INTO member_purge_guards VALUES(?,(SELECT version=? AND NOT EXISTS(SELECT 1 FROM media WHERE operation_until>?) AND NOT EXISTS(SELECT 1 FROM member_purge_jobs) AND NOT EXISTS(SELECT 1 FROM login_limits WHERE key=? AND expires_at>?) AND EXISTS(SELECT 1 FROM members WHERE email=? AND role=\'admin\' AND active=1) AND EXISTS(SELECT 1 FROM member_purge_previews WHERE token=? AND expires_at>?) FROM member_purge_clock WHERE id=1))').bind(guard,preview.version,Date.now(),invitationLock,Date.now(),actor.email,input.token,Date.now()),
      env.DB.prepare("INSERT INTO member_purge_jobs(slot,id,email,uid,impact_json,created_at) VALUES(1,?,?,?,?,?)").bind(id,preview.email,preview.uid,preview.impact_json,Date.now()),
      env.DB.prepare('INSERT INTO member_purge_objects SELECT id,?,object_key,upload_id FROM media WHERE created_by=?').bind(id,preview.email),
      ...eraseMetadata(env.DB,preview),
      env.DB.prepare('DELETE FROM member_purge_previews WHERE token=?').bind(input.token),
      env.DB.prepare('DELETE FROM member_purge_guards WHERE id=?').bind(guard),
    ]);}catch(error){if(/last_admin|CHECK constraint|UNIQUE constraint/.test(String(error)))throw new HttpError(409,'Le bilan a changé, ou un transfert ou une invitation est en cours. Aucun effacement n’a démarré. Patientez puis actualisez le bilan.');throw error;}
    return json({job:await status(env.DB)},202);
  }
  if(path==='/api/members/deletion/continue'){
    const {id}=z.object({id:z.uuid()}).strict().parse(await readJson(request));
    const lease=crypto.randomUUID();
    const locked=await env.DB.prepare('UPDATE member_purge_jobs SET lease_token=?,lease_until=? WHERE id=? AND lease_until<?').bind(lease,Date.now()+180000,id,Date.now()).run();
    if(!locked.meta.changes){const running=await status(env.DB);if(!running)return json({job:null});throw new HttpError(409,'Une étape est déjà en cours. Patientez puis reprenez la suppression.');}
    try{
      const job=(await env.DB.prepare('SELECT * FROM member_purge_jobs WHERE id=?').bind(id).first<Job>())!;
      if(!job.identity_deleted){
        const admin=await firebaseAccountAdmin(env);if(job.uid)await admin.remove(job.uid,job.email);
        // A replacement account is never deleted automatically by e-mail.
        if(await admin.lookup(job.email))throw new HttpError(409,'Un compte de connexion est encore présent. Vérification administrateur nécessaire ; aucun succès n’est annoncé.');
        await env.DB.prepare('UPDATE member_purge_jobs SET identity_deleted=1 WHERE id=? AND lease_token=?').bind(id,lease).run();
        return json({job:await status(env.DB)});
      }
      const media=await env.DB.prepare('SELECT id,object_key,upload_id FROM member_purge_objects WHERE job_id=? ORDER BY id LIMIT 1').bind(job.id).first<{id:string;object_key:string;upload_id:string|null}>();
      if(media){
        if(await purgeUploadedMedia(env,media.object_key,media.upload_id))await env.DB.prepare('DELETE FROM member_purge_objects WHERE id=? AND job_id=? AND EXISTS(SELECT 1 FROM member_purge_jobs WHERE id=? AND lease_token=?)').bind(media.id,job.id,id,lease).run();
        return json({job:await status(env.DB)});
      }
      const admin=await firebaseAccountAdmin(env);if(await admin.lookup(job.email))throw new HttpError(409,'Une nouvelle identité utilise cette adresse. Elle n’a pas été supprimée. Vérification administrateur nécessaire avant de clôturer.');
      await env.DB.prepare('DELETE FROM member_purge_jobs WHERE id=? AND lease_token=?').bind(id,lease).run();
      return json({job:null,notice:'Compte et contenus supprimés définitivement de Graphics. Cette adresse peut recevoir un nouvel accès ; les anciennes sessions ne sont plus valides.'});
    }finally{await env.DB.prepare('UPDATE member_purge_jobs SET lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?').bind(id,lease).run();}
  }
  throw new HttpError(404,'Action non disponible.');
}
