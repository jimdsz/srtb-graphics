import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {ensureMediaEngine,digestFile} from './media-engine.mjs';

const MAX_BYTES=64*1024**3;
export function preparationArguments(input,output){return ['-hide_banner','-nostdin','-v','error','-n','-protocol_whitelist','file,pipe','-threads','2','-i',input,'-map','0:v:0','-map','0:a:0?','-sn','-dn','-vf','bwdif=mode=send_frame:parity=auto:deint=interlaced,scale=trunc(iw/2)*2:trunc(ih/2)*2:in_range=auto:out_range=tv','-c:v','libx264','-threads','2','-preset','fast','-crf','16','-pix_fmt','yuv420p','-color_range','tv','-g','25','-c:a','aac','-b:a','320k','-ac','2','-ar','48000','-movflags','+faststart','-map_metadata','-1','-progress','pipe:1','-f','mp4',output];}
function execute(exe,args,signal,progress=()=>{},timeout=6*3600000){return new Promise((resolve,reject)=>{
  signal.throwIfAborted();const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],signal});let out='',error='',settled=false;
  const timer=setTimeout(()=>child.kill(),timeout);
  child.stdout.on('data',bytes=>{out+=bytes;progress(String(bytes));if(out.length>1024*1024)out=out.slice(-1024*1024);});
  child.stderr.on('data',bytes=>{error=(error+bytes).slice(-4096);});
  child.once('error',reason=>{clearTimeout(timer);settled=true;reject(reason);});
  child.once('close',code=>{clearTimeout(timer);if(settled)return;signal.aborted?reject(signal.reason):code===0?resolve(out):reject(Error('Le moteur ne peut pas préparer ce fichier. Vérifiez la source, l’espace disque et la connexion réseau.'));});
});}
async function probe(engine,file,signal){const text=await execute(engine.ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration:stream=codec_type,codec_name,width,height,channels,pix_fmt,color_transfer','-of','json',file],signal,undefined,120000);const data=JSON.parse(text),video=data.streams?.find(s=>s.codec_type==='video');const duration=Number(data.format?.duration);if(!video||!Number.isFinite(duration)||duration<=0||duration>86400)throw Error('Vidéo absente ou durée non reconnue.');if(video.width>8192||video.height>8192)throw Error('La source dépasse 8K. Préparez une version plus petite.');return {duration,video,audio:data.streams.find(s=>s.codec_type==='audio'),audioTracks:data.streams.filter(s=>s.codec_type==='audio').length};}
const same=(a,b)=>a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&a.ino===b.ino&&a.dev===b.dev;

/** Only paths selected by a native human picker or validated by the existing
 * authorized-root resolver reach this class. No remote filesystem path input. */
export class MediaPreparation{
  constructor(dataDir,{pickFile,ensureEngine=ensureMediaEngine}={}){this.base=path.join(dataDir,'prepared-media');this.dataDir=dataDir;this.pickFile=pickFile;this.ensureEngine=ensureEngine;this.jobs=new Map();this.tickets=new Map();this.active=null;this.closed=false;}
  async start(origin,expected,requestSignal,source){
    if(this.closed||this.active)throw Error('Une préparation est déjà en cours sur ce poste. Attendez ou annulez-la.');
    if(expected&&(!expected.name||typeof expected.name!=='string'||expected.name.length>200||!Number.isSafeInteger(expected.size)||!Number.isSafeInteger(expected.modified)))throw Error('Référence du fichier invalide.');
    const id=randomUUID(),controller=new AbortController(),job={id,origin,controller,status:'running',stage:'Choisissez le fichier source dans la fenêtre du connecteur',progress:undefined};
    this.active=job;this.jobs.set(id,job);
    for(const [key,value]of this.jobs)if(value!==job&&value.status!=='running'&&this.jobs.size>30)this.jobs.delete(key);
    const abort=()=>controller.abort(requestSignal.reason);requestSignal.addEventListener('abort',abort,{once:true});
    try{
      const selected=source||await this.pickFile(controller.signal);controller.signal.throwIfAborted();
      if(!selected)throw new DOMException('Choix annulé.','AbortError');
      if(!path.isAbsolute(selected)||! /\.(mxf|mov|mp4|webm)$/i.test(selected))throw Error('Choisissez une vidéo MXF, MOV, MP4 ou WebM.');
      const stat=await fs.lstat(selected);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0||stat.size>MAX_BYTES)throw Error('Fichier absent, lien ou taille supérieure à 64 Go.');
      if(expected&&(path.basename(selected)!==expected.name||stat.size!==expected.size||Math.trunc(stat.mtimeMs)!==expected.modified))throw Error('Ce n’est pas le fichier choisi dans Graphics. Sélectionnez le même fichier.');
      job.name=path.basename(selected);job.source=await fs.realpath(selected);job.sourceStat=stat;
      job.promise=this.process(job).catch(error=>{job.status=controller.signal.aborted||error.name==='AbortError'?'cancelled':'error';job.stage=job.status==='cancelled'?'Préparation annulée':'Préparation interrompue';job.error=error.code==='ENOSPC'?'Espace disque insuffisant. Libérez de la place sur ce poste puis réessayez.':error.message||'Préparation impossible.';}).finally(()=>{if(this.active===job)this.active=null;});
      return {id};
    }catch(error){this.jobs.delete(id);if(this.active===job)this.active=null;throw error;}
    finally{requestSignal.removeEventListener('abort',abort);}
  }
  async process(job){
    const signal=job.controller.signal,report=value=>{Object.assign(job,value);};
    const engine=await this.ensureEngine(this.dataDir,signal,report);signal.throwIfAborted();
    job.stage='Analyse du fichier';const metadata=await probe(engine,job.source,signal);
    if(metadata.audioTracks>1)throw Error('Cette source contient plusieurs pistes son distinctes. Préparez un MP4 avec la piste souhaitée : Graphics ne choisira pas une langue ou un mixage à votre place.');
    if(['smpte2084','arib-std-b67'].includes(metadata.video.color_transfer))throw Error('Cette source HDR demande une conversion couleur contrôlée. Utilisez une copie MP4 SDR.');
    const stamp=createHash('sha256').update(JSON.stringify({profile:1,path:job.source,size:job.sourceStat.size,mtime:job.sourceStat.mtimeMs,ctime:job.sourceStat.ctimeMs})).digest('hex');
    await fs.mkdir(this.base,{recursive:true,mode:0o700});if((await fs.lstat(this.base)).isSymbolicLink())throw Error('Emplacement des copies locales non sûr.');
    const file=path.join(this.base,stamp+'.mp4'),manifest=path.join(this.base,stamp+'.json');
    // Reuse only complete, fingerprint-verified output from the same source
    // identity/profile. A partial file can never become a playback lease.
    try{const record=JSON.parse(await fs.readFile(manifest,'utf8'));const info=await fs.lstat(file);if(info.isFile()&&!info.isSymbolicLink()&&record.bytes===info.size&&record.hash===await digestFile(file,signal)){signal.throwIfAborted();await this.remember(record,stamp,job.origin);signal.throwIfAborted();job.output={file,record,stat:info};job.status='ready';job.stage='Copie locale retrouvée';job.progress=100;return;}}catch{signal.throwIfAborted();}
    const partial=path.join(this.base,randomUUID()+'.partial.mp4');
    try{
      const space=await fs.statfs(this.base);if(Number(space.bavail)*Number(space.bsize)<Math.min(job.sourceStat.size,metadata.duration*8*1024**2)+512*1024**2)throw Error('Espace disque insuffisant pour préparer ce programme. Libérez de la place sur le poste.');
      job.stage='Préparation de la copie MP4';job.progress=0;let pending='';
      await execute(engine.ffmpeg,preparationArguments(job.source,partial),signal,chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){const match=/^out_time_us=(\d+)/.exec(line.trim());if(match)job.progress=Math.min(99,Number(match[1])/1e6/metadata.duration*100);}});
      signal.throwIfAborted();if(!same(job.sourceStat,await fs.stat(job.source)))throw Error('Le fichier source a changé pendant la préparation. Actualisez votre choix.');
      job.stage='Vérification de la copie';job.progress=undefined;const check=await probe(engine,partial,signal);
      if(check.video.codec_name!=='h264'||check.video.pix_fmt!=='yuv420p'||Math.abs(check.duration-metadata.duration)>.25||!!check.audio!==!!metadata.audio||check.audio&&check.audio.codec_name!=='aac')throw Error('La copie produite ne conserve pas correctement l’image, le son ou la durée.');
      const info=await fs.stat(partial),hash=await digestFile(partial,signal);signal.throwIfAborted();
      if(info.size>MAX_BYTES)throw Error('La copie dépasse 64 Go.');
      const record={hash,bytes:info.size,name:job.name.replace(/\.[^.]+$/,'').slice(0,160)+' - Graphics.mp4',duration:check.duration,profile:'H.264 8 bits CRF16 / AAC 320 kb/s',sourceName:job.name};
      await fs.rename(partial,file);await fs.writeFile(manifest,JSON.stringify(record),{mode:0o600});signal.throwIfAborted();
      await this.remember(record,stamp,job.origin);const committed=await fs.stat(file);signal.throwIfAborted();job.output={file,record,stat:committed};job.status='ready';job.stage='Copie locale prête';job.progress=100;
    }finally{await fs.rm(partial,{force:true}).catch(()=>{});}
  }
  status(id,origin){const job=this.jobs.get(id);if(!job||job.origin!==origin)throw Error('Préparation introuvable.');return {id:job.id,status:job.status,stage:job.stage,progress:job.progress,error:job.error,name:job.name};}
  lease(id,origin){const job=this.jobs.get(id);if(!job||job.origin!==origin||job.status!=='ready'||job.controller.signal.aborted)throw Error('La copie n’est pas encore prête.');return this.leaseOutput(job.output,origin);}
  leaseOutput(output,origin){const token=randomBytes(32).toString('hex'),expires=Date.now()+12*3600000;for(const [key,ticket]of this.tickets)if(ticket.expires<Date.now())this.tickets.delete(key);if(this.tickets.size>=200)throw Error('Trop de copies ouvertes. Reconnectez le connecteur.');const {record,file,stat}=output;this.tickets.set(token,{origin,expires,file,size:record.bytes,stat,name:record.name});return {descriptor:{url:`local-media:${record.hash}:${record.bytes}`,name:record.name,mimeType:'video/mp4'},mediaPath:`/v1/media/${token}`,expires};}
  async remember(record,stamp,origin){const scope=createHash('sha256').update(origin).digest('hex').slice(0,16);await fs.writeFile(path.join(this.base,`${record.hash}-${record.bytes}-${scope}.ref.json`),JSON.stringify({stamp}),{mode:0o600});}
  async restore(reference,origin,signal){
    const match=/^local-media:([a-f\d]{64}):(\d{1,12})$/.exec(reference);if(!match)throw Error('Référence de copie invalide.');
    const scope=createHash('sha256').update(origin).digest('hex').slice(0,16),entry=path.join(this.base,`${match[1]}-${match[2]}-${scope}.ref.json`);
    let pointer;try{pointer=JSON.parse(await fs.readFile(entry,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if((await fs.lstat(this.base)).isSymbolicLink()||!/^[a-f\d]{64}$/.test(pointer.stamp))throw Error('Référence de copie invalide.');
    const file=path.join(this.base,pointer.stamp+'.mp4'),record=JSON.parse(await fs.readFile(path.join(this.base,pointer.stamp+'.json'),'utf8')),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||record.hash!==match[1]||record.bytes!==Number(match[2])||stat.size!==record.bytes||typeof record.name!=='string'||record.name.length>200)throw Error('Copie modifiée. Préparez le fichier à nouveau.');
    if(record.hash!==await digestFile(file,signal)||!same(stat,await fs.stat(file)))throw Error('Copie modifiée. Préparez le fichier à nouveau.');signal.throwIfAborted();
    return this.leaseOutput({file,record,stat},origin);
  }
  cancel(id,origin){const job=this.jobs.get(id);if(!job||job.origin!==origin)throw Error('Préparation introuvable.');job.controller.abort();if(job.status==='ready'){job.status='cancelled';job.stage='Préparation annulée';}for(const [key,ticket]of this.tickets)if(ticket.origin===origin&&ticket.file===job.output?.file)this.tickets.delete(key);}
  revoke(origin){for(const job of this.jobs.values())if(!origin||job.origin===origin)job.controller.abort();for(const [key,ticket]of this.tickets)if(!origin||ticket.origin===origin)this.tickets.delete(key);}
  async close(){this.closed=true;this.revoke();await Promise.all([...this.jobs.values()].map(job=>job.promise));}
}
