import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Public read-only smoke check. No cookies, tokens, account mutation or media upload.
const root=resolve(import.meta.dirname,'..');
const origin='https://srtb-graphics.pages.dev';
const deployment=process.argv[2];
assert.match(deployment||'',/^[a-f0-9]{8}$/,'Pass the verified production deployment identifier.');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const localHtml=await readFile(resolve(root,'dist-studio-native/index.html'));
const results=[];
for(const path of ['/graphics','/auth/action']){
  const response=await fetch(origin+path,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});
  assert.equal(response.status,200,path);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(digest(bytes),digest(localHtml),`${path}: the main origin must serve the tested bundle`);
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer',`${path}: action credentials must not leave in a referrer`);
  assert.match(response.headers.get('Cache-Control')||'',/no-store/,`${path}: do not cache the action shell`);
  assert.match(response.headers.get('Content-Security-Policy')||'',/form-action 'self'/,`${path}: same-origin forms only`);
  results.push({path,status:response.status,matchingBuild:true,noReferrer:true,noStore:true,sameOriginForms:true});
}
const assets=[...localHtml.toString().matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match=>match[1]);
for(const path of assets){
  const response=await fetch(origin+path,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,path);
  const bytes=Buffer.from(await response.arrayBuffer()),local=await readFile(resolve(root,'dist-studio-native',path.slice(1)));
  assert.equal(digest(bytes),digest(local),`${path}: exact public asset`);
  results.push({path,status:response.status,matchingBuild:true});
}
for(const path of ['/api/graphics/channels','/api/graphics/programmes','/api/graphics/planner/overview?view=mine&date=2026-09-29','/api/graphics/planner/00000000-0000-4000-8000-000000000000/production-links?rowId=verification&revision=1&section=occurrences','/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4']){
  const response=await fetch(origin+path,{credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,401,`${path}: authentication required`);
  await response.body?.cancel();results.push({path,status:response.status,anonymousAccessDenied:true});
}
const report={origin,deployment,checkedAt:new Date().toISOString(),results,limits:['Read-only HTTP smoke check; this script does not verify the authenticated UI.','No real recovery email or physical Mac qualification.']};
await mkdir(resolve(root,'reports/premium-production'),{recursive:true});
await writeFile(resolve(root,'reports/premium-production/http.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
