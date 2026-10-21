import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/planner-logo-entry');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],unexpected=[];
try{
 for(const [width,theme] of [[1366,'dark'],[320,'light']]){
  const page=await browser.newPage({viewport:{width,height:width===1366?768:844},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;
   const body=path.endsWith('/channels')?[{id:'benin-tv',name:'Bénin TV',logo:'',accent:'#efbd32',timezone:'Africa/Porto-Novo',revision:1,archived:0}]:path.endsWith('/habits')?{suggestions:[]}:null;
   if(!body)unexpected.push({path,method:route.request().method()});return route.fulfill({status:body?200:500,contentType:'application/json',body:JSON.stringify(body||{error:'Appel inattendu dans la recette logo'})});
  });
  await page.goto(`${base}/tests/day-planner-workbench.html?seed=1&large=1`);await page.addStyleTag({content:'#planner-fixture-audit{display:none}'});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const png=Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=48;canvas.height=24;const c=canvas.getContext('2d');c.fillStyle='#efbd32';c.fillRect(0,0,48,24);return canvas.toDataURL('image/png').split(',')[1];}),'base64');
  if(width<=800)await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('navigation',{name:'Navigation Graphics'}).getByRole('button',{name:'À faire',exact:true}).click();
  await page.locator('.planner-entry select').selectOption('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');await page.getByRole('button',{name:'Préparer Programme 1',exact:true}).click();
  const inspector=page.locator('dialog[aria-labelledby="planner-inspector-title"]'),logo=page.getByRole('dialog',{name:'Logo facultatif',exact:true});
  await expect(inspector.getByRole('textbox',{name:'Épisode / sous-titre',exact:true})).toHaveValue('Épisode 31');
  await inspector.getByRole('button',{name:'Logo de l’émission : Programme 1',exact:true}).click();await expect(logo).toBeVisible();
  await expect(logo.locator('img')).toHaveCount(0);await logo.getByRole('button',{name:'Annuler',exact:true}).click();
  await expect(inspector.getByRole('button',{name:'Logo de l’émission : Programme 1',exact:true})).toBeFocused();
  await inspector.getByRole('button',{name:'Logo de l’émission : Programme 1',exact:true}).click();
  await logo.locator('input[type=file]').setInputFiles({name:'Logo local de recette.png',mimeType:'image/png',buffer:png});
  await expect(logo.getByRole('checkbox',{name:'J’ai vérifié ce logo pour cette émission.',exact:true})).toBeEnabled();
  await expect(logo.getByRole('button',{name:'Utiliser ce logo',exact:true})).toBeDisabled();
  await logo.getByRole('checkbox',{name:'J’ai vérifié ce logo pour cette émission.',exact:true}).check();await logo.getByRole('button',{name:'Utiliser ce logo',exact:true}).click();
  await expect(logo).toHaveCount(0);await expect(inspector.getByRole('button',{name:'Logo de l’émission : Programme 1',exact:true})).toContainText('Logo local de recette.png');
  await expect(inspector.getByRole('textbox',{name:'Épisode / sous-titre',exact:true})).toHaveValue('Épisode 31');await expect(inspector.getByRole('textbox',{name:'Heure de diffusion',exact:true})).toHaveValue('20:30:00');
  await expect(inspector.getByText('Média manquant · à compléter avant export.',{exact:true})).toBeVisible();await expect(inspector.getByRole('checkbox',{name:'Inclure dans le semainier',exact:true})).not.toBeChecked();
  await page.screenshot({path:resolve(directory,`inspector-${theme}-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Enregistrer les modifications',exact:true})).toBeEnabled();
  if(width<=800)await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('navigation',{name:'Navigation Graphics'}).getByRole('button',{name:'Accueil',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Conserver votre préparation ?',exact:true})).toBeVisible();await page.getByRole('button',{name:'Rester ici',exact:true}).click();
  await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(page.getByRole('button',{name:'Enregistrer les modifications',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Recharger la version partagée',exact:true}).click();await page.getByRole('button',{name:'Préparer Programme 1',exact:true}).click();
  await expect(inspector.getByRole('button',{name:'Logo de l’émission : Programme 1',exact:true})).toContainText('Logo local de recette.png');
  await inspector.getByRole('button',{name:'Logo de l’émission : Programme 1',exact:true}).click();await logo.getByRole('button',{name:'Retirer le logo',exact:true}).click();await logo.getByRole('checkbox',{name:'Je confirme le retrait du logo pour les nouveaux brouillons.',exact:true}).check();await logo.getByRole('button',{name:'Confirmer le retrait',exact:true}).click();
  await expect(inspector.getByRole('button',{name:'Logo de l’émission : Programme 1',exact:true})).toContainText('À choisir ou proposer depuis la fiche');
  await expect(page.locator('video,audio')).toHaveCount(0);checks.push({name:`${theme}-${width}`,realStudioAndDayPlanner:true,localFileAndExplicitConfirmation:true,cancelAndFocus:true,dirtyGuard:true,saveReloadAndRemoval:true,episodeTimeMediaWeeklyUnchanged:true,mockedPersistence:true});await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);const report={scope:'Real UI with in-memory API doubles; genuine synthetic PNG and local fingerprint/preview. No production account, server persistence or exports verified.',checks,errors,unexpected};await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
