import {chromium,expect} from '@playwright/test';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';

const base=process.env.SRTB_QA_ORIGIN||'http://127.0.0.1:5198',directory='C:/Users/SRTB_AD/Desktop/Voix off';
const required=['Mardi.mp3','demain.mp3',"aujourdh'ui.mp3",'ce soir.mp3','Tout de suite.mp3'];
const available=new Set(await readdir(directory));for(const name of required)if(!available.has(name))throw Error('Voix locale manquante : '+name);
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/tests/real-voice-mix-qualification.html',{waitUntil:'networkidle'});
  await page.locator('#files').setInputFiles(required.map(name=>join(directory,name)));
  await expect(page.locator('#run')).toBeEnabled({timeout:15000}).catch(async error=>{throw Error(`${error.message}\nÉtat : ${await page.locator('#status').textContent()}\nErreurs : ${errors.join(' | ')}`);});
  const overlay=page.locator('vite-error-overlay');if(await overlay.count())throw Error('Vite : '+await overlay.evaluate(node=>node.shadowRoot?.textContent||node.textContent||'erreur sans détail'));
  await page.locator('#run').click();
  await expect(page.locator('#status')).toContainText('PASS —',{timeout:120000});
  const report=JSON.parse(await page.locator('#result').textContent());
  if(report.status!=='PASS'||report.records.length!==5||errors.length)throw Error(JSON.stringify({report,errors},null,2));
  console.log(JSON.stringify({status:'PASS',records:report.records,errors},null,2));
}finally{await browser.close();}
