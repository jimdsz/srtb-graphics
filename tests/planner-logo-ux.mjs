import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/planner-logo');
const id=number=>`44444444-4444-4444-8444-${String(number).padStart(12,'0')}`;
const url=number=>`/api/graphics/media/${id(number)}/content`;
const checks=[],errors=[],unexpectedRequests=[];
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
// Browser-encoded synthetic test pixels give genuine PNG/JPEG/WebP bytes.
const pixelPage=await browser.newPage();
const encoded=await pixelPage.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;
  const context=canvas.getContext('2d');context.fillStyle='#007300';context.fillRect(0,0,96,64);context.fillStyle='#f0b900';context.fillRect(12,12,72,40);
  return Object.fromEntries(['image/png','image/jpeg','image/webp'].map(mime=>[mime,canvas.toDataURL(mime).split(',')[1]]));
});
await pixelPage.close();
const bytes=Object.fromEntries(Object.entries(encoded).map(([mime,data])=>[mime,Buffer.from(data,'base64')]));
const audit=page=>page.evaluate(()=>structuredClone(window.plannerLogoEvidence));
const confirmation=page=>page.getByRole('checkbox',{name:'J’ai vérifié ce logo pour cette émission.',exact:true});
const apply=page=>page.getByRole('button',{name:'Utiliser ce logo',exact:true});
const preview=page=>page.getByRole('img',{name:'Logo sélectionné',exact:true});
const propose=page=>page.getByRole('button',{name:'Voir le logo proposé',exact:true});
const imageRequests=new WeakMap();
async function open(width=1366,theme='dark',mode='normal',hold=''){
  const page=await browser.newPage({viewport:{width,height:width===720?450:768},reducedMotion:'reduce'}),requests=[];imageRequests.set(page,requests);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const request=route.request(),address=new URL(request.url());
    if(address.origin===base&&/^\/api\/graphics\/media\/44444444-4444-4444-8444-\d{12}\/content$/.test(address.pathname)&&request.method()==='GET'){
      requests.push(address.pathname);const number=Number(address.pathname.split('/')[4].slice(-12)),mime=[1,4].includes(number)?'image/webp':number===3?'image/jpeg':'image/png';
      return route.fulfill({status:200,contentType:mime,body:bytes[mime]});
    }
    if(address.origin!==base||address.pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method())){unexpectedRequests.push({url:address.href,method:request.method()});return route.abort();}
    return route.continue();
  });
  await page.goto(`${base}/tests/planner-logo.html?${new URLSearchParams({mode,...(hold?{hold}:{})})}`);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.getByRole('button',{name:'Ouvrir le choix du logo',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();return page;
}
async function capture(page,name){
  await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: page overflow`);
  assert.equal(await page.locator('dialog[open]').evaluateAll(nodes=>nodes.some(node=>node.scrollWidth>node.clientWidth+1)),false,`${name}: dialog overflow`);
}
async function untouched(page){const e=await audit(page);assert.deepEqual(e.changes,[]);assert.deepEqual(e.writes,[]);await expect(page.locator('audio,video')).toHaveCount(0);}
async function previewReady(page){await expect(preview(page)).toBeVisible();await expect.poll(()=>preview(page).evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);}
async function selectLocal(page,mime='image/png',name='Choix manuel local.png'){
  await page.locator('input[type=file]').setInputFiles({name,mimeType:mime,buffer:bytes[mime]});await previewReady(page);
  await expect(confirmation(page)).not.toBeChecked();await expect(apply(page)).toBeDisabled();return preview(page).getAttribute('src');
}
async function shared(page){
  const section=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Images déjà partagées dans Graphics'})});
  if(await section.getAttribute('open')===null)await section.locator('summary').click();return section;
}
try{
  for(const width of [1366,720,320])for(const theme of ['dark','light']){
    const page=await open(width,theme);await expect(propose(page)).toBeEnabled();await untouched(page);
    assert.deepEqual(imageRequests.get(page),[],'Programme metadata alone must not request logo content');
    assert.equal((await audit(page)).catalogueCalls,0,'Shared image catalogue is lazy');await expect(preview(page)).toHaveCount(0);
    await capture(page,`proposal-${theme}-${width}`);
    await propose(page).focus();await page.keyboard.press('Enter');await previewReady(page);
    await expect(preview(page)).toHaveAttribute('src',url(1));await expect(confirmation(page)).not.toBeChecked();await expect(apply(page)).toBeDisabled();await untouched(page);
    const confirmationLayout=await confirmation(page).evaluate(input=>{const box=input.getBoundingClientRect();return {width:box.width,height:box.height,direction:getComputedStyle(input.closest('label')).flexDirection};});
    assert.ok(confirmationLayout.width>0&&confirmationLayout.width<=20,`${theme}-${width}: compact checkbox width`);
    assert.ok(confirmationLayout.height>0&&confirmationLayout.height<=20,`${theme}-${width}: compact checkbox height`);
    assert.equal(confirmationLayout.direction,'row',`${theme}-${width}: confirmation label remains horizontal`);
    await confirmation(page).focus();await page.keyboard.press('Space');await expect(apply(page)).toBeEnabled();
    await capture(page,`preview-${theme}-${width}`);await apply(page).focus();await page.keyboard.press('Enter');
    await expect.poll(async()=>(await audit(page)).changes.length).toBe(1);
    assert.deepEqual((await audit(page)).changes[0],{url:url(1),name:'Logo proposé.webp',mimeType:'image/webp'});assert.deepEqual((await audit(page)).writes,[]);
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Ouvrir le choix du logo',exact:true})).toBeFocused();
    checks.push({name:`${theme}-${width}`,metadataMimePreserved:true,explicitPreviewAndConfirmation:true,keyboard:true,confirmationLayout});await page.close();
  }
  {
    const page=await open(320,'light','unlinked'),section=await shared(page);
    await expect(section.getByRole('button',{name:'Logo manuel partagé.png',exact:true})).toBeEnabled();
    for(const label of ['Vidéo interdite.mp4','Audio interdit.wav','Image en transfert.png','Image en échec.png','SVG non pris en charge.svg']){
      const option=section.getByRole('button',{name:label,exact:true});if(await option.count())await expect(option).toBeDisabled();
    }
    assert.deepEqual(imageRequests.get(page),[],'Catalogue names are not image previews');await untouched(page);
    const malformed=section.getByRole('button',{name:'Identifiant invalide.png',exact:true});
    if(await malformed.count()&&await malformed.isEnabled()){
      await malformed.click();await expect(page.getByRole('alert')).toContainText('Le logo doit être une image partagée dans cette chaîne.');
      await expect(preview(page)).toHaveCount(0);assert.deepEqual(imageRequests.get(page),[]);await untouched(page);
    }
    await section.getByRole('button',{name:'Logo manuel partagé.png',exact:true}).click();await previewReady(page);await expect(apply(page)).toBeDisabled();
    await confirmation(page).check();await apply(page).click();
    assert.deepEqual((await audit(page)).changes,[{url:url(2),name:'Logo manuel partagé.png',mimeType:'image/png'}]);assert.deepEqual((await audit(page)).writes,[]);
    checks.push({name:'shared-images-only',invalidAssetsUnavailable:true,explicitChoice:true});await page.close();
  }
  for(const [mime,extension]of [['image/png','png'],['image/jpeg','jpg'],['image/webp','webp']]){
    const page=await open(320,'dark','unlinked'),name=`Logo local.${extension}`;
    await selectLocal(page,mime,name);await untouched(page);assert.deepEqual(imageRequests.get(page),[]);
    await confirmation(page).check();await apply(page).click();await expect.poll(async()=>(await audit(page)).changes.length).toBe(1);
    const change=(await audit(page)).changes[0];assert.equal(change.name,name);assert.equal(change.mimeType,mime);assert.match(change.url,/^local-media:[a-f0-9]{64}:\d+$/);assert.deepEqual((await audit(page)).writes,[]);
    checks.push({name:`local-${extension}`,verifiedLocalReference:true,noUpload:true});await page.close();
  }
  {
    const page=await open(320,'light','existing');await expect(propose(page)).toBeEnabled();
    assert.deepEqual(imageRequests.get(page),[]);await page.getByRole('button',{name:'Vérifier le logo enregistré',exact:true}).click();await previewReady(page);
    await expect(preview(page)).toHaveAttribute('src',url(9));await untouched(page);await page.getByRole('button',{name:'Annuler',exact:true}).click();
    await expect(page.getByRole('status',{name:'Logo conservé dans la fixture',exact:true})).toHaveText('Logo enregistré.png');await untouched(page);
    await page.getByRole('button',{name:'Ouvrir le choix du logo',exact:true}).click();await page.getByRole('button',{name:'Retirer le logo',exact:true}).click();
    const remove=page.getByRole('button',{name:'Confirmer le retrait',exact:true}),confirmRemoval=page.getByRole('checkbox',{name:'Je confirme le retrait du logo pour les nouveaux brouillons.',exact:true});
    await expect(confirmRemoval).not.toBeChecked();await expect(remove).toBeDisabled();await untouched(page);await page.keyboard.press('Escape');await untouched(page);
    await page.getByRole('button',{name:'Ouvrir le choix du logo',exact:true}).click();await page.getByRole('button',{name:'Retirer le logo',exact:true}).click();await confirmRemoval.check();await remove.click();
    assert.deepEqual((await audit(page)).changes,[null]);assert.deepEqual((await audit(page)).writes,[]);
    checks.push({name:'existing-logo-cancel-and-removal',previewOptIn:true,cancelIntact:true,removalRequiresConfirmation:true});await page.close();
  }
  for(const mode of ['mismatch','empty','wrong-id','not-ready','nonimage','unsupported','programme-error','metadata-error']){
    const page=await open(320,'light',mode);
    if(['mismatch','empty'].includes(mode))await expect.poll(async()=>(await audit(page)).programmeCalls.every(call=>call.settled)).toBe(true);
    else await expect(page.getByRole('button',{name:'Réessayer la proposition',exact:true})).toBeEnabled();
    await expect(propose(page)).toHaveCount(0);assert.deepEqual(imageRequests.get(page),[]);await untouched(page);
    if(['mismatch','empty'].includes(mode))assert.equal((await audit(page)).metadataCalls.length,0);
    await capture(page,`${mode}-light-320`);
    if(!['mismatch','empty'].includes(mode)){
      await page.evaluate(()=>window.plannerLogoControl.recover());await page.getByRole('button',{name:'Réessayer la proposition',exact:true}).click();await expect(propose(page)).toBeEnabled();await untouched(page);assert.deepEqual(imageRequests.get(page),[]);
    }
    checks.push({name:mode,noAutomaticReplacement:true,retry:!['mismatch','empty'].includes(mode)});await page.close();
  }
  {
    const page=await open(320,'dark','shared-metadata-error'),section=await shared(page);
    await section.getByRole('button',{name:'Logo manuel partagé.png',exact:true}).click();await expect(page.getByRole('button',{name:'Réessayer ce choix',exact:true})).toBeEnabled();
    await expect(preview(page)).toHaveCount(0);assert.deepEqual(imageRequests.get(page),[]);await untouched(page);
    await page.evaluate(()=>window.plannerLogoControl.recover());await page.getByRole('button',{name:'Réessayer ce choix',exact:true}).click();await previewReady(page);await expect(apply(page)).toBeDisabled();
    checks.push({name:'shared-metadata-error',retryKeepsExplicitChoice:true,noPrematurePreview:true});await page.close();
  }
  for(const kind of ['programme','metadata']){
    const page=await open(320,'light','normal',kind);await expect.poll(async()=>(await audit(page))[kind==='programme'?'programmeCalls':'metadataCalls'].length).toBe(1);
    const selected=await selectLocal(page);await page.evaluate(kind=>window.plannerLogoControl.release(kind),kind);
    await expect.poll(async()=>(await audit(page))[kind==='programme'?'programmeCalls':'metadataCalls'][0].settled).toBe(true);
    await expect(preview(page)).toHaveAttribute('src',selected);await expect(confirmation(page)).not.toBeChecked();await untouched(page);
    await confirmation(page).check();await apply(page).click();await expect.poll(async()=>(await audit(page)).changes.length).toBe(1);assert.equal((await audit(page)).changes[0].name,'Choix manuel local.png');
    checks.push({name:`late-${kind}-after-local-choice`,manualChoicePreserved:true});await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
  const report={scope:'Isolated real PlannerLogoDialog, synthetic programme/catalogue/asset metadata and synthetic decoded PNG/JPEG/WebP pixels. Shared content reads intercepted locally; no real account, upload, disk grant, server mutation or project/weekly integration. 720px checks CSS reflow, not native browser zoom.',checks,errors,unexpectedRequests};
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
