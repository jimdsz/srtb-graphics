import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {MediaPreparation,preparationArguments} from './media-preparation.mjs';
import {createConnectorServer} from './server.mjs';
const run=promisify(execFile),engine={ffmpeg:process.env.TEST_FFMPEG||'C:/Program Files/PlayoutPilot/Components/casparcg/current/ffmpeg.exe',ffprobe:process.env.TEST_FFPROBE||'C:/Program Files/PlayoutPilot/Components/casparcg/current/ffprobe.exe'};
const origin='https://srtb-graphics.pages.dev';
async function fixture(){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'graphics-prepare-'));const file=path.join(dir,'Source professionnelle.mxf');await run(engine.ffmpeg,['-v','error','-nostdin','-f','lavfi','-i','testsrc2=size=320x180:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-pix_fmt','yuv422p10le','-c:a','pcm_s24le','-ac','2','-f','mxf',file],{windowsHide:true});return {dir,file};}
test('fixed conversion profile cannot be used to inject paths or shell commands',()=>{const args=preparationArguments('source.mxf','output.mp4');assert.equal(args.includes('-nostdin'),true);assert.equal(args[args.indexOf('-protocol_whitelist')+1],'file,pipe');assert.equal(args.includes('yuv420p'),true);assert.equal(args.includes('aac'),true);assert.equal(args.includes('-n'),true);});
test('real 10-bit MXF becomes verified H264/AAC, source intact, cache reusable and range lease revoked',async()=>{
 const {dir,file}=await fixture(),before=await fs.readFile(file);let launches=0;
 const service=new MediaPreparation(path.join(dir,'metadata'),{pickFile:async()=>file,ensureEngine:async()=>{launches++;return engine;}});
 try{
  const stat=await fs.stat(file),expected={name:path.basename(file),size:stat.size,modified:Math.trunc(stat.mtimeMs)},request=new AbortController();
  const {id}=await service.start(origin,expected,request.signal);await service.jobs.get(id).promise;
  const status=service.status(id,origin);assert.equal(status.status,'ready',status.error);assert.equal(status.progress,100);
  assert.throws(()=>service.status(id,'https://attacker.example'),/introuvable/);
  const lease=service.lease(id,origin);assert.equal(lease.descriptor.mimeType,'video/mp4');assert.match(lease.descriptor.url,/^local-media:[a-f\d]{64}:\d+$/);
  assert.deepEqual(await fs.readFile(file),before);
  const output=service.jobs.get(id).output.file,mtime=(await fs.stat(output)).mtimeMs;
  const reopened=new MediaPreparation(path.join(dir,'metadata'));
  const recovered=await reopened.restore(lease.descriptor.url,origin,request.signal);assert.equal(recovered.descriptor.url,lease.descriptor.url);
  assert.equal(await reopened.restore(lease.descriptor.url,'https://attacker.example',request.signal),null);await reopened.close();
  const second=await service.start(origin,expected,request.signal);await service.jobs.get(second.id).promise;
  assert.equal(service.status(second.id,origin).stage,'Copie locale retrouvée');assert.equal((await fs.stat(output)).mtimeMs,mtime);
  service.revoke(origin);assert.equal(service.tickets.size,0);
  await assert.rejects(service.start(origin,{...expected,size:stat.size+1},request.signal),/même fichier/);
 }finally{await service.close();}
});
test('cancellation during final persistence cannot publish a ready job',async()=>{
 const {dir,file}=await fixture(),service=new MediaPreparation(path.join(dir,'metadata'),{pickFile:async()=>file,ensureEngine:async()=>engine});
 let entered,release;const reached=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const remember=service.remember.bind(service);service.remember=async(...args)=>{entered();await gate;await remember(...args);};
 try{const {id}=await service.start(origin,undefined,new AbortController().signal);await reached;service.cancel(id,origin);release();await service.jobs.get(id).promise;assert.equal(service.status(id,origin).status,'cancelled');assert.throws(()=>service.lease(id,origin));}finally{release();await service.close();}
});
test('source error keeps output unavailable and native picker cancellation is neutral',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'graphics-prepare-bad-')),file=path.join(dir,'unreadable.mxf');await fs.writeFile(file,'Not an MXF');
 const app=await createConnectorServer({dataDir:path.join(dir,'metadata'),port:0,pickFile:async()=>null,preparationOptions:{ensureEngine:async()=>engine}});
 try{
  const response=await fetch(app.url+'/v1/preparation/pick',{method:'POST',headers:{Origin:app.url,Authorization:'Bearer '+app.owner,'Content-Type':'application/json'},body:JSON.stringify({allowEngineDownload:true})});assert.equal(response.status,200);assert.deepEqual(await response.json(),{cancelled:true});
  const {id}=await app.preparation.start(origin,undefined,new AbortController().signal,file);await app.preparation.jobs.get(id).promise;assert.equal(app.preparation.status(id,origin).status,'error');assert.throws(()=>app.preparation.lease(id,origin));
 }finally{await app.close();}
});
test('cancellation interrupts pending engine preparation and does not publish output',async()=>{
 const {dir,file}=await fixture();const service=new MediaPreparation(path.join(dir,'metadata'),{pickFile:async()=>file,ensureEngine:async(_dir,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
 try{const {id}=await service.start(origin,undefined,new AbortController().signal);service.cancel(id,origin);await service.jobs.get(id).promise;assert.equal(service.status(id,origin).status,'cancelled');assert.throws(()=>service.lease(id,origin));assert.equal(service.tickets.size,0);}finally{await service.close();}
});
test('HTTP preparation requires pairing + consent, never accepts remote paths, and streams only completed MP4',async()=>{
 const {dir,file}=await fixture(),app=await createConnectorServer({dataDir:path.join(dir,'metadata'),port:0,pickFile:async()=>file,preparationOptions:{ensureEngine:async()=>engine}});
 const req=async(route,data,token=app.owner,site=app.url)=>fetch(app.url+'/v1/'+route,{method:data===undefined?'GET':'POST',headers:{Origin:site,Authorization:'Bearer '+token,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 try{
  assert.equal((await req('preparation/pick',{allowEngineDownload:true},'wrong',origin)).status,401);
  assert.equal((await req('preparation/pick',{allowEngineDownload:false})).status,400);
  assert.equal((await req('preparation/pick',{allowEngineDownload:true,path:'C:/private.txt'})).status,400);
  const {code}=await (await req('pairing',{})).json(),{token}=await (await req('pair',{code},'',origin)).json();
  const response=await req('preparation/pick',{allowEngineDownload:true},token,origin);assert.equal(response.status,202);const {id}=await response.json();await app.preparation.jobs.get(id).promise;
  const lease=await (await req('preparation/'+id+'/lease',{},token,origin)).json();assert.ok(lease.mediaPath,JSON.stringify(lease));
  const partial=await fetch(app.url+lease.mediaPath,{headers:{Origin:origin,Range:'bytes=0-63'}});assert.equal(partial.status,206);assert.equal(partial.headers.get('content-type'),'video/mp4');assert.equal((await partial.arrayBuffer()).byteLength,64);
  assert.equal(JSON.stringify(lease).includes(dir),false);
  await req('disconnect',{},token,origin);assert.equal((await fetch(app.url+lease.mediaPath)).status,403);
 }finally{await app.close();}
});
