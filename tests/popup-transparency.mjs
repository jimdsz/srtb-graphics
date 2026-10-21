import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),exceptions=[];
  page.on('pageerror',error=>exceptions.push(error.message));
  await page.goto('http://127.0.0.1:5192/tests/preview-reliability.html');
  const apply=page.getByRole('button',{name:'Appliquer les réglages',exact:true}),IN=page.getByRole('button',{name:'▶ IN',exact:true});
  await expect(IN).toBeEnabled({timeout:30000});
  async function patch(data){await page.evaluate(async data=>{window.previewQA.patch(data);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},data);if(await apply.isEnabled())await apply.click();await expect(apply).toBeDisabled();await expect(IN).toBeEnabled();}
  async function status(){return page.evaluate(()=>{
    const graphic=document.querySelector('.graphic-host').firstElementChild,slot=graphic.media.backgroundSlot,node=graphic.media.nodes.background;
    return {background:graphic.media.data._background_visible,clips:graphic.tracks.background.clips.length,display:getComputedStyle(slot).display,visible:!!node?.checkVisibility({checkVisibilityCSS:true}),source:node?.src||'',popupClips:graphic.tracks.popup.clips.length};
  });}
  await page.getByRole('spinbutton',{name:'Temps d’inspection en secondes'}).fill('3.16');
  await page.getByRole('button',{name:'Voir cette image',exact:true}).click();await expect(IN).toBeEnabled();
  const before=await status();assert.equal(before.visible,true);
  await patch({_background_visible:false});
  const disabled=await status();
  await page.evaluate(async()=>{
    const graphic=document.querySelector('.graphic-host').firstElementChild;
    await graphic.updateAction({_background_visible:true,_media_background_url:'',_media_background_sequence:'[]'});
    await graphic.goToTime({seconds:3.16});
  });
  const empty=await status();
  console.log(JSON.stringify({before,disabled,empty}));
  assert.equal(disabled.visible,false,'a previously loaded image must not override the hidden background');
  assert.equal(disabled.clips,0,'disabled background decoders must be released');
  assert.equal(empty.visible,false,'an explicitly empty background must not restore the sample image');
  assert.equal(empty.background,false);assert.equal(empty.popupClips,1);
  const mode=page.getByLabel('Fond du pop-up',{exact:true});
  await expect(mode).toHaveValue('transparent');
  await mode.selectOption('media');await apply.click();await expect(IN).toBeEnabled();await expect(apply).toBeDisabled();
  assert.equal((await status()).visible,true,'the original background can be restored deliberately');
  await mode.selectOption('transparent');await apply.click();await expect(IN).toBeEnabled();await expect(apply).toBeDisabled();
  const toggled=await status();assert.equal(toggled.visible,false);assert.equal(toggled.popupClips,1);
  assert.equal(await page.evaluate(()=>window.previewQA.data()._media_background_url),'lib/media/default-background.png','the transparency toggle preserves the saved alternative');
  // A real playlist must work even when its single source is empty.
  await patch({_background_visible:true,_media_background_url:'',_media_background_sequence:JSON.stringify([{url:'lib/media/default-background.png',start:0,end:3}])});
  assert.equal((await status()).visible,true);
  await page.getByPlaceholder('Couleur, son, titre…').fill('Média de fond');
  await page.getByLabel('Média de fond',{exact:true}).selectOption('');
  await apply.click();await expect(IN).toBeEnabled();await expect(apply).toBeDisabled();
  assert.equal((await status()).visible,false);
  const cleared=await page.evaluate(()=>window.previewQA.data());assert.equal(cleared._background_visible,false);assert.equal(cleared._media_background_sequence,'[]');
  // Re-open the actual component with the serialized saved parameters.
  await page.reload();await expect(IN).toBeEnabled({timeout:30000});await patch(JSON.parse(JSON.stringify(cleared)));
  const reopened=await status();assert.equal(reopened.visible,false);
  await page.getByRole('spinbutton',{name:'Temps d’inspection en secondes'}).fill('3.16');
  await page.getByRole('button',{name:'Voir cette image',exact:true}).click();await expect(IN).toBeEnabled();
  await mkdir('reports/reliability',{recursive:true});
  await page.locator('.preview-screen').screenshot({path:'reports/reliability/popup-transparent.png'});
  await page.setViewportSize({width:390,height:844});
  await mode.scrollIntoViewIfNeeded();
  const mobile=await mode.boundingBox();assert.ok(mobile.x>=0&&mobile.x+mobile.width<=390);
  await page.locator('.popup-background-setting').screenshot({path:'reports/reliability/popup-background-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});
  const alpha=await page.evaluate(async()=>{
    const {exportBroadcastVideo}=await import('/src/studio/video/export.ts'),{getTemplate}=await import('/src/studio/domain.ts');
    let points;
    const result=await exportBroadcastVideo(getTemplate('BTV_PopUp'),window.previewQA.data(),{format:'alpha',manualOut:3.2,removeBackground:false,audio:false,background:'#000000'},new AbortController().signal,()=>{},async(_blob,proofs)=>{
      const frame=proofs.find(proof=>proof.frame===80);points={outside:frame.alpha[0],thumbnail:frame.alpha[20*96+81],panel:frame.alpha[32*96+81]};
    });
    try{return {report:result.report,points};}finally{await result.dispose();}
  });
  assert.deepEqual(alpha.points,{outside:0,thumbnail:255,panel:255});assert.equal(alpha.report.alpha,true);
  // OUT/Clear must also hide explicit visibility:visible descendants.
  await patch({_background_visible:true,_media_background_url:'lib/media/default-background.png'});
  await IN.click();await expect(IN).toBeEnabled({timeout:15000});await page.getByRole('button',{name:'Effacer',exact:true}).click();
  await expect.poll(async()=>(await status()).visible).toBe(false);
  const stopped=await status();
  assert.deepEqual(exceptions,[]);
  console.log('PASS background toggle, empty source, playlist clear, serialized reopen, VP9 alpha pixels and Clear');
  await writeFile('reports/reliability/popup-transparency.json',JSON.stringify({checkedAt:new Date().toISOString(),before,disabled,empty,toggled,reopened,alpha,stopped,exceptions},null,2));
}finally{await browser.close();}
