import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const folder='reports/export-queue-live';await mkdir(folder,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1366,height:900},acceptDownloads:true}),errors=[],apiCalls=[],downloads=[];
page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d.suggestedFilename()));
try{
 await page.route('**/api/**',async route=>{
  const r=route.request(),path=new URL(r.url()).pathname;apiCalls.push({method:r.method(),path,channel:r.headers()['x-srtb-channel']});
  assert.equal(r.method(),'GET','qualification must never write');
  if(/^\/api\/graphics\/projects\/[a-f0-9-]{36}$/.test(path)){
   const p=await page.evaluate(id=>window.queueLive.projects.find(p=>p.id===id),path.split('/').at(-1));return route.fulfill({json:p});
  }
  return route.fulfill({status:404,json:{error:'Aucune donnée de recette pour cet écran secondaire.'}});
 });
 await page.goto('http://127.0.0.1:5198/tests/export-queue-live.html');await page.getByRole('button',{name:'Ouvrir Recette A',exact:true}).click();
 await expect(page.getByRole('button',{name:'Ajouter à la file d’exports',exact:true})).toBeEnabled({timeout:60000});
 await page.getByRole('button',{name:'Ajouter à la file d’exports',exact:true}).click();
 await page.waitForFunction(()=>window.queueLive.snapshot().items[0]?.status==='rendering',{},{timeout:60000});
 assert.equal(await page.getByRole('region',{name:'File d’exports',exact:true}).count(),0,'queue never auto-opens');
 await page.getByRole('button',{name:'Projets',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Projets de recette'})).toBeVisible();
 await page.getByRole('button',{name:'Ouvrir Recette B',exact:true}).click();
 await page.getByRole('button',{name:'Ajouter à la file d’exports',exact:true}).click();
 // Edit another project while the earlier export is independent of the workspace.
 const title=page.getByRole('textbox',{name:'Nom du projet',exact:true});await title.fill('Retouche pendant les exports');
 await expect(title).toHaveValue('Retouche pendant les exports');
 await page.getByRole('button',{name:/^Exports ·/}).click();
 const panel=page.getByRole('region',{name:'File d’exports',exact:true});await expect(panel).toBeVisible();
 await page.screenshot({path:`${folder}/working.png`,fullPage:true});
 await page.waitForFunction(()=>window.queueLive.snapshot().items.length===2&&!window.queueLive.snapshot().running,{},{timeout:240000});
 const results=await page.evaluate(()=>window.queueLive.snapshot().items.map(({result,...item})=>({...item,result:result?{report:result.report,filename:result.filename}:null})));
 assert.deepEqual(results.map(i=>i.status),['completed','completed']);assert.deepEqual(results.map(i=>i.title),['Recette A','Recette B']);assert.deepEqual(results.map(i=>i.result.report.duration),[12,2]);
 assert.deepEqual(downloads,[],'downloads require an explicit user action');
 const files=panel.getByRole('link',{name:'Télécharger',exact:true});for(let n=0;n<2;n++){const [download]=await Promise.all([page.waitForEvent('download'),files.nth(n).click()]);await download.saveAs(`${folder}/${n?'vertical':'portrait'}.mp4`);}
 await page.screenshot({path:`${folder}/completed.png`,fullPage:true});assert.deepEqual(errors,[]);
 await page.evaluate(()=>window.queueLive.clear());await writeFile(`${folder}/report.json`,JSON.stringify({status:'PASS',results,apiCalls,errors,downloads},null,2));console.log('PASS real queue: navigation, second job, edits, sequential MP4s and explicit downloads');
}catch(error){await writeFile(`${folder}/failure.json`,JSON.stringify({error:String(error),errors,apiCalls,body:await page.locator('body').innerText()},null,2));throw error;}
finally{await browser.close();}
