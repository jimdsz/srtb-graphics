import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Read-only and credential-free: no media, sessions or projects are submitted.
const origins=['https://072572a6.srtb-graphics.pages.dev','https://srtb-graphics.pages.dev'];
const local=await readFile(new URL('../dist-studio-native/index.html',import.meta.url),'utf8');
const entry=local.match(/src="(\/assets\/studio-[^"]+\.js)"/)?.[1];
assert.ok(entry,'Compiled studio entry missing');
const expected=await readFile(new URL('../dist-studio-native'+entry,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes instanceof ArrayBuffer?new Uint8Array(bytes):bytes).digest('hex');
for(const origin of origins){
  const report={origin,checks:[]};
  for(const [path,status]of [['/',200],['/graphics',200],['/api/auth/config',200],['/api/me',401],['/api/graphics/projects',401],['/api/graphics/media',401],['/library/v1.7.0/BTV_PopUp/lib/template.js',401],['/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4',401]]){
    const response=await fetch(origin+path,{credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,status,path);
    const bytes=await response.arrayBuffer();
    if(path==='/graphics')assert.ok(new TextDecoder().decode(bytes).includes(entry),'Old studio entry still served');
    report.checks.push({path,status:response.status});
  }
  const entryResponse=await fetch(origin+entry,{credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(15000)});
  assert.equal(entryResponse.status,200);assert.equal(sha(await entryResponse.arrayBuffer()),sha(expected));
  report.entry={path:entry,sha256:sha(expected),exactBytes:true};
  const rejected=await fetch(origin+'/api/me',{headers:{Authorization:'Bearer invalid-qualification-token'},credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(15000)});
  assert.equal(rejected.status,401);await rejected.body?.cancel();report.invalidAuthentication=401;
  console.log(JSON.stringify({...report,result:'PASS'}));
}
