import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/planner-recipe-editor');
const checks=[],errors=[],unexpectedRequests=[],contexts=[];
const habitTransports=new WeakMap();
const labels={ba:'Bande-annonce',popup:'Pop-up',tds:'Tout de suite',renvoi:'Renvoi',event:'Événement'};
const id=number=>`88888888-8888-4888-8888-${String(number).padStart(12,'0')}`;
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const audit=page=>page.evaluate(()=>structuredClone(window.recipeEditorEvidence));
const current=page=>page.evaluate(()=>window.recipeEditorControl.current());
const dialog=page=>page.getByRole('dialog');
async function open({role='designer',mode='new',width=1366,theme='dark',observation=false,hold='',readError=0,habits=false}={}){
 const context=await browser.newContext({viewport:{width,height:768},reducedMotion:'reduce'});contexts.push(context);const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const transport={calls:[],hold:false,release:()=>{},suggestion:{programme:'magazine de recette',candidate:{name:'Magazine de recette',kinds:['event'],directoryId:id(50)},confirmations:3,revision:2,ruleId:id(1),ruleRevision:3,state:null}};habitTransports.set(page,transport);
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(habits&&url.origin===base&&((url.pathname==='/api/graphics/habits'&&request.method()==='GET')||(url.pathname==='/api/graphics/habits/decide'&&request.method()==='POST'))){
   const channel=request.headers()['x-srtb-channel'];transport.calls.push({method:request.method(),path:url.pathname,channel,body:request.postDataJSON()});
   if(request.method()==='POST'&&transport.hold)await new Promise(resolve=>{transport.release=resolve;});
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(request.method()==='POST'?{ok:true}:{suggestions:channel==='benin-tv'?[transport.suggestion]:[]})}).catch(()=>{});
  }
  if(url.origin!==base||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method())){unexpectedRequests.push({url:url.href,method:request.method()});return route.abort();}
  return route.continue();
 });
 await page.goto(`${base}/tests/planner-recipe-editor.html?${new URLSearchParams({role,mode,readError:String(readError),...(observation?{observation:typeof observation==='string'?observation:'1'}:{}),...(hold?{hold}:{}),...(habits?{habits:'1'}:{})})}`);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 if(habits){await page.locator('.planner-habits > summary').click();await expect(page.getByRole('button',{name:'Adapter cette proposition',exact:true})).toBeVisible();}else await expect(dialog(page).getByRole('heading',{name:'Adapter une recette',exact:true})).toBeVisible();return page;
}
async function choose(page,kinds){for(const [key,label]of Object.entries(labels))await dialog(page).getByRole('checkbox',{name:label,exact:true}).setChecked(kinds.includes(key));}
async function noWrites(page){const evidence=await audit(page);assert.deepEqual(evidence.attempts,[]);assert.deepEqual(evidence.writes,[]);assert.equal(evidence.mediaReads,0);assert.equal(evidence.generated,0);assert.equal(await page.locator('audio,video,img').count(),0);}
async function capture(page,name){await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: page overflow`);assert.equal(await dialog(page).evaluateAll(nodes=>nodes.some(node=>node.scrollWidth>node.clientWidth+1)),false,`${name}: dialog overflow`);}
async function prepare(page){await dialog(page).getByRole('button',{name:'Préparer la mémorisation',exact:true}).click();const heading=dialog(page).getByRole('heading',{name:'Confirmer la recette d’équipe',exact:true});await expect(heading).toBeVisible();await expect(heading).toBeFocused();const bounds=await heading.boundingBox(),viewport=page.viewportSize();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=viewport.height,'The confirmation begins at its visible heading, not the old scroll position');}
async function confirm(page){await dialog(page).getByRole('button',{name:'Mémoriser pour l’équipe',exact:true}).click();}
function onlyKinds(initial,updated,kinds,index=0){const expected=structuredClone(initial);expected.rows[index].kinds=kinds;assert.deepEqual(updated,expected,'Only the selected occurrence kinds may change; every other field/reference is retained');}

try{
 for(const width of [1366,320])for(const theme of ['dark','light']){
  const page=await open({width,theme});const initial=(await audit(page)).initial;
  await noWrites(page);assert.deepEqual((await audit(page)).changes,[]);await expect(dialog(page).getByRole('button',{name:'Préparer la mémorisation',exact:true})).toHaveCount(0);
  await choose(page,['popup','event']);await capture(page,`edit-${theme}-${width}`);await noWrites(page);assert.deepEqual(await current(page),initial);
  const apply=dialog(page).getByRole('button',{name:'Appliquer à cette ligne',exact:true});await apply.focus();await page.keyboard.press('Enter');await expect.poll(async()=>(await audit(page)).changes.length).toBe(1);onlyKinds(initial,await current(page),['popup','event']);
  await capture(page,`applied-${theme}-${width}`);await dialog(page).getByRole('button',{name:'Annuler l’application',exact:true}).click();await expect.poll(async()=>(await audit(page)).changes.length).toBe(2);assert.deepEqual(await current(page),initial);await noWrites(page);
  const applications=(await audit(page)).applications;assert.equal(applications.length,2);assert.deepEqual(applications[0].after,['popup','event']);assert.equal(applications[1],null);
  checks.push({name:`designer-${theme}-${width}`,localOnly:true,explicitKeyboardApplication:true,allReferencesPreserved:true,undoExact:true});await page.close();
 }
 for(const role of ['admin','broadcaster'])for(const family of [false,true]){
  const page=await open({role});await choose(page,family?[]:['event']);await noWrites(page);
  await dialog(page).getByRole('radio',{name:family?'Les prochains épisodes de cette émission':'Ce titre / épisode',exact:true}).check();await prepare(page);await noWrites(page);await capture(page,`confirm-${role}-${family?'family-empty':'episode'}`);
  await confirm(page);await expect.poll(async()=>(await audit(page)).writes.length).toBe(1);const evidence=await audit(page),saved=evidence.writes[0];assert.equal(evidence.attempts.length,1);assert.deepEqual(saved.data.kinds,family?[]:['event']);assert.equal(saved.data.family,family?'magazine de recette':undefined);assert.equal(saved.data.preferredPath,null);assert.equal(saved.revision,1);assert.deepEqual(evidence.changes,[],'Shared memorization does not apply a row recipe');
  checks.push({name:`${role}-${family?'family-empty':'episode'}`,explicitReviewBeforeOneWrite:true,noAutomaticLocalApply:true,noEpisodeFileInherited:true});await page.close();
 }
 {
  const page=await open({role:'admin',mode:'exact'});await expect(dialog(page).getByText('Règle de ce titre / épisode · r4',{exact:true})).toBeVisible();await choose(page,['event']);await prepare(page);await confirm(page);await expect.poll(async()=>(await audit(page)).writes.length).toBe(1);
  const saved=(await audit(page)).writes[0];assert.equal(saved.id,id(1));assert.equal(saved.revision,5);assert.equal(saved.data.directoryId,id(50));assert.equal(saved.data.preferredPath,'Épisodes/ancien-episode.mp4');assert.equal(saved.data.keywords,'Recherche relue');assert.deepEqual(await current(page),(await audit(page)).initial);
  checks.push({name:'exact-rule-update-preserves-approved-association',sameIdAndRevision:true,noLocalMutation:true});await page.close();
 }
 {
  const page=await open({role:'admin',mode:'family'});await expect(dialog(page).getByText('Règle héritée de cette émission',{exact:true})).toBeVisible();await choose(page,['event']);await prepare(page);await confirm(page);await expect.poll(async()=>(await audit(page)).writes.length).toBe(1);
  const saved=(await audit(page)).writes[0];assert.notEqual(saved.id,id(1));assert.equal(saved.data.preferredPath,null);assert.equal(saved.data.directoryId,id(50));assert.equal(saved.data.family,undefined);assert.equal(saved.data.programme,'magazine de recette episode 31');assert.deepEqual(await current(page),(await audit(page)).initial);
  checks.push({name:'new-episode-rule-never-inherits-previous-file',newRuleIdentity:true,folderOnlyInherited:true});await page.close();
 }
 {
  const page=await open({role:'admin',mode:'exact-family'});await choose(page,['event']);await prepare(page);await expect(dialog(page)).toContainText('La proposition aux prochains épisodes sera retirée');await confirm(page);await expect.poll(async()=>(await audit(page)).writes.length).toBe(1);assert.equal((await audit(page)).writes[0].data.family,undefined);
  checks.push({name:'narrow-family-to-exact-is-explicitly-reviewed',scopeRemovalVisible:true});await page.close();
 }
 {
  const page=await open({role:'admin',mode:'exact-and-family'});const initial=await page.evaluate(()=>window.recipeEditorControl.saved());await choose(page,['event']);await dialog(page).getByRole('radio',{name:'Les prochains épisodes de cette émission',exact:true}).check();await prepare(page);await expect(dialog(page)).toContainText('La règle exacte de cet épisode reste prioritaire');await confirm(page);await expect.poll(async()=>(await audit(page)).writes.length).toBe(1);
  const evidence=await audit(page),saved=await page.evaluate(()=>window.recipeEditorControl.saved());assert.equal(evidence.writes[0].id,id(2));assert.deepEqual(saved.find(rule=>rule.id===id(1)),initial.find(rule=>rule.id===id(1)));assert.deepEqual(saved.find(rule=>rule.id===id(2)).data.kinds,['event']);
  checks.push({name:'exact-episode-exception-outranks-separate-family-rule',priorityDisclosed:true,exactRuleUnchanged:true});await page.close();
 }
 for(const mode of ['ambiguous','multiple-family']){
  const page=await open({role:'admin',mode});await choose(page,['event']);await dialog(page).getByRole('radio',{name:'Les prochains épisodes de cette émission',exact:true}).check();await dialog(page).getByRole('button',{name:'Préparer la mémorisation',exact:true}).click();await expect(dialog(page).getByRole('alert')).toContainText(mode==='ambiguous'?'contradictoires':'Plusieurs règles');await noWrites(page);
  await dialog(page).getByRole('button',{name:'Appliquer à cette ligne',exact:true}).click();onlyKinds((await audit(page)).initial,await current(page),['event']);await noWrites(page);
  checks.push({name:`${mode}-shared-blocked-local-allowed`,noArbitraryRuleWinner:true});await page.close();
 }
 {
  const page=await open();const initial=(await audit(page)).initial;await choose(page,[]);await dialog(page).getByRole('button',{name:'Appliquer à cette ligne',exact:true}).click();onlyKinds(initial,await current(page),[]);await dialog(page).getByRole('button',{name:'Annuler l’application',exact:true}).click();assert.deepEqual(await current(page),initial);await noWrites(page);
  checks.push({name:'empty-local-recipe-preserves-semainier-and-source',explicitEmptyRecipe:true});await page.close();
 }
 {
  const page=await open();const initial=(await audit(page)).initial;await choose(page,['event']);await dialog(page).getByRole('button',{name:'Appliquer à cette ligne',exact:true}).click();await page.evaluate(()=>window.recipeEditorControl.patch(0,{time:'04:12:00',formats:['portrait']}));await dialog(page).getByRole('button',{name:'Annuler l’application',exact:true}).click();const expected=structuredClone(initial);expected.rows[0].time='04:12:00';expected.rows[0].formats=['portrait'];assert.deepEqual(await current(page),expected);await noWrites(page);
  checks.push({name:'undo-preserves-subsequent-unrelated-edits',manualTimeAndFormatRetained:true});await page.close();
 }
 {
  const page=await open({role:'admin',observation:true});await expect(dialog(page).getByRole('checkbox',{name:'Événement',exact:true})).toBeChecked();await expect(dialog(page)).toContainText('Choix observés : Événement');await choose(page,['tds']);await prepare(page);await expect(dialog(page)).toContainText('3 confirmations concernent seulement les choix observés d’origine');await noWrites(page);await confirm(page);await expect.poll(async()=>(await audit(page)).writes.length).toBe(1);await expect(dialog(page)).toContainText('Les observations d’habitude restent inchangées');assert.deepEqual((await audit(page)).writes[0].data.kinds,['tds']);assert.deepEqual((await audit(page)).changes,[]);
  checks.push({name:'edited-observation-is-separate-manual-rule',originalEvidenceNotRewritten:true});await page.close();
 }
 for(const observation of ['linked-current','linked-changed','linked-pending']){
  const page=await open({role:'admin',mode:'exact',observation,hold:'get'});await expect.poll(async()=>(await audit(page)).reads.some(read=>read.kind==='get'&&!read.settled)).toBe(true);await choose(page,['popup']);await page.evaluate(()=>window.recipeEditorControl.release('get'));
  await expect(dialog(page)).toContainText(observation==='linked-current'?'Règle liée actuelle · r4':'Règle modifiée manuellement · r4');await expect(dialog(page)).toContainText('décision r2');await expect(dialog(page)).toContainText(observation==='linked-pending'?'Cette proposition affichée n’est pas approuvée.':'L’approbation concerne les choix observés, pas vos modifications.');await expect(dialog(page).getByRole('checkbox',{name:'Pop-up',exact:true})).toBeChecked();await expect(dialog(page).getByRole('checkbox',{name:'Événement',exact:true})).not.toBeChecked();await noWrites(page);await capture(page,`observation-${observation}`);
  if(observation==='linked-current'){await prepare(page);await confirm(page);await expect.poll(async()=>(await audit(page)).writes.length).toBe(1);await expect(dialog(page)).toContainText('Règle modifiée manuellement · r5');}
  checks.push({name:`observation-${observation}`,decisionAndRuleRevisionsDistinct:true,lateOriginReadKeepsManualTypes:true,noFalseApproval:true});await page.close();
 }
 {
  const page=await open({role:'admin',mode:'exact'});await choose(page,['event']);await prepare(page);await page.evaluate(()=>window.recipeEditorControl.revise());await confirm(page);await expect(dialog(page).getByRole('alert')).toContainText('changé pendant votre revue');await noWrites(page);
  checks.push({name:'server-revision-changed-after-review-blocks-before-write',manualChoicesRetained:true});await page.close();
 }
 {
  const page=await open({role:'admin'});await choose(page,['event']);await prepare(page);await page.evaluate(()=>window.recipeEditorControl.patch(0,{kinds:['renvoi']}));await expect(dialog(page).getByRole('button',{name:'Mémoriser pour l’équipe',exact:true})).toBeDisabled();await noWrites(page);assert.deepEqual((await current(page)).rows[0].kinds,['renvoi']);
  checks.push({name:'row-edited-after-review-blocks-confirmation',noOverwrite:true});await page.close();
 }
 {
  const page=await open({role:'admin'});await choose(page,['event']);await prepare(page);await page.evaluate(()=>window.recipeEditorControl.hold('rules'));await confirm(page);const before=(await audit(page)).reads.length;await expect.poll(async()=>(await audit(page)).reads.filter(read=>!read.settled).length).toBe(1);await page.evaluate(()=>window.recipeEditorControl.patch(0,{kinds:['renvoi']}));await expect.poll(async()=>(await current(page)).rows[0].kinds).toEqual(['renvoi']);await page.evaluate(()=>window.recipeEditorControl.release('rules'));await expect(dialog(page).getByRole('alert')).toContainText('La ligne a changé pendant votre revue');assert.ok((await audit(page)).reads.length>=before);await noWrites(page);
  checks.push({name:'row-edited-during-final-read-blocks-write',finalSnapshotRechecked:true});await page.close();
 }
 {
  const page=await open({mode:'exact',hold:'rules'});await choose(page,['event']);await page.evaluate(()=>window.recipeEditorControl.release('rules'));await expect(dialog(page).getByText('Règle de ce titre / épisode · r4',{exact:true})).toBeVisible();await expect(dialog(page).getByRole('checkbox',{name:'Événement',exact:true})).toBeChecked();await expect(dialog(page).getByRole('checkbox',{name:'Tout de suite',exact:true})).not.toBeChecked();await noWrites(page);
  checks.push({name:'late-initial-rule-does-not-replace-manual-types',manualChoiceWins:true});await page.close();
 }
 {
  const page=await open({mode:'exact',hold:'rules'});await dialog(page).getByRole('combobox',{name:'Programme / épisode',exact:true}).selectOption('occurrence:2/épisode');await choose(page,['renvoi']);await page.evaluate(()=>window.recipeEditorControl.release('rules'));await expect(dialog(page).getByRole('combobox',{name:'Programme / épisode',exact:true})).toHaveValue('occurrence:2/épisode');await expect(dialog(page).getByRole('checkbox',{name:'Renvoi',exact:true})).toBeChecked();await expect(dialog(page).getByRole('checkbox',{name:'Tout de suite',exact:true})).not.toBeChecked();assert.ok((await audit(page)).reads.some(read=>read.aborted));await noWrites(page);
  checks.push({name:'row-selection-discards-old-late-catalogue',noOldProposalApplied:true});await page.close();
 }
 for(const mode of ['channel','unmount','context']){
  const page=await open({role:'admin',hold:'rules'});await expect.poll(async()=>(await audit(page)).reads.length).toBe(1);await page.evaluate(mode=>mode==='channel'?window.recipeEditorControl.channel():mode==='context'?window.recipeEditorControl.context():window.recipeEditorControl.mount(false),mode);if(mode==='context')await expect.poll(async()=>(await current(page)).sourceHash).toBe('d'.repeat(64));await page.evaluate(()=>window.recipeEditorControl.release('rules'));await expect.poll(async()=>(await audit(page)).reads.every(read=>read.settled)).toBe(true);
  if(mode!=='unmount'){await expect(dialog(page).getByRole('button',{name:'Appliquer à cette ligne',exact:true})).toBeDisabled();await expect(dialog(page).getByRole('button',{name:'Préparer la mémorisation',exact:true})).toBeDisabled();}else await expect(dialog(page)).toHaveCount(0);await noWrites(page);assert.deepEqual((await audit(page)).changes,[]);
  checks.push({name:`${mode}-blocks-late-recipe-read`,noStaleWriteOrApply:true});await page.close();
 }
 {
  const page=await open({role:'admin',readError:503});await expect(dialog(page).getByRole('alert')).toContainText('Lecture des recettes indisponible');await expect(dialog(page).getByRole('button',{name:'Préparer la mémorisation',exact:true})).toBeDisabled();await choose(page,['event']);await page.evaluate(()=>window.recipeEditorControl.readFailure(0));await dialog(page).getByRole('button',{name:'Relire les recettes',exact:true}).click();await expect(dialog(page).getByRole('button',{name:'Préparer la mémorisation',exact:true})).toBeEnabled();await expect(dialog(page).getByRole('checkbox',{name:'Événement',exact:true})).toBeChecked();await noWrites(page);
  checks.push({name:'read-error-is-explicit-and-retry-keeps-types',notFalseEmptySuccess:true});await page.close();
 }
 {
  const page=await open({role:'admin',mode:'exact'});await choose(page,['event']);await prepare(page);await page.evaluate(()=>window.recipeEditorControl.writeFailure('lost'));await confirm(page);await expect(dialog(page).getByRole('alert')).toContainText('pas confirmée');await expect(dialog(page).getByRole('button',{name:'Préparer la mémorisation',exact:true})).toBeDisabled();assert.equal((await audit(page)).attempts.length,1);assert.equal((await audit(page)).writes.length,1);await expect(dialog(page).getByText(/Règle manuelle enregistrée/)).toHaveCount(0);
  await page.evaluate(()=>window.recipeEditorControl.writeFailure(''));await dialog(page).getByRole('button',{name:'Relire les recettes',exact:true}).click();await expect(dialog(page).getByRole('button',{name:'Préparer la mémorisation',exact:true})).toBeEnabled();assert.equal((await audit(page)).attempts.length,1);await dialog(page).getByRole('button',{name:'Préparer la mémorisation',exact:true}).click();await expect(dialog(page)).toContainText('Ces choix sont déjà mémorisés dans la règle r5. Aucun nouvel enregistrement n’est nécessaire.');await expect(dialog(page).getByRole('button',{name:'Mémoriser pour l’équipe',exact:true})).toHaveCount(0);const evidence=await audit(page);assert.equal(evidence.writes.length,1);assert.deepEqual(evidence.attempts.map(write=>[write.id,write.revision]),[[id(1),4]]);assert.equal((await page.evaluate(()=>window.recipeEditorControl.saved())).length,1);
  checks.push({name:'lost-write-fresh-read-recognizes-committed-rule',noAutomaticRetry:true,noSecondWriteOrReview:true,sameRuleNoDuplicate:true});await page.close();
 }
 {
  const page=await open({role:'admin'});await choose(page,['event']);await prepare(page);await dialog(page).getByRole('button',{name:'Revenir aux choix',exact:true}).click();await expect(dialog(page).getByRole('heading',{name:'Adapter une recette',exact:true})).toBeVisible();await noWrites(page);await page.keyboard.press('Escape');await expect(dialog(page)).toHaveCount(0);assert.deepEqual(await current(page),(await audit(page)).initial);assert.deepEqual((await audit(page)).changes,[]);assert.equal((await audit(page)).closed,1);
  checks.push({name:'cancel-final-review-and-escape-keep-preparation-intact',noWritesOrApplication:true});await page.close();
 }
 {
  const page=await open({role:'admin',mode:'exact',habits:true}),transport=habitTransports.get(page),original=structuredClone(transport.suggestion),initial=(await audit(page)).initial;await noWrites(page);await expect(dialog(page)).toHaveCount(0);
  await page.getByRole('button',{name:'Adapter cette proposition',exact:true}).click();await expect(dialog(page).getByRole('heading',{name:'Adapter une recette',exact:true})).toBeVisible();await expect(dialog(page)).toContainText('Règle modifiée manuellement · r4');await choose(page,['popup']);await prepare(page);await confirm(page);await expect.poll(async()=>(await audit(page)).writes.length).toBe(1);await expect(dialog(page)).toContainText('Règle modifiée manuellement · r5');await page.keyboard.press('Escape');await expect(dialog(page)).toHaveCount(0);
  assert.deepEqual(transport.suggestion,original);assert.equal(transport.calls.filter(call=>call.method!=='GET').length,0);assert.deepEqual(await current(page),initial);await expect(page.locator('.planner-habits')).toContainText('À examiner');await expect(page.locator('.planner-habits')).toContainText('Événement');await capture(page,'habits-adapted-dark-1366');
  checks.push({name:'habits-entry-opens-real-editor-with-unmodified-observation',explicitSeparateRuleWrite:true,noApprovalOrCandidateRewrite:true,planUnchanged:true});await page.close();
 }
 for(const transition of ['unmount','channel']){
  const page=await open({role:'admin',mode:'exact',habits:true}),transport=habitTransports.get(page);transport.hold=true;await page.getByRole('button',{name:'Approuver',exact:true}).click();await expect.poll(()=>transport.calls.filter(call=>call.method==='POST').length).toBe(1);const post=transport.calls.find(call=>call.method==='POST');assert.equal(post.channel,'benin-tv');assert.deepEqual(post.body,{programme:transport.suggestion.programme,candidate:transport.suggestion.candidate,revision:2,action:'approve'});
  await page.evaluate(transition=>transition==='channel'?window.recipeEditorControl.channel():window.recipeEditorControl.mount(false),transition);
  if(transition==='unmount')await expect(page.locator('.planner-habits')).toHaveCount(0);else await expect(page.locator('.planner-habits')).toContainText('Aucune habitude à proposer');
  const count=transport.calls.length;transport.release();await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,150)));assert.equal(transport.calls.length,count,'Late write acknowledgement must not refresh the new channel or unmounted view');await expect(page.getByText('Observation approuvée. Les prochaines préparations proposeront cette recette.',{exact:true})).toHaveCount(0);assert.equal(transport.calls.filter(call=>call.method==='POST').length,1);await noWrites(page);
  checks.push({name:`habits-pending-mutation-${transition}-no-late-refresh`,oneOriginalChannelRequest:true,noFalseSuccessOrCrossChannelRefresh:true});await page.close();
 }
}catch(error){errors.push(error.stack||String(error));throw error;}
finally{
 const report={scope:'Real PlannerRecipeEditor and PlannerHabits, synthetic complete Plan rows, in-memory rules/get/save transports and intercepted habits HTTP responses. No real account, backend authorization, server persistence, disk access, media decoding, generation, export or production deployment. Browser checks exercise local UI/revision contracts only.',checks,errors,unexpectedRequests};await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));for(const context of contexts)await context.close();await browser.close();console.log(JSON.stringify({checks:checks.length,errors,unexpectedRequests},null,2));
}
assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
