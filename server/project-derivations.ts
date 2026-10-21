import {z} from 'zod';
import inventory from '../reports/library-intake.json';
import {getTemplate,ParameterError,validateProjectData} from '../src/studio/domain';
import type {BroadcastTemplate,Member,Project,ProjectData} from '../src/studio/domain';
import {derivationRequestSchema,deriveProjects,DERIVATION_MAPPING_VERSION,MAX_DERIVATION_CHILDREN,normalizeAnnouncement,recipeSourceIds,canDerive} from '../src/studio/derivation-model';
import type {DerivedProject} from '../src/studio/derivation-model';
import {voiceDataSchema} from '../src/studio/preparation-profile-model';
import {baVoicePlacement} from '../src/studio/ba-voice-placement';
import type {DerivationBatch,DerivationBatchSummary,DerivationPage} from '../src/studio/derivation-types';
import {selectedMediaData} from '../src/studio/media-selection';
import {localReference,mediaExtensions} from '../src/studio/local-reference';
import {findProject} from './projects';
import {HttpError,json,readJson} from './http';
import {readyMedia} from './ready-media';
import {sharedMediaReferences} from './media-references';
import {presetAssetUses} from './preparation-profile-assets';
import {canonicalJson,getValidatedProjectOrigin,libraryReferences,snapshotHash} from './derivation-origin';
import {requireDerivationClient} from './derivation-client';

const idSchema=z.uuid();
const pageSchema=z.object({limit:z.coerce.number().int().min(1).max(50).default(20),before:z.iso.datetime().optional(),id:idSchema.optional()}).strict().refine(value=>!!value.before===!!value.id,'Curseur incomplet.');
const assetKeys=new Set(inventory.assets.map(asset=>asset.key));
const extensionMime:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',mpeg:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg'};
interface BatchRow {
  id:string;request_hash:string;name:string;source_project_id:string;source_revision:number;source_template_id:string;source_template_version:string;
  source_library_version:string;source_snapshot_json:string;source_snapshot_sha256:string;mapping_version:string;target_count:number;created_by:string;created_at:string;
}
interface ChildRow extends Omit<Project,'data'> {data_json:string;target_key:string;label:string;warnings_json:string;announcement_json:string|null}
const summary=(row:BatchRow):DerivationBatchSummary=>({id:row.id,name:row.name,sourceProjectId:row.source_project_id,sourceRevision:row.source_revision,
  sourceTemplateId:row.source_template_id,sourceTemplateVersion:row.source_template_version,sourceLibraryVersion:row.source_library_version,
  mappingVersion:row.mapping_version,sourceSnapshotSha256:row.source_snapshot_sha256,createdBy:row.created_by,createdAt:row.created_at,childCount:row.target_count});
const summaryColumns='b.id,b.name,b.source_project_id,b.source_revision,b.source_template_id,b.source_template_version,b.source_library_version,b.source_snapshot_sha256,b.mapping_version,b.target_count,b.created_by,b.created_at';
async function detail(db:D1Database,row:BatchRow):Promise<DerivationBatch>{
  const children=await db.prepare('SELECT p.*,d.target_key,d.label,d.warnings_json,d.announcement_json FROM project_derivations d JOIN projects p ON p.id=d.project_id WHERE d.batch_id=? ORDER BY d.ordinal').bind(row.id).all<ChildRow>();
  return {...summary(row),sourceSnapshot:{...JSON.parse(row.source_snapshot_json),sha256:row.source_snapshot_sha256},children:children.results.map(({data_json,target_key,label,warnings_json,announcement_json,...project})=>({targetKey:target_key,label,initialRevision:1,warnings:JSON.parse(warnings_json),...(announcement_json?{announcement:JSON.parse(announcement_json)}:{}),project:{...project,data:JSON.parse(data_json)}}))};
}
async function receipt(db:D1Database,actor:string,requestId:string){
  return db.prepare('SELECT * FROM derivation_batches WHERE created_by=? AND request_id=?').bind(actor,requestId).first<BatchRow>();
}
function matchingReceipt(row:BatchRow,hash:string){if(row.request_hash!==hash)throw new HttpError(409,'Cette demande a déjà été utilisée avec d’autres réglages. Ouvrez son résultat ou préparez une nouvelle demande.');}
function boundedJson(value:unknown,message:string){const encoded=canonicalJson(value);if(new TextEncoder().encode(encoded).byteLength>128*1024)throw new HttpError(413,message);return encoded;}

