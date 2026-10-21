import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/production-dossier');
const id=number=>`11111111-1111-4111-8111-${String(number).padStart(12,'0')}`;
const checks=[],errors=[],unexpectedRequests=[];
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const audit=page=>page.evaluate(()=>structuredClone(window.productionDossierEvidence));
async function open(width,theme,mode='populated'){
  const page=await browser.newPage({viewport:{width,height:width===720?450:768},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method())){
      unexpectedRequests.push({url:url.href,method:request.method()});return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${base}/tests/production-dossier.html?mode=${mode}`);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.getByRole('button',{name:'Ouvrir le dossier de recette',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Dossier de production',exact:true})).toBeVisible();
  assert.deepEqual(await audit(page),{mode,prepare:0,opens:[]},'Rendering invokes no prepare/open callback');
  await expect(page.locator('audio,video,iframe,canvas,img')).toHaveCount(0);
  return page;
}
async function capture(page,name){
  await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});
  const geometry=await page.evaluate(()=>{
    const dialog=document.querySelector('dialog[open]');
    return {page:document.documentElement.scrollWidth<=innerWidth+1,dialog:dialog.scrollWidth<=dialog.clientWidth+1,width:dialog.getBoundingClientRect().width};
  });
  assert.equal(geometry.page,true,`${name}: no document horizontal overflow`);
  assert.equal(geometry.dialog,true,`${name}: no drawer horizontal overflow`);
  return geometry;
}
try{
  for(const width of [1366,720,320])for(const theme of ['dark','light']){
    const page=await open(width,theme),name=`${theme}-${width}`;
    const dossier=page.getByRole('region',{name:'Dossier de production',exact:true});
    await expect(dossier.locator('button.primary')).toHaveCount(1);
    await expect(dossier.getByRole('button',{name:'Préparer les livrables',exact:true})).toBeEnabled();
    await expect(dossier.getByText('7 projets liés à votre compte',{exact:true})).toBeVisible();
    await expect(dossier.getByText('Semainier exclu de ce dossier',{exact:true})).toHaveCount(0);
    await expect(dossier.getByText('Même titre, autre ligne privée',{exact:true})).toHaveCount(0);
    await expect(dossier.getByText('Référence invalide ignorée',{exact:true})).toHaveCount(0);
    await expect(dossier.getByText('internal-private-raw-status',{exact:true})).toHaveCount(0);
    await expect(dossier.getByText('Journal du soir — version initiale',{exact:true})).toBeHidden();
    const geometry=await capture(page,`overview-${name}`);
    if(width>=720)assert.equal(geometry.width,580,'Use the production 580px inspector geometry');
    const prepare=dossier.getByRole('button',{name:'Préparer les livrables',exact:true});
    await prepare.focus();await page.keyboard.press('Enter');
    assert.equal((await audit(page)).prepare,1);
    const settings=dossier.getByRole('button',{name:'Réglages · Bande-annonce · TV · 16:9 · Journal du soir — version actuelle · origine r4',exact:true});
    await page.keyboard.press('Tab');await expect(settings).toBeFocused();
    await page.keyboard.press('Enter');
    const exports=dossier.getByRole('button',{name:'Exporter · Bande-annonce · TV · 16:9 · Journal du soir — version actuelle · origine r4',exact:true});
    await page.keyboard.press('Tab');await expect(exports).toBeFocused();await page.keyboard.press('Space');
    assert.deepEqual((await audit(page)).opens,[{projectId:id(2),target:'settings'},{projectId:id(2),target:'exports'}]);
    const history=dossier.locator('summary').filter({hasText:'Autres versions liées'});
    await page.keyboard.press('Tab');await expect(history).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dossier.getByText('Journal du soir — version initiale',{exact:true})).toBeVisible();
    await capture(page,`history-${name}`);
    await dossier.getByRole('button',{name:'Réglages · Bande-annonce · TV · 16:9 · Journal du soir — version initiale · origine r1',exact:true}).click();
    assert.deepEqual((await audit(page)).opens.at(-1),{projectId:id(1),target:'settings'});
    await history.focus();await page.keyboard.press('Enter');
    await expect(dossier.getByText('Journal du soir — version initiale',{exact:true})).toBeHidden();
    for(const label of ['Brouillon','À valider','Validé','À corriger','Archivé','État à vérifier'])await expect(dossier.locator('.dossier-status:visible').filter({hasText:new RegExp(`^${label}$`)}).first()).toBeVisible();
    const archived=dossier.getByRole('button',{name:'Exporter · Renvoi · TV · 16:9 · Renvoi — projet archivé · origine r1',exact:true});
    await archived.click();assert.deepEqual((await audit(page)).opens.at(-1),{projectId:id(7),target:'exports'},'Archive action requests navigation only, never a render');
    await dossier.locator('.dossier-notes').scrollIntoViewIfNeeded();
    await expect(dossier.getByText('Les états indiquent la validation, pas un export terminé. Les semainiers restent dans « Le semainier ».',{exact:true})).toBeVisible();
    await capture(page,`states-${name}`);
    const smallTargets=await dossier.locator('button,summary').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length&&node.getBoundingClientRect().height<43).map(node=>node.textContent));
    assert.deepEqual(smallTargets,[],'Visible controls retain 44px targets');
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Ouvrir le dossier de recette',exact:true})).toBeFocused();
    checks.push({name,projectCount:7,drawerWidth:geometry.width,keyboard:true,history:true,noOverflow:true});await page.close();
  }
  for(const mode of ['empty','excluded','removed','no-kinds','no-formats','disabled','dirty']){
    const page=await open(320,'light',mode),dossier=page.getByRole('region',{name:'Dossier de production',exact:true}),prepare=dossier.getByRole('button',{name:'Préparer les livrables',exact:true});
    if(mode==='empty'){
      await expect(prepare).toBeEnabled();
      await expect(dossier.getByText('Aucun projet lié visible dans votre registre. Les projets privés des collègues ne sont pas listés.',{exact:true})).toBeVisible();
      await expect(dossier.getByRole('button',{name:/^(?:Réglages|Exporter) ·/})).toHaveCount(0);
      await expect(dossier.getByText(/^(?:0 projets.*|Terminé|Exporté|Tout est prêt)$/i)).toHaveCount(0);
    }else if(mode==='dirty'){
      await expect(prepare).toBeEnabled();
      await expect(dossier.getByText('Les modifications non enregistrées de cette liste ne changent pas les projets déjà créés.',{exact:true})).toBeVisible();
    }else{
      await expect(prepare).toBeDisabled();
      const settings=dossier.getByRole('button',{name:'Réglages · Bande-annonce · TV · 16:9 · Journal du soir — version actuelle · origine r4',exact:true});
      if(mode==='disabled')for(const button of await dossier.getByRole('button').all())await expect(button).toBeDisabled();
      else await expect(settings).toBeEnabled();
      await expect(dossier.getByText('7 projets liés à votre compte',{exact:true})).toBeVisible();
    }
    assert.deepEqual(await audit(page),{mode,prepare:0,opens:[]});
    await capture(page,`state-${mode}-light-320`);
    checks.push({name:mode,renderCallbacks:0,requestWrites:0});await page.close();
  }
  {
    const page=await open(320,'dark','large-history'),dossier=page.getByRole('region',{name:'Dossier de production',exact:true});
    await expect(dossier.getByText('2000 projets liés à votre compte',{exact:true})).toBeVisible();
    await expect(dossier.locator('.dossier-project')).toHaveCount(1);
    const history=dossier.locator('summary').filter({hasText:'Autres versions liées · 1999'});
    await history.focus();await page.keyboard.press('Enter');
    await expect(dossier.locator('.dossier-project')).toHaveCount(11);
    const more=dossier.getByRole('button',{name:'Afficher 10 autres versions',exact:true});
    await more.focus();await page.keyboard.press('Enter');
    await expect(dossier.locator('.dossier-project')).toHaveCount(21);
    await dossier.getByRole('button',{name:'Exporter · Bande-annonce · TV · 16:9 · Journal du soir — versions homonymes · origine r1980',exact:true}).click();
    assert.deepEqual((await audit(page)).opens,[{projectId:id(1980),target:'exports'}],'Homonymous historical project navigation uses the selected edition ID');
    await capture(page,'large-history-dark-320');
    await history.focus();await page.keyboard.press('Enter');
    await expect(dossier.locator('.dossier-project')).toHaveCount(1);
    await page.keyboard.press('Enter');await expect(dossier.locator('.dossier-project')).toHaveCount(21);
    checks.push({name:'large-history',ledgerCount:2000,initialMounted:1,openedMounted:11,afterMoreMounted:21,closedMounted:1,selectedHistoricalProject:1980});await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
  const report={scope:'Isolated ProductionDossier in the real native inspector wrapper with synthetic authorized ledger and callback spies. No backend, real account, permission enforcement or full DayPlanner navigation verified. Local modules/fonts may load; zero API, external, media or write requests. 720×450 verifies a CSS reflow surface equivalent to 1440×900 at 200%; not native browser zoom.',checks,errors,unexpectedRequests};
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
