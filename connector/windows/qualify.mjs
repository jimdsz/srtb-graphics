// Exercises the exact packaged runtime without opening a browser, scanning user
// disks, installing software, adding registry entries or bypassing OS policy.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
const run=promisify(execFile),repo=path.resolve(import.meta.dirname,'../..');
const base=path.join(repo,'.qa-delivery'),source=path.resolve(process.argv[2]||'');
if(process.platform!=='win32'||!source.startsWith(base+path.sep)||path.basename(source)!=='payload')throw Error('Expected a generated Windows payload within .qa-delivery.');
const trial=await fs.mkdtemp(path.join(base,'connector-qualification-'));
const payload=path.join(trial,'Essai avec espaces é'),data=path.join(trial,'metadata');
await fs.cp(source,payload,{recursive:true,errorOnExist:true,force:false});
const launcher=path.join(payload,'GraphicsConnector.exe');
const steps=[];
const verify=async expected=>{
 let code=0;try{await run(launcher,['--verify-only'],{windowsHide:true,timeout:15000});}catch(error){code=error.code;}
 assert.equal(code,expected);
};
await verify(0);steps.push('integrity: exact payload in a path with spaces and accents');
const version=await run(path.join(payload,'node.exe'),['--version'],{windowsHide:true});assert.equal(version.stdout.trim(),'v24.21.0');
steps.push('bundled official Node 24.21.0 executes');
const child=spawn(path.join(payload,'node.exe'),[path.join(payload,'connector/main.mjs'),'--desktop','--data-dir',data],{cwd:payload,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,NODE_OPTIONS:'',NODE_PATH:''}});
const closed=once(child,'exit');let output='',errors='';child.stderr.on('data',chunk=>errors+=chunk);
const deadline=setTimeout(()=>child.kill(),15000);
try{
 const ready=await new Promise((resolve,reject)=>{
  child.once('error',reject);child.once('exit',()=>reject(Error('Packaged child stopped before ready')));
  child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n'))try{resolve(JSON.parse(output.split('\n')[0]));}catch(error){reject(error);}});
 });
 assert.equal(ready.type,'ready');assert.match(ready.consoleURL,/^http:\/\/127\.0\.0\.1:43871\/#[a-f\d]{64}$/);
 const res=await fetch('http://127.0.0.1:43871/v1/roots',{headers:{Origin:'http://127.0.0.1:43871',Authorization:'Bearer '+new URL(ready.consoleURL).hash.slice(1)},signal:AbortSignal.timeout(5000)});
 assert.equal(res.status,200);assert.deepEqual((await res.json()).roots,[]);
 steps.push('packaged server starts with no authorized folder and no automatic scan');
 child.stdin.end();assert.equal((await closed)[0],0);assert.equal(errors,'');
 steps.push('closing the supervising pipe stops the packaged server');
}finally{clearTimeout(deadline);if(child.exitCode===null)child.kill();}
// Only a new test copy is changed. The original payload/installer is untouched.
const fixtureFile=path.join(payload,'connector/core.mjs'),original=await fs.readFile(fixtureFile);
await fs.appendFile(fixtureFile,'\n// synthetic integrity test\n');await verify(1);
steps.push('modified payload refused before execution');
await fs.writeFile(fixtureFile,original);await verify(0);
steps.push('intact payload accepted again');
const report={schema:1,source,steps,passed:steps.length,nativeInstallerUiTested:false,macTested:false,publicDownloadAllowed:false};
await fs.writeFile(path.join(trial,'qualification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({report:path.join(trial,'qualification.json'),passed:report.passed,publicDownloadAllowed:false}));
