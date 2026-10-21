import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5219';
const directory=resolve('reports/social-editorial-overflow');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],apiRequests=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{apiRequests.push(route.request().url());return route.fulfill({status:500,body:'No API in social editorial fixture'});});
  await page.goto(base+'/tests/social-portrait-qualification.html');
  await expect(page.getByRole('button',{name:'Contrôler les compositions et la parité',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Contrôler les compositions et la parité',exact:true}).click();
  await expect(page.locator('#status')).toHaveText(/^(PASS|ÉCHEC)/,{timeout:180000});
  const report=JSON.parse(await page.locator('#result').innerText());
  await writeFile(resolve(directory,'results.json'),JSON.stringify({...report,pageErrors:errors,apiRequests},null,2));
  assert.equal(report.status,'PASS',report.error||'Qualification incomplète');
  await page.locator('#gallery').screenshot({path:resolve(directory,'compositions.png')});

  // Exercise live editing through the same public controls used by an operator.
  await page.getByRole('combobox',{name:'Composition de test'}).selectOption({label:'9:16 · quatre lignes saisies'});
  await page.getByRole('button',{name:'Ouvrir l’éditeur réel',exact:true}).click();
  await expect(page.getByRole('button',{name:'Lire l’aperçu',exact:true})).toBeEnabled({timeout:30000});
  await page.getByRole('button',{name:'Lire l’aperçu',exact:true}).click();
  await page.getByRole('button',{name:'Mettre l’aperçu en pause',exact:true}).click();
  await expect(page.getByRole('button',{name:'Reprendre l’aperçu',exact:true})).toBeEnabled();
  await expect(page.locator('.preview-panel [role=status]').filter({hasText:'utilise 4 lignes'})).toBeVisible();
  const selection=page.getByRole('region',{name:'Éditeur de texte'}).getByRole('combobox',{name:'Texte à modifier',exact:true});
  await selection.selectOption('_titre_ligne_1');
  const content=page.getByRole('region',{name:'Éditeur de texte'}).getByRole('textbox');
  await expect(content).toHaveValue('LE GRAND\nENTRETIEN\nAU CŒUR\nDU BÉNIN');
  await content.fill('ENTRETIEN');
  await expect(page.locator('.preview-panel [role=status]').filter({hasText:'utilise 4 lignes'})).toHaveCount(0);
  await page.getByRole('button',{name:'Simuler sauvegarde et relecture',exact:true}).click();
  await expect(content).toHaveValue('ENTRETIEN');
  await page.locator('.preview-panel').screenshot({path:resolve(directory,'corrected-preview.png')});
  assert.deepEqual(errors,[]);assert.deepEqual(apiRequests,[]);
  const liveEdit='4 lignes → pause → correction → avertissement retiré → relecture';
  await writeFile(resolve(directory,'results.json'),JSON.stringify({...report,liveEdit,pageErrors:errors,apiRequests},null,2));
  console.log(JSON.stringify({passed:true,compositions:report.records.length,parities:report.parities.length,liveEdit,pageErrors:errors,apiRequests},null,2));
}finally{await browser.close();}
