import {copyFile,lstat,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

export const PUBLISHED_DEPLOYMENT='https://cd51b957.srtb-graphics.pages.dev';
export const NATIVE_PUBLISHED_DEPLOYMENT='https://88bab601.srtb-graphics.pages.dev';
const approvedOrigins=new Set([PUBLISHED_DEPLOYMENT,'https://585ba1c9.srtb-graphics.pages.dev','https://3e34f1b8.srtb-graphics.pages.dev','https://072572a6.srtb-graphics.pages.dev','https://c548198a.srtb-graphics.pages.dev','https://32809088.srtb-graphics.pages.dev','https://1d4469ad.srtb-graphics.pages.dev','https://83183a04.srtb-graphics.pages.dev','https://4eb7fe2d.srtb-graphics.pages.dev',NATIVE_PUBLISHED_DEPLOYMENT,
 'https://85ffd0bb.srtb-graphics.pages.dev','https://8fc931b6.srtb-graphics.pages.dev','https://558e8b97.srtb-graphics.pages.dev','https://68db5df2.srtb-graphics.pages.dev','https://08e1f4e9.srtb-graphics.pages.dev','https://eeb91213.srtb-graphics.pages.dev','https://169a6a02.srtb-graphics.pages.dev','https://fab61257.srtb-graphics.pages.dev','https://d4f6782b.srtb-graphics.pages.dev','https://53ffab40.srtb-graphics.pages.dev','https://36e9e700.srtb-graphics.pages.dev']);
// 2026-10-13: Commercial workspace and qualified Ce soir changes, verified on production.
approvedOrigins.add('https://1f8c10ab.srtb-graphics.pages.dev');
// 2026-10-13: Revised Commercial editor, native motion and voice-driven duration verified on production.
approvedOrigins.add('https://f5e9593a.srtb-graphics.pages.dev');
// 2026-10-13: Commercial quality export, direct canvas editing and smooth backgrounds verified on production.
approvedOrigins.add('https://dc4b82de.srtb-graphics.pages.dev');
// 2026-10-13: Commercial logo dragging, legacy positions and export geometry verified.
approvedOrigins.add('https://1af02600.srtb-graphics.pages.dev');
// 2026-10-15: Commercial sequence timeline and announcement lifecycle verified in production.
approvedOrigins.add('https://52f72eeb.srtb-graphics.pages.dev');
// 2026-10-15: Commercial chronological editor, responsive layout and preview synchronization verified.
approvedOrigins.add('https://1bb063a2.srtb-graphics.pages.dev');
// Commercial readable modes and adaptive logos: production hashes and access guards verified.
approvedOrigins.add('https://ca242d39.srtb-graphics.pages.dev');
// Shared visible footer baseline: production hashes and access guards verified.
approvedOrigins.add('https://d3084a58.srtb-graphics.pages.dev');
// Automatic footer alignment and editable Bénin TV example: production hashes
// and anonymous access guards verified after actual MP4 qualification.
approvedOrigins.add('https://405d35a2.srtb-graphics.pages.dev');
// Presentation v8: actual MP4, neural narration/music mix, centered cards,
// brand bookends and production Commercial/Graphics hashes verified.
approvedOrigins.add('https://174ac444.srtb-graphics.pages.dev');
// Native opening/closing restored; production hashes and access guards verified.
approvedOrigins.add('https://69cdcba1.srtb-graphics.pages.dev');
// Automatic logo cleanup and upper-right placement: actual MP4, production
// Commercial/Graphics hashes and access guards verified.
approvedOrigins.add('https://75fee94d.srtb-graphics.pages.dev');
// 2026-10-20: readable commercial typography and an open central composition; production checks passed.
approvedOrigins.add('https://57f2d525.srtb-graphics.pages.dev');
approvedOrigins.add('https://aca52c3f.srtb-graphics.pages.dev');
// Three-line text limit and editor guidance: targeted QA and production checks passed.
approvedOrigins.add('https://660f8ec5.srtb-graphics.pages.dev');
// 2026-10-21: template montage, source audio and production asset hashes verified.
approvedOrigins.add('https://a16e4c0e.srtb-graphics.pages.dev');
approvedOrigins.add('https://1051ee62.srtb-graphics.pages.dev');
approvedOrigins.add('https://0c4a886f.srtb-graphics.pages.dev');
approvedOrigins.add('https://af384e17.srtb-graphics.pages.dev');
approvedOrigins.add('https://6707df5b.srtb-graphics.pages.dev');
approvedOrigins.add('https://419b0f4d.srtb-graphics.pages.dev');
approvedOrigins.add('https://0a332dc7.srtb-graphics.pages.dev');
approvedOrigins.add('https://facb2519.srtb-graphics.pages.dev');
approvedOrigins.add('https://21a5ce27.srtb-graphics.pages.dev');
approvedOrigins.add('https://e00e2409.srtb-graphics.pages.dev');
approvedOrigins.add('https://5c2376e0.srtb-graphics.pages.dev');
approvedOrigins.add('https://b6cec45d.srtb-graphics.pages.dev');
approvedOrigins.add('https://1d0b323e.srtb-graphics.pages.dev');
approvedOrigins.add('https://91ba5c51.srtb-graphics.pages.dev');
approvedOrigins.add('https://89b87d5c.srtb-graphics.pages.dev');
approvedOrigins.add('https://7fc52076.srtb-graphics.pages.dev');
approvedOrigins.add('https://a4af833c.srtb-graphics.pages.dev');
approvedOrigins.add('https://3fa5906d.srtb-graphics.pages.dev');
approvedOrigins.add('https://1d8a3d2a.srtb-graphics.pages.dev');
approvedOrigins.add('https://25d578a2.srtb-graphics.pages.dev');
approvedOrigins.add('https://31bcb6e4.srtb-graphics.pages.dev');
approvedOrigins.add('https://212b92a3.srtb-graphics.pages.dev');
approvedOrigins.add('https://c5dd3791.srtb-graphics.pages.dev');
approvedOrigins.add('https://079fad52.srtb-graphics.pages.dev');
approvedOrigins.add('https://148445c8.srtb-graphics.pages.dev');
approvedOrigins.add('https://0b7197c3.srtb-graphics.pages.dev');
approvedOrigins.add('https://b61e5fcb.srtb-graphics.pages.dev');
approvedOrigins.add('https://b1bd40a7.srtb-graphics.pages.dev');
approvedOrigins.add('https://29eb4c32.srtb-graphics.pages.dev');
approvedOrigins.add('https://0a2a56b6.srtb-graphics.pages.dev');
approvedOrigins.add('https://731a6ca2.srtb-graphics.pages.dev');
approvedOrigins.add('https://53aea4b5.srtb-graphics.pages.dev');
approvedOrigins.add('https://9d333353.srtb-graphics.pages.dev');
approvedOrigins.add('https://bc2a0eb2.srtb-graphics.pages.dev');
approvedOrigins.add('https://e0ec5430.srtb-graphics.pages.dev');
approvedOrigins.add('https://1bcfefb4.srtb-graphics.pages.dev');
approvedOrigins.add('https://8ad23147.srtb-graphics.pages.dev');
approvedOrigins.add('https://16e55c87.srtb-graphics.pages.dev');
approvedOrigins.add('https://146d3dc1.srtb-graphics.pages.dev');
approvedOrigins.add('https://f0dbe814.srtb-graphics.pages.dev');
approvedOrigins.add('https://8acb56b5.srtb-graphics.pages.dev');
approvedOrigins.add('https://b5b6d697.srtb-graphics.pages.dev');
approvedOrigins.add('https://b12b5a0d.srtb-graphics.pages.dev');
approvedOrigins.add('https://c83466ed.srtb-graphics.pages.dev');
approvedOrigins.add('https://fcb63514.srtb-graphics.pages.dev');
approvedOrigins.add('https://0b0a6d32.srtb-graphics.pages.dev');
approvedOrigins.add('https://d6d9b730.srtb-graphics.pages.dev');
approvedOrigins.add('https://7d41d025.srtb-graphics.pages.dev');
approvedOrigins.add('https://adeb499b.srtb-graphics.pages.dev');
approvedOrigins.add('https://fe6a9585.srtb-graphics.pages.dev');
approvedOrigins.add('https://9294e020.srtb-graphics.pages.dev');
approvedOrigins.add('https://6f133952.srtb-graphics.pages.dev');
approvedOrigins.add('https://f54df929.srtb-graphics.pages.dev');
approvedOrigins.add('https://3b65f06b.srtb-graphics.pages.dev');
approvedOrigins.add('https://133e7dd7.srtb-graphics.pages.dev');
approvedOrigins.add('https://96cc3b18.srtb-graphics.pages.dev');
approvedOrigins.add('https://477eb949.srtb-graphics.pages.dev');
approvedOrigins.add('https://bc80ac1b.srtb-graphics.pages.dev');
approvedOrigins.add('https://fb302892.srtb-graphics.pages.dev');
approvedOrigins.add('https://f7e32c0f.srtb-graphics.pages.dev');
approvedOrigins.add('https://e108877d.srtb-graphics.pages.dev');
approvedOrigins.add('https://ebc308f5.srtb-graphics.pages.dev');
// 2026-09-28: guarded production publication — local network search and subject tracking.
approvedOrigins.add('https://839a2224.srtb-graphics.pages.dev');
// 2026-09-29: guarded production publication — administrator member controls.
approvedOrigins.add('https://3563c181.srtb-graphics.pages.dev');
// 2026-09-29: guarded production publication — channels, programme resources and daily production.
approvedOrigins.add('https://bf4f2b75.srtb-graphics.pages.dev');
approvedOrigins.add('https://0982f57c.srtb-graphics.pages.dev');
approvedOrigins.add('https://7df96cc9.srtb-graphics.pages.dev');
approvedOrigins.add('https://2d1e1e68.srtb-graphics.pages.dev');
approvedOrigins.add('https://0db9b65e.srtb-graphics.pages.dev');
approvedOrigins.add('https://f50c6b4e.srtb-graphics.pages.dev');
approvedOrigins.add('https://8e8d69b7.srtb-graphics.pages.dev');
approvedOrigins.add('https://fb700e7a.srtb-graphics.pages.dev');
approvedOrigins.add('https://ec49af35.srtb-graphics.pages.dev');
// 2026-09-30: production channel spaces and explicit task/review workflow.
approvedOrigins.add('https://9fd8764b.srtb-graphics.pages.dev');
approvedOrigins.add('https://cbbd52d4.srtb-graphics.pages.dev');
approvedOrigins.add('https://29de6713.srtb-graphics.pages.dev');
approvedOrigins.add('https://94ce7134.srtb-graphics.pages.dev');
// 2026-09-30: visual onboarding and contextual help, verified on production.
approvedOrigins.add('https://1c54a450.srtb-graphics.pages.dev');
// 2026-09-30: native Tout de suite signatures enabled, tested and published.
approvedOrigins.add('https://7005f625.srtb-graphics.pages.dev');
// 2026-09-30: guarded permanent member deletion, production credential enabled.
approvedOrigins.add('https://8a8a8203.srtb-graphics.pages.dev');
approvedOrigins.add('https://4ea7e2c5.srtb-graphics.pages.dev');
// 2026-09-25: 1,632 deployed modules after the preview/edit recovery release.
// Preserve the previous open sessions while verifying the new graph.
// Retain open sessions' imports (~119 MiB of public hashed assets)
// with a bounded margin, rather than discarding previously published chunks.
// 1,662 assets measured after the image sizing/defaults release; bounded headroom.
// 2026-09-25: 1,690 verified files before the planner voice release. Retain the
// old open tabs' imports with bounded headroom for this additional public graph.
// 1,786 verified assets before the range delivery release; keep old tabs working.
// 2026-09-26: 1,879 files in the GPU-stall fix release, including verified history.
// Retain those public imports for already-open sessions, with bounded headroom.
// 2026-09-26: 1,969 files measured in the portable-folder release, including
// verified history. Keep existing sessions' imports; do not prune old modules.
// 2026-09-26: track-isolation release measures 2,060 public hashed assets;
// its 32 new chunks add 2.93 MB. Preserve prior sessions with bounded headroom.
// 2026-09-26: displayed-source crop release measures 2,120 hashed assets;
// 32 new chunks total 2,926,373 bytes. Retain all prior sessions' imports.
// 2026-09-26: contextual folder reconnection measures 2,151 hashed assets;
// 33 new chunks total 2,981,813 bytes. No previously published file is pruned.
// 2026-09-26: restored linked derivations measure 2,181 built hashed assets;
// 32 new chunks add 2,931,464 bytes. Preserve all open-session imports.
// 2026-09-26: planner editions measure 2,217 built assets; 36 additional
// hashed modules total 3,582,081 bytes. Preserve old tabs with bounded headroom.
// 2026-09-26: media lifecycle fixes measure 2,249 built assets; 32 additional
// hashed modules total 2,935,551 bytes. Keep prior tabs' imports intact.
// 2026-09-26: explicit weekly title fitting measures 2,282 built assets;
// 33 additional hashed modules, about 2.94 MB. Keep prior sessions' imports.
// 2026-09-26: sequence decoder recovery measures 2,315 built assets. Preserve
// all verified prior imports; bounded headroom for the additional public graph.
// 2026-09-26: non-blocking planner media read measures 2,348 built assets.
// Retain verified earlier sessions' imports with bounded headroom.
// AE live-playback release: 2,381 built assets, 34 additions (2,946,377 bytes)
// over 2,347 verified historical resources; preserve existing open sessions.
// Exact-inspection guard: 2,414 built assets, 34 additions (2,946,395 bytes).
// BA direct-canvas preview: 2,447 built assets, 34 additions (2,946,559 bytes).
// Preserve the previous 2,413 verified resources for already-open sessions.
// Canvas-loss guard: 2,479 built assets, 33 additions (2,946,407 bytes).
// Preserve verified imports for open tabs; bounded headroom, no pruning.
// Weekly-only recipe memory: 2,515 built assets, 36 additions (3,539,127 bytes).
// Keep verified earlier imports available for already-open sessions.
// 2026-09-28: template timing/logo corrections measure 2,614 hashed assets;
// 34 new modules add 3,060,925 bytes. Preserve all 2,580 verified imports.
// Network matching and optional subject worker: 2,694 built assets measured
// on 2026-09-28; retain every verified old chunk with bounded headroom.
// Member controls release: 2,732 assets measured; preserve open tabs' imports.
// Premium production adds 40 public assets; retain the prior sessions' imports.
// Explicit logo selection: 2,857 built assets, preserving the 2,814 verified
// modules used by already-open tabs. Bounded headroom, no historical pruning.
// Confirmed email actions: 2,896 built assets, 40 additions (3,569,481 bytes).
// Preserve the 2,856 verified earlier imports; no historical pruning.
// Grouped programme review: 2,936 built assets, 41 additions (3,652,420 bytes).
// Preserve the 2,895 verified earlier imports with bounded release headroom.
// Personal planner recovery: 2,976 built assets, 41 additions (3,674,105 bytes).
// Preserve all 2,935 verified imports used by existing sessions; no pruning.
// Guided recipe editing: 3,016 built assets, 41 additions (3,695,518 bytes).
// Preserve all 2,975 previously verified imports with bounded release headroom.
// Programme production dossier: 3,057 built assets, 42 additions (3,637,262 bytes).
// Preserve every verified previous module for already-open production tabs.
// This release uploads 46 assets; preserve all previously verified imports.
// Commercial revision 3 adds 60 verified modules (4,883,071 bytes), taking
// retained history to 3,619. Keep bounded headroom and every existing import.
// Commercial drag correction adds 57 measured assets (3,775,707 bytes),
// bringing the built set to 3,676; the verified published history retains
// 3,675 modules without removing any earlier import.
// Commercial sequences: 3,733 built assets, 58 additions (3,814,218 bytes).
// Keep all 3,675 verified previous modules with bounded release headroom.
// Commercial chronological editor: 3,789 built assets, 57 additions (3,821,208 bytes).
// Preserve all 3,732 previously verified imports; no historical pruning.
// Commercial readable modes: 3,845 built assets, 57 additions (3,841,194 bytes).
// Preserve all 3,788 previously verified imports with bounded release headroom.
// Commercial footer alignment: 3,900 built assets, 56 additions (3,813,873 bytes).
// All 3,844 previously verified imports remain inside this existing bound.
// Automatic commercial logo alignment and the editable Bénin TV example:
// 3,958 built assets, 59 additions (3,847,045 bytes). Preserve all 3,899
// previously verified imports with bounded headroom for this publication.
// Commercial presentation v8: measured 4,015 built assets, 58 additions.
// Retain all 3,957 verified imports; bounded headroom, no historical pruning.
// Automatic logo import: measured 4,129 built assets, 58 additions;
// all 4,071 verified imports retained, including the native-signature correction.
// Revision 10 retains 4,128 verified modules and adds 58 built assets.
// Revision 11 measured 4,243 built assets, retaining all 4,185 verified
// modules. Keep bounded headroom for this publication, without pruning.
// Revision 12 measured 4,301 built assets, retaining all 4,242 verified
// modules alongside the short-text controls.
// Montage release: 4,359 built assets, including 59 additions (3,888,236 bytes).
// Retain all 4,300 verified earlier modules for already-open sessions.
const MAX_HISTORY_ASSETS=4400;
// The PDF worker is the only bundled .mjs asset. Other .mjs strings in the
// graph name stable library engines, not /assets imports (e.g. supplemental).
const filePattern=/^(?:[-\w.]+-[-\w]{8}\.(?:js|css|wasm|woff2?|otf|ttf|png|jpe?g|webp|svg)|pdf\.worker\.min-[-\w]{8}\.mjs)$/;
const forbidden=/ffmpeg-core|\/ffmpeg\/|libx264|nal-hrd|cbr-fallback\.worker|@ffmpeg\/core/i;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const blockedHashes=new Set(['67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3','9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7']);
function validateAsset(name,bytes){
  if(!filePattern.test(name)||forbidden.test(name)||blockedHashes.has(hash(bytes))||/\.(?:m?js|css|svg)$/.test(name)&&forbidden.test(bytes.toString('utf8')))throw Error('Module incompatible avec la publication native : '+name);
}
function allowedMime(name,type){
  const mime=type.split(';')[0].trim().toLowerCase();
  if(/\.m?js$/.test(name))return ['text/javascript','application/javascript'].includes(mime);
  if(name.endsWith('.css'))return mime==='text/css';
  if(name.endsWith('.wasm'))return mime==='application/wasm';
  if(/\.(woff2?|otf|ttf)$/.test(name))return mime.startsWith('font/')||['application/font-woff','application/octet-stream'].includes(mime);
  return mime.startsWith('image/');
}

export async function verifyPublishedNativeHistory(root,fetcher=fetch,currentNative=false){
  const origin=currentNative?NATIVE_PUBLISHED_DEPLOYMENT:PUBLISHED_DEPLOYMENT;
  const source=resolve(root,currentNative?'dist-studio-native/assets':'.studio-asset-history'),folder=resolve(root,'.tools/native-release'),target=resolve(folder,'published-assets');
  await mkdir(target,{recursive:true});
  const names=(await readdir(source)).filter(name=>filePattern.test(name)).sort();
  if(names.length>MAX_HISTORY_ASSETS)throw Error('Audit historique trop volumineux ; sélectionnez explicitement la prochaine publication.');
  const files=[],skipped=[];let cursor=0;
  async function check(){
    while(cursor<names.length){
      const name=names[cursor++],path=resolve(source,name),info=await lstat(path);
      if(!info.isFile()||info.isSymbolicLink()||info.size>25*1024**2)throw Error('Candidat historique invalide.');
      const bytes=await readFile(path);
      try{validateAsset(name,bytes);}catch{skipped.push({name,reason:'blocked-component'});continue;}
      const response=await fetcher(`${origin}/assets/${name}`,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000)});
      const contentType=response.headers.get('content-type')||'';
      if(response.status!==200||!allowedMime(name,contentType)){await response.body?.cancel();skipped.push({name,reason:`status-or-mime:${response.status}`});continue;}
      const reader=response.body?.getReader();if(!reader)throw Error('Réponse publiée sans contenu.');
      const digest=createHash('sha256');let length=0;
      try{while(true){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>bytes.length){await reader.cancel();break;}digest.update(item.value);}}finally{reader.releaseLock();}
      const sha256=hash(bytes);
      if(length!==bytes.length||digest.digest('hex')!==sha256){skipped.push({name,reason:'different-bytes'});continue;}
      await copyFile(path,resolve(target,name));files.push({name,bytes:bytes.length,sha256,contentType});
    }
  }
  await Promise.all(Array.from({length:Math.min(4,names.length)},check));
  const manifest={profile:'native-only-published-history',origin,checkedAt:new Date().toISOString(),candidates:names.length,files:files.sort((a,b)=>a.name.localeCompare(b.name)),skipped:skipped.sort((a,b)=>a.name.localeCompare(b.name))};
  const deploymentId=new URL(origin).hostname.split('.')[0];
  await writeFile(resolve(folder,`published-history-${deploymentId}.json`),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(resolve(folder,'published-history.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

export async function restoreVerifiedNativeHistory(root){
  const folder=resolve(root,'.tools/native-release'),target=resolve(root,'dist-studio-native/assets');
  let manifest;try{manifest=JSON.parse(await readFile(resolve(folder,'published-history.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return 0;throw error;}
  if(manifest.profile!=='native-only-published-history'||!approvedOrigins.has(manifest.origin)||!Array.isArray(manifest.files)||manifest.files.length>MAX_HISTORY_ASSETS)throw Error('Inventaire publié natif invalide.');
  const names=new Set();await mkdir(target,{recursive:true});
  for(const file of manifest.files){
    if(file.origin&&!approvedOrigins.has(file.origin))throw Error('Origine de module historique non approuvée.');
    if(!filePattern.test(file.name)||names.has(file.name))throw Error('Nom historique invalide.');names.add(file.name);
    const from=resolve(folder,'published-assets',file.name),to=resolve(target,file.name),info=await lstat(from);
    if(!info.isFile()||info.isSymbolicLink())throw Error('Module historique non régulier.');
    const bytes=await readFile(from);validateAsset(file.name,bytes);
    if(bytes.length!==file.bytes||hash(bytes)!==file.sha256||!allowedMime(file.name,file.contentType))throw Error('Module historique différent de la preuve publiée.');
    try{if(!(await lstat(to)).isFile()||hash(await readFile(to))!==file.sha256)throw Error('Collision de module historique.');}
    catch(error){if(error.code!=='ENOENT')throw error;await copyFile(from,to);}
  }
  return names.size;
}

/** Recover public hashed chunks from an explicitly approved immutable release.
 * Never follows outside /assets, uses credentials, reads private media, or executes downloaded JS.
 * Preserve per-file provenance so another build can retain open tabs' lazy imports. */
export async function archiveApprovedNativeGraph(root,origin,fetcher=fetch){
  if(!approvedOrigins.has(origin))throw Error('Déploiement non approuvé pour cet audit.');
  const folder=resolve(root,'.tools/native-release'),target=resolve(folder,'published-assets');
  await mkdir(target,{recursive:true});
  await restoreVerifiedNativeHistory(root); // Validate the existing evidence before merging.
  const prior=JSON.parse(await readFile(resolve(folder,'published-history.json'),'utf8'));
  const files=new Map(prior.files.map(file=>[file.name,{...file,origin:file.origin||prior.origin}]));
  async function download(path,limit){
    const response=await fetcher(origin+path,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000)});
    if(response.status!==200){await response.body?.cancel();throw Error(`Ressource publiée indisponible : ${path} (${response.status}).`);}
    const reader=response.body?.getReader();if(!reader)throw Error('Réponse vide.');
    const chunks=[];let length=0;
    try{while(true){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>limit)throw Error('Ressource publiée trop volumineuse.');chunks.push(item.value);}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    return {bytes:Buffer.concat(chunks),contentType:response.headers.get('content-type')||''};
  }
  const html=await download('/',128*1024);
  if(html.contentType.split(';')[0].trim().toLowerCase()!=='text/html')throw Error('Entrée publiée non HTML.');
  const queue=[...html.bytes.toString('utf8').matchAll(/\/(assets\/[-\w.]+-[-\w]{8}\.(?:js|css))/g)].map(match=>match[1].slice(7));
  if(!queue.length)throw Error('Entrée publiée introuvable.');
  const seen=new Set();let total=0;
  while(queue.length){
    const name=queue.shift();if(seen.has(name))continue;seen.add(name);
    if(!filePattern.test(name)||seen.size>120)throw Error('Graphe publié non borné ou nom invalide.');
    const {bytes,contentType}=await download('/assets/'+name,25*1024**2);total+=bytes.length;
    if(total>100*1024**2||!allowedMime(name,contentType))throw Error(`Type ou taille de graphe publié invalide : ${name} (${contentType}, ${total} octets cumulés).`);
    validateAsset(name,bytes);const sha256=hash(bytes),previous=files.get(name);
    if(previous&&previous.sha256!==sha256)throw Error('Collision de fichier publié : '+name);
    if(/\.(?:m?js|css)$/.test(name))for(const match of bytes.toString('utf8').matchAll(/["'`](?:\.\/|\/assets\/|assets\/)?([-\w.]+-[-\w]{8}\.(?:m?js|css|wasm|woff2?|otf|ttf|png|jpe?g|webp|svg))["'`]/g))if(filePattern.test(match[1]))queue.push(match[1]);
    await writeFile(resolve(target,name),bytes);
    files.set(name,{name,bytes:bytes.length,sha256,contentType,origin});
  }
  if(files.size>MAX_HISTORY_ASSETS)throw Error('Historique trop volumineux.');
  const manifest={profile:prior.profile,origin,checkedAt:new Date().toISOString(),candidates:seen.size,files:[...files.values()].sort((a,b)=>a.name.localeCompare(b.name)),skipped:[]};
  await writeFile(resolve(folder,`published-history-${new URL(origin).hostname.split('.')[0]}.json`),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(resolve(folder,'published-history.json'),JSON.stringify(manifest,null,2)+'\n');
  return {origin,verified:seen.size,retained:files.size};
}
