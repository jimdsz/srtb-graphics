// Interactive test console. Grants only a fresh synthetic temp folder, never a
// real drive. A test-only owner capability is printed for the browser harness.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createConnectorServer} from './server.mjs';
const folder=await fs.mkdtemp(path.join(os.tmpdir(),'srtb-connector-ui-'));
const media=path.join(folder,'medias');await fs.mkdir(media);
for(let i=0;i<120;i++)await fs.writeFile(path.join(media,`Bonjour le Bénin ${i}.mp4`),'synthetic fixture, not a real video');
// Generated moving-colour witness, not a programme or an uploaded team file.
await fs.copyFile(new URL('../tests/fixtures/weekly-witnesses-v2/media-1.mp4',import.meta.url),path.join(media,'Témoin lecture connecteur.mp4'));
const live=process.argv.includes('--live-client');
const app=await createConnectorServer({dataDir:path.join(folder,'index'),port:live?43871:0,origins:live?['http://127.0.0.1:5192',...(process.argv.includes('--production-ui')?['https://srtb-graphics.pages.dev']:[])]:undefined,pickDirectory:async signal=>{
 if(process.argv.includes('--slow-picker'))await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,10000);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});
 return media;
}});
// Opt-in, credential-free diagnostics for the synthetic HTTPS-to-loopback test.
if(process.argv.includes('--trace-requests'))app.server.prependListener('request',(req,res)=>{
 const route=new URL(req.url,app.url).pathname;
 if(!['/v1/health','/v1/pair','/v1/roots'].includes(route))return;
 const started=Date.now();res.once('finish',()=>console.log(JSON.stringify({method:req.method,route,origin:req.headers.origin||'same-origin',status:res.statusCode,ms:Date.now()-started})));
});
console.log('TEST CONSOLE ONLY: '+app.consoleURL);
for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>void app.close());
await app.closed;
console.log('TEST CONSOLE CLOSED');
