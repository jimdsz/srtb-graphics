import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const base=process.env.TDS_TEST_URL||'http://127.0.0.1:5227';
const browser=await chromium.launch({channel:'msedge',headless:true});
const report=[];
await mkdir('reports/tds-preview-continuity',{recursive:true});
try{
  for(const id of ['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'])for(const format of ['tv','vertical','portrait']){
    const page=await browser.newPage({viewport:{width:1366,height:1000},deviceScaleFactor:1}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try{
      await page.goto(`${base}/tests/tds-preview-continuity.html?template=${id}&format=${format}`);
      await page.getByRole('button',{name:'Lire l’aperçu',exact:true}).waitFor({timeout:60000});
      await page.waitForFunction(()=>!document.querySelector('.transport-play')?.disabled,{timeout:60000});
      await page.locator('.monitor-precision > summary').click();
      const clock=page.getByRole('spinbutton',{name:'Temps d’inspection en secondes'}),inspect=page.getByRole('button',{name:'Voir cette image',exact:true}),host=page.locator('.graphic-host');
      async function seek(seconds){await clock.fill(String(seconds));await inspect.click();await page.waitForFunction(seconds=>{const g=document.querySelector('.graphic-host')?.firstElementChild;return g?.__previewTransport?.snapshot().phase==='paused'&&Math.abs(g.__previewTransport.snapshot().seconds-seconds)<.041&&!document.querySelector('.transport-play')?.disabled;},seconds);}
      async function gate(method){await page.evaluate(method=>{const g=document.querySelector('.graphic-host').firstElementChild,original=g[method].bind(g);window.__tdsGateEntered=false;g[method]=async(...args)=>{g[method]=original;window.__tdsGateEntered=true;await new Promise(resolve=>{window.__tdsGateRelease=resolve;});return original(...args);};},method);}
      async function release(){await page.evaluate(()=>window.__tdsGateRelease());await page.waitForFunction(()=>!document.querySelector('.transport-play')?.disabled);await page.waitForFunction(()=>!document.querySelector('[data-preview-hold]'));}
      async function capture(label){return host.screenshot({path:`reports/tds-preview-continuity/${id}-${format}-${label}.png`,animations:'disabled'});}
      await seek(8);
      const accepted=await capture('accepted');
      // The actual Preview inspection button, with a deliberately slow native
      // decode. Clear has already run underneath the retained picture.
      await gate('goToTime');await clock.fill('2');await inspect.click();
      await page.waitForFunction(()=>window.__tdsGateEntered);await page.waitForTimeout(180);
      assert.equal(await page.locator('[data-preview-hold]').count(),1,`${id}/${format}: seek retained picture`);
      const held=await capture('seek-wait');assert.ok(accepted.equals(held),`${id}/${format}: seek must retain exactly the accepted pixels`);
      await release();const replaced=await capture('seek-ready');assert.ok(!accepted.equals(replaced),`${id}/${format}: new frame must replace old frame`);
      // Trigger the existing auto-apply rebuild route, not the live typography
      // shortcut, and prove that it retains the social surface, not hidden TV.
      await seek(8);const beforeUpdate=await capture('before-update');await gate('updateAction');
      await page.getByRole('button',{name:'Modifier la durée pour reconstruire',exact:true}).click();
      await page.waitForFunction(()=>window.__tdsGateEntered);await page.waitForTimeout(180);
      assert.equal(await page.locator('[data-preview-hold]').count(),1,`${id}/${format}: update retained picture`);
      assert.ok(beforeUpdate.equals(await capture('update-wait')),`${id}/${format}: rebuild must retain exactly the accepted pixels`);
      await release();
      const social=await page.evaluate(()=>{const g=document.querySelector('.graphic-host').firstElementChild,c=g.__socialPreview?.canvas;return c?{exposed:c===g.parentElement.querySelector('canvas'),width:c.width,height:c.height}:null;});
      if(format!=='tv')assert.equal(social?.exposed,true,`${id}/${format}: accessor follows replaced renderer`);
      await page.getByRole('button',{name:'Effacer l’aperçu',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.graphic-host')?.firstElementChild?.__previewTransport?.snapshot().phase==='stopped');
      assert.equal(await page.locator('[data-preview-hold]').count(),0,`${id}/${format}: explicit Clear must remove every hold`);
      assert.ok(!beforeUpdate.equals(await capture('clear')),`${id}/${format}: explicit Clear must empty the picture`);
      assert.deepEqual(errors,[],`${id}/${format}: browser runtime errors`);
      const result={id,format,seekPixels:'identical during delayed decode',updatePixels:'identical during delayed rebuild',replacement:'visible',clear:'cleared',social,errors};report.push(result);console.log(JSON.stringify(result));
    }finally{await page.close();}
  }
  await writeFile('reports/tds-preview-continuity/report.json',JSON.stringify({at:new Date().toISOString(),report},null,2));
}finally{await browser.close();}
