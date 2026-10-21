import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5194';
const directory=resolve('reports/announcement-layout');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const pageErrors=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',error=>pageErrors.push(error.message));
  // The qualification page normally writes its report through the dedicated
  // evidence plug-in. This runner persists the same report itself, so a plain
  // Vite server only needs an explicit successful acknowledgement.
  await page.route('**/__social-evidence/**',route=>route.fulfill({status:204,body:''}));
  await page.goto(base+'/tests/announcement-layout-qualification.html');
  await page.getByRole('button',{name:'Vérifier les quinze compositions',exact:true}).click();
  await expect(page.locator('#status')).toHaveText(/^PASS — 15 compositions/,{timeout:300000});
  const report=JSON.parse(await page.locator('#result').textContent());
  assert.equal(report.status,'PASS');
  assert.equal(report.count,15);
  const immediate=report.records.filter(record=>record.label==='Tout de suite');
  assert.equal(immediate.length,3);
  for(const record of immediate){
    assert.equal(record.templateId,'BTV_BA_TDS');
    assert.equal(record.announcement,'Tout de suite');
    assert.equal(record.time,'');
    assert.equal(record.result,'PASS');
  }
  const tv=immediate.find(record=>record.format==='tv');
  assert.ok(tv);
  assert.notEqual(tv.samples[0].sha256,tv.samples[1].sha256,'Le grand titre horizontal doit devenir la signature Tout de suite sur deux lignes.');
  assert.deepEqual(pageErrors,[]);
  await page.screenshot({path:resolve(directory,'fifteen-compositions.png'),fullPage:true,animations:'disabled'});
  await writeFile(resolve(directory,'browser-results.json'),JSON.stringify({passed:true,pageErrors,report},null,2));
  console.log(JSON.stringify({passed:true,compositions:report.count,immediate:immediate.map(record=>({format:record.format,time:record.time,templateId:record.templateId}))}));
}finally{
  await browser.close();
}
