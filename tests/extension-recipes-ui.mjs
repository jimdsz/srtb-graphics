import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(['POST','PUT','PATCH','DELETE'].includes(r.method()))writes.push(r.url());});
try{
  for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier']){
    await page.goto(`http://127.0.0.1:5221/tests/operator-workbench.html?template=${id}`);
    await page.locator('[data-project-id="operator-fixture"] .project-row-title').click();
    const suggestion=page.getByRole('button',{name:'Voir les éléments proposés',exact:true});await expect(suggestion).toBeVisible();await suggestion.click();
    const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'Créer les déclinaisons',exact:true})).toBeVisible();
    await expect(dialog.getByText('2 sortie(s) sélectionnée(s) / 8 maximum',{exact:true})).toBeVisible();
    await expect(dialog.getByRole('button',{name:'Préparer les projets',exact:false})).toBeEnabled();
    await expect(dialog.getByRole('button',{name:'Préparer et exporter',exact:false})).toBeEnabled();
    results.push({id,choices:await dialog.locator('.derivation-choice-label strong').allTextContents(),selected:await dialog.locator('.derivation-choice-label input:checked').count()});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  await writeFile('reports/ae-live/recipes-ui.json',JSON.stringify({at:new Date().toISOString(),results,errors,writes},null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
