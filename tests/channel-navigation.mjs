import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5224',directory=resolve('reports/channel-navigation');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],checks=[];
async function navigate(page,label){const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')!=='true')await menu.click();await page.getByRole('navigation',{name:'Navigation Graphics'}).getByRole('button',{name:label,exact:true}).click();}
async function evidence(page){return page.evaluate(()=>structuredClone(window.channelNavigationEvidence));}
async function validationContrast(page){return page.locator('.validation-views>button[aria-pressed=true]').evaluate(button=>{
 const parse=color=>color.match(/[\d.]+/g).slice(0,3).map(Number),light=color=>parse(color).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((total,value,i)=>total+value*[.2126,.7152,.0722][i],0);
 const ratio=(a,b)=>{const x=light(a),y=light(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const style=getComputedStyle(button),indicator=getComputedStyle(button,'::after'),canvas=getComputedStyle(document.body).backgroundColor;
 return {text:ratio(style.color,canvas),indicator:ratio(indicator.backgroundColor,canvas)};
});}
try{
 for(const width of [1366,720,320])for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width,height:width===1366?768:844},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({plans:0,updatedAt:null})}));
  await page.goto(`${base}/tests/channel-navigation.html`);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect(page.getByRole('heading',{name:'Aujourd’hui',exact:true})).toBeVisible();
  await expect(page.getByRole('group',{name:'Vue de production'}).getByRole('button',{name:'À valider',exact:true})).toHaveAttribute('aria-pressed','true');
  await navigate(page,'À valider');await expect(page.getByRole('button',{name:'Vérifier : Version à relire',exact:true})).toBeVisible();
  assert.ok((await evidence(page)).reads.some(read=>read.status==='submitted'&&read.scope==='accessible'));
  const views=page.getByRole('group',{name:'Suivi des envois'});
  await views.getByRole('button',{name:'En attente',exact:true}).click();await expect(page.getByRole('button',{name:'Vérifier : Version à relire',exact:true})).toBeVisible();
  await views.getByRole('button',{name:'À corriger',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Voir : Version à corriger',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Vérifier : Version à relire',exact:true})).toHaveCount(0);
  await views.getByRole('button',{name:'Validés',exact:true}).click();await expect(page.getByRole('button',{name:'Ouvrir : Version approuvée',exact:true})).toBeVisible();
  for(const status of ['submitted','rejected','approved'])assert.ok((await evidence(page)).reads.some(read=>read.status===status&&read.scope==='accessible'));
  for(const button of await views.getByRole('button').all())assert.ok((await button.boundingBox()).height>=44);
  const contrast=await validationContrast(page);assert.ok(contrast.text>=4.5,`${theme}: text contrast ${contrast.text}`);assert.ok(contrast.indicator>=3,`${theme}: selected indicator contrast ${contrast.indicator}`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.equal(await page.locator('video,audio').count(),0);
  await page.screenshot({path:resolve(directory,`validation-${theme}-${width}.png`),fullPage:true});
  for(const name of ['Bénin TV Alafia','Bénin TV Kids']){
   await page.getByRole('button',{name:'Gérer les chaînes',exact:true}).click();
   await page.getByRole('button',{name,exact:true}).click();await expect(page.getByRole('textbox',{name:'Nouvelle chaîne',exact:true})).toHaveValue(name);
   await page.getByRole('button',{name:'Créer la chaîne',exact:true}).click();
   await expect(page.getByRole('combobox',{name:'Chaîne de travail',exact:true})).toContainText(name);
   await expect(page.getByRole('heading',{name:'Votre espace est prêt',exact:true})).toBeVisible();
   await navigate(page,'Bibliothèque');await expect(page.getByRole('heading',{name:'Bibliothèque',exact:true})).toBeVisible();await expect(page.locator('.catalogue-choice')).toHaveCount(0);await expect(page.locator('video,audio')).toHaveCount(0);
   await navigate(page,'Médias');await expect(page.getByRole('heading',{name:'Aucun média partagé',exact:true})).toBeVisible();await expect(page.getByText('Voix Bénin TV.wav',{exact:true})).toHaveCount(0);
   await navigate(page,'Émissions');await expect(page.locator('.programme-list>button')).toHaveCount(0);
  }
  await page.getByRole('combobox',{name:'Chaîne de travail'}).selectOption('benin-tv');
  await navigate(page,'Bibliothèque');await expect(page.locator('.catalogue-choice').first()).toBeAttached();await expect(page.getByRole('button',{name:'Charger l’aperçu',exact:true})).toBeVisible();await expect(page.locator('video,audio')).toHaveCount(0);
  await navigate(page,'Médias');await expect(page.getByText('Voix Bénin TV.wav',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Gérer les chaînes',exact:true}).click();await expect(page.getByRole('button',{name:/^Bénin TV Alafia/})).toBeDisabled();await expect(page.getByRole('button',{name:/^Bénin TV Kids/})).toBeDisabled();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.equal(await page.locator('dialog[open]').evaluate(node=>node.scrollWidth>node.clientWidth+1),false);
  await page.screenshot({path:resolve(directory,`channels-${theme}-${width}.png`),fullPage:true});
  assert.equal((await evidence(page)).creates.length,2);checks.push({width,theme,passed:true});await page.close();
 }
 const page=await browser.newPage();await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({plans:0,updatedAt:null})}));await page.goto(`${base}/tests/channel-navigation.html?role=designer`);
 await expect(page.getByRole('button',{name:'Gérer les chaînes',exact:true})).toHaveCount(0);await navigate(page,'Mes envois');await expect(page.getByRole('button',{name:'Voir : Version à relire',exact:true})).toBeVisible();
 const views=page.getByRole('group',{name:'Suivi des envois'});await views.getByRole('button',{name:'À corriger',exact:true}).click();
 await expect(page.getByRole('button',{name:'Corriger : Version à corriger',exact:true})).toBeVisible();
 const search=page.getByRole('searchbox',{name:'Rechercher un projet',exact:true});await search.fill('corriger');
 await page.getByRole('button',{name:'Corriger : Version à corriger',exact:true}).click();await expect(page.getByRole('textbox',{name:'Nom du projet',exact:true})).toHaveValue('Version à corriger');
 await expect(page.getByRole('button',{name:'Réglages',exact:true})).toHaveAttribute('aria-current','page');
 await page.locator('.workspace-back').click();await expect(views.getByRole('button',{name:'À corriger',exact:true})).toHaveAttribute('aria-pressed','true');await expect(search).toHaveValue('corriger');
 await page.getByRole('button',{name:'Corriger : Version à corriger',exact:true}).click();await page.getByRole('textbox',{name:'Nom du projet',exact:true}).fill('Version à corriger — reprise');
 await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(page.getByText('Corrections enregistrées. Soumettez cette nouvelle version au diffuseur.',{exact:true})).toBeVisible();
 await page.locator('.workspace-back').click();await expect(page.getByRole('heading',{name:'Aucun projet correspondant',exact:true})).toBeVisible();await search.fill('');await expect(page.getByRole('heading',{name:'Aucune correction demandée',exact:true})).toBeVisible();
 await views.getByRole('button',{name:'Validés',exact:true}).click();await expect(page.getByRole('button',{name:'Ouvrir : Version approuvée',exact:true})).toBeVisible();
 for(const status of ['submitted','rejected','approved'])assert.ok((await evidence(page)).reads.some(read=>read.status===status&&read.scope==='mine'));
 await page.close();checks.push({role:'designer',returnContext:true,correctedDraft:true,passed:true});
 assert.deepEqual(errors,[]);await writeFile(resolve(directory,'report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors}));
}finally{await browser.close();}
