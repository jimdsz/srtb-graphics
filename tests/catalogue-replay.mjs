import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:5193/tests/workspace-reliability.html?studio=1');
  await page.getByRole('button',{name:'Bibliothèque',exact:true}).click();
  await page.getByRole('button',{name:'Replay La passerelle replay',exact:true}).click();
  await expect(page.getByText('Aperçu de démonstration :',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Charger l’aperçu',exact:true}).click();
  await expect(page.getByRole('button',{name:'▶ IN',exact:true})).toBeEnabled({timeout:30000});await page.getByRole('button',{name:'▶ IN',exact:true}).click();
  await expect(page.getByRole('button',{name:'▶ IN',exact:true})).toBeEnabled({timeout:10000});await expect(page.locator('.preview-panel [role="alert"]')).toHaveCount(0);
  assert.equal(await page.evaluate(()=>document.querySelector('.graphic-host').firstElementChild.data._replay_url),'https://srtb-graphics.pages.dev/');
  const blocked=await page.evaluate(async()=>{const {getTemplate,templateDefaults}=await import('/src/studio/domain.ts'),{prepareGraphic}=await import('/src/studio/video/engine.ts');const t=getTemplate('BTV_Passerelle_Replay');try{const g=await prepareGraphic(t,templateDefaults(t),2,true,new AbortController().signal);await g.dispose();return '';}catch(e){return e.message;}});
  assert.match(blocked,/adresse du replay/);console.log('PASS playable library replay, clearly labelled demo URL, export of an unconfigured project refused');
}finally{await browser.close();}
