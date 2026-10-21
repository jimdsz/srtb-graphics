import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[],report=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(['POST','PUT','PATCH'].includes(r.method()))writes.push(r.url());});
await mkdir('reports/ae-live',{recursive:true});
try{
  await page.goto('http://127.0.0.1:5221/tests/preview-reliability.html');
  const IN=page.getByRole('button',{name:'Recommencer l’aperçu (IN)',exact:true});await expect(IN).toBeEnabled({timeout:45000});
  await page.evaluate(async()=>{const blob=await (await fetch('/preview-media/v1/ba-programme.mp4')).blob();window.qaLocal=await window.previewQA.bindLocalFile(new File([blob],'Programme.mp4',{type:'video/mp4'}),()=>{});});
  for(const id of ['BTV_Evenement','BTV_Semainier','BTV_Renvoi']){
    await page.evaluate(id=>{const t=window.previewQA.templates.find(t=>t.id===id),patch={_studio_format:'vertical',_audio_enabled:false};for(const key of Object.keys(t.fields))if(key.startsWith('_media_')&&key.endsWith('_url'))patch[key]=window.qaLocal;window.previewQA.set(id,patch);},id);
    await expect(IN).toBeEnabled({timeout:45000});await IN.click();
    await expect(page.locator('.preview-panel [role="alert"]')).toHaveCount(0);
    await page.waitForTimeout(6400); // measured real playback, not readiness polling
    await page.getByRole('button',{name:'Mettre l’aperçu en pause',exact:true}).click();
    await page.screenshot({path:`reports/ae-live/${id}-social-ui.png`});
    await page.getByRole('button',{name:'Médias',exact:true}).click();
    const field=id==='BTV_Evenement'?'_media_event_url':id==='BTV_Semainier'?'_media_programme_2_url':'_media_renvoi_url';
    const group=page.locator('.field-section').filter({has:page.locator(`[data-inspector-field="${field}"]`)});
    if(await group.getAttribute('open')===null)await group.locator('summary').click();
    const editor=page.locator(`[data-inspector-field="${field}"] .crop-editor`);await editor.getByRole('button',{name:'Cadrer pour les réseaux',exact:true}).click();
    await page.evaluate(()=>{window.qaRebuilds=0;const g=document.querySelector('.graphic-host').firstElementChild,update=g.updateAction.bind(g);g.updateAction=(...args)=>{window.qaRebuilds++;return update(...args);};});
    const c=editor.locator('canvas');await expect(c).toHaveAttribute('tabindex','0',{timeout:30000});
    await c.scrollIntoViewIfNeeded();const before=await page.evaluate(()=>window.previewQA.data()),box=await c.boundingBox();
    await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.5+40,box.y+box.height*.5,{steps:5});await page.mouse.up();
    const after=await page.evaluate(()=>window.previewQA.data()),changed=Object.keys(after).filter(k=>k.endsWith('_x')&&after[k]!==before[k]);assert.ok(changed.length,`${id}: drag changes crop`);
    await c.press('ArrowLeft');const keyboard=await page.evaluate(key=>window.previewQA.data()[key],changed[0]);assert.notEqual(keyboard,after[changed[0]]);
    await expect(page.locator('.monitor-sync')).toContainText('Aperçu à jour',{timeout:15000});
    assert.equal(await page.evaluate(()=>window.qaRebuilds),0,'crop keeps the loaded media scene');
    report.push({id,changed,drag:after[changed[0]],keyboard});await expect(page.locator('.preview-panel [role="alert"]')).toHaveCount(0);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await writeFile('reports/ae-live/social-ui.json',JSON.stringify({at:new Date().toISOString(),report,errors,writes},null,2));
}catch(error){console.error(await page.locator('.preview-panel').innerText());console.error(errors);await page.screenshot({path:'reports/ae-live/ui-failure.png'});throw error;}finally{await browser.close();}
