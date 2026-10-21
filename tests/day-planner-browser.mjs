import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5221',output=resolve('reports/day-planner');
await mkdir(output,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],requests=[],checks=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}});page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()!=='GET')requests.push({url:r.url(),method:r.method()});});
 await page.goto(base+'/tests/day-planner-workbench.html');await page.getByRole('button',{name:'À faire',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Habillage du jour.'})).toBeVisible();
 const file=process.env.SRTB_PLANNER_FIXTURE;if(!file)throw Error('SRTB_PLANNER_FIXTURE is required');
 await page.locator('.planner-entry input[type=file]').setInputFiles(file);
 await expect(page.getByText(/29 feuilles/)).toBeVisible({timeout:30000});
 await page.getByRole('checkbox',{name:/LUNDI 07 SEPT/}).check();await page.getByRole('checkbox',{name:'J’ai vérifié les onglets et les dates sélectionnés'}).check();await page.getByRole('button',{name:'Préparer ma liste'}).click();
 await expect(page.getByRole('heading',{name:'FITFORME',exact:true}).first()).toBeVisible();checks.push('Real workbook: 29 sheets, explicit Monday selection, cached timings');
 await page.getByRole('button',{name:'Accueil',exact:true}).click();await expect(page.getByRole('dialog',{name:'Conserver votre préparation ?'})).toBeVisible();await page.getByRole('button',{name:'Rester ici',exact:true}).click();checks.push('Navigation guard preserves unsaved import');
 await page.getByLabel('Programme',{exact:true}).fill('FITFORME');
 const rows=page.locator('.planner-row');await expect(rows).toHaveCount(2);await rows.first().getByText('Textes, horaire et habillages à préparer',{exact:true}).click();
 await rows.first().getByLabel('Titre',{exact:true}).fill('FITFORME · spécial santé');
 await rows.first().getByLabel('Vertical · 9:16',{exact:true}).check();
 await rows.first().getByRole('button',{name:'Choisir le média'}).click();await expect(page.getByRole('dialog')).toContainText('Aucun fichier n’est envoyé');
 await page.locator('dialog input[type=file]').setInputFiles(resolve('public/thumbnails/btv-popup.png'));
 await expect(page.locator('dialog .planner-media-preview img')).toBeVisible();await page.getByRole('button',{name:'Utiliser ce média',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0,{timeout:10000});await expect(rows.first()).toContainText('Média lié : btv-popup.png');checks.push('Local media preview and verified fingerprint without upload');
 await page.getByRole('button',{name:'Préparer les habillages de cette vue'}).click();await expect(page.getByRole('dialog')).toContainText('6 nouveaux brouillons');await page.getByRole('button',{name:'Créer les brouillons',exact:true}).click();
 await expect(page.getByText(/Les brouillons sont prêts à ouvrir/)).toBeVisible();await expect(page.locator('.planner-linked button')).toHaveCount(6);checks.push('Prefill/edit titles, select social format, create six linked drafts');
 await page.getByRole('button',{name:'Préparer les habillages de cette vue'}).click();await expect(page.getByRole('dialog')).toContainText('0 nouveaux brouillons');await page.getByRole('button',{name:'Créer les brouillons',exact:true}).click();await expect(page.locator('.planner-linked button')).toHaveCount(6);checks.push('Retry uses same projects, no duplicates');
 for(const [theme,width]of [['dark',1440],['light',1440],['dark',768],['dark',390],['light',390]]){
  await page.setViewportSize({width,height:960});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth>innerWidth+1,controls:[...document.querySelectorAll('.day-planner button')].filter(el=>el.clientWidth&&el.scrollWidth>el.clientWidth+2).map(el=>el.textContent)}));assert.equal(overflow.page,false,JSON.stringify({width,...overflow}));assert.deepEqual(overflow.controls,[],JSON.stringify({width,...overflow}));
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:resolve(output,`planner-${theme}-${width}.png`),fullPage:true});
 }checks.push('Dark/light desktop, tablet, mobile without page/control overflow');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);checks.push('No local file uploads; no page errors in isolated browser fixture');
 await writeFile(resolve(output,'browser-result.json'),JSON.stringify({checks,errors,requests},null,2));console.log(JSON.stringify({checks,errors,requests},null,2));
}finally{await browser.close();}
