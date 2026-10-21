import {z} from 'zod';
import {canApprove,getTemplate,validateProjectData} from '../src/studio/domain';
import type {Member} from '../src/studio/domain';
import {createPreparationSchema,updatePreparationSchema,programmeDataSchema,voiceDataSchema,profileIdSchema,preparationKinds,MAX_PROFILE_DATA_BYTES,MAX_PREPARATION_PROFILES} from '../src/studio/preparation-profile-model';
import type {PreparationProfile,PreparationProfileSummary,PreparationProfileRevision,PreparationData,PreparationKind} from '../src/studio/preparation-profile-model';
import {HttpError,json,readJson} from './http';
import {presetAssetUses,validateProfileAssets} from './preparation-profile-assets';
import type {ProfileAssetUse} from './preparation-profile-assets';
import {requestChannel} from './channel-access';

interface ProfileRow extends Omit<PreparationProfileSummary,'favorite'|'archived'> {favorite:number;archived:number;data_json:string}
interface RevisionRow extends Omit<PreparationProfileRevision,'favorite'|'archived'|'data'> {favorite:number;archived:number;data_json:string}
type TemplatePin=Pick<ProfileRow,'template_id'|'template_version'|'library_version'>;
const rowJson=({data_json,favorite,archived,...row}:ProfileRow)=>({...row,favorite:!!favorite,archived:!!archived,data:JSON.parse(data_json)}) as PreparationProfile;
const revisionJson=({data_json,favorite,archived,...row}:RevisionRow):PreparationProfileRevision=>({...row,favorite:!!favorite,archived:!!archived,data:JSON.parse(data_json)});
const summaryColumns='id,kind,name,template_id,template_version,library_version,favorite,archived,revision,created_by,updated_by,created_at,updated_at,validated_by,validated_at';
const listSchema=z.object({kind:z.enum(preparationKinds).optional(),archived:z.enum(['0','1']).default('0'),favorite:z.literal('1').optional(),limit:z.coerce.number().int().min(1).max(100).default(50),before:z.iso.datetime().optional(),afterId:profileIdSchema.optional()}).strict().refine(value=>!!value.before===!!value.afterId,'Le curseur de pagination est incomplet.');
const revisionPageSchema=z.object({before:z.coerce.number().int().positive().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict();
const voiceCatalogueSchema=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),before:z.iso.datetime().optional(),afterId:profileIdSchema.optional()}).strict().refine(value=>!!value.before===!!value.afterId,'Le curseur de pagination est incomplet.');
const revisionColumns='revision,name,data_json,favorite,archived,actor,created_at,validated_by,validated_at';
async function findProfile(db:D1Database,id:string){
  if(!profileIdSchema.safeParse(id).success)throw new HttpError(404,'Fiche introuvable.');
  const row=await db.prepare('SELECT * FROM preparation_profiles WHERE id=?').bind(id).first<ProfileRow>();
  if(!row)throw new HttpError(404,'Fiche introuvable.');return row;
}
async function validatedData(db:D1Database,kind:PreparationKind,input:unknown,pin:TemplatePin):Promise<string>{
  let data:PreparationData;const uses:ProfileAssetUse[]=[];
  if(kind==='preset'){
    const template=getTemplate(pin.template_id||'');
    if(template.version!==pin.template_version||template.libraryVersion!==pin.library_version)throw new HttpError(409,'La version originale du modèle doit rester disponible pour utiliser ce favori.');
    data=validateProjectData(template,input);uses.push(...presetAssetUses(template,data));
  }else if(kind==='voice'){
    data=voiceDataSchema.parse(input);uses.push({value:data.source,kind:'audio'});
  }else{
    data=programmeDataSchema.parse(input);
    if(data.logo)uses.push({value:data.logo,kind:'image'});
    if(data.voice){
      const voice=await db.prepare("SELECT r.data_json,r.validated_by FROM preparation_profiles p JOIN preparation_profile_revisions r ON r.profile_id=p.id WHERE p.id=? AND p.kind='voice' AND p.archived=0 AND r.revision=?").bind(data.voice.profileId,data.voice.revision).first<{data_json:string;validated_by:string|null}>();
      if(!voice?.validated_by)throw new HttpError(422,'Choisissez une version de voix off validée et non archivée.');
      const selected=voiceDataSchema.parse(JSON.parse(voice.data_json));uses.push({value:selected.source,kind:'audio'});
    }
  }
  const serialized=JSON.stringify(data);
  if(new TextEncoder().encode(serialized).byteLength>MAX_PROFILE_DATA_BYTES)throw new HttpError(413,'Une fiche accepte au maximum 64 Kio de réglages et références.');
  await validateProfileAssets(db,uses);return serialized;
}
export async function preparationProfileRoutes(request:Request,env:Env,member:Member):Promise<Response|null>{
  const url=new URL(request.url),path=url.pathname,channel=requestChannel(request);
  if(path!=='/api/preparation-profiles'&&!path.startsWith('/api/preparation-profiles/'))return null;
  if(member.active!==1||!['admin','designer','broadcaster'].includes(member.role))throw new HttpError(403,'Un compte actif de préparation est nécessaire.');
  if(path==='/api/preparation-profiles/voice-catalogue'){
    if(typeof __SRTB_DERIVATIONS__==='undefined'||!__SRTB_DERIVATIONS__)throw new HttpError(404,'Cette fonction n’existe pas.');
    if(request.method!=='GET')throw new HttpError(405,'Action non disponible.');
    const input=voiceCatalogueSchema.parse(Object.fromEntries(url.searchParams));
    const rows=await env.DB.prepare(`SELECT * FROM preparation_profiles WHERE channel_id=? AND kind='voice' AND archived=0
      AND validated_by IS NOT NULL AND validated_at IS NOT NULL AND json_extract(data_json,'$.humanValidated')=1
      AND (updated_at < ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at DESC,id LIMIT ?`)
      .bind(channel,input.before??'9999',input.before??'9999',input.afterId??'',input.limit+1).all<ProfileRow>();
    const page=rows.results.slice(0,input.limit),last=page.at(-1);
    return json({profiles:page.map(row=>({...rowJson(row),data:voiceDataSchema.parse(JSON.parse(row.data_json))})),next:rows.results.length>input.limit&&last?{before:last.updated_at,afterId:last.id}:null});
  }
  if(path==='/api/preparation-profiles'){
    if(request.method==='GET'){
      const input=listSchema.parse(Object.fromEntries(url.searchParams)),clauses=['channel_id=?','archived=?'],values:(string|number)[]=[channel,Number(input.archived)];
      if(input.kind){clauses.push('kind=?');values.push(input.kind);}
      if(input.favorite){clauses.push('favorite=1');}
      if(input.before){clauses.push('(updated_at < ? OR (updated_at = ? AND id > ?))');values.push(input.before,input.before,input.afterId!);}
      const rows=await env.DB.prepare(`SELECT ${summaryColumns} FROM preparation_profiles WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC,id LIMIT ?`).bind(...values,input.limit+1).all<Omit<ProfileRow,'data_json'>>();
      const page=rows.results.slice(0,input.limit),last=page.at(-1);
      return json({profiles:page.map(({favorite,archived,...row})=>({...row,favorite:!!favorite,archived:!!archived})),next:rows.results.length>input.limit&&last?{before:last.updated_at,afterId:last.id}:null});
    }
    if(request.method==='POST'){
      const input=createPreparationSchema.parse(await readJson(request)),pin:TemplatePin=input.kind==='preset'?{template_id:input.templateId,template_version:input.templateVersion,library_version:input.libraryVersion}:{template_id:null,template_version:null,library_version:null};
      if(input.kind==='preset'&&channel!=='benin-tv')throw new HttpError(422,'Aucun modèle approuvé dans cette chaîne.');
      const data=await validatedData(env.DB,input.kind,input.data,pin),id=crypto.randomUUID(),reviewed=input.kind==='voice';
      const row=await env.DB.prepare('INSERT INTO preparation_profiles(id,kind,name,template_id,template_version,library_version,data_json,favorite,created_by,updated_by,validated_by,validated_at,channel_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM preparation_profiles) < ? RETURNING *')
        .bind(id,input.kind,input.name,pin.template_id,pin.template_version,pin.library_version,data,input.favorite?1:0,member.email,member.email,reviewed?member.email:null,reviewed?new Date().toISOString():null,channel,MAX_PREPARATION_PROFILES).first<ProfileRow>();
      if(!row)throw new HttpError(409,`Le catalogue contient déjà ${MAX_PREPARATION_PROFILES} fiches, archives comprises. Contactez l’administrateur.`);
      return json(rowJson(row),201);
    }
    throw new HttpError(405,'Action non disponible.');
  }
  const route=path.match(/^\/api\/preparation-profiles\/([^/]+)(?:\/(archive|favorite|revisions)(?:\/(\d+))?)?$/);
  if(!route)return null;
  const [,id,action,requestedRevision]=route,row=await findProfile(env.DB,id);
  if(requestedRevision&&action!=='revisions')throw new HttpError(404,'Cette fonction n’existe pas.');
  if(!action&&request.method==='GET')return json(rowJson(row));
  if(!action&&request.method==='PUT'){
    if(row.archived)throw new HttpError(409,'Restaurez la fiche avant modification.');
    const input=updatePreparationSchema.parse(await readJson(request));
    if(input.revision!==row.revision)throw new HttpError(409,'Un collègue a modifié cette fiche. Rechargez sa version.');
    const data=await validatedData(env.DB,row.kind,input.data,row),reviewed=row.kind==='voice';
    const changed=await env.DB.prepare("UPDATE preparation_profiles SET name=?,data_json=?,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),validated_by=?,validated_at=? WHERE id=? AND revision=? AND archived=0 RETURNING *")
      .bind(input.name,data,member.email,reviewed?member.email:null,reviewed?new Date().toISOString():null,id,input.revision).first<ProfileRow>();
    if(!changed)throw new HttpError(409,'Un collègue a modifié cette fiche. Rechargez sa version.');
    return json(rowJson(changed));
  }
  if(action==='archive'&&request.method==='POST'){
    const input=z.object({revision:z.number().int().positive(),archived:z.boolean()}).strict().parse(await readJson(request));
    if(row.created_by!==member.email&&!canApprove(member.role))throw new HttpError(403,'Archivage et restauration réservés à l’auteur ou au diffuseur.');
    const changed=await env.DB.prepare("UPDATE preparation_profiles SET archived=?,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=? RETURNING *").bind(input.archived?1:0,member.email,id,input.revision).first<ProfileRow>();
    if(!changed)throw new HttpError(409,'La fiche a changé. Rechargez avant de continuer.');return json(rowJson(changed));
  }
  if(action==='favorite'&&request.method==='POST'){
    const input=z.object({revision:z.number().int().positive(),favorite:z.boolean()}).strict().parse(await readJson(request));
    const changed=await env.DB.prepare("UPDATE preparation_profiles SET favorite=?,revision=revision+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=? AND archived=0 RETURNING *").bind(input.favorite?1:0,member.email,id,input.revision).first<ProfileRow>();
    if(!changed)throw new HttpError(409,'La fiche a changé ou est archivée. Rechargez avant de continuer.');return json(rowJson(changed));
  }
  if(action==='revisions'&&request.method==='GET'){
    if(requestedRevision){
      const revision=z.coerce.number().int().positive().safeParse(requestedRevision);
      if(!revision.success)throw new HttpError(404,'Révision introuvable.');
      const item=await env.DB.prepare(`SELECT ${revisionColumns} FROM preparation_profile_revisions WHERE profile_id=? AND revision=?`).bind(id,revision.data).first<RevisionRow>();
      if(!item)throw new HttpError(404,'Révision introuvable.');return json(revisionJson(item));
    }
    const input=revisionPageSchema.parse(Object.fromEntries(url.searchParams));
    const rows=await env.DB.prepare(`SELECT ${revisionColumns} FROM preparation_profile_revisions WHERE profile_id=? AND revision<? ORDER BY revision DESC LIMIT ?`).bind(id,input.before??Number.MAX_SAFE_INTEGER,input.limit+1).all<RevisionRow>();
    const page=rows.results.slice(0,input.limit),last=page.at(-1);
    return json({revisions:page.map(revisionJson),next:rows.results.length>input.limit&&last?last.revision:null});
  }
  throw new HttpError(405,'Action non disponible.');
}
