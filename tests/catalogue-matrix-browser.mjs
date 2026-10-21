import {chromium,expect} from '@playwright/test';
// Keep a distinct basename from the browser-side catalogue-matrix.ts helper.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5194',directory=resolve('reports/catalogue-coverage');
await mkdir(directory,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
const pageErrors=[],writes=[],result={completed:false,labels:[],views:[],logo:null,pageErrors,writes};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 page.on('pageerror',error=>pageErrors.push(error.message));
 await page.route('**/api/**',route=>{writes.push(route.request().method()+' '+route.request().url());return route.fulfill({status:405,body:'{}'});});
 await page.goto(base+'/tests/catalogue-qualification.html');
 await expect(page.locator('.catalogue-choice')).toHaveCount(11); // ten engines + the simple BA preset
 for(const name of ['Renvoi · piqûre de rappel','Annonce d’événement','Semainier · sept programmes'])await expect(page.getByRole('button',{name:new RegExp(name)}).first()).toBeVisible();
 await expect(page.getByText('Tout de suite · moteur dédié',{exact:true}).first()).toBeVisible();
 for(const theme of ['dark','light'])for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:resolve(directory,`catalogue-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
  result.views.push({theme,width,overflow:false});
 }
 await page.goto(base+'/tests/social-qualification.html');
 for(const label of ['Contrôler les 30 compositions TV et sociales','Exporter les 30 MP4 TV et sociaux','Contrôler les fondus et fins des 30 compositions','Contrôler l’éditeur des 30 compositions','Mesurer la lecture des 10 modèles · 30 compositions']){
  await expect(page.getByRole('button',{name:label,exact:true})).toBeVisible();result.labels.push(label);
 }
 await page.goto(base+'/tests/text-position-qualification.html');
 await expect(page.getByRole('button',{name:'Contrôler les 30 déplacements natifs',exact:true})).toBeVisible();result.labels.push('30 déplacements natifs');
 await page.goto(base+'/tests/overlay-logo-qualification.html');
 await expect(page.getByRole('button',{name:'Vérifier les 10 modules HTML',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Vérifier les 30 compositions',exact:true}).click();
 await expect(page.locator('#status')).toHaveText(/^(PASS|ÉCHEC)/,{timeout:300000});
 result.logo={status:await page.locator('#status').textContent(),details:JSON.parse(await page.locator('#result').textContent())};
 await writeFile(resolve(directory,'results.json'),JSON.stringify(result,null,2));
 expect(result.logo.status).toMatch(/^PASS · 30 compositions/);expect(writes).toEqual([]);expect(pageErrors).toEqual([]);
 result.completed=true;
 console.log(JSON.stringify({passed:true,labels:result.labels.length,views:result.views.length,logoCompositions:result.logo.details.length,pageErrors,writes}));
}catch(error){result.failure=String(error);throw error;}finally{await writeFile(resolve(directory,'results.json'),JSON.stringify(result,null,2));await browser.close();}
