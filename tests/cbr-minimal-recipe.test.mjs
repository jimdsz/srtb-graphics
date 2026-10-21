import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateLock,verifyBytes,verifyArchiveListing,verifyArchiveTypes,within} from '../scripts/prepare-cbr-minimal.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const lock=JSON.parse(await readFile(resolve(root,'scripts/cbr-minimal/sources.lock.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('immutable image, complete commit pins and four scoped source archives',()=>{
  assert.equal(validateLock(lock),lock);
  for(const mutation of [
    copy=>{copy.image.reference='emscripten/emsdk:3.1.40';},
    copy=>{copy.sources[0].commit='n5.1.4';},
    copy=>{copy.sources.push(copy.sources[0]);},
    copy=>{copy.sources[0].file='../source.tar.gz';},
    copy=>{copy.stageDirectory='public/ffmpeg';},
  ]) {const copy=structuredClone(lock);mutation(copy);assert.throws(()=>validateLock(copy));}
});

test('equal-size archive substitution and truncation are rejected before staging',()=>{
  const bytes=Buffer.from('original source archive');
  const source={id:'fixture',bytes:bytes.length,sha256:hash(bytes)};
  assert.doesNotThrow(()=>verifyBytes(source,bytes));
  const changed=Buffer.from(bytes);changed[3]^=1;
  assert.throws(()=>verifyBytes(source,changed),/differs from pin/);
  assert.throws(()=>verifyBytes(source,bytes.subarray(1)),/differs from pin/);
});

test('archive paths stay in their pinned tree and notices cannot silently vanish',()=>{
  const source={id:'fixture',directory:'source-abc',notices:['COPYING']};
  const good='source-abc/\nsource-abc/COPYING\nsource-abc/src/a.c\n';
  assert.equal(verifyArchiveListing(source,good),3);
  for(const bad of ['source-abc/../outside','/source-abc/file','other-tree/file','source-abc/C:/file','source-abc/a\\b']) assert.throws(()=>verifyArchiveListing(source,good+bad+'\n'),/Unsafe archive/);
  assert.throws(()=>verifyArchiveListing(source,'source-abc/a.c\n'),/Missing source notice/);
});

test('source/staging path guards reject absolute, parent and root targets',()=>{
  assert.equal(within(root,'.tools/example'),resolve(root,'.tools/example'));
  for(const bad of ['..','../outside','.',root]) assert.throws(()=>within(root,bad),/declared source directory/);
});

test('extracted archives cannot introduce symlinks, hardlinks or device entries',()=>{
  assert.doesNotThrow(()=>verifyArchiveTypes({id:'fixture'},'-rw-r--r-- file\ndrwxr-xr-x dir\n'));
  for(const type of ['l','h','b','c','p','s']) assert.throws(()=>verifyArchiveTypes({id:'fixture'},type+'rwxrwxrwx entry\n'),/special archive/);
});

test('offline runner binds only the staged inputs/output and cannot pull or publish',async()=>{
  const run=await readFile(resolve(root,'scripts/cbr-minimal/run-container.sh'),'utf8');
  assert.ok(run.includes('image='+lock.image.reference));
  for(const option of ['--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges']) assert.ok(run.includes(option));
  assert.equal((run.match(/--mount /g)||[]).length,2);
  assert.ok(run.includes('dst=/inputs,readonly'));
  assert.ok(run.includes('dst=/output'));
  assert.doesNotMatch(run,/docker\s+(pull|build)|apt(-get)?\s+|wrangler|\.env|src\/studio|public\/|vendor\//);
});

test('minimal build keeps the native worker API and excludes implicit external ports',async()=>{
  const build=await readFile(resolve(root,'scripts/cbr-minimal/build.sh'),'utf8');
  for(const flag of ['--enable-decoder=h264','--enable-parser=h264','--enable-encoder=libx264','--enable-demuxer=mov','--enable-muxer=mp4','--enable-protocol=file','--disable-autodetect','--disable-network','--disable-everything','--disable-thread','--disable-opencl']) assert.ok(build.includes(flag));
  for(const source of ['cmdutils','ffmpeg','ffmpeg_filter','ffmpeg_hw','ffmpeg_mux','ffmpeg_opt','opt_common','ffprobe']) assert.ok(build.includes('src/fftools/'+source+'.c'));
  assert.ok(build.includes('--enable-filter=null,format,scale,trim,transpose,hflip,vflip,rotate'));
  assert.doesNotMatch(build,/-sUSE_SDL|-lworkerfs|--enable-lib(?:x265|vpx|mp3lame|ass|freetype)|curl\s|wget\s|apt-get/);
  assert.ok(build.includes('unset FFMPEG_MT'));
});