interface VoiceRow {id:string;current_revision:number;revision:number;data_json:string;validated_by:string;validated_at:string}
/** One bounded query for all exact pins. No profile, identity or media cache. */
async function resolveAnnouncementVoices(db:D1Database,children:DerivedProject[]){
  const pins=new Map<string,{profileId:string;revision:number}>();
  for(const child of children){const voice=child.announcement?.voice;if(voice?.mode==='profile'&&voice.profileId&&voice.revision)pins.set(`${voice.profileId}:${voice.revision}`,{profileId:voice.profileId,revision:voice.revision});}
  if(!pins.size)return [];
  const values=[...pins.values()];
  const rows=await db.prepare(`SELECT p.id,p.revision current_revision,r.revision,r.data_json,r.validated_by,r.validated_at
    FROM preparation_profiles p JOIN preparation_profile_revisions r ON r.profile_id=p.id
    WHERE p.kind='voice' AND p.archived=0 AND r.archived=0 AND r.validated_by IS NOT NULL AND r.validated_at IS NOT NULL
    AND (${values.map(()=>'(p.id=? AND r.revision=?)').join(' OR ')})`).bind(...values.flatMap(pin=>[pin.profileId,pin.revision])).all<VoiceRow>();
  const available=new Map(rows.results.map(row=>[`${row.id}:${row.revision}`,row]));
  if(available.size!==pins.size)throw new HttpError(422,'Une voix épinglée manque, est archivée ou n’a pas de validation humaine. Choisissez explicitement une voix disponible.');
  for(const child of children){
    const announcement=child.announcement,selection=announcement?.voice;if(!announcement||selection?.mode!=='profile')continue;
    const row=available.get(`${selection.profileId}:${selection.revision}`)!;
    let parsed:ReturnType<typeof voiceDataSchema.safeParse>;
    try{parsed=voiceDataSchema.safeParse(JSON.parse(row.data_json));}catch{throw new HttpError(422,'Le passage vocal épinglé est invalide.');}
    if(!parsed.success)throw new HttpError(422,'Le passage vocal épinglé est invalide.');
    const voice=parsed.data,duration=voice.end-voice.start;
    if(voice.cue.kind!=='announcement'||normalizeAnnouncement(voice.cue.value)!==normalizeAnnouncement(announcement.day))throw new HttpError(422,`La voix choisie ne correspond pas à l’annonce « ${announcement.day} ».`);
    if(child.templateId==='BTV_BA_TDS'){
      const delay=Number(child.data._audio_voice_delay_seconds),volume=Number(child.data._audio_voice_volume);
      if(!Number.isFinite(delay)||delay<0||delay+duration>15.28)throw new HttpError(422,'La voix « Tout de suite » ne tient pas entièrement dans son animation dédiée. Réduisez le passage ou recalez son départ.');
      if(!Number.isFinite(volume)||volume<=0)throw new HttpError(422,'Le volume de la voix est nul. Réglez-le explicitement avant d’associer ce passage.');
      child.data={...child.data,_audio_voice_enabled:true,_audio_voice_url:voice.source,_audio_voice_start_seconds:voice.start,_audio_voice_end_seconds:voice.end,_audio_voice_delay_seconds:delay};
      announcement.voice={mode:'profile',status:'resolved',profileId:row.id,revision:row.revision,label:voice.label,validatedBy:row.validated_by,validatedAt:row.validated_at,source:voice.source,start:voice.start,end:voice.end,placement:'source'};
      child.warnings=child.warnings.filter(warning=>!warning.startsWith('Voix « Tout de suite » à préparer'));
      child.warnings.push('Voix « Tout de suite » épinglée et validée humainement. Le passage complet est calé une seule fois sur l’animation dédiée ; contrôlez-le à l’écoute avant export.');
      continue;
    }
    // Fit is a separate, explicit request choice and uses the same versioned
    // placement contract as the audio adapter. No source trim or speed change.
    const placement=selection.placement??'source';let slots:ReturnType<typeof baVoicePlacement>;
    try{slots=baVoicePlacement(duration,placement,{intro:Number(child.data._audio_voice_intro_offset_seconds),outro:Number(child.data._audio_voice_outro_offset_seconds)});}
    catch(error){throw new HttpError(422,error instanceof Error?error.message:'Placement vocal incompatible.');}
    if(Number(child.data._audio_voice_gain)<=0)throw new HttpError(422,'Le gain de la voix est nul. Réglez-le explicitement dans la BA source avant d’associer un passage.');
    child.data={...child.data,_audio_voice_enabled:true,_audio_voice_url:voice.source,_audio_voice_in_seconds:voice.start,_audio_voice_out_seconds:voice.end,
      _audio_voice_intro_offset_seconds:slots.intro,_audio_voice_outro_offset_seconds:slots.outro,_studio_ba_voice_fit:placement};
    announcement.voice={mode:'profile',status:'resolved',profileId:row.id,revision:row.revision,label:voice.label,validatedBy:row.validated_by,validatedAt:row.validated_at,source:voice.source,start:voice.start,end:voice.end,
      placement,introOffset:slots.intro,outroOffset:slots.outro};
    child.warnings=child.warnings.filter(warning=>!warning.startsWith('Voix à préparer :'));
    child.warnings.push('Voix épinglée et validée humainement. Contrôlez à l’écoute le passage complet et la durée réelle du fichier avant export.');
    if(placement==='fit-complete')child.warnings.push('Adaptation explicitement choisie : passage entier, départ vocal et atténuation du jingle ajustés. Aucun extrait coupé, accéléré ou déplacé dans le corps du programme.');
    if(placement==='manual')child.warnings.push('Calage personnalisé repris : départs de la BA source conservés, passage entier et baisse du jingle autour de la voix. Contrôlez le placement à l’écoute avant export.');
    if(child.data._media_intro_audio_enabled||child.data._media_pack_audio_enabled)child.warnings.push('Le son du média d’introduction ou du carton est actif dans les créneaux vocaux. Il reste inchangé : contrôlez le mélange à l’écoute.');
  }
  return rows.results.map(row=>({profileId:row.id,revision:row.revision,currentRevision:row.current_revision,dataJson:row.data_json,validatedBy:row.validated_by,validatedAt:row.validated_at}));
}

