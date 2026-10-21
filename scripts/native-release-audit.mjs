import {createHash} from 'node:crypto';
import {lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {nativeReleaseProfile} from './studio-release-profile.mjs';
import {validateDerivationRequirement} from './derivation-migration-gate.mjs';
import {validatePlannerRequirement} from './planner-migration-gate.mjs';
import {validatePrivacyRequirement} from './project-privacy-gate.mjs';
import {validateAutomationRequirement} from './automation-migration-gate.mjs';

const maximumFileBytes=25*1024**2;
// Pinned qualified core artifacts, not hashes read from a mutable vendor folder.
// The gzip was independently expanded and checked against the raw WASM hash.
const forbiddenHashes=new Set([
  '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3',
  '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7',
  '1767a2d0c6d6b14de37876261443397cecd591f298b162eded99018de4f6355d',
]);
const forbiddenName=/ffmpeg-core|(?:^|\/)ffmpeg(?:\/|$)|libx264|nal-hrd|cbr-fallback(?:\.worker)?(?:[.\-/?#]|$)|@ffmpeg\/core/i;
const forbiddenContent=/ffmpeg-core|\/ffmpeg\/|libx264|nal-hrd|cbr-fallback\.worker|@ffmpeg\/core/i;
const textFile=/\.(?:[cm]?js|css|html?|json)$/i;
const derivationTemplates={BTV_BA_TDS:'graphic.mjs',BTV_Renvoi:'graphic-v2.mjs',BTV_Evenement:'graphic-v2.mjs',BTV_Semainier:'graphic-v2.mjs'};
// Frozen library source: a Node-only operator utility invoking an installed
// executable, not a browser encoder. Never exempt a graph module or renamed copy.
const offlineSourcePath='library/v1.7.0/BTV_BA_1P/prepare-slow-motion.mjs';
const offlineSourceSha256='be860549b99529de284aea3f88faf391125d586d8e569c8177bc9200fb818e16';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const slash=value=>value.replaceAll('\\','/');
const fail=message=>{throw Error(`Native release audit: ${message}`);};

function outside(directory,file){
  const child=relative(directory,file);
  return child!==''&&(child==='..'||child.startsWith(`..${process.platform==='win32'?'\\':'/'}`)||isAbsolute(child));
}

async function noSymlinks(path,allowMissing=false){
  let current=resolve(path),missing=allowMissing;
  for(;;){
    try{
      const info=await lstat(current);
      if(info.isSymbolicLink())fail(`symbolic link forbidden: ${current}`);
      missing=false;
    }catch(error){if(error.code!=='ENOENT'||!missing)throw error;}
    const parent=dirname(current);
    if(parent===current)break;
    current=parent;
  }
}

async function boundedFile(path){
  const before=await lstat(path);
  if(!before.isFile()||before.isSymbolicLink())fail(`regular file required: ${path}`);
  if(before.size>maximumFileBytes)fail(`file exceeds 25 MiB: ${path}`);
  const bytes=await readFile(path),after=await lstat(path);
  if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino||!after.isFile()||after.isSymbolicLink())fail(`file changed during audit: ${path}`);
  return bytes;
}

function safeRelativePath(path){
  return typeof path==='string'&&path.length>0&&!path.includes('\\')&&!path.includes(':')&&!/[\x00-\x1f\x7f]/.test(path)&&!path.startsWith('/')&&path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..');
}

function inspectName(path){
  if(!safeRelativePath(path))fail(`unsafe output path: ${path}`);
  if(forbiddenName.test(path))fail(`software fallback artifact forbidden: ${path}`);
  if(path.split('/').some(part=>/^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)|^\.(?:git|svn)$|^node_modules$/i.test(part))||/\.map(?:\.|$)/i.test(path))fail(`environment, source map or development artifact forbidden: ${path}`);
}

async function readGraph(graphFile,profile){
  const bytes=await boundedFile(graphFile);
  let graph;
  try{graph=JSON.parse(bytes.toString('utf8'));}catch{fail('invalid module graph JSON');}
  if(!graph||graph.profile!==profile.name||!Array.isArray(graph.modules)||graph.modules.length===0||graph.modules.some(item=>typeof item!=='string'||item.length===0))fail('nonempty '+profile.name+' module graph required');
  // Existing OFF inventories remain verifiable. Newly built graphs record the
  // explicit client flags; ON requires them and its exact migration manifest.
  if(graph.requirements!==undefined||profile.derivations){
    const requirements=graph.requirements;
    if(!requirements||requirements.version!==1||requirements.nativeOnly!==true||requirements.derivations!==profile.derivations||requirements.qualification!==false||!Array.isArray(requirements.migrations)||requirements.migrations.length!==(profile.derivations?1:0))fail('native client flags and migration requirements mismatch');
    if(profile.derivations)validateDerivationRequirement(requirements.migrations[0]);
  }
  const modules=graph.modules.map(value=>slash(value).replace(/[?#].*$/,''));
  if(modules.some(module=>module.endsWith('/src/studio/DayPlanner.tsx')||module==='src/studio/DayPlanner.tsx'))validatePlannerRequirement(graph.requirements?.planner);
  if(graph.requirements?.privacy)validatePrivacyRequirement(graph.requirements.privacy);
  if(modules.some(module=>module.endsWith('/src/studio/ChannelWorkspace.tsx')||module==='src/studio/ChannelWorkspace.tsx'))validateAutomationRequirement(graph.requirements?.automation);
  for(const module of modules){
    if(forbiddenName.test(module))fail(`software fallback module forbidden: ${module}`);
    if(module===offlineSourcePath||module.endsWith('/'+offlineSourcePath))fail(`offline preparation source forbidden in browser module graph: ${module}`);
  }
  for(const required of ['src/studio/video/release-profile.ts','src/studio/video/opaque-native-adapter.ts']){
    if(!modules.some(module=>module===required||module.endsWith('/'+required)))fail(`required native module missing: ${required}`);
  }
  if(profile.derivations)for(const required of ['src/studio/DerivationPanel.tsx','src/studio/derivation-api.ts','src/studio/client-capabilities.ts']){
    if(!modules.some(module=>module===required||module.endsWith('/'+required)))fail(`required derivation client module missing: ${required}`);
  }
  if(graph.outputs!==undefined){
    if(!Array.isArray(graph.outputs)||graph.outputs.some(output=>typeof output!=='string'))fail('module graph outputs must be paths');
    for(const output of graph.outputs)inspectName(output);
    if(new Set(graph.outputs).size!==graph.outputs.length)fail('duplicate module graph outputs');
  }
  return {graph,record:{bytes:bytes.length,sha256:hash(bytes)}};
}

async function paths(buildDirectory,graphFile,inventoryFile,writing){
  const build=resolve(buildDirectory),graph=resolve(graphFile),inventory=resolve(inventoryFile);
  if(build===dirname(build))fail('filesystem root cannot be a build directory');
  if(!outside(build,graph)||!outside(build,inventory)||graph===inventory)fail('graph and inventory must be separate files outside the build directory');
  await noSymlinks(build);await noSymlinks(graph);await noSymlinks(inventory,writing);
  if(!(await lstat(build)).isDirectory())fail('build directory required');
  return {build,graph,inventory};
}

async function capture(build,graphFile,profile){
  const {graph,record}=await readGraph(graphFile,profile),files=[],directories=[],content=new Map();
  const clientOutputs=new Set((graph.outputs??[]).filter(path=>/\.[cm]?js$/i.test(path)));
  const currentClient=[];
  async function visit(directory,prefix=''){
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const name=prefix+entry.name,path=join(directory,entry.name),info=await lstat(path);
      if(info.isSymbolicLink())fail(`symbolic link forbidden: ${name}`);
      inspectName(name);
      if(info.isDirectory()){directories.push(name);await visit(path,name+'/');continue;}
      const bytes=await boundedFile(path),sha256=hash(bytes);
      if(forbiddenHashes.has(sha256))fail(`pinned software fallback binary forbidden: ${name}`);
      if(textFile.test(name)&&forbiddenContent.test(bytes.toString('utf8'))&&!(name===offlineSourcePath&&sha256===offlineSourceSha256))fail(`software fallback content forbidden: ${name}`);
      files.push({path:name,bytes:bytes.length,sha256});
      if(['index.html','_worker.js','_routes.json'].includes(name))content.set(name,bytes.toString('utf8'));
      // Only current graph outputs can prove catalogue inclusion. Retained old
      // chunks must not hide a missing model in the newly built client.
      if(profile.derivations&&clientOutputs.has(name))currentClient.push(bytes.toString('utf8'));
    }
  }
  await visit(build);
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);directories.sort();
  if(!content.get('index.html')?.trim())fail('nonempty index.html required');
  let routes;
  try{routes=JSON.parse(content.get('_routes.json'));}catch{fail('private _routes.json required');}
  if(routes?.version!==1||JSON.stringify(routes.include)!=='["/*"]'||JSON.stringify(routes.exclude)!=='[]')fail('all routes must include /* with no public exclusions');
  const worker=files.find(file=>file.path==='_worker.js'),workerCode=content.get('_worker.js');
  if(!worker||!workerCode?.includes('authenticateSession')||!workerCode.includes('Public fallback is forbidden.'))fail('private worker session authentication and fail-closed guard required');
  if(profile.derivations){
    for(const marker of ['derivation_batches','project_derivations','derivations-v1'])if(!workerCode.includes(marker))fail('activated derivation Worker marker missing: '+marker);
    const clientCode=currentClient.join('\n');
    for(const [id,engine] of Object.entries(derivationTemplates)){
      // New clients must use the qualified version, while already-open clients
      // retain their original module. Do not let retained chunks prove inclusion.
      if(!files.some(file=>file.path===`library/v1.7.0/${id}/graphic.mjs`&&file.bytes>0))fail('required derivation catalogue asset missing: original engine '+id);
      for(const entry of [engine,'preview.html']){
        const path=`library/v1.7.0/${id}/${entry}`;
        if(!files.some(file=>file.path===path&&file.bytes>0))fail('required derivation catalogue asset missing: '+path);
        if(!clientCode.includes('/'+path)||!workerCode.includes('/'+path))fail('required derivation catalogue reference missing from current client or Worker: '+path);
      }
    }
  }else if(/derivation_batches|project_derivations/.test(workerCode))fail('unreleased derivation API/tables forbidden in the bug-fix Worker');
  // Marker checks are regression guards, not a proof of authentication semantics.
  if(/\.passThroughOnException\s*\(/.test(workerCode))fail('worker must not enable public pass-through on exception');
  for(const output of graph.outputs??[])if(!files.some(file=>file.path===output))fail(`module graph output missing: ${output}`);
  return {version:profile.derivations?2:1,profile:profile.name,...(profile.derivations||graph.requirements?.planner?{requirements:graph.requirements}:{}),graph:record,routes:{version:1,include:['/*'],exclude:[]},worker,files,directories};
}

/** Build-local integrity seal, not a cryptographic signature or trust authority. */
export async function writeNativeInventory(buildDirectory,graphFile,inventoryFile,profileName='native-only'){
  const profile=nativeReleaseProfile(profileName);
  const locations=await paths(buildDirectory,graphFile,inventoryFile,true);
  const payload=await capture(locations.build,locations.graph,profile);
  const inventory={...payload,sha256:hash(JSON.stringify(payload))};
  await mkdir(dirname(locations.inventory),{recursive:true});
  await noSymlinks(locations.inventory,true);
  await writeFile(locations.inventory,JSON.stringify(inventory,null,2)+'\n');
  return inventory;
}

/** Reruns policy checks and rejects every file, directory or graph difference. */
export async function verifyNativeInventory(buildDirectory,graphFile,inventoryFile,profileName='native-only'){
  const profile=nativeReleaseProfile(profileName);
  const locations=await paths(buildDirectory,graphFile,inventoryFile,false);
  let inventory;
  try{inventory=JSON.parse((await boundedFile(locations.inventory)).toString('utf8'));}catch(error){fail(`inventory unreadable: ${error.message}`);}
  if(!inventory||typeof inventory!=='object'||Array.isArray(inventory))fail('invalid inventory');
  const {sha256,...payload}=inventory;
  if(typeof sha256!=='string'||sha256!==hash(JSON.stringify(payload)))fail('inventory self-hash mismatch');
  const actual=await capture(locations.build,locations.graph,profile);
  if(JSON.stringify(payload)!==JSON.stringify(actual))fail('inventory mismatch: build files, directories or module graph changed');
  return inventory;
}
