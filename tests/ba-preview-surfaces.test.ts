import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {baPreviewPlacement,baPreviewStage} from '../src/studio/ba-preview-surfaces';

test('BA raster reduction keeps exact native framing for each fit and phase',()=>{
  for(const [w,h]of [[3840,2160],[1080,1920],[4096,2160],[640,480]])for(const fit of ['cover','contain'])for(const kind of ['intro','body','pack'] as const){
    const scale=(fit==='cover'?Math.max:Math.min)(1920/w,1080/h);
    assert.deepEqual(baPreviewPlacement(w,h,fit,kind),{x:(1920-w*scale)/2+1,y:(1080-h*scale)/2+(kind==='pack'?-152:kind==='intro'?1:0),width:w*scale,height:h*scale});
  }
});
test('logical BA stage is scaled once and letterboxed, never cropped at laptop sizes',()=>{
  for(const [width,height]of [[320,180],[720,405],[1100,618.75],[640,800],[1500,600]]){
    const s=baPreviewStage(width,height);
    assert.ok(s.x>=0&&s.y>=0);
    assert.ok(s.x+1920*s.scale<=width+1e-8);assert.ok(s.y+1080*s.scale<=height+1e-8);
    assert.ok(Math.abs(1920*s.scale/ (1080*s.scale)-16/9)<1e-8);
  }
});
test('preview reuses pinned native colour shader and cannot alter delivery renderer',async()=>{
  const native=await readFile('public/library/v1.7.0/BTV_BA_1P/media.mjs','utf8');
  assert.equal(createHash('sha256').update(native).digest('hex'),'9e955794db66e24d4c14b16a65ef2bad92e8712c042f25c191a301f65bee6924');
  const shader=await readFile('public/studio-engines/ba-text-v2/preview-colour.mjs','utf8');
  assert.equal(shader,'export '+native.slice(native.indexOf('class PackGrade{'),native.indexOf('export async function installMediaCanvases')));
  const preview=await readFile('src/studio/Preview.tsx','utf8'),engine=await readFile('src/studio/video/engine.ts','utf8');
  assert.match(preview,/if\(format==='tv'\)installBAPreviewSurfaces/);assert.doesNotMatch(engine,/installBAPreviewSurfaces/);
  assert.doesNotMatch(await readFile('public/studio-engines/ba-text-v2/portable.mjs','utf8'),/__installPreviewMediaCanvases/);
});
