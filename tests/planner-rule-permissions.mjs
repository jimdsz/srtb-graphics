import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',output=resolve('reports/planner-rule-permissions');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const checks=[],errors=[],unexpectedRequests=[];
async function open(role,view){
  const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===base&&!url.pathname.startsWith('/api/'))return route.continue();
    unexpectedRequests.push(url.href);return route.abort();
  });
  await page.goto(`${base}/tests/planner-rule-permissions.html?role=${role}&view=${view}`);
  await expect(page.getByRole('heading',{name:'Recette locale — permissions des règles',exact:true})).toBeAttached();
  return page;
}
async function audit(page){return page.evaluate(()=>window.plannerRuleEvidence);}
try{
  for(const role of ['designer','missing','admin','broadcaster']){
    const page=await open(role,'recipes'),allowed=['admin','broadcaster'].includes(role);
    await expect(page.getByRole('button',{name:'Voir les propositions',exact:true})).toBeVisible();
    const memory=page.getByRole('button',{name:'Mémoriser mes recettes',exact:true});
    if(allowed){
      await expect(memory).toBeEnabled();await memory.click();
      const dialog=page.getByRole('dialog');
      for(const choice of await dialog.getByRole('checkbox').all())await expect(choice).not.toBeChecked();
      await expect(dialog.getByRole('button',{name:'Mémoriser 0 recette(s) pour l’équipe',exact:true})).toBeDisabled();
      assert.equal((await audit(page)).writes.length,0);
      await dialog.getByRole('checkbox').first().check();
      await dialog.getByRole('button',{name:'Mémoriser 1 recette(s) pour l’équipe',exact:true}).click();
      await expect(dialog).toHaveCount(0);
      const result=await audit(page);assert.equal(result.writes.length,1);assert.equal(result.writes[0].kind,'rule');
      checks.push(`${role} recipes: no selection or write before explicit opt-in; one rule saved after confirmation`);
    }else{
      await expect(memory).toHaveCount(0);
      await expect(page.getByText(/Confirmez vos préparations dans « Habitudes proposées »/)).toBeVisible();
      await page.getByRole('button',{name:'Voir les propositions',exact:true}).click();
      await page.getByRole('button',{name:'Appliquer à 1 programme(s)',exact:true}).click();
      const result=await audit(page);assert.equal(result.writes.length,0);assert.equal(result.localRecipeChanges,1);
      checks.push(`${role} recipes: shared-memory action absent, local recipe application retained, zero rule writes`);
    }
    await page.screenshot({path:resolve(output,`recipes-${role}.png`),fullPage:true});await page.close();
  }
  for(const view of ['single','batch','team'])for(const role of ['designer','admin','broadcaster'])for(const optIn of role==='designer'?[false]:[false,true]){
    const page=await open(role,view),allowed=role!=='designer';
    if(view==='single'){
      await page.locator('summary').filter({hasText:'Dossiers d’équipe et recherche de médias'}).click();
      await page.getByRole('button',{name:'Voir et vérifier',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Vérifier le média',exact:true})).toBeVisible();
    }else{
      if(view==='batch')await page.getByRole('combobox',{name:'Dossier de recherche',exact:true}).selectOption('11111111-1111-4111-8111-111111111111');
      await page.getByRole('button',{name:'Cocher les correspondances distinctes',exact:true}).click();
    }
    const learn=page.getByRole('checkbox',{name:view==='single'?'Mémoriser l’association programme / média pour l’équipe':view==='batch'?'Retenir ces associations pour les prochaines préparations de l’équipe':'Retenir ces associations pour l’équipe',exact:true});
    if(allowed){
      await expect(learn).not.toBeChecked();
      await expect(page.getByRole('checkbox',{name:/Réutiliser aussi/})).toHaveCount(0);
      if(optIn){
        await learn.check();
        await expect(page.getByRole('checkbox',{name:/Réutiliser aussi/})).not.toBeChecked();
        // A fresh media choice must not inherit a previous learning consent.
        if(view==='single'){
          await page.getByRole('button',{name:'Voir et vérifier',exact:true}).click();
          await expect(learn).not.toBeChecked();await learn.check();
        }
      }
    }else{
      await expect(learn).toHaveCount(0);
      await expect(page.getByRole('checkbox',{name:/Réutiliser aussi/})).toHaveCount(0);
      await expect(page.getByText(/puis confirmez vos choix dans « Habitudes proposées »/)).toBeVisible();
    }
    assert.equal((await audit(page)).writes.length,0,'Viewing and selecting media never writes a rule');
    await page.screenshot({path:resolve(output,`${view}-${role}-${optIn?'opt-in':'default'}.png`),fullPage:true});
    await page.getByRole('button',{name:view==='single'?'Utiliser ce média':view==='batch'?'Relier les médias sélectionnés':'Relier les 1 médias sélectionnés',exact:true}).click();
    await expect.poll(async()=>((await audit(page)).bindings.length)).toBe(1);
    if(view==='single')await expect(page.getByRole('dialog')).toHaveCount(0);
    else await expect(page.getByRole('status').filter({hasText:/1 média\(s\) lié\(s\)/})).toBeVisible();
    const result=await audit(page);
    assert.equal(result.writes.length,optIn?1:0,`${role} ${view}: write requires permission AND explicit opt-in`);
    assert.match(result.bindings[0].media.url,/^local-media:/,'Ordinary media binding still verifies the local image');
    assert.equal(result.bindings[0].location.directoryId,'11111111-1111-4111-8111-111111111111');
    checks.push(`${role} ${view} ${optIn?'opt-in':'default'}: media bound; ${result.writes.length} shared rule write(s)`);
    await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
  const report={scope:'Synthetic local image, memory-only folder handles, API stubs. Real auth/backend permissions/persistence and production not tested.',checks,errors,unexpectedRequests};
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
