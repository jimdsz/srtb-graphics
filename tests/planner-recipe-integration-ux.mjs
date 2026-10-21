import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/planner-recipe-integration');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
try{
 for(const width of [1366,320])for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width,height:width===1366?768:844},reducedMotion:'reduce'}),mutations=[];
  page.on('pageerror',error=>errors.push(error.message));
  const observation={programme:'programme 1',candidate:{name:'Programme 1',kinds:['tds'],directoryId:null},confirmations:3,revision:null,ruleRevision:null,ruleId:null,state:null};
  await page.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname;
   if(route.request().method()!=='GET')mutations.push({path,body:route.request().postData()});
   const body=path.endsWith('/channels')?[{id:'benin-tv',name:'Bénin TV',logo:'',accent:'#efbd32',timezone:'Africa/Porto-Novo',revision:1,archived:0}]:path.endsWith('/planner-summary')?{plans:1,updatedAt:null}:path.endsWith('/assignments')?{tasks:[],members:[{email:'recette@example.test',name:'Poste de recette'}]}:path.endsWith('/habits')?{suggestions:[observation]}:null;
   return route.fulfill({status:body?200:500,contentType:'application/json',body:JSON.stringify(body||{error:'Appel inattendu dans la recette locale'})});
  });
  await page.goto(`${base}/tests/day-planner-workbench.html?seed=1&large=1`);await page.addStyleTag({content:'#planner-fixture-audit{display:none}'});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  if(width<1000)await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name:'À faire',exact:true}).click();
  await page.locator('.planner-entry select').selectOption('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');await expect(page.locator('.planner-row')).toHaveCount(20);
  if(width===1366){await page.evaluate(()=>scrollTo(0,0));assert.ok(await page.locator('.planner-item').evaluateAll(items=>items.filter(item=>{const box=item.getBoundingClientRect();return box.top>=0&&box.bottom<=innerHeight;}).length)>=6);}
  await page.locator('.planner-preparation-tools>summary').click();await page.getByRole('button',{name:'Adapter une recette',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Adapter une recette',exact:true});await expect(editor).toBeVisible();
  await editor.getByRole('checkbox',{name:'Bande-annonce',exact:true}).uncheck();await editor.getByRole('checkbox',{name:'Pop-up',exact:true}).uncheck();await editor.getByRole('checkbox',{name:'Événement',exact:true}).check();
  await editor.getByRole('button',{name:'Appliquer à cette ligne',exact:true}).click();await editor.locator('.planner-recipe-editor-footer').getByRole('button',{name:'Fermer',exact:true}).click();await expect(editor).toHaveCount(0);
  await expect(page.locator('.planner-row').first().locator('.planner-item-deliverables')).toContainText('Événement');
  await expect(page.getByRole('button',{name:'Annuler la dernière adaptation',exact:true})).toBeVisible();
  await page.screenshot({path:resolve(directory,`parent-undo-${theme}-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Annuler la dernière adaptation',exact:true}).click();await expect(page.locator('.planner-row').first().locator('.planner-item-deliverables')).toContainText('BA');await expect(page.locator('.planner-row').first().locator('.planner-item-deliverables')).toContainText('Pop-up');
  const habits=page.locator('.planner-habits');await habits.locator(':scope>summary').click();await expect(habits.getByText('Programme 1',{exact:true})).toBeVisible();await habits.getByRole('button',{name:'Adapter cette proposition',exact:true}).click();await expect(editor).toBeVisible();
  await expect(editor.locator('.planner-recipe-origin')).toContainText('3 conducteurs distincts');await expect(editor.getByRole('checkbox',{name:'Tout de suite',exact:true})).toBeChecked();await expect(editor.getByRole('button',{name:'Préparer la mémorisation',exact:true})).toHaveCount(0);await expect(editor.locator('img,video,audio')).toHaveCount(0);
  await editor.locator('.planner-recipe-editor-footer').getByRole('button',{name:'Fermer',exact:true}).click();assert.deepEqual(mutations,[]);const audit=JSON.parse(await page.locator('#planner-fixture-audit').textContent());assert.equal(audit.count,0);assert.deepEqual(audit.projects,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  checks.push({width,theme,realDayPlanner:true,undoAfterClosing:true,habitsEntry:true,noSharedMutation:true,sixRows:width===1366});await page.close();
 }
}catch(error){errors.push(error.stack||String(error));throw error;}
finally{await writeFile(resolve(directory,'report.json'),JSON.stringify({checks,errors,scope:'Real Studio/DayPlanner UI with existing isolated in-memory API fixture; no real account, shared server write, generation, export or production qualification.'},null,2));await browser.close();}
assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:checks.length,errors},null,2));
