import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {verifyQualifiedCore,qualifiedCoreHashes} from '../scripts/ffmpeg-cbr-integrity.mjs';

const js=readFileSync('vendor/ffmpeg-core-0.12.10/ffmpeg-core.js');
const gzip=readFileSync('vendor/ffmpeg-core-0.12.10/ffmpeg-core.wasm.gz');

test('existing vendor gzip is decompressed and measured against the qualified WASM before any copy',()=>{
  const actual=verifyQualifiedCore(js,gzip);
  assert.equal(actual.jsSha256,qualifiedCoreHashes.js);assert.equal(actual.wasmSha256,qualifiedCoreHashes.wasm);
  assert.equal(actual.compressedWasmBytes,gzip.byteLength);assert.equal(actual.compressedWasmSha256,'1767a2d0c6d6b14de37876261443397cecd591f298b162eded99018de4f6355d');assert.ok(actual.wasmBytes>gzip.byteLength);
});
test('valid but substituted gzip cannot inherit the expected hash in a manifest',()=>{
  assert.throws(()=>verifyQualifiedCore(js,gzipSync(Buffer.from('another WASM'))),/décompressé ne correspond pas/);
});
test('corrupt and truncated gzip are refused even if the JS is intact',()=>{
  const corrupted=Buffer.from(gzip);corrupted[corrupted.length-8]^=1;
  assert.throws(()=>verifyQualifiedCore(js,corrupted),/corrompu/);
  assert.throws(()=>verifyQualifiedCore(js,gzip.subarray(0,gzip.length-30)),/corrompu/);
});
test('unqualified JS and empty gzip are refused',()=>{
  assert.throws(()=>verifyQualifiedCore(Buffer.from('wrong JS'),gzip),/modifié ou inattendu/);
  assert.throws(()=>verifyQualifiedCore(js,Buffer.alloc(0)),/vide/);
});
test('preparation validates before writing the exact checked buffers and uses the measured manifest',()=>{
  const source=readFileSync('scripts/prepare-ffmpeg-cbr.mjs','utf8');
  assert.ok(source.indexOf('verifyQualifiedCore(jsBytes,gzip)')<source.indexOf("writeFile(join(output,'ffmpeg-core.js')"));
  assert.ok(source.includes("writeFile(join(output,'ffmpeg-core.wasm.gz'),gzip)"));
  assert.ok(source.includes("license:'GPL-2.0-or-later',...verified"));
  assert.ok(readFileSync('scripts/ffmpeg-cbr-integrity.mjs','utf8').includes('maxOutputLength:64*1024*1024'));
  assert.ok(readFileSync('vendor/ffmpeg-core-0.12.10/RELEASE_BLOCKED.md','utf8').includes('Corresponding Source'));
});
