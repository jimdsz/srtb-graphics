import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/production-entry');
const id=number=>`33333333-3333-4333-8333-${String(number).padStart(12,'0')}`;
const checks=[],errors=[],unexpectedRequests=[],stubbedReads=[];
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const audit=page=>page.evaluate(()=>structuredClone(window.productionEntryEvidence));
const inspector=page=>page.locator('dialog[aria-labelledby="planner-inspector-title"]');
const leave=page=>page.getByRole('dialog',{name:'Conserver votre préparation ?',exact:true});
// The source disclosure is closed after loading; read its stored select value
// without pretending that this background control is currently interactive.
const choosePlan=page=>page.locator('.planner-entry select');
async function open(width=1366,theme='dark'){
  const page=await browser.newPage({viewport:{width,height:width===720?450:768},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===base&&url.pathname==='/api/graphics/habits'&&request.method()==='GET'){
      stubbedReads.push(url.pathname);return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({suggestions:[]})});
    }
    if(url.origin!==base||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method())){unexpectedRequests.push({url:url.href,method:request.method()});return route.abort();}
    return route.continue();
  });
  await page.goto(`${base}/tests/production-entry.html`);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect(page.getByRole('heading',{name:'Accueil de recette',exact:true})).toBeVisible();return page;
}
async function inject(page,number,rowId='row:shared/Émission',revision,requestId){await page.evaluate(({number,rowId,revision,requestId})=>window.productionEntryControl.inject(number,rowId,revision,requestId),{number,rowId,revision,requestId});}
async function target(page,number,title='Programme homonyme'){
  await expect(inspector(page)).toBeVisible();
  await expect(inspector(page).getByRole('textbox',{name:'Titre',exact:true})).toHaveValue(title);
  await expect(inspector(page).getByRole('textbox',{name:'Épisode / sous-titre',exact:true})).toHaveValue(`Préparation ${number===1?'A':'B'} — Épisode cible`);
  await expect(choosePlan(page)).toHaveValue(id(number));
}
async function close(page){await page.keyboard.press('Escape');await expect(inspector(page)).toHaveCount(0);}
async function capture(page,name){
  await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: page overflow`);
  assert.equal(await page.locator('dialog[open]').evaluateAll(nodes=>nodes.some(node=>node.scrollWidth>node.clientWidth+1)),false,`${name}: dialog overflow`);
}
async function noUnexpectedWrites(page){const e=await audit(page);assert.equal(e.created,0);assert.equal(e.openedProjects,0);assert.deepEqual(e.saves,[]);}
try{
  for(const width of [1366,720,320])for(const theme of ['dark','light']){
    const page=await open(width,theme);await page.getByRole('button',{name:'Demander la cible B',exact:true}).click();await target(page,2);
    await capture(page,`target-${theme}-${width}`);
    await close(page);
    await expect(page.getByRole('combobox',{name:'Journée de grille',exact:true})).toHaveValue('2026-09-30');
    await expect(page.getByRole('searchbox',{name:'Programme',exact:true})).toHaveValue('');
    await expect(page.locator('.planner-pagination>span')).toContainText('21–32 / 32');
    await expect(page.getByRole('button',{name:'Préparer Programme homonyme',exact:true})).toBeFocused();
    let evidence=await audit(page);assert.deepEqual(evidence.reads.map(r=>[r.kind,r.id]),[['get',id(2)],['tasks',id(2)]]);assert.equal(evidence.consumed.length,1);
    await page.getByRole('combobox',{name:'Journée de grille',exact:true}).selectOption('2026-09-29');
    await page.getByRole('searchbox',{name:'Programme',exact:true}).fill('introuvable');
    await page.getByRole('button',{name:'Demander la cible B',exact:true}).click();await target(page,2);await close(page);
    await expect(page.getByRole('combobox',{name:'Journée de grille',exact:true})).toHaveValue('2026-09-30');
    await expect(page.getByRole('searchbox',{name:'Programme',exact:true})).toHaveValue('');
    assert.equal((await audit(page)).reads.length,2,'Same plan navigation does not reload its snapshot');
    await page.getByRole('button',{name:'Demander la cible A',exact:true}).click();await target(page,1);
    await noUnexpectedWrites(page);checks.push({name:`${theme}-${width}`,exactTuple:true,correctDayPage:true,filterCleared:true,noSamePlanReload:true});await page.close();
  }
  {
    const page=await open();await inject(page,1);await target(page,1);
    await inspector(page).getByRole('textbox',{name:'Titre',exact:true}).fill('Retouche locale conservée');await close(page);
    const before=(await audit(page)).reads.length;
    await inject(page,1);await target(page,1,'Retouche locale conservée');assert.equal((await audit(page)).reads.length,before);await expect(leave(page)).toHaveCount(0);await close(page);
    await page.getByRole('button',{name:'Demander la cible B',exact:true}).click();await expect(leave(page)).toBeVisible();
    assert.equal((await audit(page)).reads.length,before,'Target snapshot not read before dirty guard acceptance');
    await leave(page).getByRole('button',{name:'Rester ici',exact:true}).click();await expect(choosePlan(page)).toHaveValue(id(1));
    await page.getByRole('button',{name:'Préparer Retouche locale conservée',exact:true}).click();await target(page,1,'Retouche locale conservée');await close(page);
    await page.getByRole('button',{name:'Demander la cible B',exact:true}).click();await expect(leave(page)).toBeVisible();
    await leave(page).getByRole('button',{name:'Enregistrer puis continuer',exact:true}).click();await target(page,2);
    const evidence=await audit(page);assert.equal(evidence.saves.length,1);assert.equal(evidence.saves[0].id,id(1));assert.equal(evidence.saves[0].data.rows.find(r=>r.id==='row:shared/Émission').title,'Retouche locale conservée');
    checks.push({name:'dirty-same-plan-and-other-plan-save',samePlanEditsPreserved:true,guardStay:true,saveBeforeRead:true});await page.close();
  }
  {
    const page=await open(320,'light');await inject(page,1);await target(page,1);
    await inspector(page).getByRole('textbox',{name:'Titre',exact:true}).fill('Retouche après conflit');await close(page);
    await page.evaluate(()=>window.productionEntryControl.failSave(true));await inject(page,2);await expect(leave(page)).toBeVisible();
    await leave(page).getByRole('button',{name:'Enregistrer puis continuer',exact:true}).click();
    await expect(leave(page).getByRole('alert')).toContainText('Conflit de recette');await expect(choosePlan(page)).toHaveValue(id(1));
    const evidence=await audit(page);assert.equal(evidence.saveAttempts.length,1);assert.deepEqual(evidence.saves,[]);assert.equal(evidence.reads.filter(r=>r.id===id(2)).length,0);
    await capture(page,'failed-save-light-320');
    for(const label of ['Enregistrer puis continuer','Continuer sans enregistrer','Rester ici']){
      assert.ok((await leave(page).getByRole('button',{name:label,exact:true}).boundingBox()).width>=200,`320px dirty guard: ${label} must remain readable, not a narrow word-breaking column`);
    }
    await leave(page).getByRole('button',{name:'Rester ici',exact:true}).click();
    await page.getByRole('button',{name:'Préparer Retouche après conflit',exact:true}).click();await target(page,1,'Retouche après conflit');await close(page);
    await page.getByRole('button',{name:'Retour accueil de recette',exact:true}).click();await expect(leave(page)).toBeVisible();
    await leave(page).getByRole('button',{name:'Rester ici',exact:true}).click();await expect(page.getByRole('heading',{name:'Accueil de recette',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Retour accueil de recette',exact:true}).click();await leave(page).getByRole('button',{name:'Continuer sans enregistrer',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Accueil de recette',exact:true})).toBeVisible();assert.equal((await audit(page)).homeReturns,1);await noUnexpectedWrites(page);
    checks.push({name:'failed-save-and-home-guard',failedSaveKeepsDraft:true,homeStayThenDiscard:true});await page.close();
  }
  {
    const page=await open();await inject(page,2,'row:shared/Émission',1);await target(page,2);await close(page);
    await expect(page.getByRole('status').filter({hasText:/r9|révision 9/})).toBeVisible();
    await inject(page,2,'excluded');await expect(inspector(page)).toBeVisible();await expect(inspector(page).getByRole('textbox',{name:'Titre',exact:true})).toHaveValue('Programme 27');await close(page);
    await expect(page.getByRole('checkbox',{name:'Voir aussi les lignes écartées',exact:true})).toBeChecked();
    await inject(page,2,'removed');await expect(inspector(page)).toBeVisible();await expect(inspector(page).getByText('Ligne retirée du conducteur : vérifiez-la avant toute nouvelle préparation.',{exact:true})).toBeVisible();
    await expect(inspector(page).getByRole('button',{name:'Préparer les livrables',exact:true})).toBeDisabled();await close(page);
    await inject(page,2,'missing-row');await expect(inspector(page)).toHaveCount(0);
    await expect(page.getByRole('status').or(page.getByRole('alert')).filter({hasText:/ligne.*(?:disponible|introuvable|retirée|existe)/i})).toBeVisible();
    await noUnexpectedWrites(page);checks.push({name:'stale-revision-excluded-removed-missing',currentRevisionQualified:true,noInventedRow:true});await page.close();
  }
  {
    const page=await open();await inject(page,1);await target(page,1);await close(page);
    await page.evaluate(()=>window.productionEntryControl.hold(2));await inject(page,2);
    await expect.poll(async()=>(await audit(page)).reads.filter(r=>r.id===id(2)).length).toBe(2);
    await page.getByRole('button',{name:'Arrêter après l’opération en cours',exact:true}).click();
    await expect(page.getByRole('button',{name:'Arrêt demandé…',exact:true})).toHaveCount(0);
    await inject(page,1);await target(page,1);await page.evaluate(()=>window.productionEntryControl.release(2));
    await expect.poll(async()=>(await audit(page)).reads.filter(r=>r.id===id(2)).every(r=>r.settled)).toBe(true);
    await target(page,1);assert.ok((await audit(page)).reads.filter(r=>r.id===id(2)).every(r=>r.aborted));
    await noUnexpectedWrites(page);checks.push({name:'cancelled-late-snapshot',oldReadDiscarded:true});await page.close();
  }
  {
    const page=await open();await inject(page,1);await target(page,1);await close(page);
    await page.evaluate(()=>window.productionEntryControl.hold(2));await inject(page,2);
    await expect.poll(async()=>(await audit(page)).reads.filter(r=>r.id===id(2)).length).toBe(2);
    await inject(page,1);await page.evaluate(()=>window.productionEntryControl.release(2));await target(page,1);
    await close(page);await expect(page.getByRole('heading',{name:'Programme homonyme',exact:true})).toHaveCount(0);
    assert.equal(new Set((await audit(page)).consumed).size,(await audit(page)).consumed.length,'Each request consumed at most once');
    await noUnexpectedWrites(page);checks.push({name:'new-entry-while-busy',latestEntryNotLost:true});await page.close();
  }
  {
    const page=await open();await inject(page,1);await target(page,1);
    await inspector(page).getByRole('textbox',{name:'Titre',exact:true}).fill('Retouche enregistrée avant départ');await close(page);
    await page.evaluate(()=>window.productionEntryControl.holdSave());
    await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();
    await expect.poll(async()=>(await audit(page)).saveAttempts.length).toBe(1);
    await inject(page,2);assert.equal((await audit(page)).reads.filter(r=>r.id===id(2)).length,0,'Entry must wait for an unrelated save');
    await page.evaluate(()=>window.productionEntryControl.releaseSave());await target(page,2);
    const evidence=await audit(page);assert.equal(evidence.saves.length,1);assert.equal(evidence.saves[0].data.rows.find(r=>r.id==='row:shared/Émission').title,'Retouche enregistrée avant départ');
    assert.equal(evidence.created,0);checks.push({name:'entry-during-save',saveNotInterrupted:true,entryResumedAfterSave:true});await page.close();
  }
  {
    const page=await open();await inject(page,1,'row:shared/Émission',4,'stable-request');await target(page,1);await close(page);
    const before=await audit(page);await inject(page,1,'row:shared/Émission',4,'stable-request');
    await expect(inspector(page)).toHaveCount(0);assert.deepEqual((await audit(page)).consumed,before.consumed);assert.equal((await audit(page)).reads.length,before.reads.length);
    await inject(page,1,'row:shared/Émission',4,'new-request');await target(page,1);
    assert.deepEqual((await audit(page)).consumed,['stable-request','new-request']);await noUnexpectedWrites(page);
    checks.push({name:'request-id-idempotency',sameRequestNotReplayed:true,newRequestAccepted:true});await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
  const report={scope:'DayPlanner integration with a synthetic home, entry injection and real navigationRef guard. In-memory read/save doubles and intercepted empty GET /habits responses; no real Studio/ProductionOverview, account, backend, remote API or production mutation. Six dark/light CSS viewport checks; 720px is reflow geometry, not native zoom.',checks,errors,unexpectedRequests,stubbedReads};
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
