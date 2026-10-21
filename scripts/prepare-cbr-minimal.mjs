// Offline source verification/staging only. Does not extract or execute sources,
// download the compiler, build the app, copy into vendor/public, or release.
import {lstat, mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recipeFiles=['sources.lock.json','build.sh','pkg-config-x264.sh','run-container.sh','README.md'];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function within(root, name) {
  const target=resolve(root,name),rel=relative(root,target);
  if(!rel||isAbsolute(name)||isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')) throw Error('Path leaves the declared source directory');
  return target;
}

export function validateLock(lock) {
  if(lock.schemaVersion!==1||lock.status!=='recipe-only-not-built-not-qualified-not-release-approved') throw Error('Invalid recipe status');
  if(lock.sourceDirectory!=='.tools/cbr-source-candidates'||lock.stageDirectory!=='.tools/cbr-minimal/context') throw Error('Unexpected recipe scope');
  if(!/^emscripten\/emsdk@sha256:[a-f0-9]{64}$/.test(lock.image?.reference)||lock.image.platform!=='linux/amd64') throw Error('Compiler image must be pinned by digest');
  const expected=['ffmpeg','x264','bindings','emscripten-source'];
  if(!Array.isArray(lock.sources)||lock.sources.length!==expected.length||new Set(lock.sources.map(s=>s.id)).size!==expected.length) throw Error('Unexpected source set');
  for(const source of lock.sources) {
    if(!expected.includes(source.id)||!/^\w[\w.-]*--[\w.-]+-[a-f0-9]{40}\.tar\.gz$/.test(source.file)||!source.file.includes(source.commit)||!/^[a-f0-9]{40}$/.test(source.commit)||!/^[a-f0-9]{64}$/.test(source.sha256)||!Number.isSafeInteger(source.bytes)||source.bytes<1||source.bytes>32*1024**2) throw Error('Invalid source pin');
    if(!/^[\w.-]+-[a-f0-9]{40}$/.test(source.directory)||!source.directory.endsWith(source.commit)) throw Error('Invalid archive root');
    if(!source.url.startsWith('https://codeload.github.com/')||!source.url.endsWith('/'+source.commit)) throw Error('Source URL must select the pinned commit');
  }
  return lock;
}

export function verifyBytes(source, bytes) {
  if(bytes.length!==source.bytes||sha256(bytes)!==source.sha256) throw Error('Source archive differs from pin: '+source.id);
}

export function verifyArchiveListing(source, listing) {
  const paths=listing.split(/\r?\n/).filter(Boolean);
  if(!paths.length||paths.some(p=>p!==source.directory+'/'&&!p.startsWith(source.directory+'/')||p.includes('\\')||p.includes(':')||p.split('/').includes('..')||p.startsWith('/'))) throw Error('Unsafe archive path: '+source.id);
  for(const notice of source.notices) if(!paths.includes(source.directory+'/'+notice)) throw Error('Missing source notice: '+source.id+'/'+notice);
  return paths.length;
}

export function verifyArchiveTypes(source, listing) {
  if(listing.split(/\r?\n/).filter(Boolean).some(line=>!/^[-d]/.test(line))) throw Error('Links or special archive entries refused: '+source.id);
}

async function assertRegularPath(root, target) {
  const parts=relative(root,target).split(/[\\/]/);let current=root;
  for(const part of parts) {current=join(current,part);if((await lstat(current)).isSymbolicLink()) throw Error('Symlink/reparse source path refused');}
  if(!(await lstat(target)).isFile()) throw Error('Source must be a regular file');
}

export async function verifySources(root, lock) {
  validateLock(lock);
  const verified=[];
  for(const source of lock.sources) {
    const path=within(root,join(lock.sourceDirectory,source.file));
    await assertRegularPath(root,path);
    const bytes=await readFile(path);verifyBytes(source,bytes);
    // tar only lists names; it never extracts content or executes an archive.
    const result=spawnSync(process.platform==='win32'?'tar.exe':'tar',['-tf',path],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024**2,timeout:30_000});
    if(result.error||result.status!==0) throw Error('Cannot list verified source: '+source.id+': '+(result.error?.message||result.stderr));
    if(source.role==='build') {
      const types=spawnSync(process.platform==='win32'?'tar.exe':'tar',['-tvf',path],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024**2,timeout:30_000});
      if(types.error||types.status!==0) throw Error('Cannot inspect archive types: '+source.id);
      verifyArchiveTypes(source,types.stdout);
    }
    verified.push({source,bytes,entries:verifyArchiveListing(source,result.stdout)});
  }
  return verified;
}

export async function main(args=process.argv.slice(2), root=projectRoot) {
  if(args.length>1||args.length===1&&!['--check','--stage'].includes(args[0])) throw Error('Usage: node scripts/prepare-cbr-minimal.mjs [--check|--stage]');
  const recipe=join(root,'scripts/cbr-minimal');
  const lock=JSON.parse(await readFile(join(recipe,'sources.lock.json'),'utf8'));
  const verified=await verifySources(root,lock);
  const summary={status:lock.status,archives:verified.map(({source,entries})=>({id:source.id,bytes:source.bytes,sha256:source.sha256,entries})),image:lock.image.reference,networkUsed:false,compiled:false,qualified:false};
  if(args[0]==='--stage') {
    // Read all bytes before the first write; copies use these verified buffers.
    const records=verified.map(({source,bytes})=>({name:source.file,bytes}));
    for(const name of recipeFiles) records.push({name,bytes:await readFile(join(recipe,name))});
    const destination=within(root,lock.stageDirectory),parent=dirname(destination);
    const toolsDir=join(root,'.tools');
    if((await lstat(toolsDir)).isSymbolicLink()) throw Error('Symlink/reparse staging path refused');
    try {await mkdir(parent);} catch(error) {if(error.code!=='EEXIST') throw error;}
    if((await lstat(parent)).isSymbolicLink()) throw Error('Symlink/reparse staging path refused');
    await mkdir(destination); // EEXIST is intentional: never overwrite a bundle.
    for(const record of records) await writeFile(join(destination,record.name),record.bytes,{flag:'wx',mode:0o644});
    const sums=records.map(({name,bytes})=>sha256(bytes)+'  '+name).join('\n')+'\n';
    await writeFile(join(destination,'SHA256SUMS'),sums,{flag:'wx'});
    await writeFile(join(destination,'staging-report.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
    summary.staged=relative(root,destination).replaceAll('\\','/');
  }
  console.log(JSON.stringify(summary,null,2));
  return summary;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.message);process.exitCode=1;});
