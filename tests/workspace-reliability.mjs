import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const base=process.env.SRTB_QA_ORIGIN||'http://127.0.0.1:5192';
const browser=await chromium.launch({channel:'msedge',headless:true});
const reports=[],exceptions=[];
const pass=(name,details={})=>{reports.push({name,...details});console.log('PASS '+name+' '+JSON.stringify(details));};
try{
  const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  const post=async(path,data)=>{const r=await context.request.post(base+'/api/graphics'+path,{data,headers:{Origin:base}});assert.equal(r.ok(),true,await r.text());return r.json();};
  const get=async id=>(await context.request.get(base+'/api/graphics/projects/'+id)).json();
  async function open(id){const page=await context.newPage();page.on('pageerror',e=>exceptions.push(e.message));await page.goto(base+'/tests/workspace-reliability.html?project='+id);await expect(page.getByLabel('Nom du projet',{exact:true})).toBeVisible();return page;}
  const p=await post('/projects',{title:'Recette deux postes',templateId:'BTV_Relais_Antenne',data:{_out_mode:'manual'}}),a=await open(p.id),b=await open(p.id);
  await a.getByLabel('Nom du projet',{exact:true}).fill('Version poste A');
  await a.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();await expect(a.getByText('Projet enregistré. Une nouvelle révision a été créée.',{exact:true})).toBeVisible();
  await b.getByLabel('Nom du projet',{exact:true}).fill('Saisie du poste B à préserver');
  await b.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();
  await expect(b.getByText('Vos saisies sont conservées à l’écran.',{exact:true})).toBeVisible();
  await expect(b.getByLabel('Nom du projet',{exact:true})).toHaveValue('Saisie du poste B à préserver');
  assert.equal((await get(p.id)).title,'Version poste A');
  const backupEvent=b.waitForEvent('download');await b.getByRole('button',{name:'Sauvegarder mon brouillon',exact:true}).click();
  const backup=await backupEvent,backupBody=JSON.parse(await readFile(await backup.path(),'utf8'));
  assert.equal(backupBody.project.title,'Saisie du poste B à préserver');
  b.once('dialog',dialog=>dialog.accept());await b.getByRole('button',{name:'Charger la dernière version',exact:true}).click();
  await expect(b.getByLabel('Nom du projet',{exact:true})).toHaveValue('Version poste A');
  pass('deux postes : conflit refusé, saisie conservée, sauvegarde JSON puis dernière version');

  await b.route('**/api/graphics/projects/'+p.id,async route=>route.request().method()==='PUT'?route.abort('internetdisconnected'):route.continue());
  await b.getByLabel('Nom du projet',{exact:true}).fill('Saisie pendant coupure');await b.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();
  await expect(b.getByRole('alert').filter({hasText:'Connexion interrompue'})).toBeVisible();await expect(b.getByLabel('Nom du projet',{exact:true})).toHaveValue('Saisie pendant coupure');
  assert.equal((await get(p.id)).title,'Version poste A');
  await b.unroute('**/api/graphics/projects/'+p.id);await b.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();
  await expect(b.getByText('Projet enregistré. Une nouvelle révision a été créée.',{exact:true})).toBeVisible();
  pass('coupure réseau simulée : aucun faux succès, saisie conservée, reprise réussie');

  // The server accepted the write, but its reply never reached this browser.
  await b.route('**/api/graphics/projects/'+p.id,async route=>{
    if(route.request().method()==='PUT'){await route.fetch();await route.abort('connectionreset');}else await route.continue();
  });
  await b.getByLabel('Nom du projet',{exact:true}).fill('Enregistré malgré réponse perdue');await b.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();
  await expect(b.getByRole('alert').filter({hasText:'action non confirmée'})).toBeVisible();
  const committed=await get(p.id);assert.equal(committed.title,'Enregistré malgré réponse perdue');
  await b.unroute('**/api/graphics/projects/'+p.id);await b.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();
  await expect(b.getByText('Vos saisies sont conservées à l’écran.',{exact:true})).toBeVisible();
  assert.equal((await get(p.id)).revision,committed.revision);
  pass('réponse perdue après écriture : nouvelle tentative refusée sans écrasement ni doublon');

  const broken=await post('/projects',{title:'Aperçu absent',templateId:'BTV_PopUp',data:{_background_visible:false,_media_popup_url:'lib/media/missing-qa.png'}});
  await post(`/projects/${broken.id}/status`,{revision:broken.revision,status:'submitted'});
  const page=await open(broken.id);
  await expect(page.getByText('Aperçu indisponible',{exact:true})).toBeVisible({timeout:30000});
  await page.getByText('Validation pour la diffusion',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Valider cette révision',exact:true})).toBeDisabled();
  pass('validation bloquée dans l’interface lorsque l’aperçu échoue');

  const beforeExport=await get(p.id),exportPage=await open(p.id);
  await exportPage.getByLabel('Nom du projet',{exact:true}).fill('Export des saisies non enregistrées');
  await exportPage.getByRole('button',{name:'Exporter',exact:true}).first().click();
  await expect(exportPage.getByRole('button',{name:'Télécharger la vidéo',exact:true})).toBeEnabled();
  await exportPage.getByText('Autres formats · HTML / réglages',{exact:true}).click();
  await exportPage.evaluate(()=>Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined}));
  const zipEvent=exportPage.waitForEvent('download');await exportPage.getByRole('button',{name:'Télécharger le paquet HTML (.zip)',exact:true}).click();
  const zip=await zipEvent;
  const {unzipSync,strFromU8}=await import('fflate');
  const zipFiles=unzipSync(await readFile(await zip.path())),document=JSON.parse(strFromU8(zipFiles['PROJET.json']));
  assert.equal(document.project.title,'Export des saisies non enregistrées');assert.equal(document.snapshot.purpose,'working-copy');
  assert.deepEqual(await get(p.id),beforeExport);
  pass('ZIP réel du brouillon non enregistré, sans validation et sans modifier le projet partagé');

  // Simulate a slow disk after a real write, so cancellation happens mid-transfer.
  await exportPage.evaluate(()=>{
    window.zipDisk={written:0,closed:false,aborted:false};
    Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:async()=>({createWritable:async()=>({write:async bytes=>{window.zipDisk.written+=bytes.length;await new Promise(resolve=>setTimeout(resolve,80));},close:async()=>{window.zipDisk.closed=true;},abort:async()=>{window.zipDisk.aborted=true;}})})});
  });
  await exportPage.getByRole('button',{name:'Télécharger le paquet HTML (.zip)',exact:true}).click();
  await exportPage.waitForFunction(()=>window.zipDisk.written>0);
  await exportPage.getByRole('button',{name:'Annuler',exact:true}).click();
  await expect(exportPage.getByRole('status').filter({hasText:'Export annulé.'})).toBeVisible();
  const disk=await exportPage.evaluate(()=>window.zipDisk);assert.equal(disk.closed,false);assert.equal(disk.aborted,true);
  await expect(exportPage.getByRole('alert')).toHaveCount(0);
  pass('annulation du ZIP : aucune alerte rouge, aucun fichier partiel finalisé');

  await exportPage.getByLabel('Déclencher OUT après (secondes)').fill('1.4');
  const planRequests=[];
  exportPage.on('request',request=>{if(request.url().endsWith('/export'))planRequests.push(request.postDataJSON());});
  const videoEvent=exportPage.waitForEvent('download',{timeout:120000});
  await exportPage.getByRole('button',{name:'Télécharger la vidéo',exact:true}).click();
  await exportPage.getByRole('button',{name:'Réglages',exact:true}).click();
  const video=await videoEvent;assert.ok(video.suggestedFilename().endsWith('.mp4'));assert.ok((await readFile(await video.path())).byteLength>1000);
  await exportPage.getByRole('button',{name:/^Exporter/}).first().click();
  await expect(exportPage.getByRole('link',{name:'Retélécharger le dernier export',exact:true})).toBeVisible();
  assert.equal(planRequests.length,1);assert.equal(planRequests[0].title,'Export des saisies non enregistrées');
  assert.deepEqual(await get(p.id),beforeExport);
  await expect(exportPage.getByRole('button',{name:'Lire l’aperçu',exact:true})).toBeEnabled();
  pass('MP4 réel sans validation ni sauvegarde ; changement d’onglet sans interruption du calcul');

  await exportPage.getByRole('radio',{name:'WebM · VP9 · Transparence alpha',exact:true}).check();
  const alphaEvent=exportPage.waitForEvent('download',{timeout:120000});await exportPage.getByRole('button',{name:'Télécharger la vidéo',exact:true}).click();
  const alpha=await alphaEvent;assert.ok(alpha.suggestedFilename().endsWith('.webm'));assert.ok((await readFile(await alpha.path())).byteLength>1000);
  await expect(exportPage.getByText(/alpha contrôlé/)).toBeVisible();
  assert.deepEqual(await get(p.id),beforeExport);
  pass('WebM alpha réel du brouillon, sans validation ni transfert cloud');

  assert.deepEqual(exceptions,[]);await mkdir('reports/reliability',{recursive:true});
  await writeFile('reports/reliability/collaboration.json',JSON.stringify({checkedAt:new Date().toISOString(),environment:'Loopback qualification; real API and local D1; UI sessions share the qualification admin; role isolation tested separately in Workers Vitest.',reports,exceptions},null,2));
}finally{await browser.close();}
