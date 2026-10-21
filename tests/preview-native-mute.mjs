import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:5193/tests/preview-reliability.html');
  const IN=page.getByRole('button',{name:'▶ IN',exact:true});await expect(IN).toBeEnabled({timeout:30000});
  await page.evaluate(()=>window.previewQA.set('BTV_BA_1P'));await expect(IN).toBeEnabled({timeout:30000});
  await page.evaluate(()=>{const g=document.querySelector('.graphic-host').firstElementChild;window.beforeMuteMedia=g.media;window.beforeMuteNode=g.media.node('body');});
  await page.getByRole('button',{name:'Activer le son',exact:true}).click();
  await expect(page.getByRole('button',{name:'Couper le son',exact:true})).toBeEnabled({timeout:45000});
  assert.equal(await page.evaluate(()=>{const g=document.querySelector('.graphic-host').firstElementChild;window.beforeMuteAudio=g.audio;return g.media===window.beforeMuteMedia&&g.media.node('body')===window.beforeMuteNode&&!!g.audio.buffers.bed&&!!g.audio.buffers.voice&&!g.muted;}),true);
  await page.getByRole('button',{name:'Couper le son',exact:true}).click();await expect(page.getByRole('button',{name:'Activer le son',exact:true})).toBeEnabled();
  assert.equal(await page.evaluate(()=>{const g=document.querySelector('.graphic-host').firstElementChild;return g.media===window.beforeMuteMedia&&g.audio===window.beforeMuteAudio&&g.muted;}),true);
  await expect(page.locator('.preview-panel [role="alert"]')).toHaveCount(0);
  console.log('PASS BA sound toggle retains video decoder and prepared audio, initial preview remains muted');
}finally{await browser.close();}
