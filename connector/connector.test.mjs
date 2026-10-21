import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {Connector,bounded} from './core.mjs';
import {createConnectorServer,byteRange} from './server.mjs';

async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'srtb-connector-test-'));
 // Deliberately retained in OS temp, never recursively delete a computed directory.
 const root=path.join(dir,'medias'),outside=path.join(dir,'outside');await fs.mkdir(root);await fs.mkdir(outside);
 await fs.mkdir(path.join(root,'divers'));await fs.mkdir(path.join(root,'prive'));
 const bytes=Buffer.from('synthetic-video-not-production-0123456789');
 await fs.writeFile(path.join(root,'divers','Bonjour le Bénin 2026-09-28.mp4'),bytes);
 await fs.writeFile(path.join(root,'prive','Bonjour le Benin prive.mp4'),bytes);
 await fs.writeFile(path.join(root,'secret.txt'),'not a media');await fs.writeFile(path.join(outside,'Bonjour le Benin hors.mp4'),bytes);
 const connector=await new Connector(path.join(dir,'index')).init();t.after(()=>connector.close());const allowed=await connector.authorize(root,['prive']);return {dir,root,outside,bytes,connector,allowed};
}
async function index(c,id){c.start(id);await c.jobs.get(id).promise;assert.equal(c.root(id).state,'ready');}

test('scattered media names, exclusions, persistent metadata and no absolute paths in site response',async t=>{
 const f=await fixture(t);await index(f.connector,f.allowed.id);
 const result=await f.connector.search([{id:'row',title:'Bonjour le Bénin'}]);assert.equal(result[0].matches.length,1);
 assert.equal(result[0].matches[0].file.path,'divers/Bonjour le Bénin 2026-09-28.mp4');assert.equal(f.connector.list()[0].files,1);
 assert.equal(JSON.stringify(f.connector.list()).includes(f.root.replaceAll('\\','\\\\')),false);
 const restored=await new Connector(path.join(f.dir,'index')).init();t.after(()=>restored.close());assert.deepEqual(await restored.search([{id:'row',title:'Bonjour le Bénin'}]),result);
});

test('token-directed search preserves ranking, ties and independent programmes without reading media contents',async t=>{
 const f=await fixture(t);await index(f.connector,f.allowed.id);
 const queries=[{id:'a',title:'Bonjour le Bénin'},{id:'b',title:'Bonjour Bonjour'},{id:'c',title:'Pour les'},{id:'d',title:'Programme inconnu'},{id:'e',title:'Bénin'}];
 const results=await f.connector.search(queries);assert.deepEqual(results.map(r=>[r.id,r.matches.length]),[['a',1],['b',1],['c',0],['d',0],['e',1]]);
 for(const row of results.filter(r=>r.matches.length))assert.ok(row.matches[0].score>=40);
 const c=new AbortController();c.abort();await assert.rejects(()=>f.connector.search(queries,c.signal),e=>e.name==='AbortError');
});

