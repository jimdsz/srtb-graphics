import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/planner-programme-batch');
const checks=[],errors=[],unexpectedRequests=[];
const uuid=n=>`55555555-5555-4555-8555-${String(n).padStart(12,'0')}`;
const alpha=Array.from({length:24},(_,n)=>`occurrence:${n+1}`).filter(id=>id!=='occurrence:3'),beta=['occurrence:25','occurrence:26','occurrence:27'];
const all=[...alpha,...beta];
const audit=page=>page.evaluate(()=>structuredClone(window.plannerProgrammeBatchEvidence));
const selectAll=page=>page.getByRole('button',{name:'Sélectionner les correspondances exactes',exact:true});
const review=(page,n)=>page.getByRole('button',{name:`Revoir ${n} ligne${n>1?'s':''}`,exact:true});
const confirm=(page,n)=>page.getByRole('button',{name:`Confirmer ${n} ligne${n>1?'s':''}`,exact:true});
const alphaGroup=page=>page.getByRole('checkbox',{name:'Sélectionner Magazine des régions',exact:true});
const betaGroup=page=>page.getByRole('checkbox',{name:'Sélectionner Culture en direct',exact:true});
const row=(page,n)=>page.getByRole('checkbox',{name:new RegExp(`Épisode ${String(n).padStart(2,'0')} ·`)});
const linking=page=>page.getByRole('radio',{name:/^Lier les fiches, conserver mes textes et recettes/});
const copying=page=>page.getByRole('radio',{name:/^Reprendre les titres et recettes des fiches/});
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
async function open(options={}){
  const width=options.width||1366,page=await browser.newPage({viewport:{width,height:width===720?450:768},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==base||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method())){unexpectedRequests.push({path:url.pathname,method:request.method()});return route.abort();}return route.continue();});
  await page.goto(`${base}/tests/planner-programme-batch.html?${new URLSearchParams({mode:options.mode||'normal',hold:options.hold||''})}`);
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.dispatchEvent(new Event('srtb:interface-theme'));},options.theme||'dark');
  await page.getByRole('button',{name:'Ouvrir les rapprochements',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();return page;
}
async function initial(page){await expect(page.getByRole('heading',{name:'Fiches émission',exact:true})).toBeVisible();await expect(selectAll(page)).toBeEnabled();}
async function untouched(page){const result=await audit(page);assert.deepEqual(result.applied,[]);assert.deepEqual(result.writes,[]);assert.deepEqual(result.unexpectedReads,[]);await expect(page.locator('img,video,audio')).toHaveCount(0);}
async function capture(page,name){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: page overflow`);assert.equal(await page.locator('dialog[open]').evaluateAll(nodes=>nodes.some(node=>node.scrollWidth>node.clientWidth+1)),false,`${name}: modal overflow`);await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});}
async function final(page,count,atTop=true){
  const heading=page.getByRole('heading',{name:'Confirmer les rapprochements',exact:true});await expect(heading).toBeVisible();
  if(atTop){
    await expect.poll(async()=>{
      const box=await heading.boundingBox(),modal=await page.getByRole('dialog').boundingBox(),viewport=page.viewportSize();
      return {inViewport:!!box&&box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height,inDialog:!!box&&!!modal&&box.x>=modal.x&&box.y>=modal.y&&box.x+box.width<=modal.x+modal.width&&box.y+box.height<=modal.y+modal.height,atStart:await page.getByRole('dialog').evaluate(node=>node.scrollTop<=1)};
    },{message:'A new final review must visibly start at its heading without test-driven scrolling'}).toEqual({inViewport:true,inDialog:true,atStart:true});
    await expect(heading).toBeFocused();
  }
  await expect(confirm(page,count)).toBeEnabled();
}
function expectedPlan(before,ids,copy=false){
  const result=structuredClone(before),selected=new Set(ids);
  result.rows=result.rows.map(row=>{
    if(!selected.has(row.id))return row;
    const isAlpha=Number(row.id.split(':')[1])<=24;
    return {...row,programmeId:uuid(isAlpha?1:2000),programmeRevision:isAlpha?5:6,...(copy?{title:isAlpha?'Magazine des régions':'Culture en direct',category:'Catégorie officielle à ne pas imposer',kinds:isAlpha?[]:['event']}: {})};
  });return result;
}
async function applied(page,before,ids,copy=false){
  await expect.poll(async()=>(await audit(page)).applied.length).toBe(1);const result=await audit(page);
  assert.equal(result.applied[0].changed,ids.length);assert.deepEqual(result.applied[0].plan,expectedPlan(before,ids,copy));assert.deepEqual(result.writes,[]);assert.deepEqual(result.unexpectedReads,[]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function selectEvery(page){await selectAll(page).click();await expect(review(page,all.length)).toBeEnabled();}
try{
  for(const width of [1366,720,320])for(const theme of ['dark','light']){
    const page=await open({width,theme});await initial(page);await untouched(page);const before=(await audit(page)).currentPlan;
    await expect(linking(page)).toBeChecked();await expect(alphaGroup(page)).not.toBeChecked();await expect(betaGroup(page)).not.toBeChecked();
    const size=await alphaGroup(page).boundingBox();assert.ok(size&&size.width<=20&&size.height<=20,'Compact group checkbox');
    assert.equal((await audit(page)).reads.length,2,'Initial catalogue must reach the second page');
    await expect(row(page,3)).toBeDisabled();await expect(row(page,24)).toHaveCount(1);await expect(row(page,27)).toHaveCount(1);
    await alphaGroup(page).focus();await page.keyboard.press('Space');await expect(review(page,alpha.length)).toBeEnabled();
    const line=row(page,4).locator('xpath=ancestor::label[1]');await expect(line).toHaveCount(1);const hitbox=await line.boundingBox();assert.ok(hitbox&&hitbox.height>=44&&hitbox.width>=120,'Occurrence has a full-width label hit target at least 44px high');
    await line.locator('.programme-batch-description strong').click();await expect(row(page,4)).not.toBeChecked();assert.equal(await alphaGroup(page).evaluate(input=>input.indeterminate),true,'Group shows a partial selection');
    await line.locator('.programme-batch-schedule').click();await expect(row(page,4)).toBeChecked();await capture(page,`selection-${theme}-${width}`);
    await review(page,alpha.length).focus();await page.keyboard.press('Enter');await final(page,alpha.length);await untouched(page);
    assert.equal((await audit(page)).reads.length,4,'Review rereads both catalogue pages');
    await expect(page.getByText('Épisode 24 · montage éditorial',{exact:false}).first()).toBeAttached();await capture(page,`confirmation-${theme}-${width}`);
    await confirm(page,alpha.length).focus();await page.keyboard.press('Enter');await applied(page,before,alpha);
    await expect(page.getByRole('button',{name:'Ouvrir les rapprochements',exact:true})).toBeFocused();
    checks.push({name:`link-only-${theme}-${width}`,allFieldsPreserved:true,completeCatalogue:true,explicitTwoSteps:true,reviewHeadingInViewport:true,occurrenceTextAndScheduleClickable:true,occurrenceHitboxAtLeast44px:true,keyboard:true});await page.close();
  }
  {
    const page=await open();await initial(page);const before=(await audit(page)).currentPlan;await selectEvery(page);await review(page,all.length).click();await final(page,all.length);
    await page.getByRole('button',{name:'Revenir à la sélection',exact:true}).click();await expect(review(page,all.length)).toBeEnabled();await review(page,all.length).click();await final(page,all.length);await confirm(page,all.length).click();await applied(page,before,all);
    checks.push({name:'multiple-groups-and-return',allSelectedRowsAcrossPages:true,selectionRetained:true});await page.close();
  }
  {
    const page=await open({width:320,theme:'light'});await initial(page);const before=(await audit(page)).currentPlan;
    await selectEvery(page);await copying(page).check();await expect(review(page,0)).toBeDisabled();await expect(alphaGroup(page)).not.toBeChecked();await selectAll(page).click();await expect(review(page,27)).toBeEnabled();
    await capture(page,'copy-mode-light-320');await row(page,4).scrollIntoViewIfNeeded();await capture(page,'copy-comparison-light-320');await review(page,27).click();await final(page,27);await confirm(page,27).click();await applied(page,before,[...Array.from({length:27},(_,n)=>`occurrence:${n+1}`)],true);
    checks.push({name:'explicit-copy-mode',modeClearsSelection:true,onlyAdvertisedFieldsChanged:true,recurringEmptyRecipePreserved:true});await page.close();
  }
  for(const phase of ['initial','final']){
    const page=await open({width:320});await initial(page);await selectEvery(page);if(phase==='final'){await review(page,all.length).click();await final(page,all.length);}
    await page.getByRole('button',{name:'Annuler',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await untouched(page);assert.deepEqual((await audit(page)).currentPlan,(await audit(page)).initialPlan);
    checks.push({name:`cancel-${phase}`,planUnchanged:true});await page.close();
  }
  for(const phase of ['initial','review']){
    const page=await open({hold:phase,width:320});
    if(phase==='review'){await initial(page);await selectEvery(page);await review(page,all.length).click();}
    await expect.poll(async()=>(await audit(page)).reads.filter(read=>read.phase===phase&&!read.settled).length).toBe(1);await untouched(page);
    await page.getByRole('button',{name:'Annuler',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await page.evaluate(phase=>window.plannerProgrammeBatchControl.release(phase),phase);
    await expect.poll(async()=>(await audit(page)).reads.some(read=>read.phase===phase&&read.settled&&read.aborted)).toBe(true);await untouched(page);assert.deepEqual((await audit(page)).currentPlan,(await audit(page)).initialPlan);
    checks.push({name:`cancel-during-${phase}`,requestAborted:true,lateResponseIgnored:true,planUnchanged:true});await page.close();
  }
  {
    const page=await open({hold:'page-two'});await expect.poll(async()=>(await audit(page)).reads.length).toBe(2);await expect(selectAll(page)).toHaveCount(0);await expect(review(page,0)).toBeDisabled();await untouched(page);
    await page.evaluate(()=>window.plannerProgrammeBatchControl.release('page-two'));await initial(page);await expect(row(page,31)).toHaveCount(0);await page.locator('.programme-batch-excluded>summary').click();await expect(page.locator('.programme-batch-excluded')).toContainText('Collision page suivante');
    const before=(await audit(page)).currentPlan;await selectEvery(page);await review(page,all.length).click();await final(page,all.length);await confirm(page,all.length).click();await applied(page,before,all);
    checks.push({name:'ambiguity-only-discovered-on-page-two',noPartialCatalogueChoice:true,ambiguousRowExcluded:true});await page.close();
  }
  {
    const page=await open({mode:'bad-pagination',width:320});await expect(page.getByRole('alert')).toContainText(/incomplète|pagination|vide|changé/i);await expect(selectAll(page)).toHaveCount(0);await expect(review(page,0)).toBeDisabled();await untouched(page);assert.equal((await audit(page)).reads.length,2);
    await capture(page,'empty-page-with-next-dark-320');checks.push({name:'empty-page-with-next',wholeCatalogueRejected:true,noPartialMatch:true});await page.close();
  }
  for(const mode of ['initial-error','page-error','review-error']){
    const page=await open({mode,width:320,theme:'light'});
    if(mode==='review-error'){await initial(page);await selectEvery(page);await review(page,all.length).click();}
    await expect(page.getByRole('alert')).toContainText(/indisponible|chargement|réessayer/i);await untouched(page);await expect(page.getByRole('heading',{name:'Confirmer les rapprochements',exact:true})).toHaveCount(0);
    await capture(page,`${mode}-light-320`);await page.evaluate(()=>window.plannerProgrammeBatchControl.recover());
    const retry=mode==='review-error'?review(page,all.length):page.getByRole('button',{name:'Réessayer',exact:true});await retry.click();
    if(mode==='review-error')await final(page,all.length);else await initial(page);
    await untouched(page);checks.push({name:mode,explicitErrorNotEmpty:true,retry:true,noMutation:true});await page.close();
  }
  for(const mode of ['revision-changed','data-changed','downgraded','archived']){
    const page=await open({mode,width:320});await initial(page);const before=(await audit(page)).currentPlan;await selectEvery(page);await review(page,all.length).click();await final(page,beta.length);
    await expect(page.getByText('La fiche a changé depuis la sélection. Relancez les correspondances.',{exact:true}).first()).toBeVisible();await capture(page,`${mode}-dark-320`);
    await confirm(page,beta.length).click();await applied(page,before,beta);checks.push({name:mode,staleProgrammeExcluded:true,otherGroupPreserved:true});await page.close();
  }
  {
    const page=await open({mode:'new-ambiguity'});await initial(page);const before=(await audit(page)).currentPlan;await selectEvery(page);await review(page,all.length).click();const valid=['occurrence:1','occurrence:2',...beta];await final(page,valid.length);await confirm(page,valid.length).click();await applied(page,before,valid);
    checks.push({name:'new-ambiguity-on-review',unlinkedAmbiguousExcluded:true,explicitIdsRemainBound:true});await page.close();
  }
  for(const phase of ['waiting','final']){
    const page=await open({hold:phase==='waiting'?'review':'',width:320,theme:'light'});await initial(page);await alphaGroup(page).check();await review(page,alpha.length).click();
    if(phase==='final')await final(page,alpha.length);else await expect.poll(async()=>(await audit(page)).reads.filter(read=>read.phase==='review').length).toBe(1);
    await page.evaluate(()=>window.plannerProgrammeBatchControl.mutateRow('occurrence:4'));await expect.poll(async()=>(await audit(page)).currentPlan.rows.find(row=>row.id==='occurrence:4').subtitle).toBe('Retouche arrivée pendant la revue');const before=(await audit(page)).currentPlan;
    if(phase==='waiting')await page.evaluate(()=>window.plannerProgrammeBatchControl.release('review'));
    else{await confirm(page,alpha.length).click();await untouched(page);}
    const valid=alpha.filter(id=>id!=='occurrence:4');await final(page,valid.length,phase!=='final');await capture(page,`row-changed-${phase}-light-320`);await confirm(page,valid.length).click();await applied(page,before,valid);
    checks.push({name:`row-changed-${phase}`,lateEditPreserved:true,...(phase==='final'?{secondConfirmationRequired:true}:{})});await page.close();
  }
  {
    const page=await open({hold:'review'});await initial(page);await selectEvery(page);await review(page,all.length).click();await expect.poll(async()=>(await audit(page)).reads.filter(read=>read.phase==='review').length).toBe(1);
    await page.evaluate(()=>window.plannerProgrammeBatchControl.changePreparation());await initial(page);await expect(review(page,0)).toBeDisabled();await page.evaluate(()=>window.plannerProgrammeBatchControl.release('review'));
    await expect(page.getByRole('heading',{name:'Confirmer les rapprochements',exact:true})).toHaveCount(0);await untouched(page);const before=(await audit(page)).currentPlan;assert.equal(before.name,'Préparation B');
    await selectEvery(page);await review(page,all.length).click();await final(page,all.length);await confirm(page,all.length).click();await applied(page,before,all);
    checks.push({name:'preparation-key-change-during-review',selectionReset:true,oldResponseIgnored:true,newPreparationPreserved:true});await page.close();
  }
  {
    const page=await open({hold:'review'});await initial(page);await selectEvery(page);await review(page,all.length).click();await expect.poll(async()=>(await audit(page)).reads.filter(read=>read.phase==='review').length).toBe(1);
    await page.evaluate(()=>window.plannerProgrammeBatchControl.changeChannel());await expect(page.getByRole('dialog')).toHaveCount(0);await page.evaluate(()=>window.plannerProgrammeBatchControl.release('review'));await untouched(page);
    checks.push({name:'channel-change-during-review',dialogClosed:true,noLateApply:true});await page.close();
  }
  {
    const page=await open({mode:'empty'});await expect(page.getByText('Aucune correspondance exploitable. Vérifiez les titres et les variantes dans Émissions.',{exact:true})).toBeVisible();await expect(selectAll(page)).toBeDisabled();await untouched(page);
    checks.push({name:'empty-catalogue',noInventedMatch:true});await page.close();
  }
  {
    const page=await open({mode:'oversized',width:320,theme:'light'});await expect(page.getByRole('alert')).toContainText('Plus de 10 000 fiches',{timeout:20000});await expect(selectAll(page)).toHaveCount(0);await expect(review(page,0)).toBeDisabled();await untouched(page);
    assert.equal((await audit(page)).reads.length,100);await capture(page,'oversized-catalogue-light-320');checks.push({name:'oversized-catalogue',wholeReviewRejected:true,noTruncatedMatch:true});await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
  const report={scope:'Isolated real PlannerProgrammeReview with synthetic paginated API and in-memory Plan changes. No server/auth, actual channel permissions, media access, save or project generation. Fixture keys model the parent preparation lifecycle; the actual DayPlanner integration is outside this recipe. 720px checks CSS reflow, not browser zoom.',checks,errors,unexpectedRequests};
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:checks.length,checks,errors,unexpectedRequests},null,2));
}finally{await browser.close();}
