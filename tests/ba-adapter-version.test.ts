import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {publishedBAEditor,verifyPublishedBAEditor} from '../scripts/preserve-ba-editor-v1.mjs';
const root=resolve(import.meta.dirname,'..');
test('the published BA v1 reference is pinned to the 072572a6 sealed artifact, not current generated code',async()=>{
  assert.equal(publishedBAEditor.deployment,'https://072572a6.srtb-graphics.pages.dev');
  await verifyPublishedBAEditor(root);
  for(const [name,record]of Object.entries(publishedBAEditor.files)){
    const bytes=await readFile(resolve(root,'dist-studio-native/studio-engines/ba-text-v1',name));
    assert.equal(bytes.length,record.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
  }
});
test('the v2 generator cannot overwrite published v1 modules and the native build checks historical bytes first',async()=>{
  const generator=await readFile(resolve(root,'scripts/build-ba-editor.mjs'),'utf8'),build=await readFile(resolve(root,'scripts/build-studio-native.mjs'),'utf8');
  assert.match(generator,/directory=resolve\(root,'public\/studio-engines\/ba-text-v2'\)/);
  assert.doesNotMatch(generator,/writeFile\(resolve\(root,'public\/studio-engines\/ba-text-v1/);
  assert.ok(build.indexOf('await verifyPublishedBAEditor(root)')<build.indexOf("run(['scripts/build-ba-editor.mjs'])"));
});
test('audio clock is established before drawing and synchronously at the IN/OUT boundaries',async()=>{
  const code=await readFile(resolve(root,'public/studio-engines/ba-text-v2/graphic.mjs'),'utf8');
  const tick=code.slice(code.indexOf('    _tick(){'),code.indexOf('    _beginOut(reason){'));
  assert.ok(tick.indexOf('this.audio.sync(')<tick.indexOf('this.scene.animation.goToAndStop'));
  assert.match(code,/this\.audio\.sync\(start,\{playing:true,muted:this\.muted,discontinuity:true\}\)/);
  assert.match(code,/this\.audio\.sync\(64\.8,\{playing:true,muted:this\.muted,discontinuity:true\}\)/);
});
