import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {videoExtension} from '../src/studio/video/export.ts';
test('MOV downloads are MOV, while all existing extensions remain unchanged',()=>{
  assert.equal(videoExtension('mov'),'.mov');assert.equal(videoExtension('mp4'),'.mp4');assert.equal(videoExtension('alpha'),'.webm');assert.equal(videoExtension('png'),'_PNG.zip');
});
test('ProRes is lazy and uses explicit straight RGBA, not premultiplied canvas frames',async()=>{
  const code=await readFile(new URL('../src/studio/video/prores.ts',import.meta.url),'utf8');
  assert.match(code,/getImageData/);assert.match(code,/new VideoSample\(/);assert.match(code,/format:'RGBA'/);assert.match(code,/fullCodecString:'ap4h'/);assert.match(code,/sample.close\(\)/);
  const exporter=await readFile(new URL('../src/studio/video/export.ts',import.meta.url),'utf8');assert.match(exporter,/import\('\.\/prores'\)/);assert.match(exporter,/codec:'pcm-s24'/);
  assert.doesNotMatch(code,/\bfetch\(|XMLHttpRequest|sendBeacon/);
});