test('episode and date ranking precedes the top 20 cutoff across dispersed authorized roots',async t=>{
 const f=await fixture(t);const other=await f.connector.authorize(f.outside);
 for(let i=1;i<=65;i++)await fs.writeFile(path.join(f.root,`Série Horizon S01E${String(i).padStart(3,'0')}.mp4`),'synthetic');
 await fs.writeFile(path.join(f.outside,'Série Horizon S02E010.mp4'),'synthetic');
 for(let i=1;i<=28;i++)await fs.writeFile(path.join(f.root,`Bonjour le Benin 2026-08-${String(i).padStart(2,'0')}.mp4`),'synthetic');
 await index(f.connector,f.allowed.id);await index(f.connector,other.id);
 const results=await f.connector.search([{id:'episode',title:'Série Horizon',subtitle:'S02E010',airDate:'2026-09-28'},{id:'day',title:'Bonjour le Bénin',subtitle:'',airDate:'2026-09-28'}]);
 assert.equal(results[0].matches.length,20);assert.equal(results[0].matches[0].file.name,'Série Horizon S02E010.mp4');assert.equal(results[0].matches[0].manual,false);
 assert.equal(results[1].matches[0].file.name,'Bonjour le Bénin 2026-09-28.mp4');
 assert.ok(results[1].matches.slice(1).some(m=>m.manual));
 await assert.rejects(()=>f.connector.search([{id:'x',title:'a',subtitle:{}}]),/invalide/);
});
test('many numbered popup frames and finished promos cannot evict the programme video',async t=>{
 const f=await fixture(t);
 for(let i=0;i<65;i++)await fs.writeFile(path.join(f.root,`POP UP BONJOUR LE BENIN LUNDI 7H_${String(i).padStart(5,'0')}.png`),'synthetic');
 await fs.writeFile(path.join(f.root,'BONJOUR LE BENIN BA.mp4'),'synthetic');
 await index(f.connector,f.allowed.id);
 const [result]=await f.connector.search([{id:'r',title:'Bonjour le Bénin',airDate:'2026-09-28'}]);
 assert.equal(result.matches[0].file.name,'Bonjour le Bénin 2026-09-28.mp4');
 assert.equal(result.matches[0].manual,false);
 assert.ok(result.matches.slice(1).every(m=>m.manual&&m.score<=45));
});

test('lease verifies content; cannot spoof names to read non-media or leave a grant',async t=>{
 const f=await fixture(t);await index(f.connector,f.allowed.id);const [{matches:[{file}]}]=await f.connector.search([{id:'r',title:'Bonjour Benin'}]);
 const lease=await f.connector.lease(f.allowed.id,file,'https://srtb-graphics.pages.dev');assert.equal(lease.descriptor.url,`local-media:${createHash('sha256').update(f.bytes).digest('hex')}:${f.bytes.length}`);
 for(const invalid of [{...file,path:'../outside/file.mp4'},{...file,path:'secret.txt',name:'file.mp4'},{...file,path:'prive/Bonjour le Benin prive.mp4',name:'Bonjour le Benin prive.mp4'},{...file,size:file.size+1}])await assert.rejects(()=>f.connector.lease(f.allowed.id,invalid,'site'));
 await fs.appendFile(path.join(f.root,file.path),'changed');await assert.rejects(()=>f.connector.open(f.allowed.id,file),/changé/);
 await f.connector.revoke(f.allowed.id);assert.equal(f.connector.tickets.size,0);await assert.rejects(()=>f.connector.open(f.allowed.id,file));
});
test('junctions do not extend authorization',async t=>{
 const f=await fixture(t);try{await fs.symlink(f.outside,path.join(f.root,'escape'),process.platform==='win32'?'junction':'dir');}catch(e){if(e.code==='EPERM'){t.skip('OS does not permit test symlink');return;}throw e;}
 await index(f.connector,f.allowed.id);const results=await f.connector.search([{id:'r',title:'Bonjour Benin'}]);assert.equal(results[0].matches.length,1);await assert.rejects(()=>f.connector.safePath(f.allowed,'escape/Bonjour le Benin hors.mp4'),/liens/);
});
test('cancelling an index keeps previous committed index and shuts down cleanly',async t=>{
 const f=await fixture(t);await index(f.connector,f.allowed.id);const old=await fs.readFile(path.join(f.dir,'index',f.allowed.id+'.ndjson'),'utf8');f.connector.start(f.allowed.id);f.connector.stop(f.allowed.id);await f.connector.jobs.get(f.allowed.id).promise;
 assert.equal(f.allowed.state,'cancelled');assert.equal(await fs.readFile(path.join(f.dir,'index',f.allowed.id+'.ndjson'),'utf8'),old);
 assert.equal((await fs.readdir(path.join(f.dir,'index'))).some(n=>n.endsWith('.tmp')),false);
});

