import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';

test('desktop protocol exposes capability only through parent pipe, and parent EOF stops the server',async()=>{
 const data=await mkdtemp(path.join(tmpdir(),'srtb-desktop-test-'));
 const child=spawn(process.env.SRTB_TEST_NODE||process.execPath,[path.resolve('connector/main.mjs'),'--desktop','--data-dir',data],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,NODE_OPTIONS:'',NODE_PATH:''}});
 const closed=once(child,'exit');let output='',errors='';child.stderr.on('data',chunk=>errors+=chunk);
 const timer=setTimeout(()=>child.kill(),10000);
 try{
  const ready=await new Promise((resolve,reject)=>{
   child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n'))try{resolve(JSON.parse(output.split('\n')[0]));}catch(error){reject(error);}});
   child.once('error',reject);child.once('exit',()=>reject(Error('Child stopped before ready: '+errors)));
  });
  assert.equal(ready.type,'ready');assert.match(ready.consoleURL,/^http:\/\/127\.0\.0\.1:43871\/#[a-f\d]{64}$/);
  const response=await fetch('http://127.0.0.1:43871/v1/roots',{headers:{Origin:'http://127.0.0.1:43871',Authorization:'Bearer '+new URL(ready.consoleURL).hash.slice(1)}});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).roots,[]);
  child.stdin.end();assert.equal((await closed)[0],0);assert.equal(errors,'');
 }finally{clearTimeout(timer);if(child.exitCode===null)child.kill();}
});

test('Windows installer stays user-scoped, explicit, non-autostart and non-destructive',async()=>{
 const script=await readFile(new URL('./windows/installer.nsi',import.meta.url),'utf8');
 assert.match(script,/RequestExecutionLevel user/);assert.match(script,/Call un.CheckParents/);
 assert.match(script,/StrCmp \$INSTDIR "\$LOCALAPPDATA\\Programs\\SRTB Graphics Connector" valid/);
 const commands=script.split(/\r?\n/).map(line=>line.replace(/;.*/,''));
 assert.equal(commands.some(line=>/RMDir\s+\/r|HKLM|SMSTARTUP|RunOnce|netsh|ExecutionPolicy|TrustedPeople|TrustedPublisher/i.test(line)),false);
 assert.match(script,/DELETE_LIST/);assert.match(script,/Uninstall.exe/);
 assert.match(script,/Push "\$INSTDIR\\connector\\ui"\s+Call un.CheckParents/);
 assert.match(script,/Call un.CheckNotInUse/);assert.match(script,/ClearErrors\s+!include "\$\{DELETE_LIST\}"\s+\$\{If\} \$\{Errors\}/);
});
