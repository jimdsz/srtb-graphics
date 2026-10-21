import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv.find(value=>/^https?:/.test(value))||'http://127.0.0.1:5221';
const directory=resolve('reports/export-queue-panel'),checks=[],errors=[],unexpectedRequests=[],contexts=[];
const storeModule='export const exportQueue=window.exportQueuePanelStore;';
const panel=page=>page.getByRole('region',{name:'File d’exports',exact:true});
const trigger=page=>page.getByRole('button',{name:/^Exports · \d+ dans la file$/});
const close=page=>panel(page).getByRole('button',{name:'Fermer la file d’exports',exact:true});
const audit=page=>page.evaluate(()=>structuredClone(window.exportQueuePanelEvidence));
const state=page=>page.evaluate(()=>window.exportQueuePanelControl.snapshot());
const seed=(page,mode)=>page.evaluate(mode=>window.exportQueuePanelControl.seed(mode),mode);
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
async function open({width=1366,height=768,theme='dark',syntheticReview=false}={}){
 const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',acceptDownloads:true});contexts.push(context);
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  window.exportQueuePanelTransportReady=true;
  window.exportQueuePanelMediaEvidence={play:0,load:0,decoders:0};
  for(const method of ['play','load']){const original=HTMLMediaElement.prototype[method];HTMLMediaElement.prototype[method]=function(...args){window.exportQueuePanelMediaEvidence[method]++;return original.apply(this,args);};}
  if(window.VideoDecoder){const Original=window.VideoDecoder;window.VideoDecoder=new Proxy(Original,{construct(target,args){window.exportQueuePanelMediaEvidence.decoders++;return Reflect.construct(target,args);}});}
 });
 await page.route('**/*',route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===base&&url.pathname==='/src/studio/export-queue.ts')return route.fulfill({status:200,contentType:'application/javascript',body:storeModule});
  if(syntheticReview&&url.origin===base&&url.pathname==='/src/studio/ExportReview.tsx')return route.fulfill({status:200,contentType:'application/javascript',body:'export default window.exportQueuePanelReview;'});
  if(url.origin!==base||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method())||/\/(?:ExportReview\.tsx|video\/export\.|mediabunny|prores)/i.test(url.pathname)){
   unexpectedRequests.push({path:url.pathname,method:request.method()});return route.abort();
  }
  return route.continue();
 });
 await page.goto(`${base}/tests/export-queue-panel.html`);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await expect(trigger(page)).toBeVisible();await expect(page.locator('vite-error-overlay')).toHaveCount(0);await expect(panel(page)).toHaveCount(0);return page;
}
async function noMedia(page){
 await expect(page.locator('video,audio,img,canvas,iframe')).toHaveCount(0);
 assert.deepEqual(await page.evaluate(()=>window.exportQueuePanelMediaEvidence),{play:0,load:0,decoders:0});
}
async function untouched(page){assert.deepEqual((await audit(page)).calls,[]);assert.deepEqual((await audit(page)).downloads,[]);await noMedia(page);}
async function capture(page,name){
 await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});
 const geometry=await panel(page).evaluate(node=>{const box=node.getBoundingClientRect();return {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height,overflow:node.scrollWidth>node.clientWidth+1,viewportWidth:innerWidth,viewportHeight:innerHeight};});
 assert.ok(geometry.left>=-1&&geometry.top>=-1&&geometry.right<=geometry.viewportWidth+1&&geometry.bottom<=geometry.viewportHeight+1,`${name}: panel inside viewport`);assert.equal(geometry.overflow,false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);return geometry;
}
async function row(page,status){const item=(await state(page)).items.find(item=>item.status===status);assert.ok(item,`Synthetic ${status} row exists`);return panel(page).getByRole('listitem').filter({hasText:item.title});}
async function show(page){await trigger(page).focus();await page.keyboard.press('Enter');await expect(panel(page)).toBeVisible();await expect(panel(page).getByRole('heading',{name:'File d’exports',exact:true})).toBeFocused();}
try{
 const smoke=await open();await show(smoke);await expect(panel(smoke)).toContainText(/aucun|vide/i);await untouched(smoke);await capture(smoke,'smoke-empty-dark-1366');checks.push({name:'dev-server-smoke',realPanel:true,storeOnlyIntercepted:true});await smoke.close();
 if(!process.argv.includes('--smoke')){
  for(const [width,height,label] of [[1366,768,'1366'],[390,844,'390'],[683,384,'reflow-200']])for(const theme of ['dark','light']){
   const page=await open({width,height,theme});await seed(page,'mixed');await expect(trigger(page)).toHaveAttribute('aria-label','Exports · 6 dans la file');await expect(panel(page)).toHaveCount(0);await untouched(page);
   await show(page);await expect(panel(page)).not.toHaveAttribute('aria-modal','true');await expect(page.locator('[inert],dialog[open]')).toHaveCount(0);await expect(panel(page).getByRole('listitem')).toHaveCount(6);
   for(const status of ['pending','checking','rendering','completed','failed','cancelled'])await expect(await row(page,status)).toHaveCount(1);
   const completed=await row(page,'completed');await expect(completed.getByRole('link',{name:/Télécharger/})).toHaveCount(1);await expect(completed.getByRole('button',{name:/Contrôler/})).toBeDisabled();
   await page.evaluate(()=>window.exportQueuePanelControl.setRunning(false));await expect(completed.getByRole('button',{name:/Contrôler/})).toBeEnabled();await untouched(page);
   const geometry=await capture(page,`mixed-${theme}-${label}`);await close(page).click();await expect(panel(page)).toHaveCount(0);await expect(trigger(page)).toBeFocused();await untouched(page);
   checks.push({name:`six-states-${theme}-${label}`,geometry,noAutoOpenOrMedia:true,nonModal:true,reflowOnly:label==='reflow-200'});await page.close();
  }
  {
   const page=await open();await seed(page,'pending');await show(page);await expect(panel(page)).toBeVisible();await close(page).focus();await page.keyboard.press('Escape');await expect(panel(page)).toHaveCount(0);await expect(trigger(page)).toBeFocused();
   const eventTrigger=page.getByRole('button',{name:'Ouvrir depuis l’éditeur',exact:true});await eventTrigger.focus();await page.keyboard.press('Enter');await expect(panel(page)).toBeVisible();await close(page).click();await expect(eventTrigger).toBeFocused();
   await show(page);const outside=page.getByRole('textbox',{name:'Titre de travail',exact:true});await outside.click();await outside.fill('Retouche conservée pendant les exports');await expect(outside).toHaveValue('Retouche conservée pendant les exports');await expect(panel(page)).toBeVisible();await page.keyboard.press('Escape');await expect(panel(page)).toHaveCount(0);await expect(outside).toBeFocused();await expect(outside).toHaveValue('Retouche conservée pendant les exports');await untouched(page);
   await show(page);await panel(page).locator('.export-queue-origin>summary').last().focus();await page.keyboard.press('Tab');if(await page.evaluate(()=>document.activeElement===document.body))await page.keyboard.press('Tab');await expect(outside).toBeFocused();await untouched(page);
   checks.push({name:'manual-event-escape-focus-and-editable-background',outsideEditIntact:true});await page.close();
  }
  {
   const page=await open();await seed(page,'pending');await show(page);const item=(await state(page)).items[0];await page.evaluate(id=>window.exportQueuePanelControl.status(id,'rendering'),item.id);await page.evaluate(id=>window.exportQueuePanelControl.progress(id,72),item.id);await expect(await row(page,'rendering')).toContainText('72');await close(page).click();await page.evaluate(id=>window.exportQueuePanelControl.status(id,'completed'),item.id);await expect(panel(page)).toHaveCount(0);await untouched(page);
   checks.push({name:'store-updates-render-but-never-reopen-panel'});await page.close();
  }
  {
   const page=await open();await seed(page,'completed');await show(page);await untouched(page);const item=(await state(page)).items[0],link=(await row(page,'completed')).getByRole('link',{name:/Télécharger/});await expect(link).toHaveAttribute('download',item.result.filename);
   const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);assert.equal(download.suggestedFilename(),item.result.filename);assert.deepEqual((await audit(page)).downloads,[item.result.filename]);assert.deepEqual((await audit(page)).calls,[]);await noMedia(page);assert.equal((await state(page)).items.length,1);
   checks.push({name:'download-only-after-explicit-click',syntheticBytesOnly:true,noRemovalOrPreview:true});await page.close();
  }
  for(const [status,action,label] of [['pending','cancel','Annuler'],['failed','retry','Réessayer'],['cancelled','retry','Réessayer'],['completed','remove','Retirer']]){
   const page=await open();await seed(page,status==='pending'?'pending':'terminal');await show(page);const item=(await state(page)).items.find(item=>item.status===status);await untouched(page);await (await row(page,status)).getByRole('button',{name:label,exact:true}).click();await expect.poll(async()=>(await audit(page)).calls).toEqual([{action,id:item.id}]);if(action==='remove')assert.equal((await state(page)).items.some(value=>value.id===item.id),false);else assert.equal((await state(page)).items.find(value=>value.id===item.id).status,action==='cancel'?'cancelled':'pending');await noMedia(page);assert.deepEqual((await audit(page)).downloads,[]);
   if(action==='remove')await expect(panel(page).getByRole('heading',{name:'File d’exports',exact:true})).toBeFocused();else await expect((await row(page,action==='cancel'?'cancelled':'pending')).getByRole('button',{name:action==='cancel'?'Réessayer':'Annuler',exact:true})).toBeFocused();
   checks.push({name:`explicit-${action}-${status}`,exactJobOnly:true,focusSurvivesActionReplacement:true});await page.close();
  }
  {
   const page=await open();await seed(page,'completed');await show(page);const before=await state(page);await page.evaluate(()=>window.exportQueuePanelControl.failNext('remove'));await (await row(page,'completed')).getByRole('button',{name:'Retirer',exact:true}).click();await expect(panel(page).getByRole('alert')).toContainText('Action fictive refusée');assert.deepEqual(await state(page),before);assert.equal((await audit(page)).calls.length,1);await noMedia(page);
   checks.push({name:'remove-failure-keeps-file-and-reports-error',noAutomaticRetry:true});await page.close();
  }
  {
   const page=await open();await seed(page,'completed');await show(page);await page.evaluate(()=>window.exportQueuePanelControl.holdRemoval());const remove=(await row(page,'completed')).getByRole('button',{name:'Retirer',exact:true});await remove.click();await expect(remove).toBeDisabled();const outside=page.getByRole('textbox',{name:'Titre de travail',exact:true});await outside.click();await outside.fill('Retouche pendant le retrait');await page.evaluate(()=>window.exportQueuePanelControl.releaseRemoval());await expect(panel(page).getByRole('listitem')).toHaveCount(0);await expect(outside).toBeFocused();await expect(outside).toHaveValue('Retouche pendant le retrait');assert.equal((await audit(page)).calls.length,1);await noMedia(page);
   checks.push({name:'late-remove-keeps-focus-and-edits-outside',singleAction:true});await page.close();
  }
  {
   const page=await open({width:390,height:844,theme:'light'});await seed(page,'completed');await show(page);await expect(page.getByRole('region',{name:'Rapport du fichier exporté',exact:true})).toHaveCount(0);await (await row(page,'completed')).locator('.export-queue-report>summary').click();const report=page.getByRole('region',{name:'Rapport du fichier exporté',exact:true});await expect(report).toBeVisible();await expect(report).toContainText('10.00 s');await expect(report).toContainText('250');await expect(report).toContainText('ProRes 4444');await expect(report).toContainText('3 images échantillonnées');await untouched(page);await capture(page,'report-light-390');
   checks.push({name:'explicit-report-real-component-lazy-loaded',noRenderOrDecode:true});await page.close();
  }
  {
   const page=await open({syntheticReview:true});await seed(page,'completed');await show(page);const review=page.getByRole('region',{name:'Contrôle synthétique sans décodage',exact:true});await expect(review).toHaveCount(0);assert.equal((await audit(page)).reviewMounts,0);await (await row(page,'completed')).getByRole('button',{name:'Contrôler le fichier',exact:true}).click();await expect(review).toBeVisible();assert.equal((await audit(page)).reviewMounts,1);await noMedia(page);
   await page.evaluate(()=>window.exportQueuePanelControl.setRunning(true));await expect(review).toHaveCount(0);await expect.poll(async()=>(await audit(page)).reviewDisposals).toBe(1);await expect((await row(page,'completed')).getByRole('button',{name:'Contrôler le fichier',exact:true})).toBeDisabled();await page.evaluate(()=>window.exportQueuePanelControl.setRunning(false));await expect(review).toHaveCount(0);await (await row(page,'completed')).getByRole('button',{name:'Contrôler le fichier',exact:true}).click();await expect(review).toBeVisible();await close(page).click();await expect(review).toHaveCount(0);await expect.poll(async()=>(await audit(page)).reviewDisposals).toBe(2);await show(page);await expect(review).toHaveCount(0);await untouched(page);
   checks.push({name:'explicit-review-closes-on-global-work-or-panel-close',reviewOnlySynthetic:true,noDecodingClaim:true});await page.close();
  }
  {
   const page=await open();await seed(page,'pending');await show(page);await page.evaluate(()=>{const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Dialogue prioritaire de recette');const input=document.createElement('input');input.setAttribute('aria-label','Champ du dialogue prioritaire');dialog.append(input);document.body.append(dialog);dialog.showModal();});await expect(page.getByRole('dialog',{name:'Dialogue prioritaire de recette'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Dialogue prioritaire de recette'})).not.toBeVisible();await expect(panel(page)).toBeVisible();await untouched(page);
   checks.push({name:'escape-respects-another-native-modal-dialog'});await page.close();
  }
  {
   const page=await open();await seed(page,'terminal');await show(page);await page.evaluate(()=>window.exportQueuePanelControl.unmount());await expect(panel(page)).toHaveCount(0);await expect.poll(async()=>(await audit(page)).unsubscriptions).toBeGreaterThan(0);await page.evaluate(()=>window.exportQueuePanelControl.open());await expect(panel(page)).toHaveCount(0);await page.evaluate(()=>window.exportQueuePanelControl.mount());await expect(trigger(page)).toBeVisible();await expect(panel(page)).toHaveCount(0);await untouched(page);
   checks.push({name:'unmount-unsubscribes-and-event-does-not-revive-panel'});await page.close();
  }
 }
}catch(error){errors.push(error.stack||String(error));throw error;}
finally{
 await writeFile(resolve(directory,'report.json'),JSON.stringify({scope:'Real ExportQueuePanel and ExportReport; only store replaced by synthetic stable snapshots and action spies. One explicitly named review-lifecycle scenario additionally intercepts ExportReview with a synthetic component, not a decoder test. No renderer, real media, account, project, upload or production action. Synthetic download only after a user click. 683×384 CSS viewport represents the available reflow area of 1366×768 at 200%; not native browser zoom.',checks,errors,unexpectedRequests},null,2));for(const context of contexts)await context.close();await browser.close();console.log(JSON.stringify({checks:checks.length,errors,unexpectedRequests},null,2));
}
assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
