import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const folder=resolve('reports/tds-signature-2026-09-30');await mkdir(folder,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1366,height:1000}}),errors=[];
page.on('pageerror',error=>errors.push(String(error)));
try{
 await page.goto('http://127.0.0.1:5234/tests/tds-audio.html');
 const previews=[];
 for(const id of ['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE']){
  await page.getByRole('combobox').first().selectOption(id);
  await page.getByRole('button',{name:'Activer le son',exact:true}).click({timeout:90000});
  await page.getByRole('button',{name:'Couper le son',exact:true}).waitFor({timeout:90000});
  await page.getByRole('button',{name:'Recommencer l’aperçu (IN)',exact:true}).click();
  const values=[];
  for(let n=0;n<30;n++){values.push(await page.getByLabel('Niveau sonore de l’aperçu',{exact:true}).evaluate(el=>el.value));await page.waitForTimeout(100);}
  const peak=Math.max(...values);if(!(peak>.002))throw Error('Aperçu muet : '+id);
  await page.getByRole('button',{name:'Mettre l’aperçu en pause',exact:true}).click();
  await page.screenshot({path:resolve(folder,id+'-preview.png')});
  previews.push({templateId:id,peak,samples:values.length,pass:true});console.log(JSON.stringify(previews.at(-1)));
 }
 await page.getByRole('button',{name:'Vérifier le son et les exports',exact:true}).click();
 for(let n=0;n<360;n++){
  const status=await page.locator('#status').innerText();
  if(n%10===0)console.log(status);
  if(status.startsWith('FAIL'))throw Error(status);
  if(status.startsWith('PASS'))break;
  if(n===359)throw Error('Délai de recette dépassé : '+status);
  await page.waitForTimeout(1000);
 }
 const results=JSON.parse(await page.locator('#results').innerText());
 await writeFile(resolve(folder,'result.json'),JSON.stringify({previews,results,errors},null,2)+'\n');
 for(const link of await page.locator('a[download]').all()){
  const pending=page.waitForEvent('download');await link.click();const download=await pending;await download.saveAs(resolve(folder,download.suggestedFilename()));
 }
 if(errors.length)throw Error(errors.join('\n'));
 await writeFile(resolve(folder,'result.json'),JSON.stringify({previews,results,errors},null,2)+'\n');
 console.log('PASS — aperçus audibles et fichiers contrôlés : '+folder);
}catch(error){await page.screenshot({path:resolve(folder,'failure.png')}).catch(()=>{});console.error(error,errors,await page.locator('body').innerText());process.exitCode=1;}
finally{await browser.close();}
