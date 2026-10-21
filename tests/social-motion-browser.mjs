import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const directory=resolve(process.env.SRTB_MOTION_REPORT_DIR||'reports/social-motion-2026-09-30');await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],apiRequests=[];
try{
  const page=await browser.newPage({viewport:{width:1500,height:1000}});page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{apiRequests.push(route.request().url());return route.fulfill({status:500,body:'Local qualification only'});});
  await page.goto('http://127.0.0.1:5194/tests/social-motion-qualification.html');
  await page.getByRole('button',{name:'Vérifier les signatures'}).click();
  await expect(page.locator('#status')).toHaveText(/^(PASS|ÉCHEC)/,{timeout:240000});
  const result=JSON.parse(await page.locator('#result').innerText());await writeFile(resolve(directory,'results.json'),JSON.stringify({...result,errors,apiRequests},null,2));
  await page.locator('#gallery').screenshot({path:resolve(directory,'signatures.png')});
  for(const format of ['portrait','vertical']){const figure=page.locator('figure').filter({hasText:format}).first();if(await figure.count())await figure.screenshot({path:resolve(directory,'ba-'+format+'.png')});}
  assert.equal(result.status,'PASS',result.error);assert.deepEqual(errors,[]);assert.deepEqual(apiRequests,[]);console.log(JSON.stringify({status:result.status,compositions:result.records.length,errors,apiRequests}));
}finally{await browser.close();}
