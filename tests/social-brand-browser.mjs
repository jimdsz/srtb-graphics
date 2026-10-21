import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const directory=resolve('reports/social-brand-2026-10-01');await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],apiRequests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{apiRequests.push(route.request().url());return route.fulfill({status:500,body:'Local qualification only'});});
 await page.goto('http://127.0.0.1:5194/tests/social-brand-qualification.html');
 await expect(page.getByRole('heading',{name:'Logo BTV — 4:5 et 9:16'})).toBeVisible();
 await page.screenshot({path:resolve(directory,'initial.png')});
 assert.equal(await page.locator('vite-error-overlay').count(),0);
 console.log('Initial page visible; no Vite error overlay.');
 await page.getByRole('button',{name:'Vérifier les logos'}).click();
 await expect(page.locator('#status')).toHaveText(/^(PASS|ÉCHEC)/,{timeout:120000});
 const result=JSON.parse(await page.locator('#result').innerText());
 await writeFile(resolve(directory,'results.json'),JSON.stringify({...result,errors,apiRequests},null,2));
 await page.screenshot({path:resolve(directory,'completed.png')});
 assert.equal(result.status,'PASS',result.error);
 await page.locator('#gallery').screenshot({path:resolve(directory,'all-templates.png')});
 for(const format of ['portrait','vertical'])await page.locator('figure').filter({hasText:format}).first().screenshot({path:resolve(directory,format+'.png')});
 assert.equal(result.status,'PASS',result.error);assert.deepEqual(errors,[]);assert.deepEqual(apiRequests,[]);
 console.log(JSON.stringify({status:result.status,compositions:result.records.length,errors,apiRequests}));
}finally{await browser.close();}
