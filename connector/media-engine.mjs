import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
// Download directly from the upstream distributor, never redistribute its
// executable in Graphics. Keep upstream license/readme/source links intact.
export const ENGINE={version:'9.0.2',folder:'ffmpeg-9.0.2-essentials_build',url:'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip',sha256:'60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',ffmpeg:'3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec',ffprobe:'f0d36ecbbdd3bcfac3efa078c96c7271c2e68b3810595552ac3b7f17e9a65c52'};
export async function digestFile(file,signal){const hash=createHash('sha256');const stream=createReadStream(file,{signal});for await(const chunk of stream)hash.update(chunk);return hash.digest('hex');}
export async function ensureMediaEngine(dataDir,signal,progress){
  if(process.platform!=='win32')throw Error('La préparation locale demande le connecteur Windows. Les copies MP4 préparées restent utilisables sur Mac.');
  const base=path.join(dataDir,'video-engine-'+ENGINE.version);await fs.mkdir(base,{recursive:true,mode:0o700});
  if((await fs.lstat(base)).isSymbolicLink())throw Error('Emplacement du moteur vidéo non sûr.');
  const archive=path.join(base,'engine.zip'),manifest=path.join(base,'integrity.json');
  const ffmpeg=path.join(base,ENGINE.folder,'bin','ffmpeg.exe'),ffprobe=path.join(base,ENGINE.folder,'bin','ffprobe.exe');
  // Trust comes from executable digests extracted from the verified upstream
  // archive, not from a mutable local manifest.
  try{if(ENGINE.ffmpeg===await digestFile(ffmpeg,signal)&&ENGINE.ffprobe===await digestFile(ffprobe,signal))return {ffmpeg,ffprobe};}catch{signal.throwIfAborted();}
  let complete=false;try{complete=await digestFile(archive,signal)===ENGINE.sha256;}catch{signal.throwIfAborted();}
  if(!complete){
  progress({stage:'Téléchargement du moteur vidéo · première utilisation'});
  let offset=0;try{offset=(await fs.stat(archive)).size;}catch{}
  if(offset>150*1024**2)offset=0;
  const response=await fetch(ENGINE.url,{signal:AbortSignal.any([signal,AbortSignal.timeout(1800000)]),headers:offset?{Range:`bytes=${offset}-`}:{}});
  if(!response.ok||new URL(response.url).protocol!=='https:')throw Error('Le moteur vidéo ne peut pas être téléchargé. Vérifiez la connexion puis réessayez.');
  const resume=offset>0&&response.status===206&&response.headers.get('content-range')?.startsWith(`bytes ${offset}-`);
  if(response.status===206&&!resume)throw Error('Reprise du téléchargement invalide. Réessayez.');
  if(!resume)offset=0;
  const output=await fs.open(archive,resume?'a':'w',0o600);let bytes=offset;
  const total=offset+Number(response.headers.get('content-length'));
  try{for await(const chunk of response.body){signal.throwIfAborted();bytes+=chunk.length;if(bytes>150*1024**2)throw Error('Moteur vidéo reçu trop volumineux.');await output.write(chunk);progress({stage:'Téléchargement du moteur vidéo · première utilisation',...(total>0?{progress:Math.min(99,bytes/total*100)}:{})});}}finally{await output.close();}
  if(await digestFile(archive,signal)!==ENGINE.sha256){await fs.truncate(archive,0);throw Error('Le moteur vidéo reçu ne correspond pas à la version vérifiée. Aucun exécutable n’a été lancé.');}
  }
  progress({stage:'Installation locale du moteur vidéo',progress:undefined});
  // Only this pinned archive is extracted. No user-supplied archive or command.
  await run(path.join(process.env.SystemRoot||'C:/Windows','System32','tar.exe'),['-xf',archive,'-C',base],{windowsHide:true,signal,timeout:120000,maxBuffer:1024*1024});
  const saved={archive:ENGINE.sha256,ffmpeg:await digestFile(ffmpeg,signal),ffprobe:await digestFile(ffprobe,signal)};
  if(saved.ffmpeg!==ENGINE.ffmpeg||saved.ffprobe!==ENGINE.ffprobe)throw Error('Le moteur installé ne correspond pas à la version vérifiée. Aucun traitement lancé.');
  await fs.writeFile(manifest,JSON.stringify(saved),{mode:0o600});return {ffmpeg,ffprobe};
}
