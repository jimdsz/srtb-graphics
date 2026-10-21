import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {programmeWords,scoreMedia} from './matching.bundle.mjs';

export const MIME={'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mxf':'application/mxf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.ogg':'audio/ogg'};
const ignored=new Set(['$recycle.bin','system volume information','windows','node_modules','.git','.svn','.trash','.trashes']);
export const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const inside=(root,target)=>{const rel=path.relative(root,target);return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
export function relativeName(value){return typeof value==='string'&&value.length>0&&value.length<=500&&!/[\\:\x00-\x1f]/.test(value)&&value.split('/').every(v=>v&&v!=='.'&&v!=='..');}
const abortError=()=>new DOMException('Recherche arrêtée.','AbortError');
export function bounded(operation,signal,ms=20000,dispose){return new Promise((resolve,reject)=>{
 signal?.throwIfAborted();let done=false;
 const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
 const abort=()=>finish(signal.reason||abortError()),timer=setTimeout(()=>finish(new DOMException('Emplacement sans réponse. Réessayez lorsque le réseau est disponible.','TimeoutError')),ms);
 signal?.addEventListener('abort',abort,{once:true});Promise.resolve().then(()=>{signal?.throwIfAborted();return operation();}).then(v=>{if(done){Promise.resolve(dispose?.(v)).catch(()=>{});return;}finish(null,v);},e=>finish(e));
});}

/** Paths and indexes stay on this device. No cloud client or file-write API for
 * source media exists here. The public site receives only explicit searches. */
export class Connector {
 constructor(dataDir,{maxEntries=10000,readTimeout=20000}={}){this.dataDir=path.resolve(dataDir);this.maxEntries=maxEntries;this.readTimeout=readTimeout;this.roots=new Map();this.jobs=new Map();this.tickets=new Map();this.hashJobs=new Map();this.streams=new Set();this.saving=Promise.resolve();}
 async init(){
  await fs.mkdir(this.dataDir,{recursive:true,mode:0o700});
  try{const saved=JSON.parse(await fs.readFile(path.join(this.dataDir,'roots.json'),'utf8'));if(!Array.isArray(saved)||saved.length>32)throw Error('Configuration invalide.');
   for(const root of saved){if(!/^[a-f\d-]{36}$/.test(root.id)||!path.isAbsolute(root.path)||typeof root.name!=='string'||root.name.length>120||!Array.isArray(root.exclusions)||!root.exclusions.every(relativeName)||root.segments&&(!Array.isArray(root.segments)||root.segments.length>1000||!root.segments.every(name=>new RegExp('^'+root.id+'(?:\\.[a-f\\d-]{36})?\\.ndjson$').test(name)))||root.scanQueue&&(!Array.isArray(root.scanQueue)||root.scanQueue.length>100000||!root.scanQueue.every(q=>relativeName(q.relative)&&Number.isInteger(q.depth)&&q.depth>=1&&q.depth<=65)))throw Error('Configuration invalide.');this.roots.set(root.id,{...root,state:root.updatedAt?'ready':'idle',message:root.scanQueue?.length?'Indexation à reprendre : les dossiers déjà parcourus restent disponibles.':''});}
  }catch(e){if(e.code!=='ENOENT')throw e;}
  return this;
 }
 async save(){const write=async()=>{const file=path.join(this.dataDir,'roots.json'),temp=file+'.tmp';await fs.writeFile(temp,JSON.stringify([...this.roots.values()].map(({state,message,...root})=>root)),{mode:0o600});await fs.rename(temp,file);};this.saving=this.saving.catch(()=>{}).then(write);return this.saving;}
 list(){return [...this.roots.values()].map(({path:privatePath,exclusions,scanQueue,segments,scanIssue,scanVisited,...root})=>({...root,resumeAvailable:!!scanQueue?.length,exclusionCount:exclusions.length}));}
 localList(){return [...this.roots.values()];}
 async authorize(directory,exclusions=[],signal){
  if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('Sélectionnez un emplacement absolu.');
  if(exclusions.length>100||!exclusions.every(relativeName))throw Error('Exclusions invalides.');
  const selected=await bounded(()=>fs.lstat(directory),signal,this.readTimeout);if(selected.isSymbolicLink()||!selected.isDirectory())throw Error('Choisissez le dossier réel, pas un lien.');
  const real=await bounded(()=>fs.realpath(directory),signal,this.readTimeout);if(inside(real,this.dataDir)&&real===this.dataDir)throw Error('Le dossier interne du connecteur ne peut pas être indexé.');
  signal?.throwIfAborted();
  const previous=[...this.roots.values()].find(root=>root.path===real);if(previous)return previous;
  if(this.roots.size>=32)throw Error('32 emplacements maximum sur ce poste.');
  const root={id:randomUUID(),name:(path.basename(real)||'Disque').slice(0,120),path:real,exclusions:[...exclusions],state:'idle',files:0,partial:false,updatedAt:null,message:''};
  this.roots.set(root.id,root);try{await this.save();}catch(e){this.roots.delete(root.id);throw e;}return root;
 }
 root(id){const root=this.roots.get(id);if(!root)throw Error('Emplacement non autorisé.');return root;}
 cancelReads(id){for(const job of this.hashJobs.values())if(!id||job.rootId===id)job.controller.abort(abortError());for(const job of this.streams)if(!id||job.rootId===id)job.stream.destroy();for(const [key,t]of this.tickets)if(!id||t.rootId===id)this.tickets.delete(key);}
 trackStream(rootId,stream){const job={rootId,stream};this.streams.add(job);stream.once('close',()=>this.streams.delete(job));return stream;}
 async revoke(id){this.stop(id);this.roots.delete(id);this.cancelReads(id);await this.save();}
 async exclusions(id,values){const root=this.root(id);if(!Array.isArray(values)||values.length>100||!values.every(relativeName))throw Error('Exclusions invalides.');if(this.jobs.has(id))throw Error('Arrêtez la recherche avant de modifier les exclusions.');root.exclusions=[...new Set(values)];root.updatedAt=null;root.files=0;root.scanQueue=[];root.state='idle';this.cancelReads(id);await this.save();}
 excluded(root,relative){const value=relative.toLowerCase();return root.exclusions.some(ex=>value===ex.toLowerCase()||value.startsWith(ex.toLowerCase()+'/'));}
 async safePath(root,relative,signal){
  if(!relativeName(relative)||this.excluded(root,relative))throw Error('Fichier hors des emplacements autorisés.');
  const run=op=>bounded(op,signal,this.readTimeout);
  // Revalidate every component on every open; junctions/symlinks cannot extend a grant.
  const actualRoot=await run(()=>fs.realpath(root.path));if(actualRoot!==root.path)throw Error('Emplacement déplacé. Autorisez-le à nouveau.');
  let target=root.path;for(const part of relative.split('/')){target=path.join(target,part);const stat=await run(()=>fs.lstat(target));if(stat.isSymbolicLink())throw Error('Les liens de fichiers ou dossiers ne sont pas suivis.');}
  const real=await run(()=>fs.realpath(target));if(!inside(root.path,real)||inside(this.dataDir,real))throw Error('Fichier hors des emplacements autorisés.');return real;
 }
 async open(rootId,file,signal){
  if(!file||!relativeName(file.path)||file.name!==file.path.split('/').at(-1)||!MIME[path.extname(file.name).toLowerCase()]||!Number.isSafeInteger(file.size)||file.size<=0||file.size>64*1024**3||!Number.isSafeInteger(file.modified))throw Error('Référence de média invalide.');
  const root=this.root(rootId),target=await this.safePath(root,file.path,signal),before=await bounded(()=>fs.lstat(target),signal,this.readTimeout);
  if(!before.isFile()||before.size!==file.size||Math.trunc(before.mtimeMs)!==file.modified)throw Error('Le fichier a changé : actualisez la recherche.');
  const handle=await bounded(()=>fs.open(target,'r'),signal,this.readTimeout,h=>h.close());
  try{const after=await bounded(()=>handle.stat(),signal,this.readTimeout);await this.safePath(root,file.path,signal);if(this.roots.get(rootId)!==root||after.ino!==before.ino||after.dev!==before.dev||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Le fichier a changé pendant son ouverture.');return handle;}catch(e){await handle.close();throw e;}
 }
 start(id){
  this.root(id);if(this.jobs.size)throw Error('Une indexation est déjà en cours. Attendez ou arrêtez-la.');
  const controller=new AbortController();const job={controller,promise:null};this.jobs.set(id,job);
  job.promise=(async()=>{do{controller.signal.throwIfAborted();await this.scan(id,controller.signal);}while(this.root(id).scanQueue?.length);})().catch(error=>{const root=this.roots.get(id);if(root){root.state=controller.signal.aborted?'cancelled':'error';root.message=controller.signal.aborted?'Recherche arrêtée. Les derniers dossiers indexés restent disponibles ; relancez pour reprendre.':'Lecture interrompue. Les dossiers déjà indexés restent disponibles. Vérifiez l’accès puis reprenez.';}}).finally(()=>this.jobs.delete(id));return this.root(id);
 }
 stop(id){this.jobs.get(id)?.controller.abort(abortError());}
 async scan(id,signal){
  const root=this.root(id),resume=!!root.updatedAt&&!!root.scanQueue?.length;
  root.state='scanning';root.message='';root.visited=resume?root.scanVisited||0:0;root.found=resume?root.files:0;
  const segment=root.updatedAt?id+'.'+randomUUID()+'.ndjson':id+'.ndjson';
  const destination=path.join(this.dataDir,segment),temp=destination+'.'+randomUUID()+'.tmp';
  const output=createWriteStream(temp,{flags:'wx',mode:0o600});let ioError;output.on('error',e=>{ioError=e;});
  // destroy() can precede the asynchronous open. Wait for close before removing
  // or committing the file, otherwise Windows may leave a late-created .tmp.
  const closed=new Promise(resolve=>output.once('close',resolve));let visited=0,found=resume?root.files:0,partial=resume?!!root.scanIssue:false,completed=0;
  const beforeVisited=resume?root.scanVisited||0:0,queue=resume?root.scanQueue.map(q=>({...q})):[{relative:'',depth:0}];
  try{
   const actual=await bounded(()=>fs.realpath(root.path),signal,this.readTimeout);if(actual!==root.path)throw Error('Emplacement déplacé.');
   while(queue.length){
    signal.throwIfAborted();if(completed&&visited>=this.maxEntries)break;
    const {relative,depth}=queue.pop();if(depth>64){partial=true;continue;}
    let directory;try{const target=relative?await this.safePath(root,relative,signal):root.path;directory=await bounded(()=>fs.opendir(target),signal,this.readTimeout,d=>d.close());}catch(e){signal.throwIfAborted();if(!relative||e.name==='TimeoutError')throw e;partial=true;continue;}
    try{while(true){
     signal.throwIfAborted();const entry=await bounded(()=>directory.read(),signal,this.readTimeout);if(!entry)break;
     visited++;
     const rel=relative?relative+'/'+entry.name:entry.name;
     if(!relativeName(rel)||this.excluded(root,rel)||ignored.has(entry.name.toLowerCase())||entry.isSymbolicLink()){partial=true;continue;}
     if(inside(this.dataDir,path.join(root.path,rel)))continue;
     if(entry.isDirectory()){if(queue.length>=100000)throw Error('Trop de sous-dossiers en attente. Divisez cet emplacement.');queue.push({relative:rel,depth:depth+1});}
     else if(entry.isFile()&&MIME[path.extname(entry.name).toLowerCase()]&&entry.name.length<=200){
      try{const target=await this.safePath(root,rel,signal),stat=await bounded(()=>fs.stat(target),signal,this.readTimeout);
       if(stat.size>0&&stat.size<=64*1024**3){const record={path:rel,name:entry.name,size:stat.size,modified:Math.trunc(stat.mtimeMs)};if(ioError)throw ioError;if(!output.write(JSON.stringify(record)+'\n'))await bounded(()=>once(output,'drain'),signal,this.readTimeout);found++;}
      }catch(e){signal.throwIfAborted();if(ioError)throw ioError;if(e.name==='TimeoutError')throw e;partial=true;}
     }
     if(visited%50===0){root.visited=beforeVisited+visited;root.found=found;await new Promise(resolve=>setTimeout(resolve,0));}
    }}finally{await bounded(()=>directory.close(),undefined,this.readTimeout).catch(()=>{});}completed++;
   }
   if(ioError)throw ioError;const finished=once(output,'finish');output.end();await finished;await closed;if(ioError)throw ioError;signal.throwIfAborted();
   if(this.roots.get(id)!==root)throw abortError();await fs.rename(temp,destination);
   // Immutable segments + atomic metadata commit keep previous checkpoints
   // searchable on cancellation/crash. Continue at directory boundaries only;
   // never skip a numeric count of entries in a changing network directory.
   const previous={...root};
   const segments=resume?[...(root.segments||[id+'.ndjson']),segment]:[segment];if(segments.length>1000)throw Error('Index trop volumineux : choisissez des emplacements plus précis.');
   Object.assign(root,{segments,scanQueue:queue,scanIssue:partial,scanVisited:beforeVisited+visited,files:found,visited:beforeVisited+visited,found,partial:partial||!!queue.length,updatedAt:new Date().toISOString(),state:queue.length?'scanning':'ready',message:queue.length?'Indexation en cours · progression sauvegardée.':partial?'Index partiel : exclusions ou fichiers inaccessibles.':''});
   try{await this.save();}catch(error){for(const key of Object.keys(root))if(!Object.hasOwn(previous,key))delete root[key];Object.assign(root,previous);throw error;}
  }finally{output.destroy();await closed;await fs.rm(temp,{force:true}).catch(()=>{});}
 }
 async *records(id,signal){const root=this.root(id);if(!root.updatedAt)return;for(const segment of root.segments||[id+'.ndjson']){const input=createReadStream(path.join(this.dataDir,segment));const lines=createInterface({input,crlfDelay:Infinity});try{for await(const line of lines){signal?.throwIfAborted();const file=JSON.parse(line);if(!this.excluded(root,file.path))yield file;}}finally{lines.close();input.destroy();}}}
 async search(queries,signal){
  if(!Array.isArray(queries)||queries.length>600||queries.some(q=>!q||typeof q.id!=='string'||q.id.length>100||typeof q.title!=='string'||q.title.length>200||q.subtitle!==undefined&&(typeof q.subtitle!=='string'||q.subtitle.length>400)||q.airDate!==undefined&&(typeof q.airDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(q.airDate))))throw Error('Recherche invalide.');
  const unique=new Map(),requested=queries.map(q=>{const row={title:q.title,subtitle:q.subtitle||'',airDate:q.airDate||''},key=JSON.stringify(row);let item=unique.get(key);if(!item){item={row,words:programmeWords(q.title),matches:[]};unique.set(key,item);}return {id:q.id,item};});
  const lists=[...unique.values()];
  // Only consider programmes sharing a token with this file. A full day must
  // not compare every file to every programme on every authorized drive.
  const byWord=new Map();for(const [i,item]of lists.entries())for(const word of item.words){const entries=byWord.get(word)||[];entries.push(i);byWord.set(word,entries);}
  let visited=0;for(const root of this.roots.values()){if(!root.updatedAt)continue;for await(const file of this.records(root.id,signal)){
   if(++visited%100===0){await new Promise(resolve=>setImmediate(resolve));signal?.throwIfAborted();}
   const tokens=new Set(normalize(file.path).split(' ')),candidates=new Map();for(const word of tokens)for(const i of byWord.get(word)||[])candidates.set(i,(candidates.get(i)||0)+1);
   for(const [i]of candidates){const item=lists[i],match=scoreMedia(item.row,root.id,file);if(match.score<40)continue;
    // Rank episode/date evidence BEFORE truncation, across every authorized root.
    item.matches.push({rootId:root.id,rootName:root.name,...match});item.matches.sort((a,b)=>b.score-a.score||a.file.path.localeCompare(b.file.path,'fr'));if(item.matches.length>20)item.matches.length=20;
   }
  }}return requested.map(({id,item})=>({id,matches:item.matches}));
 }
 async lease(rootId,file,origin,signal){
  if(this.hashJobs.size>=2)throw Error('Deux médias sont déjà en cours de vérification.');
  const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();const id=randomUUID();this.hashJobs.set(id,{rootId,controller});
  let handle;try{
   handle=await this.open(rootId,file,controller.signal);const before=await bounded(()=>handle.stat(),controller.signal,this.readTimeout),hash=createHash('sha256'),stream=handle.createReadStream({autoClose:false,autoDestroy:false,highWaterMark:1024*1024});
   const stop=()=>stream.destroy(controller.signal.reason);controller.signal.addEventListener('abort',stop,{once:true});
   let timer=setTimeout(()=>stream.destroy(Error('Lecture du média sans réponse.')),this.readTimeout);
   try{for await(const bytes of stream){controller.signal.throwIfAborted();clearTimeout(timer);timer=setTimeout(()=>stream.destroy(Error('Lecture du média sans réponse.')),this.readTimeout);hash.update(bytes);}}finally{clearTimeout(timer);controller.signal.removeEventListener('abort',stop);}
   controller.signal.throwIfAborted();const after=await bounded(()=>handle.stat(),controller.signal,this.readTimeout);controller.signal.throwIfAborted();if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||!this.roots.has(rootId))throw Error('Fichier modifié ou autorisation retirée.');
   const sha=hash.digest('hex'),token=randomBytes(32).toString('hex'),expires=Date.now()+12*3600000;
   for(const [key,ticket]of this.tickets)if(ticket.expires<Date.now())this.tickets.delete(key);if(this.tickets.size>=200)throw Error('Trop de médias ouverts : reconnectez le connecteur.');
   this.tickets.set(token,{rootId,file,origin,expires});
   return {descriptor:{url:`local-media:${sha}:${file.size}`,name:file.name,mimeType:MIME[path.extname(file.name).toLowerCase()]},mediaPath:`/v1/media/${token}`,expires};
  }finally{await handle?.close().catch(()=>{});this.hashJobs.delete(id);signal?.removeEventListener('abort',cancel);}
 }
 close(){for(const job of this.jobs.values())job.controller.abort(abortError());this.cancelReads();}
}
