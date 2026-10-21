import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5223',directory=resolve('reports/task-workflow');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],checks=[];
const member={email:'lea@example.test',name:'Léa'},other={email:'sam@example.test',name:'Samuel'};
const owned=(row,owner=member,state='assigned')=>({key:`ba:tv:row-${row}`,owner:owner.email,ownerName:owner.name,revision:1,state});
async function open(options={}){
 const {width=1366,theme='dark',role='designer',tasks:initial=[owned(1),owned(2,member,'submitted'),owned(3,other,'draft')],query='',mode='normal'}=options;
 const page=await browser.newPage({viewport:{width,height:768},reducedMotion:'reduce'});let tasks=[...initial],writes=0;
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(!path.endsWith('/assignments'))return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Unexpected isolated API call'})});
  if(request.method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tasks:path.includes('bbbbbbbb')?[]:tasks,members:[member,other]})});
  writes++;const body=request.postDataJSON();assert.equal(body.planRevision,4);assert.equal(body.revision,tasks.find(task=>task.key===body.key)?.revision??0);
  if(mode==='conflict'){tasks=[...tasks,owned(Number(body.key.split('-').at(-1)),other)];return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Cette tâche vient d’être prise ou modifiée. Actualisez.'})});}
  tasks=tasks.filter(task=>task.key!==body.key);if(body.owner)tasks.push({...owned(Number(body.key.split('-').at(-1)),body.owner===member.email?member:other),revision:body.revision+1});
  if(mode==='lost')return route.abort('connectionreset');
  if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,700));
  return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
 });
 await page.goto(`${base}/tests/task-workflow.html?role=${role}&theme=${theme}${query}`);await expect(page.locator('.task-board-list')).toBeVisible();
 return {page,writes:()=>writes};
}
try{
 for(const width of [1366,320])for(const theme of ['dark','light']){
  const {page}=await open({width,theme,role:'admin'});
  await expect(page.getByRole('button',{name:'Équipe 8',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.task-board-list>li')).toHaveCount(6);
  await expect(page.locator('.task-board-list>li').nth(1).getByRole('combobox')).toHaveCount(0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${theme}/${width} overflow`);
  const smallTargets=await page.locator('.task-board button:visible,.task-board select:visible,.project-approval button:visible').evaluateAll(nodes=>nodes.filter(node=>node.getBoundingClientRect().height<43).map(node=>node.textContent));assert.deepEqual(smallTargets,[]);
  await page.screenshot({path:resolve(directory,`tasks-${theme}-${width}.png`),fullPage:true});
  await page.locator('.project-approval').screenshot({path:resolve(directory,`approval-${theme}-${width}.png`)});
  await page.close();checks.push(`${width} ${theme}: team default, 6 rows, started tasks locked, all controls >=44px, no overflow`);
 }
 {
  const {page,writes}=await open();await expect(page.getByRole('button',{name:'Mes tâches 2',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'Valider cette révision',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/^Ouvrir la préparation/}).first().click();await expect(page.locator('.fixture-audit')).toHaveText('Préparation ouverte : row-1');
  await page.getByRole('button',{name:/^Libérer la tâche/}).click();await expect(page.locator('.task-board-list>li')).toHaveCount(1);assert.equal(writes(),1);
  await page.getByRole('button',{name:/^À attribuer/}).click();await page.getByRole('button',{name:'Prendre la tâche',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Mes tâches 2',exact:true})).toHaveAttribute('aria-pressed','true');assert.equal(writes(),2);await expect(page.locator('.task-board-confirmation')).toContainText('vous êtes responsable');
  await page.close();checks.push('Staff: my tasks default, project-open callback, release and one-click claim, responsibility confirmed; reviewer actions absent');
 }
 for(const mode of ['conflict','lost']){
  const {page,writes}=await open({tasks:[],mode});await expect(page.getByRole('button',{name:'À attribuer 8',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Prendre la tâche',exact:true}).first().click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('.task-board-list')).toHaveAttribute('aria-busy','false');assert.equal(writes(),1);
  await page.getByRole('button',{name:/^Équipe/}).click();await expect(page.locator('.task-board-list>li').first()).toContainText(mode==='conflict'?'Samuel':'Moi');await expect(page.locator('.task-board-confirmation')).toHaveCount(0);
  await page.close();checks.push(`${mode}: single write, ownership reread automatically, error retained, no false success`);
 }
 {
  const {page,writes}=await open({role:'admin'});const first=page.locator('.task-board-list>li').first();
  await first.getByRole('combobox').selectOption(other.email);await expect(first.getByRole('combobox')).toHaveValue(other.email);await expect(page.locator('.task-board-confirmation')).toContainText('attribué à Samuel');assert.equal(writes(),1);
  await page.getByRole('button',{name:'Demander une correction',exact:true}).click();await expect(page.locator('.project-approval-state')).toHaveText('Corrections demandées');await page.getByRole('button',{name:'Commentaires',exact:true}).click();await expect(page.locator('.fixture-audit')).toHaveText('Commentaires ouverts');await page.close();checks.push('Reviewer: reassigns only unstarted tasks, requests corrections and opens comments');
 }
 {
  const {page,writes}=await open({tasks:[],mode:'slow'});await page.getByRole('button',{name:'Prendre la tâche',exact:true}).first().click();await page.getByRole('button',{name:'Changer de préparation',exact:true}).click();await expect(page.locator('.task-board-list>li')).toHaveCount(1);await expect(page.locator('.task-board-list')).toHaveAttribute('aria-busy','false');await expect(page.locator('.task-board-confirmation')).toHaveCount(0);assert.equal(writes(),1);await page.close();checks.push('Changing preparation while a write finishes does not apply its owner or success message to the next preparation');
 }
 {
  const {page,writes}=await open({tasks:[],query:'&dirty&status=draft'});await expect(page.getByRole('button',{name:'Prendre la tâche',exact:true}).first()).toBeDisabled();await expect(page.getByRole('button',{name:'Soumettre au diffuseur',exact:true})).toBeDisabled();assert.equal(writes(),0);await page.getByRole('button',{name:'Basculer modifications',exact:true}).click();await page.getByRole('button',{name:'Soumettre au diffuseur',exact:true}).click();await expect(page.locator('.project-approval-state')).toHaveText('En attente de validation');await page.close();checks.push('Unsaved changes block assignment and submission; saving unlocks submission');
 }
 for(const query of ['&notready','&missing']){
  const {page}=await open({role:'admin',query});await expect(page.getByRole('button',{name:'Valider cette révision',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Demander une correction',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Rétablir aperçu',exact:true}).click();await page.getByRole('button',{name:'Valider cette révision',exact:true}).click();await expect(page.locator('.project-approval-state')).toHaveText('Version validée');await page.close();checks.push(`${query}: approval needs ready preview and connected media, rejection remains available`);
 }
 {
  const {page}=await open({role:'admin',query:'&archived'});await expect(page.getByRole('button',{name:'Valider cette révision',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Restaurer',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Restaurer',exact:true}).click();await expect(page.locator('.fixture-audit')).toHaveText('Archive demandée');await page.close();checks.push('Archived project offers restoration and no approval');
 }
 assert.deepEqual(errors,[]);await writeFile(resolve(directory,'report.json'),JSON.stringify({checks,errors,scope:'In-memory fixture with every API request intercepted. No production state or account touched.'},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
