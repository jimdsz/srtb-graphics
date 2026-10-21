import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',phase=process.argv[3]||'before';
assert.ok(['before','after'].includes(phase));
const directory=resolve('reports/operator-ux-postpublication',phase);await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[],requests=[],results=[];
try{
  for(const width of [1440,390])for(const theme of ['dark','light']){
    const page=await browser.newPage({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/**',route=>{
      const request=route.request();requests.push({method:request.method(),url:request.url()});
      if(request.method()==='GET'&&request.url().endsWith('/derivation-origin'))return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Fixture ordinary project: no provenance'})});
      return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Unexpected fixture API request'})});
    });
    await page.goto(base+'/tests/operator-workbench.html');
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await expect(page.getByRole('heading',{name:'Votre studio de création.',exact:true})).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    if(width===390)await page.getByRole('button',{name:'Menu',exact:true}).click();
    await page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name:'Bibliothèque',exact:true}).click();
    await expect(page.locator('.template-detail')).toBeVisible();
    await page.screenshot({path:resolve(directory,`library-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
    const library=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,visibleText:document.body.innerText.length}));
    if(width===390)await page.getByRole('button',{name:'Menu',exact:true}).click();
    await page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name:'Projets',exact:true}).click();
    await page.locator('[data-project-id="operator-fixture"] .project-row-title').click();
    await expect(page.getByRole('button',{name:'Lire l’aperçu',exact:true})).toBeEnabled({timeout:30000});
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:resolve(directory,`editor-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
    const editor=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,visibleText:document.body.innerText.length,controls:[...document.querySelectorAll('.fields-panel input,.fields-panel select,.fields-panel textarea,.fields-panel button')].filter(el=>el.checkVisibility()).length}));
    assert.ok(library.pageWidth<=width+1,JSON.stringify(library));assert.ok(editor.pageWidth<=width+1,JSON.stringify(editor));
    const checks=[];
    if(phase==='after'){
      const disclosure=page.locator('.typography-disclosure'),summary=disclosure.locator(':scope>summary'),typography=page.getByRole('region',{name:'Éditeur de texte',exact:true});
      const title=page.getByRole('textbox',{name:'Titre',exact:true}),search=page.getByRole('searchbox',{name:'Rechercher un réglage',exact:true});
      await expect(disclosure).not.toHaveAttribute('open','');await expect(title).toBeVisible();
      await expect(typography).not.toBeVisible();
      await summary.focus();await page.keyboard.press('Enter');await expect(typography).toBeVisible();
      await expect(page.getByText('Toutes les modifications sont enregistrées',{exact:true})).toBeVisible();
      const targets=await typography.locator('button,input:not([type=file]):not([type=radio]),select,summary').evaluateAll(elements=>elements.filter(el=>el.checkVisibility()&&el.getBoundingClientRect().height<43.5).map(el=>el.getAttribute('aria-label')||el.textContent));assert.deepEqual(targets,[]);
      await summary.press('Enter');await expect(typography).not.toBeVisible();
      await search.fill('police');await expect(typography.getByRole('combobox',{name:'Police',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Effacer la recherche',exact:true}).click();await expect(search).toBeFocused();await expect(typography).not.toBeVisible();
      checks.push('Native disclosure opens by keyboard without dirtying the project; search reveals formatting and clear restores input focus; controls ≥44px');
      await title.fill('Un titre préparé sans doublon');
      await expect(page.getByText('Modifications non enregistrées',{exact:true})).toBeVisible();
      await summary.click();await typography.getByRole('combobox',{name:'Texte à modifier',exact:true}).selectOption({label:'Titre'});
      await expect(typography.getByRole('textbox',{name:'Contenu · Titre',exact:true})).toHaveValue('Un titre préparé sans doublon');
      await typography.getByRole('spinbutton',{name:'Taille du texte en pourcentage',exact:true}).fill('115');
      await summary.click();await expect(title).toHaveValue('Un titre préparé sans doublon');await summary.click();
      await expect(typography.getByRole('spinbutton',{name:'Taille du texte en pourcentage',exact:true})).toHaveValue('115');
      await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();
      await expect(page.getByText('Toutes les modifications sont enregistrées',{exact:true})).toBeVisible();
      checks.push('Primary content and advanced style share the same draft; collapse/reopen preserves both; fixture save succeeds');
      await summary.click();
      await page.locator('.monitor-precision>summary').click();
      await page.getByRole('spinbutton',{name:'Temps d’inspection en secondes',exact:true}).fill('4');
      await page.getByRole('button',{name:'Voir cette image',exact:true}).click();
      const handle=page.getByRole('button',{name:'Déplacer Titre',exact:true}).first();await expect(handle).toBeVisible();await handle.focus();
      await expect(typography).toBeVisible();await expect(handle).toBeFocused();
      await expect(typography.getByRole('combobox',{name:'Texte à modifier',exact:true})).toHaveValue('_title');
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:resolve(directory,`advanced-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
      checks.push('Selecting a real preview text opens its formatting automatically and keeps keyboard focus on the stage');
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);
    }
    results.push({width,theme,library,editor,checks});
    await page.close();
  }
  assert.deepEqual(errors,[]);assert.ok(requests.every(request=>request.method==='GET'&&request.url.endsWith('/derivation-origin')));
  const report={phase,passed:true,results,errors,requests};await writeFile(resolve(directory,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
