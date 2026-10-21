import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const stage=process.env.SRTB_SEQUENCES_STAGE||'after',directory=resolve('reports/social-sequences-2026-10-01',stage);await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],apiRequests=[];
try{
 const page=await browser.newPage({viewport:{width:1550,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',route=>{apiRequests.push(route.request().url());return route.fulfill({status:500,body:'Local qualification only'});});
 await page.goto('http://127.0.0.1:5194/tests/social-sequences-qualification.html');await expect(page.locator('#status')).toHaveText(/^(PASS|FAIL)$/,{timeout:120000});
 const result=JSON.parse(await page.locator('#result').innerText());await writeFile(resolve(directory,'results.json'),JSON.stringify({...result,errors,apiRequests},null,2));
 for(const format of ['portrait','vertical'])await page.locator('#sheet-'+format).screenshot({path:resolve(directory,format+'.png')});
 assert.equal(result.status,'PASS',result.error);assert.deepEqual(errors,[]);assert.deepEqual(apiRequests,[]);
 if(stage!=='before'){
  for(const record of result.records){
   if(record.seconds>=record.duration-.05)continue;
   assert.ok(record.texts.length,`${record.id}/${record.format}/${record.seconds}: no readable information`);assert.ok(record.brand,`${record.id}/${record.format}: logo missing`);
   const first=result.records.find(row=>row.id===record.id&&row.format===record.format&&row.seconds===0);assert.deepEqual(record.brand,first.brand,'station logo must not move or resize at a phase boundary');
   if(record.phase!=='content')assert.ok(record.opaque>.995,`${record.id}/${record.format}/${record.seconds}: signature exposes hidden media`);
  }
  for(const record of result.earlyOut){assert.ok(record.sameFields&&record.sameBrand&&record.maxShift<1e-8,`Early OUT resets ${JSON.stringify(record)}`);}
  for(const record of result.variants){assert.equal(record.hasField,!!record.text,`${record.id}/${record.format}: edited title omitted`);for(const box of record.boxes)assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=1.00001&&box.y+box.height<=1.00001,`Title outside frame: ${JSON.stringify(record)}`);}
 }
 console.log(JSON.stringify({status:result.status,samples:result.records.length,earlyOut:result.earlyOut.length,variants:result.variants.length,directory}));
}finally{await browser.close();}
