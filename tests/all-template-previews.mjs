import {chromium,expect} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.SRTB_QA_ORIGIN||'http://127.0.0.1:5193',browser=await chromium.launch({channel:'msedge',headless:true});
const results=[],errors=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/tests/preview-reliability.html');
  const IN=page.getByRole('button',{name:'Recommencer l’aperçu (IN)',exact:true});await expect(IN).toBeEnabled({timeout:30000});
  const ids=await page.evaluate(()=>window.previewQA.templates.map(t=>t.id));
  for(const id of ids){
    const tag=await page.evaluate(id=>{window.previewQA.set(id);const t=window.previewQA.templates.find(t=>t.id===id);return `studio-${id.toLowerCase().replaceAll('_','-')}-${t.version.replaceAll('.','-')}`;},id);
    await page.locator('.graphic-host '+tag).waitFor({state:'attached'});await expect(IN).toBeEnabled({timeout:45000});
    const checks=id==='BTV_BA_1P'?[2,8,68,72]:id==='BTV_BA_TDS'?[2,10,15.6]:id==='BTV_BA_TDS_SUIVI_DE'?[2,16,24.6]:[3.16];
    for(const seconds of checks){
      const ruler=page.getByRole('slider',{name:'Position dans l’aperçu'});
      await ruler.fill(String(seconds));await ruler.press('Tab');
      await expect(IN).toBeEnabled({timeout:45000});await expect(page.locator('.preview-panel [role="alert"]')).toHaveCount(0);
      await expect(ruler).toHaveValue(String(seconds));
    }
    results.push({id,checks});console.log('PASS '+id+' '+checks.join(', '));
  }
  assert.deepEqual(errors,[]);await mkdir('reports/reliability',{recursive:true});await writeFile('reports/reliability/all-template-previews.json',JSON.stringify({checkedAt:new Date().toISOString(),results,errors},null,2));
}finally{await browser.close();}
