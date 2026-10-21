import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5219';
const directory=resolve('reports/operator-final-ux');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],apiRequests=[],results=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{apiRequests.push(route.request().url());return route.fulfill({status:500,body:'Unexpected API request in local fixture'});});
  const openProject=async()=>{
    await page.goto(base+'/tests/operator-workbench.html');
    await page.locator('[data-project-id="operator-fixture"] .project-row-title').click();
    await expect(page.getByRole('button',{name:'Lire l’aperçu',exact:true})).toBeEnabled({timeout:30000});
    await page.locator('.typography-disclosure>summary').click();
  };
  await openProject();
  const editor=page.getByRole('region',{name:'Éditeur de texte',exact:true});
  const font=editor.getByRole('combobox',{name:'Police',exact:true});
  const file=editor.locator('input[type=file]');
  const importer=editor.getByRole('button',{name:'Importer une police',exact:true});

  await editor.getByRole('spinbutton',{name:'Taille du texte en pourcentage',exact:true}).focus();
  await page.keyboard.press('Tab');
  await expect(importer).toBeFocused();
  const picker=page.waitForEvent('filechooser',{timeout:5000});
  await importer.press('Enter');
  await (await picker).setFiles({name:'police-invalide.woff2',mimeType:'font/woff2',buffer:Buffer.from('This is not a font file. This is a malformed fixture.')});
  await expect(editor.getByRole('alert')).toHaveText('Ce fichier de police est illisible. Choisissez un autre fichier OTF, TTF, WOFF ou WOFF2.');
  await expect(font).toHaveValue('original');
  await expect(importer).toBeEnabled();
  results.push('Clavier : le bouton visible reçoit le focus après la taille ; police illisible refusée sans modifier le texte');

  await file.setInputFiles(resolve('public/fonts/BeninSemiBold-Regular.otf'));
  await expect(font).toHaveValue(/^local-font:[a-f0-9]{64}$/);
  await expect(editor.getByRole('alert')).toHaveCount(0);
  const imported=await font.inputValue();
  await expect(font.locator(`option[value="${imported}"]`)).toHaveText('BeninSemiBold-Regular.otf');
  await expect(page.getByText('Modifications non enregistrées',{exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>[...document.fonts].some(face=>face.family.startsWith('SRTB Local ')&&face.status==='loaded'))).toBe(true);
  results.push('Police OTF importée, décodée, appliquée et conservée dans IndexedDB, sans requête API');

  const summary=editor.locator('.typography-help summary');
  await summary.click();
  await expect(editor.getByText(/Maj \+ flèche : 10 px/)).toBeVisible();
  await expect(editor.getByText(/Un autre poste devra importer le même fichier/)).toBeVisible();
  await summary.click();
  results.push('Aide repliée : raccourcis, formats indépendants et limites des polices restent accessibles');

  const targets='.typography-editor button,.typography-editor summary,.typography-editor input:not([type=file]):not([type=radio]),.typography-editor select,.inspector-toolbox button,.inspector-search input,.time-ruler input,.monitor-precision summary,.preview-inspect button,.preview-inspect input';
  for(const [theme,width,height] of [['dark',1440,1000],['light',1440,1000],['dark',768,1000],['dark',390,844],['light',390,844],['dark',320,740]]){
    await page.setViewportSize({width,height});
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const precision=page.locator('.monitor-precision');
    if(!await precision.evaluate(el=>el.hasAttribute('open')))await precision.locator('summary').click();
    const audit=await page.locator(targets).evaluateAll(elements=>{
      const visible=elements.filter(el=>el.checkVisibility());
      return {small:visible.filter(el=>el.getBoundingClientRect().height<43.5).map(el=>el.getAttribute('aria-label')||el.textContent||el.tagName),overflow:document.documentElement.scrollWidth>innerWidth+1};
    });
    assert.deepEqual(audit.small,[],JSON.stringify({theme,width,...audit}));
    assert.equal(audit.overflow,false,JSON.stringify({theme,width,...audit}));
    if(width<=560){
      const fontSizes=await editor.locator('select,input[type=number]').evaluateAll(elements=>elements.filter(el=>el.checkVisibility()).map(el=>parseFloat(getComputedStyle(el).fontSize)));
      assert.ok(fontSizes.every(size=>size>=16),JSON.stringify({width,fontSizes}));
    }
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:resolve(directory,`typography-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
    results.push(`${theme} ${width}px : réglages, aide et précision ≥ 44 px, aucun débordement${width<=560?', saisie typographique ≥ 16 px':''}`);
  }
  await openProject();
  await expect(font.locator(`option[value="${imported}"]`)).toHaveText('BeninSemiBold-Regular.otf');
  await font.selectOption(imported);
  await expect(font).toHaveValue(imported);
  results.push('Après rechargement, la police importée reste disponible et peut être réappliquée');

  assert.deepEqual(errors,[]);assert.deepEqual(apiRequests,[]);
  await writeFile(resolve(directory,'results.json'),JSON.stringify({passed:true,results,pageErrors:errors,apiRequests},null,2));
  console.log(JSON.stringify({passed:true,results},null,2));
}finally{await browser.close();}
