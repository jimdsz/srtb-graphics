import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/planner-logo-reuse');
const checks=[],errors=[],unexpectedRequests=[],contexts=[],imageRequests=new WeakMap();
const id=number=>`66666666-6666-4666-8666-${String(number).padStart(12,'0')}`;
const url=number=>`/api/graphics/media/${id(number)}/content`;
const audit=page=>page.evaluate(()=>structuredClone(window.plannerLogoReuseEvidence));
const current=page=>page.evaluate(()=>window.plannerLogoReuseControl.current());
const dialog=page=>page.getByRole('dialog');
const confirmation=page=>dialog(page).getByRole('checkbox',{name:'J’ai vérifié ce logo pour cette émission.',exact:true});
const reuse=page=>dialog(page).getByRole('checkbox',{name:'Autres occurrences de cette fiche',exact:true});
const replacements=page=>dialog(page).getByRole('checkbox',{name:/^Autoriser le remplacement des logos déjà renseignés/});
const rowCheck=(page,index)=>dialog(page).getByRole('checkbox',{name:new RegExp(`Épisode ${String(index+1).padStart(2,'0')}(?:\\b| )`)});
const preview=page=>dialog(page).getByRole('img',{name:'Logo sélectionné',exact:true});
const apply=page=>dialog(page).locator('.planner-logo-footer button.primary');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const pixels=await browser.newPage();
const encoded=await pixels.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;const context=canvas.getContext('2d');context.fillStyle='#007300';context.fillRect(0,0,96,64);context.fillStyle='#f0b900';context.fillRect(12,12,72,40);return Object.fromEntries(['image/png','image/webp'].map(mime=>[mime,canvas.toDataURL(mime).split(',')[1]]));});await pixels.close();
const bytes=Object.fromEntries(Object.entries(encoded).map(([mime,value])=>[mime,Buffer.from(value,'base64')]));
async function open({width=1366,theme='dark',mode='normal',hold=''}={}){
 const context=await browser.newContext({viewport:{width,height:width===720?450:768},reducedMotion:'reduce'});contexts.push(context);const page=await context.newPage(),requests=[];imageRequests.set(page,requests);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const request=route.request(),address=new URL(request.url());if(address.origin===base&&/^\/api\/graphics\/media\/66666666-6666-4666-8666-\d{12}\/content$/.test(address.pathname)&&request.method()==='GET'){requests.push(address.pathname);const mime=address.pathname===url(1)?'image/webp':'image/png';return route.fulfill({status:200,contentType:mime,body:bytes[mime]});}if(address.origin!==base||address.pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method())){unexpectedRequests.push({url:address.href,method:request.method()});return route.abort();}return route.continue();});
 await page.goto(`${base}/tests/planner-logo-reuse.html?${new URLSearchParams({mode,...(hold?{hold}:{})})}`);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);const opener=page.getByRole('button',{name:'Ouvrir le choix du logo',exact:true});await opener.focus();await page.keyboard.press('Enter');await expect(dialog(page)).toBeVisible();return page;
}
async function untouched(page){const evidence=await audit(page);assert.deepEqual(evidence.unitChanges,[]);assert.deepEqual(evidence.groupCalls,[]);assert.deepEqual(evidence.writes,[]);assert.deepEqual(await current(page),evidence.initial);await expect(page.locator('video,audio,iframe')).toHaveCount(0);}
async function ready(page){await expect(preview(page)).toBeVisible();await expect.poll(()=>preview(page).evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);}
async function chooseProposal(page){await dialog(page).getByRole('button',{name:'Voir le logo proposé',exact:true}).click();await ready(page);await expect(confirmation(page)).not.toBeChecked();await expect(apply(page)).toBeDisabled();}
async function capture(page,name){await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: document overflow`);assert.equal(await dialog(page).evaluate(node=>node.scrollWidth>node.clientWidth+1),false,`${name}: dialog overflow`);}
function onlyLogos(initial,next,indices,logo){const expected=structuredClone(initial);for(const index of indices)expected.rows[index].logo=logo;assert.deepEqual(next,expected,'Only the chosen row logos may change; source rows, semainier, media, voices, texts and dates remain exact');}
async function grouped(page){await chooseProposal(page);await reuse(page).check();await expect(dialog(page).getByRole('group',{name:'Lignes proposées pour ce logo',exact:true}).getByRole('checkbox')).toHaveCount(32);}
async function submit(page){await confirmation(page).check();await apply(page).click();await expect(dialog(page)).toHaveCount(0);await expect.poll(async()=>(await audit(page)).groupCalls.length+(await audit(page)).unitChanges.length).toBe(1);}
async function selectLocal(page){await dialog(page).locator('input[type=file]').setInputFiles({name:'Logo local relu.png',mimeType:'image/png',buffer:bytes['image/png']});await ready(page);await expect(confirmation(page)).not.toBeChecked();await expect(apply(page)).toBeDisabled();return preview(page).getAttribute('src');}
async function noWrites(page){assert.deepEqual((await audit(page)).writes,[]);await expect(page.locator('video,audio,iframe')).toHaveCount(0);}
async function noCallbacks(page){const evidence=await audit(page);assert.deepEqual(evidence.unitChanges,[]);assert.deepEqual(evidence.groupCalls,[]);await noWrites(page);}

try{
 for(const width of [1366,720,320])for(const theme of ['dark','light']){
  const page=await open({width,theme});await expect(dialog(page).getByRole('button',{name:'Voir le logo proposé',exact:true})).toBeEnabled();await untouched(page);assert.deepEqual(imageRequests.get(page),[],'Metadata is not permission to fetch any logo content');assert.equal((await audit(page)).catalogueCalls,0);await expect(preview(page)).toHaveCount(0);await expect(reuse(page)).toHaveCount(0);
  await grouped(page);await expect(confirmation(page)).not.toBeChecked();await expect(apply(page)).toBeDisabled();await expect(rowCheck(page,0)).toBeChecked();await expect(rowCheck(page,0)).toBeDisabled();await expect(rowCheck(page,1)).not.toBeChecked();await expect(rowCheck(page,1)).toBeDisabled();await expect(rowCheck(page,2)).not.toBeChecked();await expect(rowCheck(page,2)).toBeDisabled();
  for(const index of [3,4,5,6])await expect(rowCheck(page,index)).toHaveCount(0);await expect(rowCheck(page,35)).toBeEnabled();await expect(rowCheck(page,35)).not.toBeChecked();
  await rowCheck(page,7).focus();await page.keyboard.press('Space');await rowCheck(page,8).check();await expect(apply(page)).toHaveText('Appliquer à 3 lignes');await expect(confirmation(page)).not.toBeChecked();await expect(apply(page)).toBeDisabled();
  const geometry=await rowCheck(page,8).evaluate(input=>{const box=input.getBoundingClientRect(),label=input.closest('label').getBoundingClientRect();return {width:box.width,height:box.height,labelHeight:label.height,direction:getComputedStyle(input.closest('label')).flexDirection};});assert.ok(geometry.width<=20&&geometry.height<=20&&geometry.labelHeight>=44);assert.equal(geometry.direction,'row');
  await dialog(page).getByRole('group',{name:'Lignes proposées pour ce logo',exact:true}).evaluate(node=>node.scrollTop=0);await capture(page,`selection-${theme}-${width}`);await untouched(page);await submit(page);const evidence=await audit(page);assert.equal(evidence.groupCalls.length,1);assert.deepEqual(evidence.unitChanges,[]);assert.deepEqual(evidence.groupCalls[0].selectedIds,[evidence.initial.rows[0].id,evidence.initial.rows[7].id,evidence.initial.rows[8].id]);assert.deepEqual(evidence.groupCalls[0].replaceIds,[]);onlyLogos(evidence.initial,await current(page),[0,7,8],evidence.groupCalls[0].review.logo);assert.equal(evidence.groupCalls[0].result.sourceChanged,false);
  await page.getByRole('button',{name:'Annuler la dernière application groupée',exact:true}).click();await expect.poll(async()=>(await audit(page)).undos.length).toBe(1);assert.deepEqual(await current(page),evidence.initial);await noWrites(page);
  checks.push({name:`batch-${theme}-${width}`,all32CandidatesVisible:true,explicitSourceAndTwoOccurrences:true,revisionAndTitleDifferencesAllowed:true,allOtherFieldsAndUndoPreserved:true,geometry});await page.close();
 }
 for(const mode of ['normal','standalone']){
  const page=await open({mode});await chooseProposal(page);if(mode==='normal')await expect(reuse(page)).not.toBeChecked();await submit(page);const evidence=await audit(page),logo=await page.evaluate(()=>window.plannerLogoReuseData.proposed);onlyLogos(evidence.initial,await current(page),[0],logo);if(mode==='normal'){assert.equal(evidence.groupCalls.length,1);assert.deepEqual(evidence.groupCalls[0].selectedIds,[evidence.initial.rows[0].id]);}else{assert.equal(evidence.unitChanges.length,1);assert.deepEqual(evidence.groupCalls,[]);}await noWrites(page);
  checks.push({name:`single-default-${mode}`,otherOccurrencesUntouched:true,legacyPropsSupported:mode==='standalone'});await page.close();
 }
 {
  const page=await open();await grouped(page);await dialog(page).getByRole('button',{name:'Sélectionner les lignes sans logo',exact:true}).click();await expect(apply(page)).toHaveText('Appliquer à 30 lignes');await expect(rowCheck(page,35)).toBeChecked();await expect(rowCheck(page,1)).not.toBeChecked();await expect(rowCheck(page,2)).not.toBeChecked();await expect(replacements(page)).not.toBeChecked();await submit(page);const evidence=await audit(page),indices=evidence.initial.rows.map((row,index)=>({row,index})).filter(({row})=>row.included&&!row.sourceRemoved&&row.programmeId===id(11)&&!row.logo).map(({index})=>index);assert.equal(indices.length,30);onlyLogos(evidence.initial,await current(page),indices,evidence.groupCalls[0].review.logo);assert.deepEqual(evidence.groupCalls[0].replaceIds,[]);await noWrites(page);
  checks.push({name:'select-all-without-logo-has-no-twenty-row-truncation',selected:30,existingLogosProtected:true});await page.close();
 }
 {
  const page=await open();await grouped(page);await replacements(page).check();await expect(rowCheck(page,1)).toBeEnabled();await expect(rowCheck(page,1)).not.toBeChecked();await expect(rowCheck(page,2)).not.toBeChecked();await expect(apply(page)).toHaveText('Appliquer à 1 lignes');await rowCheck(page,1).check();await expect(apply(page)).toHaveText('Appliquer à 2 lignes');await replacements(page).uncheck();await expect(rowCheck(page,1)).not.toBeChecked();await expect(rowCheck(page,1)).toBeDisabled();await replacements(page).check();await expect(rowCheck(page,1)).not.toBeChecked();await rowCheck(page,1).check();await submit(page);const evidence=await audit(page);onlyLogos(evidence.initial,await current(page),[0,1],evidence.groupCalls[0].review.logo);assert.deepEqual(evidence.groupCalls[0].replaceIds,[evidence.initial.rows[1].id]);await noWrites(page);
  checks.push({name:'replacement-requires-separate-permission-and-individual-selection',permissionAloneSelectsNobody:true,revocationClearsProtectedSelection:true});await page.close();
 }
 {
  const page=await open();await grouped(page);await replacements(page).check();await rowCheck(page,1).check();await confirmation(page).check();const local=await selectLocal(page);await expect(preview(page)).toHaveAttribute('src',local);await expect(reuse(page)).not.toBeChecked();await expect(replacements(page)).toHaveCount(0);await reuse(page).check();await expect(replacements(page)).not.toBeChecked();await expect(rowCheck(page,1)).not.toBeChecked();await expect(rowCheck(page,1)).toBeDisabled();await expect(rowCheck(page,7)).not.toBeChecked();await untouched(page);
  checks.push({name:'new-logo-clears-confirmation-grouping-and-replacement-consent',noConsentCarryOver:true});await page.close();
 }
 {
  const page=await open();await grouped(page);await dialog(page).getByRole('button',{name:'Sélectionner les lignes sans logo',exact:true}).click();await confirmation(page).check();await reuse(page).uncheck();await expect(apply(page)).toHaveText('Utiliser ce logo');await reuse(page).check();await expect(apply(page)).toHaveText('Appliquer à 1 lignes');await expect(rowCheck(page,7)).not.toBeChecked();await dialog(page).getByRole('button',{name:'Annuler',exact:true}).click();await expect(dialog(page)).toHaveCount(0);await untouched(page);
  checks.push({name:'leaving-group-clears-selected-occurrences-and-cancel-keeps-plan',noCallbackOnCancel:true});await page.close();
 }
 {
  const page=await open({mode:'existing'});await expect(dialog(page).getByRole('button',{name:'Retirer le logo',exact:true})).toBeEnabled();assert.deepEqual(imageRequests.get(page),[]);await dialog(page).getByRole('button',{name:'Retirer le logo',exact:true}).click();await expect(preview(page)).toHaveCount(0);await expect(reuse(page)).toHaveCount(0);await expect(apply(page)).toBeDisabled();await dialog(page).getByRole('checkbox',{name:'Je confirme le retrait du logo pour les nouveaux brouillons.',exact:true}).check();await apply(page).click();await expect(dialog(page)).toHaveCount(0);const evidence=await audit(page);onlyLogos(evidence.initial,await current(page),[0],null);assert.deepEqual(evidence.groupCalls[0].selectedIds,[evidence.initial.rows[0].id]);assert.deepEqual(imageRequests.get(page),[]);await noWrites(page);
  checks.push({name:'removal-is-single-only-with-explicit-confirmation',noPreviewOrGroupRemoval:true});await page.close();
 }
 {
  const page=await open({mode:'unlinked'});await selectLocal(page);await expect(reuse(page)).toHaveCount(0);await submit(page);const evidence=await audit(page);onlyLogos(evidence.initial,await current(page),[0],evidence.groupCalls[0].review.logo);await noWrites(page);
  checks.push({name:'same-title-without-programme-id-never-groups',singleLocalChoiceOnly:true});await page.close();
 }
 {
  const page=await open();await grouped(page);await rowCheck(page,7).check();await rowCheck(page,8).check();await page.evaluate(()=>window.plannerLogoReuseControl.patch(7,{time:'03:12',subtitle:'Retouche arrivée pendant la revue'}));await expect.poll(async()=>(await current(page)).rows[7].time).toBe('03:12');await expect(rowCheck(page,7)).toBeDisabled();await expect(rowCheck(page,7).locator('..')).toContainText('Modifiée depuis la revue · conservée');const before=await current(page);await submit(page);const evidence=await audit(page),call=evidence.groupCalls[0];onlyLogos(before,await current(page),[0,8],call.review.logo);assert.deepEqual(call.result.skipped,[before.rows[7].id]);assert.equal(call.result.sourceChanged,false);await noWrites(page);
  checks.push({name:'changed-target-row-is-skipped-not-overwritten',otherReviewedRowsStillApply:true,completeRowFingerprint:true});await page.close();
 }
 for(const change of ['source','reimport']){
  const page=await open();await grouped(page);await rowCheck(page,7).check();await confirmation(page).check();await page.evaluate(change=>change==='source'?window.plannerLogoReuseControl.patch(0,{subtitle:'Source retouchée'}):window.plannerLogoReuseControl.reimport(),change);await expect(dialog(page).getByRole('alert')).toContainText('Cette ligne a changé depuis la vérification');await expect(apply(page)).toBeDisabled();await expect(confirmation(page)).toBeDisabled();await noCallbacks(page);
  checks.push({name:`${change}-change-blocks-entire-application`,noPartialApplication:true});await page.close();
 }
 {
  const page=await open();await grouped(page);await rowCheck(page,7).check();await submit(page);await page.evaluate(()=>window.plannerLogoReuseControl.patch(7,{title:'Titre retouché après application',time:'02:17',media:null,excerpt:null,voices:{}}));await expect.poll(async()=>(await current(page)).rows[7].title).toBe('Titre retouché après application');const beforeUndo=await current(page),initial=(await audit(page)).initial;await page.getByRole('button',{name:'Annuler la dernière application groupée',exact:true}).click();await expect.poll(async()=>(await audit(page)).undos.length).toBe(1);const expected=structuredClone(beforeUndo);expected.rows[0].logo=initial.rows[0].logo;expected.rows[7].logo=initial.rows[7].logo;assert.deepEqual(await current(page),expected);await noWrites(page);
  checks.push({name:'undo-merges-only-logo-over-subsequent-text-media-voice-edits',laterRetouchesRetained:true});await page.close();
 }
 {
  const page=await open();await grouped(page);await rowCheck(page,7).check();await submit(page);await page.evaluate(()=>window.plannerLogoReuseControl.patch(7,{programmeRevision:9}));await expect.poll(async()=>(await current(page)).rows[7].programmeRevision).toBe(9);const beforeUndo=await current(page),initial=(await audit(page)).initial;await page.getByRole('button',{name:'Annuler la dernière application groupée',exact:true}).click();await expect.poll(async()=>(await audit(page)).undos.length).toBe(1);const expected=structuredClone(beforeUndo);expected.rows[0].logo=initial.rows[0].logo;assert.deepEqual(await current(page),expected);assert.deepEqual((await audit(page)).undos[0].skipped,[initial.rows[7].id]);await noWrites(page);
  checks.push({name:'undo-preserves-new-programme-link-revision',skippedTargetReported:true});await page.close();
 }
 for(const kind of ['programme','metadata']){
  const page=await open({hold:kind});await expect.poll(async()=>(await audit(page))[kind==='programme'?'programmeCalls':'metadataCalls'].length).toBe(1);const selected=await selectLocal(page);await reuse(page).check();await rowCheck(page,7).check();await confirmation(page).check();await page.evaluate(kind=>window.plannerLogoReuseControl.release(kind),kind);await expect.poll(async()=>(await audit(page))[kind==='programme'?'programmeCalls':'metadataCalls'][0].settled).toBe(true);await expect(preview(page)).toHaveAttribute('src',selected);await expect(confirmation(page)).toBeChecked();await expect(rowCheck(page,7)).toBeChecked();await submit(page);const evidence=await audit(page);assert.equal(evidence.groupCalls[0].review.logo.name,'Logo local relu.png');onlyLogos(evidence.initial,await current(page),[0,7],evidence.groupCalls[0].review.logo);await noWrites(page);
  checks.push({name:`late-${kind}-does-not-replace-manual-logo-or-review`,manualConsentAndTargetsKept:true});await page.close();
 }
 for(const transition of ['channel','context','unmount']){
  const page=await open({hold:'programme'});await expect.poll(async()=>(await audit(page)).programmeCalls.length).toBe(1);await page.evaluate(transition=>transition==='channel'?window.plannerLogoReuseControl.channel():transition==='context'?window.plannerLogoReuseControl.context():window.plannerLogoReuseControl.unmount(),transition);if(transition==='unmount')await expect(dialog(page)).toHaveCount(0);else await expect(dialog(page).getByRole('alert')).toContainText('la chaîne ou la préparation a changé');await page.evaluate(()=>window.plannerLogoReuseControl.release('programme'));await expect.poll(async()=>(await audit(page)).programmeCalls[0].settled).toBe(true);if(transition!=='unmount'){await expect(apply(page)).toBeDisabled();await expect(preview(page)).toHaveCount(0);await expect(dialog(page).getByRole('button',{name:'Voir le logo proposé',exact:true})).toHaveCount(0);}assert.deepEqual(imageRequests.get(page),[]);await noCallbacks(page);
  checks.push({name:`late-proposal-after-${transition}-discarded`,noOldContextPreviewOrApply:true});await page.close();
 }
}catch(error){errors.push(error.stack||String(error));throw error;}
finally{const report={scope:'Real PlannerLogoDialog and logo review/application/undo helpers; synthetic API metadata and browser-encoded PNG/WebP content served by local request interception. No real account, upload, disk permission, server persistence, existing project update or deployment. 720px is CSS reflow, not native browser zoom.',checks,errors,unexpectedRequests};await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));for(const context of contexts)await context.close();await browser.close();console.log(JSON.stringify({checks:checks.length,errors,unexpectedRequests},null,2));}
assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
