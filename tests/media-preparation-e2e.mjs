// Real connector + pinned native FFmpeg + browser decode, isolated from production.
// The native picker is replaced by one explicit synthetic test path. No user media.
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createConnectorServer} from '../connector/server.mjs';
const run=promisify(execFile),base=process.argv[2]||'http://127.0.0.1:5238';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'graphics-mxf-e2e-')),source=path.join(dir,'Recette source.mxf');
const engine={ffmpeg:path.resolve('.tools/media-preparation/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe'),ffprobe:path.resolve('.tools/media-preparation/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe')};
await run(engine.ffmpeg,['-v','error','-nostdin','-f','lavfi','-i','testsrc2=size=640x360:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-pix_fmt','yuv422p10le','-c:a','pcm_s24le','-ac','2','-f','mxf',source],{windowsHide:true});
const before=await fs.readFile(source);let picks=0;
const app=await createConnectorServer({dataDir:path.join(dir,'data'),port:0,origins:[base],pickFile:async()=>{picks++;return source;},preparationOptions:{ensureEngine:async()=>engine}});
const browser=await chromium.launch({channel:'msedge',headless:true});const errors=[],unexpected=[];
try{
 const page=await browser.newPage({viewport:{width:1366,height:768}});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin==='http://127.0.0.1:43871')return route.fulfill({response:await route.fetch({url:app.url+url.pathname+url.search,headers:{...route.request().headers(),host:new URL(app.url).host}})});
  if(url.origin!==base||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(route.request().method())){unexpected.push(url.href);return route.abort();}
  return route.continue();
 });
 const pair=async()=>{const response=await fetch(app.url+'/v1/pairing',{method:'POST',headers:{Origin:app.url,Authorization:'Bearer '+app.owner}});const {code}=await response.json();await page.evaluate(async code=>{const {pairConnector}=await import('/src/studio/connector-client.ts');await pairConnector(code);},code);};
 await page.goto(base+'/tests/programme-media-resources.html?mode=empty-catalogue');await pair();
 await page.locator('input[type=file]').setInputFiles(source);await expect(page.getByText('Copie MP4 sur ce poste',{exact:true})).toBeVisible();assert.equal(picks,0);
 await page.getByRole('button',{name:'Préparer et utiliser',exact:true}).click();
 await expect(page.getByText('Recette source - Graphics.mp4',{exact:true})).toBeVisible({timeout:30000});assert.equal(picks,1);
 await page.getByRole('button',{name:'Utiliser ce média',exact:true}).click();
 const descriptor=await page.evaluate(()=>window.programmeMediaEvidence.bindings[0]?.media);assert.match(descriptor.url,/^local-media:/);
 assert.deepEqual(await fs.readFile(source),before);
 // Restore a saved reference in a fresh page, with IndexedDB deliberately unavailable.
 await page.reload();await pair();
 const restored=await page.evaluate(async reference=>{
  Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){throw new DOMException('Unavailable in this qualification','SecurityError');}}});
  const media=await import('/src/studio/local-media.ts');const ok=await media.restoreLocal(reference,()=>{});return {ok,url:media.localURL(reference)};
 },descriptor.url);assert.equal(restored.ok,true);
 const playback=await page.evaluate(async url=>{const video=document.createElement('video');video.muted=true;video.src=url;document.body.append(video);await video.play();const before=video.currentTime;await new Promise(resolve=>setTimeout(resolve,600));const result={duration:video.duration,width:video.videoWidth,height:video.videoHeight,advances:video.currentTime>before};video.pause();video.remove();return result;},restored.url);
 assert.equal(playback.advances,true);assert.equal(playback.width,640);assert.ok(Math.abs(playback.duration-2)<=.08,'Duration within two 25fps frames including audio padding');assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 const report={realNativeEngine:'FFmpeg 9.0.2',syntheticMXF:'H264 4:2:2 10 bits + PCM24 stereo',wholeSyntheticFileConverted:true,sourceBytesUnchanged:true,explicitStart:true,plannerConfirmation:true,restoredWithoutIndexedDB:true,playback,noUpload:true,nativePickerUIQualified:false,errors};
 await fs.mkdir('reports/media-preparation-e2e',{recursive:true});await fs.writeFile('reports/media-preparation-e2e/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await app.close();}
