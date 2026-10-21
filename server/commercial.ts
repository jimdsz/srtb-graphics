import {z} from 'zod';
import type {Member} from '../src/studio/domain';
import {localReference} from '../src/studio/local-reference';
import {COMMERCIAL_TEMPLATE_ID,DEFAULT_COMMERCIAL_DATA,normalizeCommercialData,validateCommercialData} from '../src/studio/commercial/model';
import {isCommercialExampleAsset} from '../src/studio/commercial/example-assets';
import type {CommercialData} from '../src/studio/commercial/model';
import {HttpError,json,readJson} from './http';
import {assertCommercialAccess} from './tool-access';
import {mediaRoutes} from './media';

interface CommercialRow {id:string;title:string;template_id:string;revision:number;data_json:string;created_by:string;updated_by:string;created_at:string;updated_at:string;archived:number}
const title=z.string().trim().min(1).max(120),revision=z.number().int().positive();
const createSchema=z.object({title,templateId:z.literal(COMMERCIAL_TEMPLATE_ID).optional(),data:z.unknown().optional()}).strict();
const saveSchema=z.object({title,revision,data:z.unknown()}).strict();
const rowJson=({data_json,...row}:CommercialRow)=>({...row,data:JSON.parse(data_json) as CommercialData});
const owns=(member:Member,owner:string)=>member.role==='admin'||owner.toLowerCase()===member.email.toLowerCase();

async function validatedData(db:D1Database,input:unknown,owner:string):Promise<CommercialData>{
  const errors=validateCommercialData(input,{draft:true});
  if(errors.length)throw new HttpError(422,errors.join(' '));
  const data=normalizeCommercialData(input);
  for(const key of ['voice','music','logo'] as const){
    const source=data[key];if(!source)continue;
    if(localReference(source.url)||isCommercialExampleAsset(source.url,key==='logo'?'image':'audio'))continue;
    const match=source.url.match(/^\/api\/commercial\/media\/([a-f0-9-]{36})\/content$/);
    if(!match)throw new HttpError(422,'Sélectionnez un fichier local vérifié ou un média de votre espace commercial.');
    const row=await db.prepare("SELECT mime_type FROM media WHERE id=? AND tool_scope='commercial' AND created_by=? COLLATE NOCASE AND status='ready'").bind(match[1],owner).first<{mime_type:string}>();
    if(!row||!row.mime_type.startsWith(key==='logo'?'image/':'audio/'))throw new HttpError(422,'Un fichier est absent, incomplet, appartient à un autre compte ou ne correspond pas au type demandé.');
  }
  return data;
}
async function find(db:D1Database,id:string,member:Member){
  const row=await db.prepare('SELECT * FROM commercial_projects WHERE id=?').bind(id).first<CommercialRow>();
  if(!row||!owns(member,row.created_by))throw new HttpError(404,'Annonce introuvable.');
  return row;
}
export async function commercialRoutes(request:Request,env:Env,member:Member):Promise<Response|null>{
  assertCommercialAccess(member);
  const url=new URL(request.url),path=url.pathname;
  if(path.startsWith('/api/media'))return mediaRoutes(request,env,member,'commercial');
  if(path==='/api/templates'&&request.method==='GET')return json([{id:COMMERCIAL_TEMPLATE_ID,name:'Communiqués',defaults:DEFAULT_COMMERCIAL_DATA}]);
  if(path==='/api/projects'){
    if(request.method==='GET'){
      const archived=url.searchParams.get('archived')==='1'?1:0,before=url.searchParams.get('before')??'9999',afterId=url.searchParams.get('afterId')??'';
      const rows=(await env.DB.prepare('SELECT * FROM commercial_projects WHERE archived=? AND (created_by=? COLLATE NOCASE OR ?=1) AND (updated_at<? OR (updated_at=? AND id>?)) ORDER BY updated_at DESC,id LIMIT 101').bind(archived,member.email,Number(member.role==='admin'),before,before,afterId).all<CommercialRow>()).results;
      const page=rows.slice(0,100),last=page.at(-1);
      return json({projects:page.map(rowJson),next:rows.length>100&&last?{before:last.updated_at,afterId:last.id}:null});
    }
    if(request.method==='POST'){
      const input=createSchema.parse(await readJson(request)),data=await validatedData(env.DB,input.data??DEFAULT_COMMERCIAL_DATA,member.email),id=crypto.randomUUID();
      await env.DB.prepare('INSERT INTO commercial_projects(id,title,template_id,data_json,created_by,updated_by) VALUES(?,?,?,?,?,?)').bind(id,input.title,COMMERCIAL_TEMPLATE_ID,JSON.stringify(data),member.email,member.email).run();
      return json(rowJson(await find(env.DB,id,member)),201);
    }
    throw new HttpError(405,'Action non disponible.');
  }
  const route=path.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/(archive|revisions))?$/);if(!route)return null;
  const [,id,action]=route,row=await find(env.DB,id,member);
  if(!action&&request.method==='GET')return json(rowJson(row));
  if(!action&&request.method==='DELETE'){
    const input=z.object({revision}).strict().parse(await readJson(request));
    // D1 batches are transactional. The revision predicate also gates history
    // and audit writes, so a stale delete cannot remove any newer revision.
    const removed=await env.DB.batch([
      env.DB.prepare("INSERT INTO activity(actor,action,target,detail) SELECT ?,'commercial.deleted',id,title FROM commercial_projects WHERE id=? AND revision=?").bind(member.email,id,input.revision),
      env.DB.prepare('DELETE FROM commercial_revisions WHERE project_id=? AND EXISTS(SELECT 1 FROM commercial_projects WHERE id=? AND revision=?)').bind(id,id,input.revision),
      env.DB.prepare('DELETE FROM commercial_projects WHERE id=? AND revision=?').bind(id,input.revision),
    ]);
    if(removed[2].meta.changes!==1)throw new HttpError(409,'Cette annonce a changé. Rechargez sa version avant de la supprimer.');
    return json({deleted:true});
  }
  if(!action&&request.method==='PUT'){
    if(row.archived)throw new HttpError(409,'Restaurez cette annonce avant de la modifier.');
    const input=saveSchema.parse(await readJson(request)),data=await validatedData(env.DB,input.data,row.created_by);
    const changed=await env.DB.prepare("UPDATE commercial_projects SET title=?,data_json=?,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=? AND archived=0 RETURNING *").bind(input.title,JSON.stringify(data),member.email,id,input.revision).first<CommercialRow>();
    if(!changed)throw new HttpError(409,'Cette annonce a changé. Rechargez sa version avant d’enregistrer.');
    return json(rowJson(changed));
  }
  if(action==='archive'&&request.method==='POST'){
    const input=z.object({revision,archived:z.boolean()}).strict().parse(await readJson(request));
    const changed=await env.DB.prepare("UPDATE commercial_projects SET archived=?,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=? RETURNING *").bind(Number(input.archived),member.email,id,input.revision).first<CommercialRow>();
    if(!changed)throw new HttpError(409,'Cette annonce a changé. Rechargez avant de modifier son archivage.');
    return json(rowJson(changed));
  }
  if(action==='revisions'&&request.method==='GET'){
    const rows=(await env.DB.prepare('SELECT revision,title,data_json,archived,actor,created_at FROM commercial_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 100').bind(id).all<{revision:number;title:string;data_json:string;archived:number;actor:string;created_at:string}>()).results;
    return json(rows.map(({data_json,...row})=>({...row,data:JSON.parse(data_json)})));
  }
  throw new HttpError(405,'Action non disponible.');
}