test('immediate cancellation waits for the temporary index handle to close',async t=>{
 const f=await fixture(t);
 for(let attempt=0;attempt<20;attempt++){
  f.connector.start(f.allowed.id);const job=f.connector.jobs.get(f.allowed.id);f.connector.stop(f.allowed.id);await job.promise;
  assert.equal(f.allowed.state,'cancelled');
  assert.equal((await fs.readdir(path.join(f.dir,'index'))).some(n=>n.endsWith('.tmp')),false);
 }
 await index(f.connector,f.allowed.id);assert.equal(f.allowed.files,1);
});
test('timeouts release handles that arrive late and cancellation never hangs',async()=>{
 let disposed=false;await assert.rejects(()=>bounded(()=>new Promise(r=>setTimeout(()=>r({}),25)),undefined,5,()=>{disposed=true;}),e=>e.name==='TimeoutError');await new Promise(r=>setTimeout(r,40));assert.equal(disposed,true);
 const c=new AbortController();c.abort();await assert.rejects(()=>bounded(()=>Promise.resolve(),c.signal),e=>e.name==='AbortError');
});
test('HTTP pairing, DNS rebinding / origin guard, byte ranges, revocation and private errors',async t=>{
 const f=await fixture(t),site='https://srtb-graphics.pages.dev';let picks=0;
 const s=await createConnectorServer({dataDir:path.join(f.dir,'http-index'),port:0,pickDirectory:async()=>{picks++;return f.root;}});t.after(()=>s.close());
 const api=async(route,{token,origin=site,method='GET',data,headers={}}={})=>fetch(s.url+route,{method,headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json'}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});
 assert.equal((await api('/v1/roots')).status,401);assert.equal((await api('/v1/health',{origin:'https://evil.example'})).status,403);
 assert.equal(await new Promise((resolve,reject)=>{http.get(s.url+'/v1/health',{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject);}),403);
 const opt=await api('/v1/roots',{method:'OPTIONS'});assert.equal(opt.status,204);assert.equal(opt.headers.get('Access-Control-Allow-Origin'),site);
 assert.equal((await api('/v1/roots/pick',{method:'POST',data:{path:f.root}})).status,401);assert.equal(picks,0);
 const owner={origin:s.url,token:s.owner,method:'POST',data:{}};
 const code=(await (await api('/v1/pairing',owner)).json()).code;
 const paired=await (await api('/v1/pair',{method:'POST',data:{code}})).json();assert.ok(paired.token);
 assert.equal((await api('/v1/pair',{method:'POST',data:{code}})).status,403);
 assert.equal((await api('/v1/roots/pick',{method:'POST',token:paired.token,data:{path:f.root}})).status,404);assert.equal(picks,0);
 assert.equal((await api('/v1/roots/pick',owner)).status,200);assert.equal(picks,1);
 const root=s.connector.localList()[0];await index(s.connector,root.id);
 const search=await (await api('/v1/search',{method:'POST',token:paired.token,data:{queries:[{id:'r',title:'Bonjour Benin'}]}})).json();const file=search.results[0].matches.find(m=>m.file.path.startsWith('divers/')).file;
 const lease=await (await api('/v1/lease',{method:'POST',token:paired.token,data:{rootId:root.id,file}})).json();assert.ok(lease.mediaPath);
 for(const [range,expected]of [['bytes=2-8',f.bytes.subarray(2,9)],['bytes=-5',f.bytes.subarray(-5)]]){const response=await api(lease.mediaPath,{headers:{Range:range}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);}
 assert.equal((await api(lease.mediaPath,{headers:{Range:'bytes=999-'}})).status,416);
 const missing={...file,path:'missing.mp4',name:'missing.mp4'};const failure=await (await api('/v1/lease',{method:'POST',token:paired.token,data:{rootId:root.id,file:missing}})).json();assert.equal(failure.error.includes(f.root),false);
 await api('/v1/disconnect',{method:'POST',token:paired.token,data:{}});assert.equal((await api(lease.mediaPath)).status,403);assert.equal((await api('/v1/roots',{token:paired.token})).status,401);
});
test('range validation rejects multipart, negative, empty and overflowing requests',()=>{
 for(const value of ['bytes=','bytes=1-0','bytes=20-30','bytes=0-1,3-4','bytes=-0','bytes=99999999999999999999-'])assert.equal(byteRange(value,20),null);
 assert.deepEqual(byteRange('bytes=0-',20),{start:0,end:19,partial:true});
});

test('large dispersed indexes checkpoint at directory boundaries and resume after process restart without duplicates',async t=>{
 const f=await fixture(t);f.connector.maxEntries=1;
 const scan=f.connector.scan.bind(f.connector);let batches=0;
 f.connector.scan=async(id,signal)=>{await scan(id,signal);if(++batches===1)f.connector.stop(id);};
 f.connector.start(f.allowed.id);await f.connector.jobs.get(f.allowed.id).promise;
 assert.equal(f.allowed.state,'cancelled');assert.ok(f.allowed.scanQueue.length);assert.equal(f.allowed.partial,true);
 assert.equal(JSON.stringify(f.connector.list()).includes('scanQueue'),false);assert.equal(JSON.stringify(f.connector.list()).includes('segments'),false);
 const restored=await new Connector(path.join(f.dir,'index'),{maxEntries:1}).init();t.after(()=>restored.close());
 assert.equal(restored.list()[0].resumeAvailable,true);await index(restored,f.allowed.id);
 const files=[];for await(const file of restored.records(f.allowed.id))files.push(file.path);
 assert.deepEqual(files,['divers/Bonjour le Bénin 2026-09-28.mp4']);assert.equal(restored.list()[0].resumeAvailable,false);
 assert.equal((await restored.search([{id:'r',title:'Bonjour le Bénin'}]))[0].matches.length,1);
});

test('a hidden folder picker is cancellable, does not block reads and cannot authorize a late answer',async t=>{
 const f=await fixture(t);let release,entered,pickerSignal;
 const waiting=new Promise(resolve=>entered=resolve);
 const s=await createConnectorServer({dataDir:path.join(f.dir,'cancel-picker'),port:0,pickDirectory:signal=>{pickerSignal=signal;entered();return new Promise(resolve=>release=resolve);}});t.after(()=>s.close());
 const owner={Origin:s.url,Authorization:'Bearer '+s.owner};
 const selection=fetch(s.url+'/v1/roots/pick',{method:'POST',headers:owner});await waiting;
 assert.equal((await fetch(s.url+'/v1/roots',{headers:owner})).status,200);
 assert.equal((await fetch(s.url+'/v1/roots/pick/cancel',{method:'POST',headers:{...owner,Origin:'https://srtb-graphics.pages.dev'}})).status,401);
 assert.equal(pickerSignal.aborted,false);
 assert.equal((await fetch(s.url+'/v1/roots/pick/cancel',{method:'POST',headers:owner})).status,200);
 assert.deepEqual(await (await selection).json(),{cancelled:true});assert.equal(pickerSignal.aborted,true);
 release(f.root);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(s.connector.localList(),[]);
});

test('folder picker timeout releases the next attempt; shutdown also aborts the picker',async t=>{
 const f=await fixture(t);const signals=[];
 const s=await createConnectorServer({dataDir:path.join(f.dir,'timeout-picker'),port:0,pickerTimeout:25,pickDirectory:signal=>{signals.push(signal);return new Promise(()=>{});}});t.after(()=>s.close());
 const owner={Origin:s.url,Authorization:'Bearer '+s.owner};
 const answer=await fetch(s.url+'/v1/roots/pick',{method:'POST',headers:owner});assert.match((await answer.json()).error,/expiré/);assert.equal(signals[0].aborted,true);
 const next=fetch(s.url+'/v1/roots/pick',{method:'POST',headers:owner}).catch(()=>null);
 await bounded(async()=>{while(signals.length<2)await new Promise(resolve=>setTimeout(resolve,1));},undefined,1000);
 await s.close();await next;assert.equal(signals[1].aborted,true);assert.deepEqual(s.connector.localList(),[]);
});

test('local browser reads omit Origin; only the owner can stop, and disconnect invalidates unused codes',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'srtb-connector-console-test-'));
 const s=await createConnectorServer({dataDir:dir,port:0});t.after(()=>s.close());
 const bearer={Authorization:'Bearer '+s.owner},owner={...bearer,Origin:s.url},site='https://srtb-graphics.pages.dev';
 assert.equal((await fetch(s.url+'/v1/roots',{headers:{...bearer,'Sec-Fetch-Site':'same-origin'}})).status,200);
 for(const headers of [bearer,{...bearer,'Sec-Fetch-Site':'cross-site'},{...bearer,'Sec-Fetch-Site':'same-origin',Origin:site}])assert.equal((await fetch(s.url+'/v1/roots',{headers})).status,401);
 assert.equal((await fetch(s.url+'/v1/shutdown',{method:'POST',headers:{...bearer,'Sec-Fetch-Site':'same-origin'}})).status,401);
 const pairing=await (await fetch(s.url+'/v1/pairing',{method:'POST',headers:owner})).json();
 await fetch(s.url+'/v1/disconnect',{method:'POST',headers:owner});
 const pair=()=>fetch(s.url+'/v1/pair',{method:'POST',headers:{Origin:site,'Content-Type':'application/json'},body:JSON.stringify({code:pairing.code})});
 assert.equal((await pair()).status,403);
 const code=(await (await fetch(s.url+'/v1/pairing',{method:'POST',headers:owner})).json()).code;
 const session=await (await fetch(s.url+'/v1/pair',{method:'POST',headers:{Origin:site,'Content-Type':'application/json'},body:JSON.stringify({code})})).json();
 assert.equal((await fetch(s.url+'/v1/shutdown',{method:'POST',headers:{Origin:site,Authorization:'Bearer '+session.token}})).status,404);
 const response=await fetch(s.url+'/v1/shutdown',{method:'POST',headers:owner});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
 await bounded(()=>s.closed,undefined,3000);await s.close();await s.close();assert.equal(s.server.listening,false);
});

for(const reason of ['disconnect','expiry'])test(`a pending network open cannot start reading after ${reason}`,async t=>{
 const f=await fixture(t),site='https://srtb-graphics.pages.dev';
 const s=await createConnectorServer({dataDir:path.join(f.dir,'race-index'),port:0});t.after(()=>s.close());
 const root=await s.connector.authorize(f.root,['prive']);await index(s.connector,root.id);
 const [{matches:[{file}]}]=await s.connector.search([{id:'r',title:'Bonjour Benin'}]);
 const lease=await s.connector.lease(root.id,file,site),key=lease.mediaPath.split('/').at(-1);
 const original=s.connector.open.bind(s.connector);let release,entered,handle;
 const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 s.connector.open=async(...args)=>{handle=await original(...args);entered();await gate;return handle;};
 const reading=fetch(s.url+lease.mediaPath,{headers:{Origin:site}});
 await bounded(()=>waiting,undefined,3000);
 if(reason==='disconnect'){
  const response=await fetch(s.url+'/v1/disconnect',{method:'POST',headers:{Origin:s.url,Authorization:'Bearer '+s.owner}});
  assert.equal(response.status,200);
 }else s.connector.tickets.get(key).expires=Date.now()-1;
 release();const response=await reading;assert.equal(response.status,403);
 assert.match((await response.json()).error,/expirée/);assert.equal(s.connector.streams.size,0);
 await assert.rejects(()=>handle.stat(),e=>e.code==='EBADF');
});
