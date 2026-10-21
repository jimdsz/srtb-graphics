import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import XLSX from 'xlsx';

const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/planner-local-recovery');
const checks=[],errors=[],unexpectedRequests=[],contrastChecks=[];
const id=number=>`77777777-7777-4777-8777-${String(number).padStart(12,'0')}`;
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const contexts=[];
const audit=page=>page.evaluate(()=>structuredClone(window.plannerLocalEvidence));
const drafts=page=>page.evaluate(()=>window.plannerLocalControl.list());
const copies=page=>page.locator('details').filter({has:page.locator('summary').filter({hasText:'Copies sur ce poste'})});
const inspector=page=>page.locator('dialog[aria-labelledby="planner-inspector-title"]');
async function open({width=1366,theme='dark',seed='',server=0,context,probe=false}={}){
 const owner=context||await browser.newContext({viewport:{width,height:width===720?450:768},reducedMotion:'reduce'});if(!context)contexts.push(owner);
 const page=await owner.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===base&&url.pathname==='/api/graphics/habits'&&request.method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:'{"suggestions":[]}'});
  if(url.origin!==base||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method())){unexpectedRequests.push({url:url.href,method:request.method()});return route.abort();}
  return route.continue();
 });
 await page.goto(`${base}/tests/planner-local-recovery.html?${new URLSearchParams({seed,server:String(server),...(probe?{probe:'1'}:{})})}`);
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await expect(page.getByRole('heading',{name:'Recette des copies locales',exact:true})).toBeVisible();
 return page;
}
async function capture(page,name){
 await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: horizontal page overflow`);
 assert.equal(await page.locator('dialog[open]').evaluateAll(nodes=>nodes.some(node=>node.scrollWidth>node.clientWidth+1)),false,`${name}: horizontal dialog overflow`);
}
async function noAutomaticEffects(page){
 const evidence=await audit(page);assert.deepEqual(evidence.saveAttempts,[]);assert.equal(evidence.created,0);assert.equal(evidence.openedProjects,0);assert.equal(evidence.mediaReads,0);assert.equal(evidence.programmeReads,0);
 assert.equal(await page.locator('audio,video,img[src*="/media/"]').count(),0);
}
async function remount(page){await page.evaluate(()=>window.plannerLocalControl.mount(false));await expect(page.getByText('Préparation démontée pour la recette.',{exact:true})).toBeVisible();await page.evaluate(()=>window.plannerLocalControl.remount());}
async function recover(page){await expect(copies(page)).toBeVisible();await copies(page).getByRole('button',{name:'Reprendre',exact:true}).first().click();}
async function current(page,name='Retouches locales à reprendre',title='Titre retouché localement'){
 await expect(page.getByRole('textbox',{name:'Nom de la préparation',exact:true})).toHaveValue(name);
 if(title)await expect(page.getByRole('button',{name:`Préparer ${title}`,exact:true})).toBeVisible();
}
async function settled(page){await expect(page.getByText('Copie sur ce poste à jour',{exact:true})).toBeVisible();}
async function contrast(locator,label,{focus=false}={}){
 const result=await locator.evaluate((node,focus)=>{
  const rgba=value=>{const parts=value.match(/[\d.]+/g)?.map(Number)||[];if(parts.length<3)throw Error(`Couleur non RGB à examiner : ${value}`);return [parts[0],parts[1],parts[2],parts[3]??1];};
  const blend=(front,back)=>front.slice(0,3).map((channel,index)=>channel*front[3]+back[index]*(1-front[3]));
  const background=element=>{const chain=[];for(let current=element;current;current=current.parentElement)chain.unshift(current);return chain.reduce((color,current)=>blend(rgba(getComputedStyle(current).backgroundColor),color),[255,255,255]);};
  const luminance=color=>color.map(channel=>{const s=channel/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}).reduce((sum,channel,index)=>sum+channel*[.2126,.7152,.0722][index],0);
  const style=getComputedStyle(node),back=background(focus?node.parentElement:node),front=blend(rgba(focus?style.outlineColor:style.color),back),a=luminance(front),b=luminance(back);
  return {foreground:front,background:back,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),outline:focus?{width:style.outlineWidth,style:style.outlineStyle,visible:node.matches(':focus-visible')}:null};
 },focus);
 assert.ok(result.ratio>=(focus?3:4.5),`${label}: actual contrast ${result.ratio.toFixed(2)}:1`);
 if(focus){assert.equal(result.outline.visible,true,`${label}: focus-visible`);assert.ok(parseFloat(result.outline.width)>=2);assert.notEqual(result.outline.style,'none');}
 contrastChecks.push({label,...result});
}
async function edit(page,title){await page.getByRole('button',{name:'Préparer Titre retouché localement',exact:true}).click();await inspector(page).getByRole('textbox',{name:'Titre',exact:true}).fill(title);await page.keyboard.press('Escape');}
function workbook(){const sheet=XLSX.utils.aoa_to_sheet([['29 septembre 2026'],['Horaire','Description','Durée'],['20:30','Magazine : Import vraiment local / Épisode neuf','00:30']]);const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'29 septembre 2026');return XLSX.write(book,{type:'buffer',bookType:'xlsx'});}

try{
 // Scenarios are added against the implemented UI contract below. Setup uses
 // the actual storage helper; no storage function is replaced by a module mock.
 for(const width of [1366,720,320])for(const theme of ['dark','light']){
  const page=await open({width,theme,seed:'shared'});await expect(copies(page)).toBeVisible();await capture(page,`available-${theme}-${width}`);
  await contrast(copies(page).locator(':scope>summary'),`${theme}-${width}: summary`);await contrast(copies(page).locator('.planner-local-body>p').first(),`${theme}-${width}: explanation`);await contrast(copies(page).locator('.planner-local-list>li>div>span').first(),`${theme}-${width}: metadata`);
  await page.keyboard.press('Tab');await copies(page).locator(':scope>summary').focus();await contrast(copies(page).locator(':scope>summary'),`${theme}-${width}: summary focus`,{focus:true});
  await noAutomaticEffects(page);assert.deepEqual((await audit(page)).reads,[],'No server reread before a restore action');
  await copies(page).getByRole('button',{name:'Reprendre',exact:true}).first().focus();await contrast(copies(page).getByRole('button',{name:'Reprendre',exact:true}).first(),`${theme}-${width}: restore focus`,{focus:true});await page.keyboard.press('Enter');await current(page);await settled(page);await contrast(page.locator('.planner-local-status>span').first(),`${theme}-${width}: saved status`);
  const evidence=await audit(page);assert.deepEqual(evidence.reads.map(read=>read.kind).sort(),['get','tasks']);
  await page.getByRole('button',{name:'Préparer Titre retouché localement',exact:true}).click();
  await expect(inspector(page).getByRole('heading',{name:'Dossier de production',exact:true})).toBeVisible();await expect(inspector(page).getByText('Projet déjà lié',{exact:true})).toBeVisible();
  await capture(page,`restored-${theme}-${width}`);await page.keyboard.press('Escape');await noAutomaticEffects(page);
  checks.push({name:`shared-${theme}-${width}`,realIndexedDB:true,explicitKeyboardRestore:true,serverReadBeforeRestore:true,existingTaskRetained:true});await page.close();
 }
 {
  const page=await open({seed:'new',server:503});await recover(page);await current(page,'Import local à reprendre');await settled(page);
  assert.deepEqual((await audit(page)).reads,[]);await noAutomaticEffects(page);await remount(page);await recover(page);await current(page,'Import local à reprendre');
  checks.push({name:'unshared-restores-with-server-unavailable',realIndexedDB:true,noServerRead:true,noMediaReconnection:true});await page.close();
 }
 {
  const page=await open({server:503});
  await page.getByLabel('Importer un Excel ou PDF',{exact:true}).setInputFiles({name:'conducteur-synthetique-2026.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook()});
  await expect(page.getByRole('heading',{name:'Choisir la bonne semaine',exact:true})).toBeVisible();
  await page.locator('.planner-sheet-list input[type="checkbox"]').first().check();await page.getByRole('checkbox',{name:'J’ai vérifié les onglets et les dates sélectionnés',exact:true}).check();await page.getByRole('button',{name:'Préparer ma liste',exact:true}).click();
  await expect(page.getByRole('button',{name:'Préparer Import vraiment local',exact:true})).toBeVisible();await settled(page);
  await page.getByRole('textbox',{name:'Nom de la préparation',exact:true}).fill('Import hors réseau serveur');await settled(page);
  assert.equal((await drafts(page)).some(draft=>draft.base===null&&draft.plan.name==='Import hors réseau serveur'),true);
  await remount(page);await recover(page);await current(page,'Import hors réseau serveur','Import vraiment local');await noAutomaticEffects(page);
  checks.push({name:'real-xlsx-import-durable-and-restored',actualLocalParser:true,realIndexedDB:true,serverUnavailable:true,noSharedSave:true});await page.close();
 }
 {
  const page=await open({seed:'shared'});await recover(page);await current(page);await page.getByRole('textbox',{name:'Nom de la préparation',exact:true}).fill('');await edit(page,'');await settled(page);
  assert.equal((await drafts(page)).some(draft=>draft.plan.name===''&&draft.plan.rows[0].title===''),true);
  await remount(page);await expect(copies(page).getByText('Préparation sans titre',{exact:true})).toBeVisible();
  // Most recent empty draft is first, not the preserved source recovery copy.
  await recover(page);await current(page,'','');await page.locator('.planner-row .planner-item-open').click();
  await expect(inspector(page).getByRole('textbox',{name:'Titre',exact:true})).toHaveValue('');await noAutomaticEffects(page);
  checks.push({name:'unfinished-empty-name-and-title-preserved',noFallbackOverwrite:true,noAutomaticServerValidation:true});await page.close();
 }
 {
  const page=await open({seed:'shared'});await page.evaluate(()=>window.plannerLocalControl.revision(5));await recover(page);
  const copy=page.getByRole('button',{name:'Créer une copie indépendante',exact:true});await expect(copy).toBeVisible();await expect(page.getByRole('textbox',{name:'Nom de la préparation',exact:true})).toHaveCount(0);await noAutomaticEffects(page);
  await copy.click();await current(page);await settled(page);
  const independent=(await drafts(page)).find(draft=>draft.base===null);assert.ok(independent);assert.notEqual(independent.draftId,id(1));
  await page.getByRole('button',{name:'Préparer Titre retouché localement',exact:true}).click();await expect(inspector(page).getByText('Projet déjà lié',{exact:true})).toHaveCount(0);await expect(inspector(page).getByText(/Aucun projet lié visible/)).toBeVisible();await page.keyboard.press('Escape');
  const evidence=await audit(page);assert.ok(evidence.reads.filter(read=>read.kind==='get').length>=2,'Independent copy reauthorizes access');await noAutomaticEffects(page);
  checks.push({name:'changed-revision-requires-independent-copy',explicitChoice:true,newDraftId:true,noInheritedTasks:true,accessRechecked:true});await page.close();
 }
 for(const status of [401,403]){
  const page=await open({seed:'shared'});await page.evaluate(status=>window.plannerLocalControl.server(status),status);await recover(page);
  await expect(page.getByRole('alert').filter({hasText:/accès|autoris|connect|refus/i}).first()).toBeVisible();await expect(page.getByRole('textbox',{name:'Nom de la préparation',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Créer une copie indépendante',exact:true})).toHaveCount(0);
  assert.equal((await drafts(page)).length,1);await noAutomaticEffects(page);checks.push({name:`permission-${status}-blocks-all-restoration`,copyRetained:true,noIndependentBypass:true});await page.close();
 }
 {
  const page=await open({seed:'shared'});await page.evaluate(()=>window.plannerLocalControl.revision(4));await recover(page);
  await expect(page.getByRole('button',{name:'Créer une copie indépendante',exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Nom de la préparation',exact:true})).toHaveCount(0);await noAutomaticEffects(page);
  checks.push({name:'same-revision-different-server-data-is-conflict',noSilentOverwrite:true});await page.close();
 }
 {
  const page=await open({seed:'shared'});await page.evaluate(()=>window.plannerLocalControl.revision(5));await recover(page);await expect(page.getByRole('button',{name:'Créer une copie indépendante',exact:true})).toBeVisible();
  await page.evaluate(()=>window.plannerLocalControl.server(403));await page.getByRole('button',{name:'Créer une copie indépendante',exact:true}).click();await expect(page.getByRole('alert')).toContainText('droits');await expect(page.getByRole('textbox',{name:'Nom de la préparation',exact:true})).toHaveCount(0);assert.equal((await drafts(page)).length,1);await noAutomaticEffects(page);
  checks.push({name:'independent-copy-rechecks-permission',revokedAccessBlocksCopy:true});await page.close();
 }
 for(const failure of ['missing','archived']){
  const page=await open({seed:'shared'});await page.evaluate(failure=>failure==='missing'?window.plannerLocalControl.server(404):window.plannerLocalControl.archived(true),failure);await recover(page);
  await expect(page.getByText(/introuvable|retirée|archivée|absente|404/i).filter({visible:true}).first()).toBeVisible();await expect(page.getByRole('textbox',{name:'Nom de la préparation',exact:true})).toHaveCount(0);assert.equal((await drafts(page)).length,1);await noAutomaticEffects(page);
  checks.push({name:`shared-${failure}-is-not-silent-success`,localCopyRetained:true});await page.close();
 }
 for(const fault of ['quota','blocked']){
  const page=await open({seed:'shared'});await recover(page);await current(page);await settled(page);await page.evaluate(fault=>window.plannerLocalControl.fault(fault),fault);
  await edit(page,`Retouche malgré ${fault}`);await expect(page.getByText('Copie locale indisponible',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:`Préparer Retouche malgré ${fault}`,exact:true})).toBeVisible();
  await capture(page,`storage-${fault}`);await page.evaluate(()=>window.plannerLocalControl.fault(''));await page.getByRole('button',{name:'Réessayer la copie',exact:true}).click();await settled(page);
  assert.equal((await drafts(page)).some(draft=>draft.plan.rows[0].title===`Retouche malgré ${fault}`),true);await noAutomaticEffects(page);
  checks.push({name:`synthetic-${fault}-fault-keeps-edits-and-retries`,actualIndexedDBBeforeAndAfterFault:true,syntheticFaultOnly:true});await page.close();
 }
 {
  const page=await open({seed:'shared'});await recover(page);await current(page);await page.evaluate(()=>window.plannerLocalControl.fault('quota'));await edit(page,'Retouche enregistrée malgré quota');await expect(page.getByText('Copie locale indisponible',{exact:true})).toBeVisible();
  // Leave the quota fault active throughout the explicit shared save.
  await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Liste enregistrée et partagée.'})).toBeVisible();
  const evidence=await audit(page);assert.equal(evidence.saveAttempts.length,1);assert.equal(evidence.saves.length,1);assert.equal(evidence.saveAttempts[0].data.rows[0].title,'Retouche enregistrée malgré quota');await current(page,'Retouches locales à reprendre','Retouche enregistrée malgré quota');assert.equal(evidence.created,0);assert.equal(evidence.mediaReads,0);assert.equal(evidence.openedProjects,0);
  await page.evaluate(()=>window.plannerLocalControl.fault(''));checks.push({name:'active-quota-fault-does-not-block-explicit-shared-save',oneExplicitSave:true,latestEditsSubmitted:true,syntheticFaultOnly:true});await page.close();
 }
 {
  const page=await open({seed:'shared'});await recover(page);await current(page);await edit(page,'Retouche avant réponse perdue');await settled(page);await page.evaluate(()=>window.plannerLocalControl.lostSave(true));
  await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(page.getByRole('alert')).toContainText('perdue');
  const evidence=await audit(page);assert.equal(evidence.saveAttempts.length,1);assert.equal(evidence.saves.length,1);assert.equal((await drafts(page)).some(draft=>draft.plan.rows[0].title==='Retouche avant réponse perdue'),true);await expect(page.getByRole('button',{name:'Préparer Retouche avant réponse perdue',exact:true})).toBeVisible();
  checks.push({name:'lost-shared-save-ack-keeps-exact-local-copy',noAutomaticRetry:true});await page.close();
 }
 {
  const page=await open({seed:'shared'});await recover(page);await current(page);await page.getByRole('textbox',{name:'Nom de la préparation',exact:true}).fill('Retouche juste avant départ');
  // Do not wait for debounce: the guarded departure must flush this snapshot.
  await page.evaluate(()=>window.plannerLocalControl.leave());const guard=page.getByRole('dialog',{name:'Conserver votre préparation ?',exact:true});await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Continuer sans enregistrer',exact:true}).click();
  await expect(page.getByText('Préparation démontée pour la recette.',{exact:true})).toBeVisible();assert.equal((await drafts(page)).some(draft=>draft.plan.name==='Retouche juste avant départ'),true);await noAutomaticEffects(page);
  checks.push({name:'guarded-leave-flushes-pending-copy-without-sharing',noDebounceWait:true,noSharedSave:true});await page.close();
 }
 {
  const page=await open({seed:'shared'});await recover(page);await current(page);await settled(page);await copies(page).locator(':scope>summary').click();
  await copies(page).getByRole('button',{name:'Supprimer cette copie : Retouches locales à reprendre',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Supprimer cette copie locale ?',exact:true});await dialog.getByRole('button',{name:'Supprimer cette copie',exact:true}).click();await expect(dialog).toHaveCount(0);
  assert.deepEqual(await drafts(page),[]);await expect(page.getByText('Copie sur ce poste à jour',{exact:true})).toHaveCount(0);await current(page);
  await page.getByRole('textbox',{name:'Nom de la préparation',exact:true}).fill('Nouvelle retouche après suppression');await page.evaluate(()=>window.plannerLocalControl.leave());await page.getByRole('dialog',{name:'Conserver votre préparation ?',exact:true}).getByRole('button',{name:'Continuer sans enregistrer',exact:true}).click();await expect(page.getByText('Préparation démontée pour la recette.',{exact:true})).toBeVisible();
  const saved=await drafts(page);assert.equal(saved.length,1);assert.equal(saved[0].plan.name,'Nouvelle retouche après suppression');assert.notEqual(saved[0].id,id(10));await noAutomaticEffects(page);
  checks.push({name:'delete-current-receipt-then-edit-and-flush',noFalseSavedStatus:true,newDurableCopy:true});await page.close();
 }
 {
  const page=await open({probe:true});
  const result=await page.evaluate(async()=>{
   const run=async()=>{const receipts=[];for(let index=0;index<3;index++){const first=await window.plannerLocalProbe.flush();const second=await window.plannerLocalProbe.flush();await window.plannerLocalProbe.saved(second);receipts.push({first:first.sequence,second:second.sequence,count:(await window.plannerLocalControl.list()).length});}return receipts;};
   let timeout;try{return await Promise.race([run(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Deux flush successifs ne se terminent pas.')),8000);})]);}finally{clearTimeout(timeout);}
  });
  assert.equal(result.length,3);for(const cycle of result)assert.equal(cycle.count,0);await expect(page.getByLabel('Écritures du probe',{exact:true})).toHaveText('Terminées');assert.deepEqual(await drafts(page),[]);await noAutomaticEffects(page);
  checks.push({name:'real-hook-back-to-back-flush-save-removal',cycles:result,noStuckPromise:true,noResurrection:true,realIndexedDB:true});await page.close();
 }
 {
  const page=await open({seed:'shared'});await page.evaluate(()=>window.plannerLocalControl.hold());await recover(page);await expect.poll(async()=>(await audit(page)).reads.length).toBe(2);
  await page.getByRole('button',{name:'Annuler la vérification',exact:true}).click();await page.evaluate(()=>window.plannerLocalControl.release());
  await expect(page.getByRole('textbox',{name:'Nom de la préparation',exact:true})).toHaveCount(0);await expect.poll(async()=>(await audit(page)).reads.every(read=>read.settled)).toBe(true);assert.equal((await drafts(page)).length,1);await noAutomaticEffects(page);
  checks.push({name:'cancelled-restore-discards-late-server-replies',copyRetained:true});await page.close();
 }
 for(const kind of ['unmount','channel']){
  const page=await open({seed:'shared'});await page.evaluate(()=>window.plannerLocalControl.hold());await recover(page);await expect.poll(async()=>(await audit(page)).reads.length).toBe(2);
  await page.evaluate(kind=>kind==='unmount'?window.plannerLocalControl.mount(false):window.plannerLocalControl.channel('recette-autre-chaine'),kind);
  await page.evaluate(()=>window.plannerLocalControl.release());await expect.poll(async()=>(await audit(page)).reads.every(read=>read.settled)).toBe(true);
  await expect(page.getByRole('textbox',{name:'Nom de la préparation',exact:true})).toHaveCount(0);if(kind==='channel')assert.deepEqual(await drafts(page),[]);await noAutomaticEffects(page);
  checks.push({name:`${kind}-discards-late-restore`,noLatePlanPublished:true});await page.close();
 }
 {
  const page=await open({seed:'shared'}),other=await open({context:page.context()});await expect(copies(other).getByRole('button',{name:'Reprendre',exact:true})).toHaveCount(1);
  await recover(page);await recover(other);await current(page);await current(other);await edit(page,'Retouche onglet A');await edit(other,'Retouche onglet B');await page.getByRole('textbox',{name:'Nom de la préparation',exact:true}).fill('Copie onglet A');await other.getByRole('textbox',{name:'Nom de la préparation',exact:true}).fill('Copie onglet B');await settled(page);await settled(other);
  const local=await drafts(page),first=local.find(draft=>draft.plan.rows[0].title==='Retouche onglet A'),second=local.find(draft=>draft.plan.rows[0].title==='Retouche onglet B');assert.ok(first);assert.ok(second);assert.notEqual(first.id,second.id);assert.equal(first.draftId,second.draftId);
  await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Liste enregistrée et partagée.'})).toBeVisible();
  await expect.poll(async()=>(await drafts(other)).some(draft=>draft.id===first.id)).toBe(false);assert.equal((await drafts(other)).some(draft=>draft.id===second.id),true);await expect(other.getByRole('button',{name:'Préparer Retouche onglet B',exact:true})).toBeVisible();
  assert.deepEqual((await audit(other)).saveAttempts,[]);checks.push({name:'two-tabs-distinct-copy-ids-and-exact-save-removal',actualSharedIndexedDB:true,otherTabDraftIntact:true});
  await remount(other);await other.setViewportSize({width:320,height:768});await other.evaluate(()=>document.documentElement.dataset.theme='light');
  await copies(other).getByRole('button',{name:'Supprimer cette copie : Copie onglet B',exact:true}).click();
  const removal=other.getByRole('dialog',{name:'Supprimer cette copie locale ?',exact:true});await expect(removal).toBeVisible();await removal.getByRole('button',{name:'Conserver la copie',exact:true}).click();assert.equal((await drafts(other)).some(draft=>draft.id===second.id),true);
  const retainedIds=(await drafts(other)).filter(draft=>draft.id!==second.id).map(draft=>draft.id).sort();assert.ok(retainedIds.length);
  await copies(other).getByRole('button',{name:'Supprimer cette copie : Copie onglet B',exact:true}).click();await capture(other,'delete-light-320');await removal.getByRole('button',{name:'Supprimer cette copie',exact:true}).click();await expect(removal).toHaveCount(0);
  assert.deepEqual((await drafts(other)).map(draft=>draft.id).sort(),retainedIds);assert.deepEqual((await audit(other)).saveAttempts,[]);
  checks.push({name:'explicit-delete-cancel-then-one-exact-copy',allOtherCopiesIntact:true,noSharedWrite:true});await page.close();await other.close();
 }
}catch(error){errors.push(error.stack||String(error));throw error;}
finally{
 const report={scope:'Real DayPlanner, actual origin-scoped IndexedDB in isolated Edge contexts. Server transports are memory doubles; no real account, remote API, backend authorization, shared persistence, production mutation or deployment. Synthetic quota/blocked faults are identified per scenario. Server-unavailable restoration is not a claim that a Vite document can cold-load while the browser is fully offline. 720px checks CSS reflow, not native zoom. Contrast uses actual computed RGB foreground and alpha-composited ancestor backgrounds (these tested surfaces are solid colors), 4.5:1 for text and 3:1 for keyboard focus.',checks,contrastChecks,errors,unexpectedRequests};
 await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));for(const context of contexts)await context.close();await browser.close();
 console.log(JSON.stringify({checks:checks.length,errors,unexpectedRequests},null,2));
}
assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
