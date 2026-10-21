import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(['POST','PUT','PATCH','DELETE'].includes(r.method()))writes.push(r.url());});
const folder='reports/renvoi-signage';await mkdir(folder,{recursive:true});
try{
  await page.goto('http://127.0.0.1:5198/tests/preview-reliability.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.previewQA?.set);
  await page.evaluate(()=>window.previewQA.set('BTV_Renvoi',{variant:'2L',title:'STREET ART',title2:'SANS FRONTIÈRES',_audio_enabled:false}));
  await expect(page.getByRole('button',{name:'Recommencer l’aperçu (IN)',exact:true})).toBeEnabled({timeout:30000});
  await page.locator('.monitor-precision summary').click();
  await page.getByLabel('Temps d’inspection en secondes').fill('5');await page.getByRole('button',{name:'Voir cette image',exact:true}).click();
  await expect(page.getByRole('button',{name:'Voir cette image',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Graphisme',exact:true}).click();
  const rating=page.getByRole('checkbox',{name:/Afficher le pictogramme −10/}),ad=page.getByRole('checkbox',{name:/Afficher le pictogramme d’audiodescription/});
  await expect(rating).not.toBeChecked();await expect(ad).not.toBeChecked();
  await page.evaluate(()=>{window.renvoiRebuilds=0;const g=document.querySelector('.graphic-host').firstElementChild,update=g.updateAction.bind(g);window.renvoiAnimation=g.animation;g.updateAction=(...args)=>{window.renvoiRebuilds++;return update(...args);};});
  for(const [r,a]of [[true,true],[false,true],[true,false],[false,false]]){
    await rating.setChecked(r);await ad.setChecked(a);await expect(page.locator('.monitor-sync')).toContainText('Aperçu à jour');
    const state=await page.evaluate(()=>{const g=document.querySelector('.graphic-host').firstElementChild;return {rebuilds:window.renvoiRebuilds,same:g.animation===window.renvoiAnimation,icons:Object.fromEntries([...g.shadowRoot.querySelectorAll('[data-studio-renvoi-signage]')].map(n=>[n.dataset.studioRenvoiSignage,n.style.visibility!=='hidden']))};});
    assert.deepEqual(state,{rebuilds:0,same:true,icons:{rating:r,ad:a}});
    await page.locator('.graphic-host').screenshot({path:`${folder}/preview-${Number(r)}${Number(a)}.png`});
  }
  await page.locator('.fields-panel').screenshot({path:`${folder}/controls.png`});
  for(const query of ['−10','AD','audiodescription','signalétique','masquer','retirer']){
    await page.getByRole('searchbox',{name:'Rechercher un réglage'}).fill(query);
    await expect(query==='−10'?rating:ad).toBeVisible();
  }
  await page.getByRole('searchbox',{name:'Rechercher un réglage'}).fill('');
  await page.getByRole('button',{name:'Recommencer l’aperçu (IN)',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.graphic-host')?.firstElementChild?._time?.()>3);
  const runningTime=await page.evaluate(()=>document.querySelector('.graphic-host').firstElementChild._time());
  await rating.check();await expect(page.locator('.monitor-sync')).toContainText('Aperçu à jour');
  await rating.uncheck();await expect(page.locator('.monitor-sync')).toContainText('Aperçu à jour');
  const playback=await page.evaluate(()=>{const g=document.querySelector('.graphic-host').firstElementChild;return {sameAnimation:g.animation===window.renvoiAnimation,rebuilds:window.renvoiRebuilds,timeAfter:g._time(),phase:g.phase};});
  assert.equal(playback.sameAnimation,true);assert.equal(playback.rebuilds,0);assert.ok(playback.timeAfter>=runningTime);assert.equal(playback.phase,'onair');
  await writeFile(`${folder}/playback-report.json`,JSON.stringify({timeBefore:runningTime,...playback},null,2));
  const saved=await page.evaluate(()=>JSON.parse(JSON.stringify(window.previewQA.data())));
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.previewQA?.set);
  await page.evaluate(data=>window.previewQA.set('BTV_Renvoi',data),saved);
  await expect(page.getByRole('button',{name:'Recommencer l’aperçu (IN)',exact:true})).toBeEnabled({timeout:30000});
  await page.getByRole('button',{name:'Graphisme',exact:true}).click();await expect(rating).not.toBeChecked();await expect(ad).not.toBeChecked();
  await page.evaluate(()=>window.previewQA.patch({variant:'1L',title2:''}));await expect(rating).toHaveCount(0);await expect(ad).toHaveCount(0);
  await expect(page.locator('.monitor-sync')).toContainText('Aperçu à jour');
  const result=await page.evaluate(async()=>{const {qualifyRenvoiSignage}=await import('/tests/renvoi-signage-qualification.ts');return qualifyRenvoiSignage();});
  for(const [key,uri]of Object.entries(result.images))await writeFile(`${folder}/export-${key}.png`,Buffer.from(uri.split(',')[1],'base64'));
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  await writeFile(`${folder}/qualification.json`,JSON.stringify({at:new Date().toISOString(),ui:'PASS: four choices, no rebuild while paused or playing, search, reload, one-line controls hidden',records:result.records,errors,writes},null,2));
  console.log(JSON.stringify({ui:'PASS',records:result.records,errors,writes},null,2));
}catch(error){await page.screenshot({path:`${folder}/failure.png`,fullPage:true});console.error(errors);throw error;}finally{await browser.close();}
