import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.argv[2]||'http://127.0.0.1:5192',browser=await chromium.launch({channel:'msedge',headless:true});
const reports=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),exceptions=[];
  page.on('pageerror',error=>exceptions.push(error.message));
  await page.goto(base+'/tests/preview-reliability.html');
  await page.waitForFunction(()=>!!window.previewQA?.set);
  const IN=page.getByRole('button',{name:'▶ IN',exact:true});
  await expect(IN).toBeEnabled({timeout:30000});
  const patch=async data=>{await page.evaluate(async data=>{window.previewQA.patch(data);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},data);};
  const set=async(id,data={})=>{await page.evaluate(async({id,data})=>{window.previewQA.set(id,data);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},{id,data});};
  const apply=async()=>{await expect(IN).toBeEnabled({timeout:30000});const button=page.getByRole('button',{name:'Appliquer les réglages',exact:true});if(await button.isEnabled())await button.click();await expect(page.getByText('Réglages appliqués à cet aperçu.',{exact:false})).toBeVisible({timeout:30000});};
  const pass=(name,detail={})=>{reports.push({name,...detail});console.log('PASS '+name+' '+JSON.stringify(detail));};
  const hidden={url:`local-media:${'b'.repeat(64)}:120`,name:'fond-non-reconnecte.mp4',mimeType:'video/mp4'};
  await patch({_background_visible:false,_media_background_url:hidden,_media_background_sequence:'[{"url":"","start":0,"end":5}]'});
  await apply();await IN.click();await expect(IN).toBeEnabled({timeout:15000});
  await page.getByRole('button',{name:'Effacer',exact:true}).click();
  pass('fond désactivé avec fichier absent et passage vide');

  await patch({_media_popup_sequence:'[{"url":"","start":0,"end":5}]'});
  await page.getByRole('button',{name:'Appliquer les réglages',exact:true}).click();
  await expect(page.locator('.preview-panel [role="alert"]')).toContainText('passage 1');
  await expect(IN).toBeEnabled();
  await patch({_media_popup_sequence:'[]',_label:'À VOIR'});await apply();pass('correction après UPDATE invalide sans rechargement');

  // Initial load failure, then edit the source and retry on the same mounted UI.
  await set('BTV_Passerelle_Replay');await expect(IN).toBeEnabled({timeout:30000});
  await set('BTV_PopUp',{_media_popup_sequence:'[{"url":"","start":0,"end":5}]'});
  await expect(page.getByRole('button',{name:'Relancer l’aperçu'})).toBeEnabled({timeout:30000});
  await patch({_media_popup_sequence:'[]',_background_visible:false});
  await page.getByRole('button',{name:'Relancer l’aperçu'}).click();await expect(IN).toBeEnabled({timeout:30000});
  pass('récupération après échec initial sans quitter le projet');

  // A real local PNG, then a real MP4, with hash/binding and blob decoding.
  const png=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=54;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#f0b900';ctx.fillRect(0,0,96,54);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return window.previewQA.bindLocalFile(new File([blob],'recette.png',{type:'image/png'}),()=>{});
  });
  await patch({_media_popup_url:png,_media_popup_start_seconds:0,_media_popup_end_seconds:1});
  await expect(IN).toBeEnabled({timeout:30000});
  await expect(page.getByText('Réglages appliqués à cet aperçu.',{exact:false})).toBeVisible();
  pass('PNG local décodé sans téléversement');
  const urlBefore=await page.evaluate(png=>window.previewQA.localURL(png.url),png);
  const urlAfter=await page.evaluate(async png=>{const source=window.previewQA.localURL(png.url),blob=await fetch(source).then(r=>r.blob());await window.previewQA.bindLocalFile(new File([blob],png.name,{type:png.mimeType}),()=>{});return window.previewQA.localURL(png.url);},png);
  assert.equal(urlAfter,urlBefore);pass('reconnexion du même fichier sans révocation de son URL');

  const mp4=await page.evaluate(async()=>{
    const response=await fetch('/library/v1.7.0/BTV_BA_1P/lib/media/prepared/native-v102/slow-25b341c2aeb35dc28530.mp4');
    if(!response.ok)throw Error('Vidéo de recette absente');
    return window.previewQA.bindLocalFile(new File([await response.blob()],'recette.mp4',{type:'video/mp4'}),()=>{});
  });
  await patch({_media_popup_url:mp4,_media_popup_end_seconds:1,_media_popup_loop:false});
  await expect(IN).toBeEnabled({timeout:30000});
  await page.getByRole('textbox',{name:'Rechercher un réglage'}).count();
  await page.getByPlaceholder('Couleur, son, titre…').fill('Pop-up — liste');
  await page.getByRole('button',{name:'+ Ajouter un passage',exact:true}).click();
  const inherited=await page.evaluate(()=>JSON.parse(window.previewQA.data()._media_popup_sequence));
  assert.equal(inherited[0].url.url,mp4.url);await apply();pass('nouvel extrait initialisé avec le média principal');

  await patch({_media_popup_url:hidden,_media_popup_sequence:JSON.stringify([{url:mp4,start:0,end:.4},{url:mp4,start:.5,end:.9}]),_out_mode:'media_end',_out_media_track:'popup',_media_popup_loop:false});
  await apply();await IN.click();
  await expect(page.locator('.preview-phase')).toContainText('Arrêté',{timeout:15000});
  pass('playlist vidéo locale prioritaire et OUT automatique complet');
  await patch({_media_popup_sequence:JSON.stringify([{url:mp4,start:9999,end:10000}])});
  await page.getByRole('button',{name:'Appliquer les réglages',exact:true}).click();
  await expect(page.locator('.preview-panel [role="alert"]')).toContainText('hors de la vidéo',{timeout:30000});
  await patch({_media_popup_sequence:'[]',_media_popup_url:png,_media_popup_end_seconds:1,_out_mode:'manual'});await apply();
  pass('points hors vidéo rejetés puis réglage corrigé');
  for(const format of ['mp4','alpha']){
    const report=await page.evaluate(format=>window.previewQA.export(format),format);
    assert.equal(report.frames,101);assert.equal(report.alpha,format==='alpha');assert.ok(report.bytes>0);
    pass('export Pop-up '+format+' relu après encodage',report);
  }

  // Smoke the seven genuine engines. Each test edits, inspects and plays OUT.
  const ids=await page.evaluate(()=>window.previewQA.templates.map(t=>t.id));
  for(const id of ids){
    await set(id,{_out_mode:'manual'});await page.getByPlaceholder('Couleur, son, titre…').fill('');
    await expect(IN).toBeEnabled({timeout:60000});
    if(id==='BTV_PopUp'){
      const applyButton=page.getByRole('button',{name:'Appliquer les réglages',exact:true});
      if(await applyButton.isEnabled())await apply();
    }
    await page.getByRole('spinbutton',{name:'Temps d’inspection en secondes'}).fill('2');
    await page.getByRole('button',{name:'Voir cette image',exact:true}).click();
    await expect(IN).toBeEnabled({timeout:60000});
    await page.getByRole('button',{name:'OUT',exact:true}).click();
    await expect(page.locator('.preview-phase')).toContainText(/Arrêté|stopped|stop/,{timeout:30000});
    assert.equal(await page.locator('.preview-panel [role="alert"]').count(),0,id);
    pass('moteur '+id+' : chargement, inspection et OUT');
  }
  assert.deepEqual(exceptions,[]);
  await mkdir('reports/reliability',{recursive:true});
  await page.screenshot({path:'reports/reliability/preview.png',fullPage:true});
  await writeFile('reports/reliability/browser.json',JSON.stringify({checkedAt:new Date().toISOString(),reports,exceptions},null,2));
}finally{await browser.close();}