/** Same selected-media semantics as project saving, with exact library and MIME checks. No upload or source-file reads. */
async function validateAssets(db:D1Database,items:{template:BroadcastTemplate;data:ProjectData}[],source:BroadcastTemplate,sourceData:ProjectData){
  const references=[...new Set(items.flatMap(item=>sharedMediaReferences(item.template,item.data)))];
  const media=await readyMedia(db,references),available=new Map(media.map(asset=>[asset.id,asset]));
  if(media.length!==references.length)throw new HttpError(422,'Un média partagé manque ou son transfert n’est pas terminé.');
  const sourceUrls=libraryReferences(source.id,source.libraryVersion,sourceData),sourcePrefix=`/library/v${source.libraryVersion}/${source.id}/`;
  for(const {template,data}of items){
    for(const {value,kind}of presetAssetUses(template,selectedMediaData(template,data))){
      const url=typeof value==='string'?value:typeof value==='object'?value.url:'';
      if(!url)continue;
      let mime:string|undefined;
      if(localReference(url))mime=typeof value==='object'?value.mimeType:undefined;
      else{
        const match=/^\/api\/graphics\/media\/([a-f\d-]+)\/content$/.exec(url);
        if(match)mime=available.get(match[1])?.mime_type;
        else{
          const base=`/library/v${template.libraryVersion}/`,own=base+template.id+'/';let key:string;
          if(url.startsWith(own))key=decodeURIComponent(url.slice(base.length));
          else if(url.startsWith(sourcePrefix)&&sourceUrls.has(url))key=decodeURIComponent(url.slice(`/library/v${source.libraryVersion}/`.length));
          else if(/^(?:lib|sourceassets)\//.test(url))key=template.id+'/'+decodeURIComponent(url);
          else if(/^img_\d+\.(?:png|jpe?g|webp)$/.test(url))key=template.id+'/lib/images/'+url;
          else throw new HttpError(422,'Une ressource ne correspond pas à la bibliothèque de la source ou du modèle cible.');
          if(!assetKeys.has(key))throw new HttpError(422,'Une ressource de bibliothèque est absente.');
          mime=extensionMime[key.split('.').at(-1)?.toLowerCase()||''];
        }
      }
      if(!mime||(!Object.hasOwn(mediaExtensions,mime)&&mime!=='image/svg+xml')||(kind==='visual'?!/^(image|video)\//.test(mime):kind&&!mime.startsWith(kind+'/'))||typeof value==='object'&&value.mimeType!==mime)throw new HttpError(422,'Une source ne correspond pas au type de média attendu.');
    }
  }
  return media.map(asset=>({id:asset.id,mimeType:asset.mime_type}));
}

export async function projectDerivationRoutes(request:Request,env:Env,member:Member):Promise<Response|null>{
  const url=new URL(request.url),projectRoute=url.pathname.match(/^\/api\/projects\/([^/]+)\/(derivations|derivation-origin)$/),batchRoute=url.pathname.match(/^\/api\/derivations\/([^/]+)$/);
  if(!projectRoute&&!batchRoute)return null;
  if(member.active!==1||!['admin','designer','broadcaster'].includes(member.role))throw new HttpError(403,'Un compte actif est nécessaire pour préparer les déclinaisons.');
  const id=projectRoute?.[1]??batchRoute![1];if(!idSchema.safeParse(id).success)throw new HttpError(404,'Ensemble ou projet introuvable.');
  requireDerivationClient(request);
  if(batchRoute){
    if(request.method!=='GET')throw new HttpError(405,'Action non disponible.');
    const row=await env.DB.prepare('SELECT * FROM derivation_batches WHERE id=?').bind(id).first<BatchRow>();
    if(!row||row.created_by!==member.email&&!['admin','broadcaster'].includes(member.role))throw new HttpError(404,'Ensemble introuvable.');
    await findProject(env.DB,row.source_project_id,member,request);return json(await detail(env.DB,row));
  }
  // Check before origins, receipts, histories or source snapshots are exposed.
  await findProject(env.DB,id,member,request);
  if(projectRoute![2]==='derivation-origin'){
    if(request.method!=='GET')throw new HttpError(405,'Action non disponible.');
    const origin=await getValidatedProjectOrigin(env.DB,id);if(!origin)throw new HttpError(404,'Ce projet ne possède pas de provenance de déclinaison vérifiée.');return json(origin);
  }
  if(request.method==='GET'){
    const input=pageSchema.parse(Object.fromEntries(url.searchParams));
    const rows=await env.DB.prepare(`SELECT ${summaryColumns} FROM derivation_batches b WHERE
      (b.source_project_id=? OR EXISTS(SELECT 1 FROM project_derivations d WHERE d.batch_id=b.id AND d.project_id=?))
      AND (b.created_by=? OR ?=1) AND (b.created_at < ? OR (b.created_at = ? AND b.id > ?)) ORDER BY b.created_at DESC,b.id LIMIT ?`)
      .bind(id,id,member.email,Number(['admin','broadcaster'].includes(member.role)),input.before??'9999',input.before??'9999',input.id??'',input.limit+1).all<BatchRow>();
    const page=rows.results.slice(0,input.limit),last=page.at(-1);
    return json({batches:page.map(summary),next:rows.results.length>input.limit&&last?{before:last.created_at,id:last.id}:null} satisfies DerivationPage);
  }
  if(request.method!=='POST')throw new HttpError(405,'Action non disponible.');
  const raw=await readJson(request);
  // Do this before record parsing can normalize an own __proto__ property away.
  if(raw&&typeof raw==='object'&&'sourceData'in raw&&raw.sourceData&&typeof raw.sourceData==='object'){
    for(const key of Object.keys(raw.sourceData))if(!recipeSourceIds.some(id=>Object.hasOwn(getTemplate(id).fields,key)))throw new ParameterError(`Champ inconnu : ${key}`);
  }
  const input=derivationRequestSchema.parse(raw),{requestId,...intent}=input;
  const requestHash=await snapshotHash(canonicalJson({sourceProjectId:id,...intent}));
  const previous=await receipt(env.DB,member.email,requestId);
  if(previous){matchingReceipt(previous,requestHash);return json(await detail(env.DB,previous));}
  const source=await findProject(env.DB,id,member,request),template=getTemplate(source.template_id);
  if(source.archived||source.revision!==input.sourceRevision)throw new HttpError(409,'La BA source a changé ou a été archivée. Rechargez sa révision avant de créer les déclinaisons.');
  if(!canDerive(template.id)||template.version!==source.template_version||template.libraryVersion!==source.library_version)throw new HttpError(409,'La recette de cette version du modèle doit rester disponible.');
  const data=validateProjectData(template,input.sourceData);
  const snapshotJson=boundedJson({title:input.sourceTitle,data},'Les réglages source dépassent 128 Kio.'),sourceHash=await snapshotHash(snapshotJson);
  const derived=deriveProjects({templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,title:input.sourceTitle,data},input.targets,input.replayUrl,input.announcements);
  const expected=input.targets.length+(input.announcements??[]).reduce((sum,item)=>sum+item.formats.length,0);
  if(derived.length!==expected||derived.length<1||derived.length>MAX_DERIVATION_CHILDREN||new Set(derived.map(item=>item.targetKey)).size!==derived.length)throw new HttpError(422,'La liste des déclinaisons est invalide.');
  const voices=await resolveAnnouncementVoices(env.DB,derived);
  const children=derived.map(item=>{
    const target=getTemplate(item.templateId);
    if(target.version!==item.templateVersion||target.libraryVersion!==item.libraryVersion)throw new HttpError(409,'Un modèle cible a changé. Reprenez la préparation.');
    return {...item,id:crypto.randomUUID(),template:target,data:validateProjectData(target,item.data)};
  });
  const media=await validateAssets(env.DB,[{template,data},...children.map(child=>({template:child.template,data:child.data}))],template,data);
  const batchId=crypto.randomUUID();
  const statements=[env.DB.prepare(`INSERT INTO derivation_batches(id,request_id,request_hash,name,source_project_id,source_revision,source_template_id,source_template_version,source_library_version,source_snapshot_json,source_snapshot_sha256,mapping_version,media_refs_json,voice_refs_json,target_count,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(batchId,requestId,requestHash,input.name,id,input.sourceRevision,template.id,template.version,template.libraryVersion,snapshotJson,sourceHash,DERIVATION_MAPPING_VERSION,boundedJson(media,'Trop de références partagées.'),boundedJson(voices,'Les références vocales dépassent 128 Kio.'),children.length,member.email)];
  for(const [index,child]of children.entries()){
    statements.push(env.DB.prepare("INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by,status,revision,archived,channel_id) VALUES(?,?,?,?,?,?,?,?,'draft',1,0,?)")
      .bind(child.id,child.title,child.templateId,child.templateVersion,child.libraryVersion,boundedJson(child.data,'Une déclinaison dépasse 128 Kio.'),member.email,member.email,source.channel_id||'benin-tv'));
    statements.push(env.DB.prepare('INSERT INTO project_derivations(batch_id,project_id,target_key,label,ordinal,warnings_json,announcement_json) VALUES(?,?,?,?,?,?,?)').bind(batchId,child.id,child.targetKey,child.label,index,JSON.stringify(child.warnings),child.announcement?JSON.stringify(child.announcement):null));
  }
  statements.push(env.DB.prepare('SELECT * FROM derivation_batches WHERE id=?').bind(batchId));
  try{
    const result=await env.DB.batch<BatchRow>(statements),created=result.at(-1)?.results[0];
    if(!created)throw new Error('Missing derivation receipt');return json(await detail(env.DB,created),201);
  }catch(error){
    // A committed response can be lost, or another request can win the unique
    // key. The durable receipt, not the transport outcome, decides what happened.
    let confirmed:BatchRow|null;
    try{confirmed=await receipt(env.DB,member.email,requestId);}
    catch{throw new HttpError(503,'Création non confirmée. Conservez cette demande et réessayez pour retrouver son résultat sans doublon.');}
    if(confirmed){matchingReceipt(confirmed,requestHash);return json(await detail(env.DB,confirmed));}
    if(String(error).includes('derivation_source_conflict'))throw new HttpError(409,'La BA source a changé pendant la préparation. Aucune déclinaison n’a été créée.');
    if(String(error).includes('derivation_actor_inactive'))throw new HttpError(403,'Votre accès a été suspendu pendant la préparation.');
    if(String(error).includes('derivation_media_unavailable'))throw new HttpError(422,'Un média partagé a changé pendant la préparation. Aucune déclinaison n’a été créée.');
    if(String(error).includes('derivation_voice_conflict'))throw new HttpError(409,'Une fiche voix a changé pendant la préparation. Vérifiez sa révision avant de recommencer ; aucune déclinaison n’a été créée.');
    throw new HttpError(503,'Création non confirmée. Réessayez avec la même demande pour retrouver son résultat sans doublon.');
  }
}
