import {z} from 'zod';
import type {Member} from '../src/studio/domain';
import {canApprove} from '../src/studio/domain';
import {programmeSchema,programmeKey} from '../src/studio/channel-model';
import {channelNameKey} from '../src/studio/channel-presets';
import {authorizeChannel,requestChannel} from './channel-access';
import {projectAccessSql} from './project-access';
import {HttpError,json,readJson} from './http';
const channelSchema=z.object({name:z.string().trim().min(1).max(120),logo:z.string().max(500).default(''),accent:z.string().regex(/^#[a-fA-F0-9]{6}$/),timezone:z.string().max(80).refine(v=>{try{new Intl.DateTimeFormat('fr',{timeZone:v});return true;}catch{return false;}})}).strict();
const programmeJson=({data_json,...row}:{data_json:string;[key:string]:unknown})=>({...row,data:JSON.parse(data_json)});
async function uniqueChannelName(db:D1Database,name:string,exceptId=''){
 const key=channelNameKey(name);
 const existing=await db.prepare('SELECT id,name FROM channels').all<{id:string;name:string}>();
 if(existing.results.some(row=>row.id!==exceptId&&channelNameKey(row.name)===key))throw new HttpError(409,'Une chaîne porte déjà ce nom. Choisissez-la dans le sélecteur de chaîne.');
 return key;
}
async function nameConflict(db:D1Database,key:string,exceptId='',cause?:unknown):Promise<never>{
 if(await db.prepare('SELECT id FROM channels WHERE name_key=? AND id<>?').bind(key,exceptId).first())throw new HttpError(409,'Une chaîne porte déjà ce nom. Actualisez le sélecteur de chaîne.');
 throw cause;
}
async function verifyLogo(db:D1Database,channel:string,logo:string|undefined){
 if(!logo)return;
 const match=logo.match(/^\/api\/graphics\/media\/([a-f0-9-]{36})\/content$/);
 if(!match||!await db.prepare("SELECT 1 FROM media WHERE id=? AND channel_id=? AND tool_scope='graphics' AND status='ready' AND mime_type LIKE 'image/%'").bind(match[1],channel).first())throw new HttpError(422,'Choisissez une image partagée et disponible dans cette chaîne.');
}
export async function channelRoutes(request:Request,env:Env,member:Member):Promise<Response|null>{
 const url=new URL(request.url),path=url.pathname;
 if(member.active!==1)throw new HttpError(403,'Compte inactif.');
 if(path==='/api/channels'){
  if(request.method==='GET'){
   const rows=await env.DB.prepare('SELECT c.* FROM channels c WHERE c.archived=0 AND (?=1 OR EXISTS(SELECT 1 FROM channel_members cm WHERE cm.channel_id=c.id AND cm.email=?)) ORDER BY c.name').bind(Number(member.role==='admin'),member.email).all();
   return json(rows.results.map(row=>({...row,canManage:member.role==='admin'})));
  }
  if(request.method==='POST'){
   if(member.role!=='admin')throw new HttpError(403,'Création de chaîne réservée à l’administration.');
   const input=channelSchema.parse(await readJson(request)),id=crypto.randomUUID();
   if(input.logo&&!/^\/api\/graphics\/media\/[a-f0-9-]{36}\/content$/.test(input.logo))throw new HttpError(422,'Utilisez un logo partagé de la chaîne après sa création.');
   if(input.logo)throw new HttpError(422,'Ajoutez le logo après avoir créé la chaîne.');
   const key=await uniqueChannelName(env.DB,input.name);
   try{await env.DB.batch([env.DB.prepare('INSERT INTO channels(id,name,logo,accent,timezone,created_by,name_key) VALUES(?,?,?,?,?,?,?)').bind(id,input.name,input.logo,input.accent,input.timezone,member.email,key),env.DB.prepare('INSERT INTO channel_members(channel_id,email) VALUES(?,?)').bind(id,member.email)]);}
   catch(cause){return nameConflict(env.DB,key,'',cause);}
   return json(await env.DB.prepare('SELECT * FROM channels WHERE id=?').bind(id).first(),201);
  }
 }
 const identity=path.match(/^\/api\/channels\/([a-z0-9-]{1,64})$/);
 if(identity){
  if(request.method!=='PUT')throw new HttpError(405,'Action non disponible.');
  if(member.role!=='admin')throw new HttpError(403,'L’identité de chaîne est réservée à l’administration.');
  const channel=await authorizeChannel(env.DB,member,identity[1]);
  const input=z.object({revision:z.number().int().positive(),data:channelSchema}).strict().parse(await readJson(request,8192));
  await verifyLogo(env.DB,channel,input.data.logo);
  const key=await uniqueChannelName(env.DB,input.data.name,channel);
  let saved;
  try{saved=await env.DB.prepare('UPDATE channels SET name=?,logo=?,accent=?,timezone=?,name_key=?,revision=revision+1 WHERE id=? AND revision=? AND archived=0 RETURNING *').bind(input.data.name,input.data.logo,input.data.accent,input.data.timezone,key,channel,input.revision).first();}
  catch(cause){return nameConflict(env.DB,key,channel,cause);}
  if(!saved)throw new HttpError(409,'Cette identité de chaîne a changé. Actualisez avant de la modifier.');
  await env.DB.prepare("INSERT INTO activity(actor,action,target,detail) VALUES(?,'channel.identity',?,?)").bind(member.email,channel,'Identité actualisée / r'+saved.revision).run();
  return json({...saved,canManage:true});
 }
 const team=path.match(/^\/api\/channels\/([a-z0-9-]{1,64})\/members$/);
 if(team){
  if(member.role!=='admin')throw new HttpError(403,'Gestion des équipes réservée à l’administration.');
  await authorizeChannel(env.DB,member,team[1]);
  if(request.method==='GET')return json((await env.DB.prepare("SELECT m.email,m.name,m.role,m.active FROM members m JOIN channel_members cm ON cm.email=m.email WHERE cm.channel_id=? AND m.tool_scope='graphics' AND m.removed_at IS NULL ORDER BY m.name").bind(team[1]).all()).results);
  if(request.method==='POST'){
   const input=z.object({email:z.email().transform(s=>s.toLowerCase()),allowed:z.boolean()}).strict().parse(await readJson(request));
   if(!await env.DB.prepare("SELECT email FROM members WHERE email=? AND tool_scope='graphics' AND removed_at IS NULL").bind(input.email).first())throw new HttpError(404,'Membre Graphics introuvable. Les comptes commerciaux restent dans Annonces.');
   await env.DB.batch([input.allowed?env.DB.prepare('INSERT OR IGNORE INTO channel_members(channel_id,email) VALUES(?,?)').bind(team[1],input.email):env.DB.prepare('DELETE FROM channel_members WHERE channel_id=? AND email=?').bind(team[1],input.email),env.DB.prepare("INSERT INTO activity(actor,action,target,detail) VALUES(?,'channel.membership',?,?)").bind(member.email,team[1],`${input.email}: ${input.allowed?'autorisé':'retiré'}`)]);
   return json({ok:true});
  }
 }
 if(path==='/api/search'&&request.method==='GET'){
  const channel=await authorizeChannel(env.DB,member,requestChannel(request)),q=z.string().trim().min(2).max(120).parse(url.searchParams.get('q'));
  const needle=`%${q.replace(/[\\%_]/g,'\\$&')}%`,access=projectAccessSql(member);
  const [projects,programmes,media]=await env.DB.batch([
   env.DB.prepare(`SELECT * FROM projects WHERE channel_id=? AND archived=0 AND ${access.sql} AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 20`).bind(channel,...access.values,needle),
   env.DB.prepare("SELECT * FROM programmes WHERE channel_id=? AND archived=0 AND (name LIKE ? ESCAPE '\\' OR json_extract(data_json,'$.aliases') LIKE ? ESCAPE '\\') ORDER BY name LIMIT 20").bind(channel,needle,needle),
   env.DB.prepare("SELECT id,name,mime_type,bytes,status,created_by,created_at FROM media WHERE channel_id=? AND tool_scope='graphics' AND status='ready' AND name LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 20").bind(channel,needle),
  ]);
  return json({projects:projects.results.map(r=>programmeJson(r as {data_json:string})),programmes:programmes.results.map(r=>programmeJson(r as {data_json:string})),media:media.results});
 }
 const route=path.match(/^\/api\/programmes(?:\/([a-f0-9-]{36}))?$/);
 if(!route)return null;
 const channel=await authorizeChannel(env.DB,member,requestChannel(request)),id=route[1];
 if(!id&&request.method==='GET'){
  // Preserve the array response for older open clients. New review workflows
  // explicitly request bounded pages; UUID ordering survives a title rename.
  if(url.searchParams.has('page')||url.searchParams.has('after')){
   if(url.searchParams.getAll('page').length!==1||url.searchParams.get('page')!=='1'||url.searchParams.getAll('after').length>1)throw new HttpError(400,'La page demandée n’est pas valide. Recommencez la lecture des fiches.');
   const after=url.searchParams.get('after');
   if(after!==null&&!z.uuid().safeParse(after).success)throw new HttpError(400,'Le repère de page n’est pas valide. Recommencez la lecture des fiches.');
   // A cursor is not a grant of access, and may not be reused in another chain.
   // Archived anchors remain valid so removal does not duplicate earlier rows.
   if(after&&!await env.DB.prepare('SELECT 1 FROM programmes WHERE id=? AND channel_id=?').bind(after,channel).first())throw new HttpError(409,'Les fiches ont changé. Recommencez la lecture dans cette chaîne.');
   const rows=(after?await env.DB.prepare('SELECT * FROM programmes WHERE channel_id=? AND archived=0 AND id>? ORDER BY id LIMIT 101').bind(channel,after).all<{id:string;data_json:string}>():await env.DB.prepare('SELECT * FROM programmes WHERE channel_id=? AND archived=0 ORDER BY id LIMIT 101').bind(channel).all<{id:string;data_json:string}>()).results;
   const page=rows.slice(0,100);
   return json({programmes:page.map(programmeJson),next:rows.length>100?page[page.length-1].id:null});
  }
  return json((await env.DB.prepare('SELECT * FROM programmes WHERE channel_id=? AND archived=0 ORDER BY name,id LIMIT 1000').bind(channel).all<{data_json:string}>()).results.map(programmeJson));
 }
 if(id&&request.method==='GET'){
  const programme=await env.DB.prepare('SELECT * FROM programmes WHERE id=? AND channel_id=? AND archived=0').bind(id,channel).first<{data_json:string}>();
  if(!programme)throw new HttpError(404,'Émission introuvable dans cette chaîne.');
  return json(programmeJson(programme));
 }
 if((!id&&request.method==='POST')||(id&&request.method==='PUT')){
  const input=z.object({revision:z.number().int().nonnegative(),data:programmeSchema}).strict().parse(await readJson(request,32768));
  // A programme recipe affects future preparations for the whole team. Metadata
  // remains editable by designers, but changing shared automation needs approval.
  if(!canApprove(member.role)){
   const current=id?await env.DB.prepare('SELECT data_json FROM programmes WHERE id=? AND channel_id=? AND archived=0').bind(id,channel).first<{data_json:string}>():null;
   if(id&&!current)throw new HttpError(404,'Émission introuvable.');
   const previous=current?programmeSchema.parse(JSON.parse(current.data_json)):null;
   if(input.data.recurring!==(previous?.recurring??false)||JSON.stringify([...input.data.recipe].sort())!==JSON.stringify([...(previous?.recipe??[])].sort()))throw new HttpError(403,'La recette partagée doit être approuvée par un administrateur ou un diffuseur.');
  }
  await verifyLogo(env.DB,channel,input.data.logo);
  if(!id&&input.revision!==0)throw new HttpError(409,'Une nouvelle émission ne doit pas reprendre la révision d’une autre fiche.');
  if(input.data.voiceProfileId&&!await env.DB.prepare("SELECT 1 FROM preparation_profiles WHERE id=? AND channel_id=? AND kind='voice' AND archived=0").bind(input.data.voiceProfileId,channel).first())throw new HttpError(422,'Choisissez une voix disponible dans cette chaîne.');
  if(input.data.directoryIds.length){
   const directories=await env.DB.prepare("SELECT id FROM planner_documents WHERE channel_id=? AND kind='directory' AND archived=0 AND id IN (SELECT value FROM json_each(?))").bind(channel,JSON.stringify(input.data.directoryIds)).all<{id:string}>();
   if(directories.results.length!==new Set(input.data.directoryIds).size)throw new HttpError(422,'Choisissez des emplacements disponibles dans cette chaîne.');
  }
  if(input.data.recipe.length&&channel!=='benin-tv')throw new HttpError(422,'Cette chaîne ne dispose pas encore de modèles approuvés.');
  const key=programmeKey(input.data);if(!key)throw new HttpError(422,'Renseignez le titre officiel.');
  const programmeId=id||crypto.randomUUID(),data=JSON.stringify(input.data);
  const saved=id?await env.DB.prepare("UPDATE programmes SET name=?,identity=?,data_json=?,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND channel_id=? AND revision=? AND archived=0 AND NOT EXISTS(SELECT 1 FROM programmes p WHERE p.channel_id=? AND p.identity=? AND p.id<>?) RETURNING *").bind(input.data.name,key,data,member.email,id,channel,input.revision,channel,key,id).first<{data_json:string}>():await env.DB.prepare('INSERT INTO programmes(id,channel_id,name,identity,data_json,updated_by) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM programmes WHERE channel_id=? AND identity=?) RETURNING *').bind(programmeId,channel,input.data.name,key,data,member.email,channel,key).first<{data_json:string}>();
  if(!saved)throw new HttpError(409,'Cette émission existe déjà ou sa fiche a changé. Actualisez avant de continuer.');
  return json(programmeJson(saved),id?200:201);
 }
 throw new HttpError(405,'Action non disponible.');
}
