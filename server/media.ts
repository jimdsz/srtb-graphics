import { z } from 'zod';
import type { Member } from '../src/studio/domain';
import { HttpError,json,readJson } from './http';
import { mediaStore } from './storage';
import type { MediaStore } from './storage';
import {requestChannel} from './channel-access';
import {assertCommercialAccess,assertGraphicsAccess} from './tool-access';
const PART = 8 * 1024 * 1024;
const OPERATION_LEASE_MS = 5 * 60 * 1000;
const PART_READ_TIMEOUT_MS = 45 * 1000;
const MAX_ACTIVE_MEDIA_OPERATIONS = 4;
const CAPACITY_RETRY_SECONDS = 2;
const mimeSchema = z.enum(['image/png','image/jpeg','image/webp','video/mp4','video/webm','audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/ogg']);
interface MediaRow { id:string;object_key:string;name:string;mime_type:string;bytes:number;status:string;upload_id:string;created_by:string;channel_id:string;tool_scope:'graphics'|'commercial' }
function signatureOK(bytes:Uint8Array,mime:string) {
  const ascii=(start:number,end:number)=>new TextDecoder().decode(bytes.subarray(start,end));
  if(mime==='image/png')return bytes[0]===137&&ascii(1,4)==='PNG';
  if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(mime==='image/webp')return ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
  if(mime==='video/mp4'||mime==='audio/mp4')return ascii(4,8)==='ftyp';
  if(mime==='video/webm')return bytes[0]===26&&bytes[1]===69&&bytes[2]===223&&bytes[3]===163;
  if(mime==='audio/wav'||mime==='audio/x-wav')return ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE';
  if(mime==='audio/ogg')return ascii(0,4)==='OggS';
  return ascii(0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224;
}
async function readBeforeDeadline(reader:ReadableStreamDefaultReader<Uint8Array>,deadline:number) {
  const pending=reader.read();
  const remaining=Math.max(0,deadline-Date.now());
  let timer:ReturnType<typeof setTimeout>|undefined;
  const outcome=await Promise.race([
    pending.then(value=>({kind:'read' as const,value})),
    new Promise<{kind:'timeout'}>(resolve=>{timer=setTimeout(()=>resolve({kind:'timeout'}),remaining);}),
  ]);
  if(timer!==undefined)clearTimeout(timer);
  if(outcome.kind==='read')return outcome.value;
  await reader.cancel('Délai de lecture dépassé.').catch(()=>undefined);
  await pending.catch(()=>undefined);
  throw new HttpError(408,'Lecture du fragment interrompue : le disque ou le réseau ne répond pas assez vite. Réessayez ; le transfert reste récupérable.');
}
export async function boundedPart(request:Request,expected:number,timeoutMs=PART_READ_TIMEOUT_MS) {
  const declared=Number(request.headers.get('Content-Length'));
  if(!Number.isInteger(declared)||declared!==expected||declared>PART)throw new HttpError(413,'Taille du fragment invalide.');
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Fragment absent.');
  const buffer=new Uint8Array(expected);let n=0;const deadline=Date.now()+timeoutMs;
  try{while(true){const item=await readBeforeDeadline(reader,deadline);if(item.done)break;if(n+item.value.length>expected){await reader.cancel();throw new HttpError(413,'Fragment trop volumineux.');}buffer.set(item.value,n);n+=item.value.length;}}
  finally{reader.releaseLock();}
  if(n!==expected)throw new HttpError(400,'Fragment incomplet.');
  return buffer;
}
export async function objectResponse(request:Request,bucket:MediaStore,key:string,mime?:string):Promise<Response> {
  const head=await bucket.head(key);
  if(!head)throw new HttpError(404,'Média introuvable.');
  const headers=new Headers({'Content-Type':mime||head.httpMetadata?.contentType||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'private, no-store','ETag':head.httpEtag,'X-Content-Type-Options':'nosniff'});
  const range=request.headers.get('Range');let start=0,end=head.size-1,status=200;
  if(range){
    const match=range.match(/^bytes=(\d*)-(\d*)$/);
    if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${head.size}`}});
    if(!match[1])start=Math.max(0,head.size-Number(match[2]));
    else {start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=head.size)
      return new Response(null,{status:416,headers:{'Content-Range':`bytes */${head.size}`}});
    headers.set('Content-Range',`bytes ${start}-${end}/${head.size}`);status=206;
  }
  headers.set('Content-Length',String(end-start+1));
  if(request.method==='HEAD')return new Response(null,{status,headers});
  if(head.size===0)return new Response(null,{status,headers});
  const object=await bucket.get(key,{range:{offset:start,length:end-start+1},etag:head.httpEtag});
  if(!object)throw new HttpError(404,'Média introuvable.');
  return new Response(object.body,{status,headers});
}
export async function mediaRoutes(request:Request,env:Env,member:Member,scope:'graphics'|'commercial'='graphics'):Promise<Response|null>{
  const path=new URL(request.url).pathname,commercial=scope==='commercial',channel=commercial?'benin-tv':requestChannel(request);
  if(!path.startsWith('/api/media'))return null;
  if(commercial)assertCommercialAccess(member);else assertGraphicsAccess(member);
  const ownerFilter=commercial?' AND (created_by=? COLLATE NOCASE OR ?=1)':'',ownerArgs=commercial?[member.email,Number(member.role==='admin')]:[];
  if(path==='/api/media/transfers'&&request.method==='GET'){
    // Expose progress only to the original uploader. Storage keys, provider IDs and leases stay server-side.
    const rows=(await env.DB.prepare(`SELECT m.id,m.name,m.mime_type,m.bytes,m.created_at,m.operation_until,
      COALESCE(SUM(p.bytes),0) AS received_bytes,COUNT(p.part_number) AS received_parts
      FROM media m LEFT JOIN media_parts p ON p.media_id=m.id
      WHERE m.channel_id=? AND m.tool_scope=? AND m.created_by=? AND m.status='uploading' GROUP BY m.id ORDER BY m.created_at DESC LIMIT 50`)
      .bind(channel,scope,member.email).all<{id:string;name:string;mime_type:string;bytes:number;created_at:string;operation_until:number;received_bytes:number;received_parts:number}>()).results;
    return json(rows.map(({operation_until,...row})=>({...row,expected_parts:Math.ceil(row.bytes/PART),busy:operation_until>Date.now()})));
  }
  if(path==='/api/media'){
    if(request.method==='GET')return json((await env.DB.prepare(`SELECT id,name,mime_type,bytes,status,created_by,created_at FROM media WHERE channel_id=? AND tool_scope=? AND status='ready'${ownerFilter} ORDER BY created_at DESC LIMIT 300`).bind(channel,scope,...ownerArgs).all()).results);
    if(request.method==='POST'){
      const input=z.object({name:z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\/\\]+$/),mimeType:mimeSchema,bytes:z.number().int().positive().max(2*1024**3),consent:z.literal(true)}).strict().parse(await readJson(request));
      const id=crypto.randomUUID(),key=`uploads/${id}`,upload=await mediaStore(env).createMultipartUpload(key,{httpMetadata:{contentType:input.mimeType,cacheControl:'private, no-store'}});
      try{
        const admitted=await env.DB.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,upload_id,created_by,channel_id,tool_scope) SELECT ?,?,?,?,?,'uploading',?,?,?,? WHERE (SELECT COALESCE(SUM(bytes),0) FROM media WHERE status<>'failed')+? <= 8589934592 AND (SELECT COUNT(*) FROM media WHERE created_by=? AND status='uploading')<3")
          .bind(id,key,input.name,input.mimeType,input.bytes,upload.uploadId,member.email,channel,scope,input.bytes,member.email).run();
        if(!admitted.meta.changes)throw new HttpError(409,'Quota de sécurité atteint (8 Go partagés ou 3 transferts en cours). Contactez l’administrateur.');
      }catch(e){await upload.abort();throw e;}
      return json({id,partSize:PART},201);
    }
  }
  const metadata=path.match(/^\/api\/media\/([a-f\d-]{36})$/);
  if(metadata){
    if(request.method!=='GET')throw new HttpError(405,'Action non disponible.');
    const asset=await env.DB.prepare(`SELECT id,name,mime_type,bytes,status,created_by,created_at FROM media WHERE id=? AND channel_id=? AND tool_scope=? AND status='ready'${ownerFilter}`).bind(metadata[1],channel,scope,...ownerArgs).first();
    if(!asset)throw new HttpError(404,'Média partagé indisponible.');
    return json(asset);
  }
  const route=path.match(/^\/api\/media\/([a-f\d-]{36})\/(content|complete|cancel|part\/\d+)$/);
  if(!route)return null;
  const [,id,action]=route,row=await env.DB.prepare('SELECT * FROM media WHERE id=?').bind(id).first<MediaRow>();
  if(!row||row.tool_scope!==scope||commercial&&member.role!=='admin'&&row.created_by.toLowerCase()!==member.email.toLowerCase())throw new HttpError(404,'Média introuvable.');
  if(action==='content'&&['GET','HEAD'].includes(request.method)){
    if(row.status!=='ready')throw new HttpError(409,'Transfert non finalisé.');
    return objectResponse(request,mediaStore(env),row.object_key,row.mime_type);
  }
  if(row.created_by!==member.email)throw new HttpError(403,'Seul l’auteur peut poursuivre ce transfert.');
  const output=()=>json({id,url:`/api/${scope}/media/${id}/content`,name:row.name,mimeType:row.mime_type});
  if(action==='complete'&&request.method==='POST'&&row.status==='ready')return output();
  if(action==='cancel'&&request.method==='POST'&&row.status==='failed')return json({ok:true});
  const token=crypto.randomUUID(),now=Date.now(),isPart=action.startsWith('part/')&&request.method==='PUT';
  const locked=isPart
    ? await env.DB.prepare("UPDATE media SET operation_token=?,operation_until=? WHERE id=? AND status='uploading' AND operation_until<? AND (SELECT COUNT(*) FROM media WHERE status='uploading' AND operation_until>=?)<?")
      .bind(token,now+OPERATION_LEASE_MS,id,now,now,MAX_ACTIVE_MEDIA_OPERATIONS).run()
    : await env.DB.prepare("UPDATE media SET operation_token=?,operation_until=? WHERE id=? AND status='uploading' AND operation_until<?")
      .bind(token,now+OPERATION_LEASE_MS,id,now).run();
  if(!locked.meta.changes){
    const current=await env.DB.prepare('SELECT status,operation_until FROM media WHERE id=?').bind(id).first<{status:string;operation_until:number}>();
    if(isPart&&current?.status==='uploading'&&current.operation_until<now)
      throw new HttpError(503,'Les transferts médias sont très sollicités. Graphics reprendra automatiquement dès qu’une place sera disponible.',{'Retry-After':String(CAPACITY_RETRY_SECONDS)});
    throw new HttpError(409,'Transfert occupé ou déjà finalisé. Réessayez dans quelques instants.');
  }
  try {
  const bucket=mediaStore(env),upload=bucket.resumeMultipartUpload(row.object_key,row.upload_id);
  if(action.startsWith('part/')&&request.method==='PUT'){
    const number=Number(action.slice(5)),count=Math.ceil(row.bytes/PART);
    if(number<1||number>count)throw new HttpError(400,'Numéro de fragment invalide.');
    const expected=Math.min(PART,row.bytes-(number-1)*PART),data=await boundedPart(request,expected);
    if(number===1&&!signatureOK(data,row.mime_type))throw new HttpError(415,'Le contenu ne correspond pas au format annoncé.');
    const part=await upload.uploadPart(number,data);
    await env.DB.prepare('INSERT INTO media_parts(media_id,part_number,etag,bytes) VALUES(?,?,?,?) ON CONFLICT(media_id,part_number) DO UPDATE SET etag=excluded.etag,bytes=excluded.bytes')
      .bind(id,number,part.etag,expected).run();
    return json({partNumber:number});
  }
  if(action==='complete'&&request.method==='POST'){
    const parts=(await env.DB.prepare('SELECT part_number,etag,bytes FROM media_parts WHERE media_id=? ORDER BY part_number').bind(id).all<{part_number:number;etag:string;bytes:number}>()).results;
    if(parts.length!==Math.ceil(row.bytes/PART)||parts.reduce((s,p)=>s+p.bytes,0)!==row.bytes||parts.some((p,i)=>p.part_number!==i+1))throw new HttpError(409,'Le transfert est incomplet.');
    // Reconcile an already-completed private object after a lost response / D1 failure.
    const object=await bucket.head(row.object_key) ?? await upload.complete(parts.map(p=>({partNumber:p.part_number,etag:p.etag})));
    if(object.size!==row.bytes)throw new HttpError(409,'Taille du fichier final incohérente.');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO activity(actor,action,target,detail) SELECT ?,'media.shared',?,? WHERE EXISTS(SELECT 1 FROM media WHERE id=? AND status='uploading' AND operation_token=?)").bind(member.email,id,row.name,id,token),
      env.DB.prepare("UPDATE media SET status='ready',upload_id=NULL WHERE id=? AND status='uploading' AND operation_token=?").bind(id,token),
    ]);
    return output();
  }
  if(action==='cancel'&&request.method==='POST'){
    if(await bucket.head(row.object_key))throw new HttpError(409,'Le fichier a été reçu. Finalisez le transfert pour le retrouver.');
    await upload.abort();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO activity(actor,action,target,detail) SELECT ?,'media.cancelled',?,? WHERE EXISTS(SELECT 1 FROM media WHERE id=? AND status='uploading' AND operation_token=?)").bind(member.email,id,row.name,id,token),
      env.DB.prepare("UPDATE media SET status='failed',upload_id=NULL WHERE id=? AND status='uploading' AND operation_token=?").bind(id,token),
    ]);
    return json({ok:true});
  }
  throw new HttpError(405,'Action non disponible.');
  } finally {
    await env.DB.prepare('UPDATE media SET operation_token=NULL,operation_until=0 WHERE id=? AND operation_token=?').bind(id,token).run();
  }
}
