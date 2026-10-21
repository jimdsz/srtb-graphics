import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/production-links');
const checks=[],errors=[],unexpectedRequests=[],contexts=[],transports=new WeakMap();
const id=number=>`77777777-7777-4777-8777-${String(number).padStart(12,'0')}`;
const rowId='Mardi / B:20,Édition';
const sectionLabels={occurrences:'Occurrences',deliverables:'Livrables',weekly:'Semainiers',derivations:'Déclinaisons'};
const audit=page=>page.evaluate(()=>structuredClone(window.productionLinksEvidence));
const dialog=page=>page.getByRole('dialog');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});

async function open({width=1366,theme='dark',mode='normal',hold='',fail='',role='designer'}={}){
 const context=await browser.newContext({viewport:{width,height:width===720?450:768},reducedMotion:'reduce'});contexts.push(context);const page=await context.newPage();
 const transport={calls:[],held:new Set(hold?[hold]:[]),failures:new Set(fail?[fail]:[]),pending:new Map(),release(key){this.held.delete(key);for(const resolve of this.pending.get(key)||[])resolve();this.pending.delete(key);}};transports.set(page,transport);
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=`/api/graphics/planner/${id(1)}/production-links`;
  if(url.origin===base&&url.pathname===path&&request.method()==='GET'){
   const section=url.searchParams.get('section'),cursor=url.searchParams.get('cursor'),key=`${section}:${cursor||''}`;
   assert.equal(url.searchParams.get('rowId'),rowId,'Encoded row identity must survive the real HTTP client');
   assert.ok(['8','9'].includes(url.searchParams.get('revision')));assert.ok(Object.hasOwn(sectionLabels,section));
   const call={section,cursor,revision:url.searchParams.get('revision'),channel:request.headers()['x-srtb-channel'],method:request.method(),settled:false};transport.calls.push(call);
   const payload=await page.evaluate(({section,cursor})=>window.productionLinksFixture.response(section,cursor),{section,cursor});
   const failure=transport.failures.has(key);
   if(transport.held.has(key))await new Promise(resolve=>transport.pending.set(key,[...(transport.pending.get(key)||[]),resolve]));
   call.settled=true;
   await route.fulfill({status:failure?503:200,contentType:'application/json',body:JSON.stringify(failure?{error:'Lecture simulée indisponible ; aucun résultat confirmé.'}:payload)}).catch(()=>{});return;
  }
  if(url.origin!==base||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method())){unexpectedRequests.push({url:url.href,method:request.method()});await route.abort();return;}
  await route.continue();
 });
 await page.goto(`${base}/tests/production-links.html?${new URLSearchParams({mode,role})}`);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 const trigger=page.getByRole('button',{name:'Ouvrir le dossier de recette',exact:true});await trigger.focus();await page.keyboard.press('Enter');
 await expect(dialog(page).getByRole('heading',{name:'Dossier de l’émission',exact:true})).toBeVisible();
 assert.equal(await dialog(page).evaluate(node=>node.matches(':modal')),true,'Native modal isolates background controls');
 return page;
}
async function select(page,section){await dialog(page).getByRole('button',{name:sectionLabels[section],exact:true}).click();}
async function noActions(page){const evidence=await audit(page);assert.deepEqual(evidence.openRows,[]);assert.deepEqual(evidence.openProjects,[]);assert.equal(evidence.closed,0);await expect(page.locator('img,video,audio,iframe,canvas')).toHaveCount(0);assert.ok(transports.get(page).calls.every(call=>call.method==='GET'));}
async function capture(page,name){await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: page overflow`);assert.equal(await dialog(page).evaluate(node=>node.scrollWidth>node.clientWidth+1),false,`${name}: dialog overflow`);if(page.viewportSize().width===320){const refresh=await dialog(page).getByRole('button',{name:'Actualiser le dossier',exact:true}).boundingBox();assert.ok(refresh.width>=44&&refresh.height>=44&&refresh.height<=56,`${name}: mobile refresh must remain a compact touch target, got ${refresh.width}×${refresh.height}`);}}
async function settled(page,section,cursor=null){await expect.poll(()=>transports.get(page).calls.some(call=>call.section===section&&call.cursor===cursor&&call.settled)).toBe(true);}
const projectCard=(page,title)=>dialog(page).locator('.programme-dossier-project').filter({has:page.locator('.programme-dossier-project-main strong').filter({hasText:title})});
const more=page=>dialog(page).getByRole('button',{name:'Afficher la suite',exact:true});
const retry=page=>dialog(page).getByRole('button',{name:'Réessayer la lecture',exact:true});
const sectionContent={deliverables:'Bande-annonce — version personnelle relue',weekly:'Semainier composite — un seul projet',derivations:'Semainier social — vraie composition 4:5'};

try{
 for(const width of [1366,720,320])for(const theme of ['dark','light']){
  const page=await open({width,theme});await settled(page,'occurrences');await expect(dialog(page)).toContainText('Épisode 31 — édition de la nuit');await expect(dialog(page)).toContainText('Épisode 32 — occurrence distincte');await noActions(page);await capture(page,`occurrences-${theme}-${width}`);
  for(const section of ['deliverables','weekly','derivations']){await select(page,section);await settled(page,section);await expect(dialog(page).locator('.programme-dossier-project-main')).toContainText([sectionContent[section]]);await capture(page,`${section}-${theme}-${width}`);await noActions(page);}
  // Native Edge may move focus to browser chrome after the last control; the
  // document then reports BODY. It must never focus an underlying page control.
  for(let index=0;index<16;index++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement===document.body||!!document.activeElement?.closest('dialog[open]')),true,'Keyboard cannot reach a background page control');}
  await page.keyboard.press('Escape');await expect(dialog(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'Ouvrir le dossier de recette',exact:true})).toBeFocused();assert.equal((await audit(page)).closed,1);
  checks.push({name:`read-only-${theme}-${width}`,nativeKeyboardIsolation:true,allSectionsReadOnly:true,noHorizontalOverflow:true});await page.close();
 }
 {
  const page=await open();await select(page,'deliverables');await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(4);await expect(dialog(page).locator('.programme-dossier-count')).toHaveText('1 lien visible affiché dans ce dossier');const history=dialog(page).locator('.programme-dossier-history');await expect(history.locator('.programme-dossier-project')).toHaveCount(3);
  const missing=projectCard(page,'Brouillon à historique indisponible');await expect(missing).toContainText('Historique de création indisponible');await expect(missing.locator('.programme-dossier-status')).toHaveText('Archivé');await missing.locator('summary').click();await expect(missing.locator('.programme-dossier-origins')).toContainText('Ligne historique indisponible');await expect(missing.locator('.programme-dossier-origins')).not.toContainText('Magazine de recette');
  const different=projectCard(page,'Ancien brouillon — autre fiche à la création');await different.locator('summary').click();await expect(different).toContainText('Autre émission historique');await expect(different).toContainText('Ce lien n’est pas compté comme un livrable de la fiche actuelle');await noActions(page);await capture(page,'history-separated-dark-1366');
  const ba=projectCard(page,'Bande-annonce — version personnelle relue');await expect(ba.locator('.programme-dossier-project-main p')).toHaveText('Bande-annonce · TV · 16:9');await expect(ba.locator('.programme-dossier-project-main')).not.toContainText('trois dates');
  checks.push({name:'historical-missing-different-undocumented-not-merged',onlyOneCurrentProgrammeLink:true,missingHistoryNeverBorrowsCurrentTitle:true,archivedNotDone:true,neutralBALabelWithoutPrivateModeData:true});await page.close();
 }
 {
  const page=await open();await select(page,'weekly');await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(1);await expect(dialog(page).locator('.programme-dossier-count')).toHaveText('1 lien visible affiché dans ce dossier');await expect(dialog(page)).toContainText('un seul projet pour ses sept lignes');await dialog(page).locator('.programme-dossier-origins summary').click();await expect(dialog(page).locator('.programme-dossier-origins li')).toHaveCount(7);await noActions(page);
  checks.push({name:'weekly-composite-counted-once-with-seven-origins',oneProjectNotSevenDeliverables:true});await page.close();
 }
 {
  const page=await open();await select(page,'derivations');await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(2);const week=projectCard(page,'Semainier social — vraie composition 4:5'),now=projectCard(page,'Annonce immédiate — modèle Tout de suite'),names=await page.evaluate(()=>window.productionLinksFixture.modelNames);await expect(week.locator('.programme-dossier-project-main p')).toContainText(names.BTV_Semainier);await expect(week.locator('.programme-dossier-project-main p')).toContainText('Portrait · 4:5');await expect(week.locator('.programme-dossier-project-main p')).not.toContainText('Vertical');await expect(now.locator('.programme-dossier-project-main p')).toContainText(names.BTV_BA_TDS);await expect(now.locator('.programme-dossier-project-main p')).toContainText('Vertical · 9:16');await expect(now).toContainText('Ce libellé ne détermine pas une date de diffusion');await week.locator('summary').click();await now.locator('summary').click();await expect(week.locator('.programme-dossier-origins')).toContainText('BTV_Semainier · modèle 1.7.0 · bibliothèque 1.7.0');await expect(now.locator('.programme-dossier-origins')).toContainText('BTV_BA_TDS · modèle 1.7.0 · bibliothèque 1.7.0');await noActions(page);
  checks.push({name:'actual-derived-template-and-format-outrank-origin-target-label',weeklyNotMislabelledBA:true,nowIsTDS:true,noInventedBroadcastDate:true});await page.close();
 }
 {
  const page=await open({mode:'pagination'});await select(page,'deliverables');await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(1);await more(page).click();await settled(page,'deliverables','middle');await expect(more(page)).toBeEnabled();await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(1);await expect(dialog(page).locator('.programme-dossier-empty')).toHaveCount(0);await more(page).click();await settled(page,'deliverables','last');await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(2);await expect(more(page)).toHaveCount(0);assert.deepEqual(transports.get(page).calls.filter(call=>call.section==='deliverables').map(call=>call.cursor),[null,'middle','last']);await noActions(page);
  checks.push({name:'empty-middle-page-with-next-is-not-end',previousItemsRetained:true,followingCursorConsumed:true});await page.close();
 }
 {
  const page=await open({fail:'occurrences:'}),transport=transports.get(page);await expect(dialog(page).getByRole('alert')).toContainText('Lecture simulée indisponible');await expect(dialog(page).locator('.programme-dossier-empty')).toHaveCount(0);transport.failures.clear();await retry(page).click();await expect(dialog(page).locator('.programme-dossier-occurrences > li')).toHaveCount(2);await expect(dialog(page).getByRole('alert')).toHaveCount(0);assert.equal(transport.calls.length,2);await noActions(page);
  checks.push({name:'initial-error-is-not-false-empty-and-explicit-retry-works',noAutomaticRetry:true});await page.close();
 }
 {
  const page=await open({mode:'pagination',fail:'deliverables:middle'}),transport=transports.get(page);await select(page,'deliverables');await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(1);await more(page).click();await expect(dialog(page).getByRole('alert')).toContainText('Lecture simulée indisponible');await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(1);await expect(more(page)).toBeDisabled();transport.failures.clear();await retry(page).click();await expect(dialog(page).getByRole('alert')).toHaveCount(0);await expect(more(page)).toBeEnabled();await more(page).click();await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(2);assert.deepEqual(transport.calls.filter(call=>call.section==='deliverables').map(call=>call.cursor),[null,'middle','middle','last']);await noActions(page);
  checks.push({name:'next-page-error-retains-existing-items-and-cursor',explicitRetryDoesNotRestartOrDuplicate:true});await page.close();
 }
 {
  const page=await open({mode:'snapshot-change'});await select(page,'deliverables');await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(1);await more(page).click();await expect(dialog(page).getByRole('alert')).toContainText('Le dossier a changé');await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(1);await expect(dialog(page).locator('.programme-dossier-history')).toHaveCount(0);await expect(more(page)).toBeDisabled();await noActions(page);
  checks.push({name:'changed-snapshot-rejected-without-page-merge',oldPageRetainedButNoFalseFreshness:true});await page.close();
 }
 {
  const page=await open({hold:'deliverables:'}),transport=transports.get(page);await select(page,'deliverables');await expect.poll(()=>transport.calls.some(call=>call.section==='deliverables'&&!call.settled)).toBe(true);await select(page,'weekly');await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(1);await expect(dialog(page)).toContainText('Semainier composite — un seul projet');transport.release('deliverables:');await settled(page,'deliverables');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(dialog(page).locator('.programme-dossier-project')).toHaveCount(1);await expect(dialog(page).getByRole('button',{name:'Semainiers',exact:true})).toHaveAttribute('aria-pressed','true');await expect(dialog(page)).not.toContainText('Bande-annonce — version personnelle relue');await noActions(page);
  checks.push({name:'late-section-reply-cannot-overwrite-current-section',newSelectionWins:true});await page.close();
 }
 for(const transition of ['channel','unmount','context','role','suspension']){
  const page=await open({hold:'occurrences:',role:'admin'}),transport=transports.get(page);await expect.poll(()=>transport.calls.length).toBe(1);await page.evaluate(transition=>transition==='channel'?window.productionLinksControl.channel():transition==='context'?window.productionLinksControl.replaceContext():transition==='role'?window.productionLinksControl.loseRole():transition==='suspension'?window.productionLinksControl.suspend():window.productionLinksControl.unmount(),transition);
  if(transition==='unmount')await expect(dialog(page)).toHaveCount(0);else await expect(dialog(page).getByRole('alert')).toContainText('Le compte, la chaîne ou la préparation a changé');
  transport.release('occurrences:');await settled(page,'occurrences');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(transport.calls.length,1);await noActions(page);if(transition!=='unmount'){await expect(dialog(page).locator('.programme-dossier-occurrences')).toHaveCount(0);for(const name of Object.values(sectionLabels))await expect(dialog(page).getByRole('button',{name,exact:true})).toBeDisabled();}
  checks.push({name:`late-reply-after-${transition}-is-discarded`,noNewContextRequestOrCallback:true});await page.close();
 }
 {
  const page=await open({mode:'dirty'}),initial=(await audit(page)).initial;await expect(dialog(page)).toContainText('Vue de la préparation enregistrée. Vos retouches locales restent intactes.');await expect(dialog(page).locator('.programme-dossier-occurrences > li')).toHaveCount(2);const first=dialog(page).getByRole('button',{name:'Ouvrir la ligne · Magazine de recette · Épisode 31 — édition de la nuit',exact:true});await first.focus();await page.keyboard.press('Enter');assert.deepEqual((await audit(page)).openRows,[rowId]);await select(page,'deliverables');await dialog(page).getByRole('button',{name:'Ouvrir le projet · Ancien brouillon — autre fiche à la création',exact:true}).click();assert.deepEqual((await audit(page)).openProjects,[id(12)]);assert.deepEqual((await audit(page)).initial,initial);assert.ok(transports.get(page).calls.every(call=>call.method==='GET'));
  checks.push({name:'navigation-callbacks-use-exact-row-and-project-identities',dirtyPreparationUntouched:true,noSaveOrGeneration:true});await page.close();
 }
 {
  const page=await open({mode:'line'});await expect(dialog(page)).toContainText('fiche émission non liée, cette ligne uniquement');await expect(dialog(page).locator('.programme-dossier-occurrences > li')).toHaveCount(1);await expect(dialog(page)).not.toContainText('Épisode 32 — occurrence distincte');await noActions(page);
  checks.push({name:'unlinked-row-discloses-line-only-scope',noTitleBasedGroupingClaim:true});await page.close();
 }
 {
  const page=await open({mode:'empty'});await select(page,'deliverables');await expect(dialog(page).locator('.programme-dossier-empty')).toContainText('Aucun lien visible dans cette vue. Cela ne décrit pas les projets privés des collègues.');await expect(dialog(page).locator('.programme-dossier-count')).toHaveCount(0);await noActions(page);
  checks.push({name:'empty-visible-list-never-claims-no-private-projects',noFalseGlobalTotal:true});await page.close();
 }
}catch(error){errors.push(error.stack||String(error));throw error;}
finally{
 const report={scope:'Real ProgrammeProductionDossier and productionLinksAPI with synthetic typed responses intercepted at HTTP. No real account, backend authorization/privacy proof, shared persistence, media loading, navigation implementation or deployment. Callback spies only. 720×450 is a CSS reflow surface, not native browser zoom.',checks,errors,unexpectedRequests};await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));for(const context of contexts)await context.close();await browser.close();console.log(JSON.stringify({checks:checks.length,errors,unexpectedRequests},null,2));
}
assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
