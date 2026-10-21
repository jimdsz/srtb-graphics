import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/production-overview');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],unexpected=[];
const audit=page=>page.evaluate(()=>structuredClone(window.productionOverviewFixture.evidence));
async function open(mode='populated',width=1366,theme='dark',shell=false){
 const page=await browser.newPage({viewport:{width,height:width===720?450:width===1366?768:844},deviceScaleFactor:width===720?2:1,reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(shell&&url.origin===base&&url.pathname==='/api/graphics/habits'&&route.request().method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({suggestions:[]})});if(url.origin!==base||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(route.request().method())){unexpected.push(url.href);return route.abort();}return route.continue();});
 await page.goto(`${base}/tests/production-overview.html?mode=${mode}${shell?'&shell=1':''}`);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await expect(page.getByRole('heading',{name:'La production du jour'})).toBeVisible();return page;
}
async function capture(page,name){
 await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${name}: no horizontal overflow`);
 assert.deepEqual(await page.locator('.production-overview button,.production-overview input').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length&&node.getBoundingClientRect().height<43).map(node=>node.textContent)),[]);
 await expect(page.locator('audio,video,canvas,img,iframe')).toHaveCount(0);
}
try{
 for(const width of [1366,720,320])for(const theme of ['dark','light']){
  const page=await open('populated',width,theme),scope=page.getByRole('region',{name:'La production du jour'});
  await expect(scope.locator('.overview-item')).toHaveCount(6);
  assert.equal((await audit(page)).calls.length,1);assert.equal((await audit(page)).items.length,0);
  await scope.getByRole('button',{name:'Mes tâches',exact:true}).click();await expect(scope.locator('.overview-item')).toHaveCount(6);assert.equal((await audit(page)).calls.length,1);
  const first=scope.getByRole('button',{name:'Préparer : Journal du soir · Journée · Équipe actualités',exact:true});await first.focus();await page.keyboard.press('Enter');
  assert.equal((await audit(page)).items[0].planId,'plan-0');assert.equal((await audit(page)).items[0].rowId,'row-0');
  await expect(scope.getByRole('button',{name:/^Ouvrir le projet :/})).toHaveCount(3);
  await scope.getByRole('button',{name:'Ouvrir le projet : Le grand rendez-vous des régions et de la culture',exact:true}).click();assert.deepEqual((await audit(page)).projects,['visible-project-1']);
  await capture(page,`mine-${theme}-${width}`);
  const more=scope.getByRole('button',{name:'Charger la suite',exact:true});await more.focus();await page.keyboard.press('Enter');await expect(scope.locator('.overview-item')).toHaveCount(7);
  await expect(scope.getByRole('button',{name:'Préparer : Émission supplémentaire · Journée · Équipe actualités',exact:true})).toBeFocused();
  assert.equal((await audit(page)).calls.at(-1).cursor,'page-2');
  await scope.getByRole('button',{name:'Médias à choisir',exact:true}).click();await expect(scope.locator('.overview-item')).toHaveCount(6);
  await expect(scope.getByText('Lignes retenues sans média sélectionné. L’accès aux fichiers sur ce poste n’est pas vérifié ici.',{exact:true})).toBeVisible();
  assert.equal((await audit(page)).calls.at(-1).cursor,undefined);await expect(scope.getByText('Bande-annonce',{exact:true})).toHaveCount(0);
  await scope.getByRole('button',{name:'À valider',exact:true}).focus();await page.keyboard.press('Space');await expect(scope.getByRole('button',{name:/^Relire :/})).toHaveCount(3);
  await capture(page,`review-${theme}-${width}`);checks.push({name:`${theme}-${width}`,keyboard:true,pagination:true,permissions:true,noMedia:true});await page.close();
 }
 for(const mode of ['empty','empty-page','error','page-error','refresh-error','mismatch','busy']){
  const page=await open(mode,320,'light'),scope=page.getByRole('region',{name:'La production du jour'});
  if(mode==='empty'){await expect(scope.getByText('Aucune tâche ne vous est attribuée pour ce jour.',{exact:true})).toBeVisible();await expect(scope.getByRole('button',{name:'Charger la suite'})).toHaveCount(0);}
  if(mode==='empty-page'){await expect(scope.getByText('Aucun élément dans cette partie des préparations. Poursuivez la lecture.',{exact:true})).toBeVisible();await expect(scope.getByText('Aucune tâche ne vous est attribuée pour ce jour.',{exact:true})).toHaveCount(0);await scope.getByRole('button',{name:'Charger la suite'}).click();await expect(scope.locator('.overview-item')).toHaveCount(2);}
  if(mode==='error'){await expect(scope.getByRole('alert')).toContainText('Lecture refusée');await expect(scope.getByText('Aucune tâche ne vous est attribuée pour ce jour.',{exact:true})).toHaveCount(0);await scope.getByRole('button',{name:'Réessayer',exact:true}).click();await expect(scope.locator('.overview-item')).toHaveCount(6);}
  if(mode==='page-error'){await expect(scope.locator('.overview-item')).toHaveCount(6);await scope.getByRole('button',{name:'Charger la suite'}).click();await expect(scope.getByRole('alert')).toContainText('Suite indisponible');await expect(scope.locator('.overview-item')).toHaveCount(6);await scope.getByRole('button',{name:'Réessayer',exact:true}).click();await expect(scope.locator('.overview-item')).toHaveCount(7);}
  if(mode==='refresh-error'){await expect(scope.locator('.overview-item')).toHaveCount(6);await scope.getByRole('button',{name:'Actualiser la production du jour'}).click();await expect(scope.getByRole('alert')).toContainText('Actualisation indisponible');await expect(scope.locator('.overview-item')).toHaveCount(6);await scope.getByRole('button',{name:'Réessayer',exact:true}).click();await expect(scope.getByRole('alert')).toHaveCount(0);}
  if(mode==='mismatch'){await expect(scope.getByRole('alert')).toContainText('La réponse ne correspond pas');await expect(scope.locator('.overview-item')).toHaveCount(0);}
  if(mode==='busy'){await expect(scope.locator('.overview-item')).toHaveCount(6);for(const action of await scope.locator('.overview-item button').all())await expect(action).toBeDisabled();assert.equal((await audit(page)).projects.length,0);}
  await capture(page,mode);checks.push({name:mode,pass:true});await page.close();
 }
 {
  const page=await open('late'),scope=page.getByRole('region',{name:'La production du jour'});
  await expect(scope.getByText('Chargement de la production…',{exact:true})).toBeVisible();await expect(scope.getByText('Aucune tâche ne vous est attribuée pour ce jour.',{exact:true})).toHaveCount(0);
  await scope.getByRole('button',{name:'À valider',exact:true}).click();await expect(scope.getByRole('button',{name:/^Relire :/})).toHaveCount(3);
  await page.evaluate(()=>window.productionOverviewFixture.release());await expect(scope.getByRole('button',{name:/^Relire :/})).toHaveCount(3);assert.equal((await audit(page)).aborts>=1,true);
  await scope.getByLabel('Jour du conducteur').fill('2026-09-29');await expect.poll(async()=>(await audit(page)).calls.at(-1).date).toBe('2026-09-29');
  await expect(scope.getByText('30 sept.',{exact:true})).toBeVisible();await capture(page,'air-date-rollover');
  await scope.getByLabel('Jour du conducteur').fill('');await expect(scope.getByText('Choisissez une date valide.',{exact:true})).toBeVisible();await expect(scope.locator('.overview-item')).toHaveCount(0);
  checks.push({name:'late-view-date',pass:true});await page.close();
 }
 {
  const page=await open('populated',1366,'dark',true);
  await page.getByRole('button',{name:'Préparer : Journal du soir · Journée · Équipe actualités',exact:true}).click();
  const inspector=page.locator('dialog[aria-labelledby="planner-inspector-title"]');await expect(inspector).toBeVisible();
  await expect(inspector.getByRole('textbox',{name:'Épisode / sous-titre',exact:true})).toHaveValue('Cible issue de l’accueil');
  await inspector.getByRole('textbox',{name:'Titre',exact:true}).fill('Retouche depuis l’accueil');await page.keyboard.press('Escape');
  await page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name:'Accueil',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Conserver votre préparation ?',exact:true})).toBeVisible();await page.getByRole('button',{name:'Rester ici',exact:true}).click();
  await page.getByRole('button',{name:'Préparer Retouche depuis l’accueil',exact:true}).click();await expect(inspector.getByRole('textbox',{name:'Titre',exact:true})).toHaveValue('Retouche depuis l’accueil');
  await expect(page.locator('audio,video,canvas,iframe')).toHaveCount(0);await page.screenshot({path:resolve(directory,'studio-target-and-dirty.png'),fullPage:true});
  checks.push({name:'real-studio-overview-to-planner',exactTarget:true,dirtyNavigationGuard:true,mockedMetadata:true});await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);await writeFile(resolve(directory,'report.json'),JSON.stringify({checks,errors,unexpected},null,2));console.log(JSON.stringify({checks,errors,unexpected},null,2));
}finally{await browser.close();}
