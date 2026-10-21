import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
const base=process.argv[2]||'http://127.0.0.1:5192',browser=await chromium.launch({channel:'msedge',headless:true});
const reports=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),exceptions=[],uploads=[];
  page.on('pageerror',error=>exceptions.push(error.message));
  page.on('request',request=>{if(['POST','PUT'].includes(request.method()))uploads.push(request.url());});
  const pass=(name,detail={})=>{reports.push({name,...detail});console.log('PASS '+name+' '+JSON.stringify(detail));};
  // Delay a genuine image response to reproduce edits while load() is pending.
  let releaseImage,reachedImage;
  const imageGate=new Promise(resolve=>{releaseImage=resolve;}),imageSeen=new Promise(resolve=>{reachedImage=resolve;});
  await page.route('**/BTV_PopUp/lib/media/default-popup.png',async route=>{reachedImage();await imageGate;await route.continue();});
  await page.goto(base+'/tests/preview-reliability.html');await imageSeen;
  await page.evaluate(()=>window.previewQA.patch({_label:'MODIFIÉ PENDANT CHARGEMENT'}));releaseImage();
  const IN=page.getByRole('button',{name:'▶ IN',exact:true}),apply=page.getByRole('button',{name:'Appliquer les réglages',exact:true});
  await expect(IN).toBeEnabled({timeout:30000});await expect(apply).toBeEnabled();
  await apply.click();await expect(apply).toBeDisabled();
  const actual=await page.evaluate(()=>document.querySelector('.graphic-host').firstElementChild.state.data._label);
  assert.equal(actual,'MODIFIÉ PENDANT CHARGEMENT');pass('saisie pendant chargement conservée et réellement appliquée');
  await page.unroute('**/BTV_PopUp/lib/media/default-popup.png');

  await page.getByPlaceholder('Couleur, son, titre…').fill('Pop-up — liste');
  await page.getByRole('button',{name:'+ Ajouter un passage',exact:true}).click();
  // Hold the hashing worker before it starts, then modify the draft while the
  // file picker is pending. The production worker and hashing still run intact.
  let releaseWorker,reachedWorker;
  const workerGate=new Promise(resolve=>{releaseWorker=resolve;}),workerSeen=new Promise(resolve=>{reachedWorker=resolve;});
  await page.route('**/local-hash.worker.ts*',async route=>{reachedWorker();await workerGate;await route.continue();});
  await page.locator('.sequence input[type="file"]').setInputFiles({name:'recette.png',mimeType:'image/png',buffer:await readFile('public/library/v1.7.0/BTV_PopUp/lib/media/default-popup.png')});
  await workerSeen;
  await expect(page.getByRole('button',{name:'Retirer',exact:true})).toBeDisabled();
  await page.evaluate(()=>window.previewQA.patch({_title:'SAISIE CONSERVÉE'}));releaseWorker();
  await expect(page.getByText('Fichier lié sur ce poste · aucun envoi.',{exact:true})).toBeVisible({timeout:30000});
  assert.equal(await page.evaluate(()=>window.previewQA.data()._title),'SAISIE CONSERVÉE');
  await expect(IN).toBeEnabled({timeout:30000});pass('sélection locale asynchrone préservant les saisies et l’ordre des passages');

  const connection=await page.evaluate(async()=>{
    const descriptor=JSON.parse(window.previewQA.data()._media_popup_sequence)[0].url;
    window.reconnectFile=new File([await fetch(window.previewQA.localURL(descriptor.url)).then(r=>r.blob())],descriptor.name,{type:descriptor.mimeType});
    window.dispatchEvent(new Event('srtb-local-media-clear'));
    return descriptor;
  });
  await expect(page.locator('.preview-panel [role="alert"]')).toContainText('Reconnecter les fichiers');
  await page.evaluate(async()=>window.previewQA.bindLocalFile(window.reconnectFile,()=>{}));
  await expect(IN).toBeEnabled({timeout:30000});pass('fichier déconnecté signalé puis aperçu récupéré après reconnexion',{fileName:connection.name});

  const wav=await page.evaluate(async()=>{
    const samples=48000*2,bytes=new ArrayBuffer(44+samples*2),v=new DataView(bytes);
    const text=(at,value)=>{for(let i=0;i<value.length;i++)v.setUint8(at+i,value.charCodeAt(i));};
    text(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples*2,true);
    for(let i=0;i<samples;i++)v.setInt16(44+i*2,Math.sin(2*Math.PI*440*i/48000)*3000,true);
    return window.previewQA.bindLocalFile(new File([bytes],'recette.wav',{type:'audio/wav'}),()=>{});
  });
  await page.evaluate(wav=>window.previewQA.set('BTV_Relais_Antenne',{_audio_enabled:true,_audio_url:wav,_audio_volume:.5,_audio_loop:true,_audio_start_seconds:0,_audio_end_seconds:1,_out_mode:'manual'}),wav);
  await expect(page.getByRole('heading',{name:'Fiabilité aperçu et médias'})).toBeVisible();
  await expect(IN).toBeEnabled({timeout:30000});
  await page.getByRole('button',{name:'Activer le son',exact:true}).click();
  await expect(page.getByRole('button',{name:'Couper le son',exact:true})).toBeEnabled({timeout:30000});
  for(const format of ['mp4','alpha']){
    const report=await page.evaluate(format=>window.previewQA.export(format,true),format);
    assert.equal(report.audio,true);assert.ok(report.audioPeak>0);assert.equal(report.frames,105);
    pass('son local mixé et relu dans '+format,report);
  }
  assert.deepEqual(uploads,[]);assert.deepEqual(exceptions,[]);
  await mkdir('reports/reliability',{recursive:true});
  await writeFile('reports/reliability/recovery.json',JSON.stringify({checkedAt:new Date().toISOString(),reports,uploads,exceptions},null,2));
}finally{await browser.close();}
