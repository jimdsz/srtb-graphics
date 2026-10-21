import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Connector,MIME,bounded} from './core.mjs';
import {MediaPreparation} from './media-preparation.mjs';

export const PORT=43871;
const production='https://srtb-graphics.pages.dev';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
async function body(req){let size=0,chunks=[];for await(const chunk of req){if((size+=chunk.length)>256*1024)throw Error('Requête trop volumineuse.');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw Error('Requête invalide.');}}
export function byteRange(value,size){
 if(!value)return {start:0,end:size-1,partial:false};
 const match=/^bytes=(\d*)-(\d*)$/.exec(value);if(!match||!match[1]&&!match[2])return null;
 let start,end;if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return null;start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;}
 return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start?{start,end,partial:true}:null;
}

/** Local-only HTTP. Capability tokens are ephemeral and origin-bound. No remote
 * request can authorize an arbitrary path/command. Native permission is required
 * before writing a prepared copy; source media are never modified. */
export async function createConnectorServer({dataDir,port=PORT,origins=[production],pickDirectory,pickFile,preparationOptions,coreOptions,pickerTimeout=120000}={}){
 const connector=await new Connector(dataDir,coreOptions).init(),owner=randomBytes(32).toString('hex'),sessions=new Map();
 const preparation=new MediaPreparation(dataDir,{pickFile,...preparationOptions});
 let pairing=null,attempts=0,attemptWindow=0,picking=null,actualPort=port,closing;
 let reportClosed;const closed=new Promise(resolve=>{reportClosed=resolve;});
 const close=()=>closing??=(async()=>{picking?.abort();sessions.clear();pairing=null;connector.close();preparation.revoke();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await Promise.all([...connector.jobs.values()].map(job=>job.promise));await preparation.close();reportClosed();})();
 const siteOrigins=new Set(origins),localOrigin=()=>`http://127.0.0.1:${actualPort}`;
 const revokeOrigin=origin=>{for(const [key,session]of sessions)if(session.origin===origin)sessions.delete(key);connector.cancelReads();preparation.revoke(origin);};
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  const expectedHost=`127.0.0.1:${actualPort}`,origin=req.headers.origin;
  if(req.headers.host!==expectedHost||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){json(res,403,{error:'Hôte refusé.'});return;}
  if(origin&&origin!==localOrigin()&&!siteOrigins.has(origin)){json(res,403,{error:'Origine refusée.'});return;}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){
   if(!origin){json(res,403,{error:'Origine requise.'});return;}
   res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, HEAD');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, Range');res.setHeader('Access-Control-Allow-Private-Network','true');res.writeHead(204);res.end();return;
  }
  const requestURL=new URL(req.url,localOrigin()),route=requestURL.pathname;
  const controller=new AbortController();req.on('aborted',()=>controller.abort());res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  const token=(req.headers.authorization||'').replace(/^Bearer /,'');
  // Same-origin GET/HEAD fetches omit Origin in browsers. The owner's secret
  // plus Fetch Metadata permits those reads only; mutations still require Origin.
  const localRead=!origin&&['GET','HEAD'].includes(req.method)&&req.headers['sec-fetch-site']==='same-origin';
  const isOwner=(origin===localOrigin()||localRead)&&equal(token,owner),session=sessions.get(token);
  const authorized=isOwner||!!origin&&session?.origin===origin&&session.expires>Date.now();
  try{
   if(req.method==='GET'&&['/','/app.js','/app.css'].includes(route)){
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const filename=route==='/'?'index.html':route.slice(1);const content=await fs.readFile(new URL('./ui/'+filename,import.meta.url));res.writeHead(200,{'Content-Type':filename.endsWith('.html')?'text/html; charset=utf-8':filename.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});res.end(content);return;
   }
   if(route==='/v1/health'&&req.method==='GET'){json(res,200,{protocol:1,version:'0.3.0',capabilities:['episode-date-ranking',...(pickFile?['media-preparation-v1']:[])],readOnly:true});return;}
   if(route==='/v1/pair'&&req.method==='POST'&&siteOrigins.has(origin)){
    if(Date.now()-attemptWindow>300000){attemptWindow=Date.now();attempts=0;}if(++attempts>8){json(res,429,{error:'Trop de tentatives. Attendez cinq minutes.'});return;}
    const data=await body(req);if(!pairing||pairing.expires<Date.now()||!equal(String(data.code||'').replace(/\s|-/g,'').toUpperCase(),pairing.code)){json(res,403,{error:'Code invalide ou expiré. Générez un nouveau code dans le connecteur.'});return;}
    pairing=null;revokeOrigin(origin);const access=randomBytes(32).toString('hex'),expires=Date.now()+12*3600000;sessions.set(access,{origin,expires});json(res,200,{token:access,expires});return;
   }
   if(route.startsWith('/v1/media/')&&['GET','HEAD'].includes(req.method)){
    const prepared=preparation.tickets.get(route.slice('/v1/media/'.length));
    if(prepared){
     if(prepared.expires<Date.now()||origin&&origin!==prepared.origin){json(res,403,{error:'Lecture expirée. Reconnectez le média.'});return;}
     const info=await fs.lstat(prepared.file);if(!info.isFile()||info.isSymbolicLink()||info.size!==prepared.size||['mtimeMs','ctimeMs','ino','dev'].some(k=>info[k]!==prepared.stat[k]))throw Error('Copie locale modifiée. Préparez-la à nouveau.');
     const handle=await fs.open(prepared.file,'r');
     const opened=await handle.stat();if(['size','mtimeMs','ctimeMs','ino','dev'].some(k=>opened[k]!==info[k])){await handle.close();throw Error('Copie modifiée pendant son ouverture.');}
     if(controller.signal.aborted||preparation.tickets.get(route.slice('/v1/media/'.length))!==prepared||prepared.expires<=Date.now()){await handle.close();json(res,403,{error:'Lecture expirée.'});return;}
     const range=byteRange(req.headers.range,prepared.size);if(!range){await handle.close();res.setHeader('Content-Range',`bytes */${prepared.size}`);res.writeHead(416);res.end();return;}
     res.setHeader('Accept-Ranges','bytes');res.setHeader('Access-Control-Expose-Headers','Content-Length, Content-Range, Accept-Ranges');res.setHeader('Content-Type','video/mp4');res.setHeader('Content-Length',String(range.end-range.start+1));
     if(range.partial)res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${prepared.size}`);
     res.writeHead(range.partial?206:200);if(req.method==='HEAD'){await handle.close();res.end();return;}
     const stream=connector.trackStream('__prepared__',handle.createReadStream({start:range.start,end:range.end,autoClose:true}));res.setTimeout(30000,()=>res.destroy());res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);return;
    }
    const ticket=connector.tickets.get(route.slice('/v1/media/'.length));if(!ticket||ticket.expires<Date.now()||origin&&origin!==ticket.origin){json(res,403,{error:'Lecture expirée. Reconnectez le média.'});return;}
    const handle=await connector.open(ticket.rootId,ticket.file,controller.signal);
    // Network file opens may settle after a disconnect or ticket expiry. An
    // authorization checked before that await cannot authorize the late stream.
    if(controller.signal.aborted||connector.tickets.get(route.slice('/v1/media/'.length))!==ticket||ticket.expires<=Date.now()){
     await handle.close();json(res,403,{error:'Lecture expirée. Reconnectez le média.'});return;
    }
    const range=byteRange(req.headers.range,ticket.file.size);if(!range){await handle.close();res.setHeader('Content-Range',`bytes */${ticket.file.size}`);res.writeHead(416);res.end();return;}
    res.setHeader('Accept-Ranges','bytes');res.setHeader('Access-Control-Expose-Headers','Content-Length, Content-Range, Accept-Ranges');res.setHeader('Content-Type',MIME[path.extname(ticket.file.name).toLowerCase()]||'application/octet-stream');res.setHeader('Content-Length',String(range.end-range.start+1));
    if(range.partial)res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${ticket.file.size}`);
    res.writeHead(range.partial?206:200);if(req.method==='HEAD'){await handle.close();res.end();return;}
    const stream=connector.trackStream(ticket.rootId,handle.createReadStream({start:range.start,end:range.end,autoClose:true}));res.setTimeout(30000,()=>res.destroy());res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.on('close',()=>{if(!res.writableEnded)res.destroy();});stream.pipe(res);return;
   }
   if(!authorized){json(res,401,{error:'Associez ce navigateur depuis le connecteur local.'});return;}
   // Only the separately authorized local control page may stop the helper.
   // Finish its response first so the UI can show a useful final state.
   if(route==='/v1/shutdown'&&req.method==='POST'&&isOwner){res.once('finish',()=>{void close();});json(res,200,{ok:true});return;}
   if(route==='/v1/disconnect'&&req.method==='POST'){if(isOwner){sessions.clear();pairing=null;connector.cancelReads();preparation.revoke();}else revokeOrigin(origin);json(res,200,{ok:true});return;}
   if(route==='/v1/preparation/pick'&&req.method==='POST'){
    if(!pickFile)throw Error('Mettez à jour le connecteur pour préparer les médias.');
    const data=await body(req);if(data.allowEngineDownload!==true)throw Error('Confirmez la préparation locale et le téléchargement initial du moteur vidéo.');
    // No filesystem path or FFmpeg arguments accepted from a web client.
    if(Object.keys(data).some(k=>!['expected','allowEngineDownload'].includes(k)))throw Error('Requête de préparation invalide.');
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(pickerTimeout)]);
    try{json(res,202,await preparation.start(origin,data.expected,signal));}catch(error){if(error.name==='AbortError'&&!signal.aborted){json(res,200,{cancelled:true});return;}throw error;}return;
   }
   if(route==='/v1/preparation/restore'&&req.method==='POST'){
    const data=await body(req);if(typeof data.reference!=='string'||Object.keys(data).some(k=>k!=='reference'))throw Error('Référence invalide.');
    const result=await preparation.restore(data.reference,origin,controller.signal);if(!authorized||session&&sessions.get(token)!==session)throw Error('Connexion expirée.');json(res,200,{lease:result});return;
   }
   const prep=/^\/v1\/preparation\/([a-f\d-]{36})(?:\/(cancel|lease))?$/.exec(route);
   if(prep){const [,id,action]=prep;
    if(req.method==='GET'&&!action){json(res,200,preparation.status(id,origin));return;}
    if(req.method==='POST'&&action==='cancel'){preparation.cancel(id,origin);json(res,200,{ok:true});return;}
    if(req.method==='POST'&&action==='lease'){json(res,200,preparation.lease(id,origin));return;}
   }
   if(route==='/v1/roots'&&req.method==='GET'){json(res,200,{roots:isOwner?connector.localList():connector.list()});return;}
   if(route==='/v1/pairing'&&req.method==='POST'&&isOwner){pairing={code:randomBytes(6).toString('hex').toUpperCase(),expires:Date.now()+300000};json(res,200,pairing);return;}
   if(route==='/v1/roots/pick/cancel'&&req.method==='POST'&&isOwner){picking?.abort(new DOMException('Choix de dossier annulé.','AbortError'));json(res,200,{ok:true});return;}
   if(route==='/v1/roots/pick'&&req.method==='POST'&&isOwner){
    if(picking||!pickDirectory)throw Error('Sélecteur indisponible ou déjà ouvert.');
    const selection=new AbortController();picking=selection;
    const abort=()=>selection.abort(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>selection.abort(new DOMException('Le choix de dossier a expiré. Vous pouvez réessayer.','TimeoutError')),pickerTimeout);
    try{
     const directory=await bounded(()=>pickDirectory(selection.signal),selection.signal,pickerTimeout+1000);
     selection.signal.throwIfAborted();if(!directory){json(res,200,{cancelled:true});return;}
     await connector.authorize(directory,[],selection.signal);json(res,200,{roots:connector.localList()});return;
    }catch(error){if(selection.signal.aborted&&selection.signal.reason?.name==='AbortError'){if(!res.destroyed)json(res,200,{cancelled:true});return;}throw error;}
    finally{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);if(picking===selection)picking=null;selection.abort();}
   }
   const match=/^\/v1\/roots\/([a-f\d-]{36})(?:\/(scan|stop|exclusions))?$/.exec(route);
   if(match){const [,id,action]=match;
    if(req.method==='POST'&&action==='scan'){connector.start(id);json(res,202,{roots:connector.list()});return;}
    if(req.method==='POST'&&action==='stop'){connector.stop(id);json(res,200,{ok:true});return;}
    if(isOwner&&req.method==='POST'&&action==='exclusions'){await connector.exclusions(id,(await body(req)).exclusions);json(res,200,{ok:true});return;}
    if(isOwner&&req.method==='DELETE'&&!action){await connector.revoke(id);json(res,200,{ok:true});return;}
   }
   if(route==='/v1/search'&&req.method==='POST'){const {queries}=await body(req),roots=connector.list();json(res,200,{results:await connector.search(queries,controller.signal),roots});return;}
   if(route==='/v1/lease'&&req.method==='POST'){const data=await body(req);json(res,200,await connector.lease(data.rootId,data.file,origin,controller.signal));return;}
   json(res,404,{error:'Action indisponible.'});
  }catch(error){if(!res.headersSent&&!res.destroyed)json(res,400,{error:typeof error?.code==='string'?'Emplacement inaccessible. Vérifiez sa connexion et ses autorisations.':error instanceof Error?error.message:'Action interrompue.'});else res.destroy();}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});actualPort=server.address().port;
 return {server,connector,preparation,owner,url:localOrigin(),consoleURL:localOrigin()+'/#'+owner,close,closed};
}
