import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Read-only HTTP proof. Authenticated role isolation is qualified against local D1/R2.
const root=resolve(import.meta.dirname,'..'),origin='https://srtb-graphics.pages.dev';
const deployment=process.argv[2];
assert.match(deployment||'',/^[a-f0-9]{8}$/);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const results=[];
const shell=await readFile(resolve(root,'dist-studio-native/index.html'));
const entry=shell.toString().match(/src="(\/assets\/studio-[\w-]{8}\.js)"/)?.[1];
assert.ok(entry,'Find the current application entry, not historical retained modules.');
const code=await readFile(resolve(root,'dist-studio-native',entry.slice(1)),'utf8');
const commercial=[...new Set([...code.matchAll(/Commercial-[\w-]{8}\.(?:js|css)/g)].map(match=>match[0]))];
assert.equal(commercial.length,2,'The final bundle must include one Commercial module and stylesheet.');
for(const path of ['/commercial',...commercial.map(name=>'/assets/'+name)]){
  const response=await fetch(origin+path,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});
  assert.equal(response.status,200,path);
  const bytes=Buffer.from(await response.arrayBuffer());
  const local=path==='/commercial'?shell:await readFile(resolve(root,'dist-studio-native',path.slice(1)));
  assert.equal(digest(bytes),digest(local),path+': exact qualified build');
  if(path==='/commercial')assert.match(response.headers.get('Cache-Control')||'',/no-store/);
  results.push({path,status:200,matchingBuild:true});
}
for(const path of ['/api/commercial/projects','/api/commercial/media',...['vert','beige','jaune'].map(theme=>`/commercial-assets/background-${theme}.mp4`),'/commercial-assets/opening.wav','/commercial-assets/BeninRegularTAB.otf','/commercial-assets/SuisseIntl-Regular.otf','/commercial-assets/examples/benin-tv-logo.png','/commercial-assets/examples/benin-tv-example-fr.wav','/commercial-assets/examples/benin-tv-example-fr-v2.wav','/commercial-assets/examples/benin-tv-example-music-v1.wav','/commercial-assets/aac/NOTICE.txt','/commercial-assets/aac/commercial-aac-sources.tar.gz','/api/graphics/projects','/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4']){
  const response=await fetch(origin+path,{credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,401,path+': anonymous access denied');
  await response.body?.cancel();results.push({path,status:401,anonymousAccessDenied:true});
}
const report={origin,deployment,checkedAt:new Date().toISOString(),results,limits:['Authenticated commercial/admin/designer flows verified locally against real isolated D1/R2, not via a production member session.']};
await mkdir(resolve(root,'reports/commercial-production'),{recursive:true});
await writeFile(resolve(root,'reports/commercial-production/http.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
