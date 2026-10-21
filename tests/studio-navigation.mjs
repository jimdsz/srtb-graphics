import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.SRTB_QA_ORIGIN||'http://127.0.0.1:5192';
const browser=await chromium.launch({channel:'msedge',headless:true});
const reports=[],errors=[];
const pass=name=>{reports.push(name);console.log('PASS '+name);};
try{
  const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const send=async(method,path,data)=>{const response=await context.request[method](base+'/api/graphics'+path,{headers:{Origin:base},data});assert.ok(response.ok(),await response.text());return response.json();};
  const project=await send('post','/projects',{title:'Navigation QA',templateId:'BTV_Relais_Antenne',data:{_out_mode:'manual'}});
  const current=()=>send('get',`/projects/${project.id}`);
  const projectRow=page.locator(`[data-project-id="${project.id}"]`);
  const nav=page.getByRole('navigation',{name:'Navigation Graphics'});
  const title=page.getByLabel('Nom du projet',{exact:true});
  const open=async name=>{await nav.getByRole('button',{name:'Projets',exact:true}).click();await projectRow.getByRole('button',{name:new RegExp('^'+name+' ')}).click();await expect(title).toBeVisible();};
  await page.goto(base+'/tests/workspace-reliability.html?studio=1');
  await open('Navigation QA');
  await nav.getByRole('button',{name:'Accueil',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Habillages BTV.'})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
  pass('navigation directe depuis un projet inchangé, sans erreur ni fermeture préalable');

  await open('Navigation QA');await title.fill('Navigation conservée');
  await nav.getByRole('button',{name:'Bibliothèque',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Conserver vos modifications ?'})).toBeVisible();
  await page.getByRole('button',{name:'Rester sur le projet',exact:true}).click();await expect(title).toHaveValue('Navigation conservée');
  await nav.getByRole('button',{name:'Médias',exact:true}).click();
  await page.getByRole('button',{name:'Enregistrer et continuer',exact:true}).click();
  await expect(title).toHaveCount(0);await expect(nav.getByRole('button',{name:'Médias',exact:true})).toHaveAttribute('aria-current','page');
  assert.equal((await current()).title,'Navigation conservée');
  pass('saisies préservées en restant ; enregistrer et continuer mène directement à la page demandée');

  await open('Navigation conservée');await title.fill('Saisie abandonnée explicitement');
  await nav.getByRole('button',{name:'Accueil',exact:true}).click();
  await page.getByRole('button',{name:'Quitter sans enregistrer',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Habillages BTV.'})).toBeVisible();
  assert.equal((await current()).title,'Navigation conservée');
  pass('quitter sans enregistrer est explicite et ne modifie pas les données partagées');

  await open('Navigation conservée');await title.fill('Brouillon en conflit');
  const original=await current();await send('put',`/projects/${project.id}`,{title:'Version collègue',revision:original.revision,data:original.data});
  await nav.getByRole('button',{name:'Bibliothèque',exact:true}).click();await page.getByRole('button',{name:'Enregistrer et continuer',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Un collègue');
  await page.getByRole('button',{name:'Rester sur le projet',exact:true}).click();await expect(title).toHaveValue('Brouillon en conflit');
  assert.equal((await current()).title,'Version collègue');
  pass('conflit lors du départ : pas de navigation destructive, pas d’écrasement, brouillon conservé');

  await nav.getByRole('button',{name:'Accueil',exact:true}).click();await page.getByRole('button',{name:'Quitter sans enregistrer',exact:true}).click();
  await nav.getByRole('button',{name:'Projets',exact:true}).click();await page.getByRole('button',{name:'Actualiser',exact:true}).click();
  await projectRow.getByRole('button',{name:'Exporter : Version collègue',exact:true}).click();
  await expect(page.getByRole('button',{name:'Télécharger la vidéo',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Soumettre au diffuseur',exact:true})).not.toBeVisible();
  pass('raccourci Exporter dans la liste, accessible avec une interface infographiste');

  await page.getByLabel('Déclencher OUT après (secondes)').fill('1.4');
  let release,seen,downloads=0;page.on('download',()=>downloads++);
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>seen=resolve);
  const pattern='**/api/graphics/projects/'+project.id+'/export';
  await page.route(pattern,async route=>{seen();await gate;await route.continue().catch(()=>{});});
  await page.getByRole('button',{name:'Télécharger la vidéo',exact:true}).click();await started;
  await nav.getByRole('button',{name:'Bibliothèque',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Un export est en cours'})).toBeVisible();
  await page.getByRole('button',{name:'Annuler l’export et quitter',exact:true}).click();release();
  await expect(title).toHaveCount(0);assert.equal(downloads,0);await page.unroute(pattern);
  pass('départ pendant un export : confirmation d’annulation, aucune fausse livraison');

  await nav.getByRole('button',{name:'Projets',exact:true}).click();await projectRow.getByRole('button',{name:'Exporter : Version collègue',exact:true}).click();
  await expect(page.getByRole('button',{name:'Télécharger la vidéo',exact:true})).toBeVisible();
  await mkdir('reports/reliability',{recursive:true});await page.screenshot({path:'reports/reliability/direct-export-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('region',{name:'Export vidéo'}).scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'reports/reliability/direct-export-mobile.png',fullPage:true});
  pass('export responsive à 390 pixels, sans débordement horizontal');
  assert.deepEqual(errors,[]);await writeFile('reports/reliability/navigation.json',JSON.stringify({checkedAt:new Date().toISOString(),environment:'Local loopback, temporary D1, no production mutation.',reports,errors},null,2));
}finally{await browser.close();}
