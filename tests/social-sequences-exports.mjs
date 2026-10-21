import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const directory='reports/social-sequences-exports-2026-10-01';await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],apiRequests=[];
try{
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{apiRequests.push(route.request().url());return route.fulfill({status:500,body:'Local qualification only'});});
  await page.goto('http://127.0.0.1:5194/tests/social-sequences-exports.html');
  await page.getByRole('button',{name:'Exporter les quatre contrôles'}).click();
  let previous='';const progress=setInterval(async()=>{try{const value=await page.locator('#status').innerText();if(value!==previous){console.log(value);previous=value;}}catch{}},10000);
  try{await expect(page.locator('#status')).toHaveText(/^(PASS|ÉCHEC)/,{timeout:1200000});}finally{clearInterval(progress);}
  const result=JSON.parse(await page.locator('#result').innerText());
  await writeFile(directory+'/report.json',JSON.stringify({...result,errors,apiRequests},null,2));
  await page.screenshot({path:directory+'/results.png',fullPage:true});
  assert.equal(result.status,'PASS',result.error);assert.deepEqual(errors,[]);assert.deepEqual(apiRequests,[]);
  console.log(JSON.stringify({status:'PASS',files:result.records.map(row=>row.filename)}));
}finally{await browser.close();}
