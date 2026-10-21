import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/channel-resources');
const id=value=>`11111111-1111-4111-8111-${String(value).padStart(12,'0')}`;
const logo=value=>`/api/graphics/media/${id(value)}/content`;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=','base64');
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const checks=[],errors=[],unexpectedRequests=[];
const audit=page=>page.evaluate(()=>structuredClone(window.channelResourceEvidence));
async function open(width,theme,fail='',role='admin',extra={}){
  const page=await browser.newPage({viewport:{width,height:width===720?450:900},deviceScaleFactor:width===720?2:1,reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base){unexpectedRequests.push(url.href);return route.abort();}
    if(/^\/api\/graphics\/media\/[a-f\d-]+\/content$/.test(url.pathname))return route.fulfill({status:200,contentType:'image/png',body:png});
    if(url.pathname==='/api/graphics/planner-summary')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({plans:0,updatedAt:null})});
    if(url.pathname.startsWith('/api/')){unexpectedRequests.push(url.href);return route.abort();}
    return route.continue();
  });
  const query=new URLSearchParams({role,...(fail?{fail}:{}),...extra});
  await page.goto(`${base}/tests/channel-resources.html?${query}`);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect(page.getByRole('heading',{name:'Aujourd’hui',exact:true})).toBeVisible();
  assert.deepEqual((await audit(page)).calls,{media:0,voices:0,directories:0},'No resource catalogue loaded on home');
  return page;
}
async function capture(page,name){
  // Full-page capture otherwise paints sticky chrome at the current scroll
  // offset. Reset the document (not an open modal's own scroll position).
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: no horizontal page overflow`);
  assert.equal(await page.locator('dialog[open]').evaluateAll(nodes=>nodes.some(node=>node.scrollWidth>node.clientWidth+1)),false,`${name}: no horizontal modal overflow`);
}
async function navigate(page,name){
  const toggle=page.getByRole('button',{name:'Menu',exact:true});
  if(await toggle.isVisible()&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  await page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name,exact:true}).click();
}
async function identity(page){
  const dialog=page.getByRole('dialog',{name:'Chaînes & équipes',exact:true});
  if(!await dialog.count()){
    await page.getByRole('button',{name:'Gérer les chaînes',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Nouvelle chaîne',exact:true})).toBeFocused();
  }
  const details=dialog.locator('details').filter({has:page.locator('summary').filter({hasText:'Identité de la chaîne'})});
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
  return dialog;
}
async function programme(page){
  await navigate(page,'Émissions');
  await page.locator('.programme-list>button').filter({hasText:'Magazine de recette'}).click();
  await expect(page.getByRole('textbox',{name:'Titre officiel',exact:true})).toBeFocused();
}
async function advanced(page){
  const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Réglages avancés'})});
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
  return details;
}
async function forbiddenOptions(select,labels){
  for(const label of labels){
    const option=select.getByRole('option',{name:label,exact:true});
    if(await option.count())await expect(option).toBeDisabled();
  }
}
async function readyProgrammeResources(page){
  const image=page.getByRole('combobox',{name:'Logo de l’émission',exact:true}),voice=page.getByRole('combobox',{name:'Voix habituelle',exact:true});
  await expect(image.getByRole('option',{name:'Logo admissible.png',exact:true})).toBeAttached();
  await expect(voice.getByRole('option',{name:'Voix validée première page',exact:true})).toBeAttached();
  await expect(page.getByRole('checkbox',{name:'Emplacement première page',exact:true})).toBeAttached();
  await forbiddenOptions(image,['Vidéo non admissible.mp4','Audio non admissible.wav','Image en téléversement.png','Image en échec.png','Identifiant image invalide.png']);
  await forbiddenOptions(voice,['Voix sans validation','Voix archivée','Voix sans date de validation','Voix sans validateur','Profil non vocal']);
  await expect(page.getByRole('checkbox',{name:'Emplacement archivé',exact:true})).toHaveCount(0);
  await expect(page.getByRole('checkbox',{name:'Document non dossier',exact:true})).toHaveCount(0);
  return {image,voice};
}
try{
  for(const width of [1366,320,720])for(const theme of ['dark','light']){
    const page=await open(width,theme),name=`${theme}-${width}`;
    await page.getByRole('button',{name:'Gérer les chaînes',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Nouvelle chaîne',exact:true})).toBeFocused();
    assert.equal((await audit(page)).calls.media,0,'Opening manager does not load logo catalogue before expansion');
    let manager=await identity(page);
    const channelLogo=page.getByRole('combobox',{name:'Logo de la chaîne',exact:true});
    await expect(channelLogo.getByRole('option',{name:'Logo admissible.png',exact:true})).toBeAttached();
    await expect(channelLogo).toHaveValue(logo(90));
    await forbiddenOptions(channelLogo,['Vidéo non admissible.mp4','Audio non admissible.wav','Image en téléversement.png','Image en échec.png','Identifiant image invalide.png']);
    await page.getByRole('textbox',{name:'Nom de la chaîne',exact:true}).fill('Bénin TV — recette');
    await page.getByRole('button',{name:'Enregistrer l’identité',exact:true}).click();
    await expect.poll(async()=>(await audit(page)).channelSaves.length).toBe(1);
    let saved=(await audit(page)).channelSaves[0];assert.equal(saved.revision,7);assert.equal(saved.data.logo,logo(90),'Unlisted channel logo is preserved');
    manager=await identity(page);
    await channelLogo.selectOption(logo(1));
    await page.getByRole('textbox',{name:'Couleur d’accent',exact:true}).fill('#123abc');
    await page.getByRole('textbox',{name:/^Fuseau horaire/}).fill('UTC');
    await capture(page,`identity-${name}`);
    await manager.getByRole('button',{name:'Fermer',exact:true}).click();
    await expect(page.getByRole('button',{name:'Continuer la modification',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Continuer la modification',exact:true}).click();
    await expect(channelLogo).toHaveValue(logo(1));
    await expect(page.getByRole('textbox',{name:'Couleur d’accent',exact:true})).toHaveValue('#123abc');
    assert.equal((await audit(page)).channelSaves.length,1,'Dirty close confirmation makes no write');
    await page.getByRole('button',{name:'Enregistrer l’identité',exact:true}).click();
    await expect.poll(async()=>(await audit(page)).channelSaves.length).toBe(2);
    saved=(await audit(page)).channelSaves[1];assert.equal(saved.revision,8);assert.deepEqual(saved.data,{name:'Bénin TV — recette',logo:logo(1),accent:'#123abc',timezone:'UTC'});
    if(await manager.count())await manager.getByRole('button',{name:'Fermer',exact:true}).click();
    const before=(await audit(page)).calls;
    await programme(page);
    assert.deepEqual((await audit(page)).calls,before,'Opening programme does not load advanced resource catalogues');
    await advanced(page);
    let {image,voice}=await readyProgrammeResources(page);
    await expect(image).toHaveValue(logo(90));await expect(voice).toHaveValue(id(92));
    await page.getByRole('textbox',{name:'Notes de préparation',exact:true}).fill('Notes vérifiées');
    await capture(page,`references-preserved-${name}`);
    await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
    await expect.poll(async()=>(await audit(page)).programmeSaves.length).toBe(1);
    let programmeSave=(await audit(page)).programmeSaves[0];
    assert.equal(programmeSave.revision,4);assert.equal(programmeSave.data.logo,logo(90));assert.equal(programmeSave.data.voiceProfileId,id(92));assert.deepEqual(programmeSave.data.directoryIds,[id(93)]);
    await page.locator('.programme-list>button').filter({hasText:'Magazine de recette'}).click();
    await advanced(page);({image,voice}=await readyProgrammeResources(page));
    await image.selectOption(logo(1));
    await page.getByRole('button',{name:'Charger d’autres voix',exact:true}).click();
    await expect(voice.getByRole('option',{name:'Voix validée deuxième page',exact:true})).toBeAttached();
    await voice.selectOption(id(21));
    await page.getByRole('checkbox',{name:'Emplacement première page',exact:true}).check();
    await page.getByRole('button',{name:'Charger d’autres emplacements',exact:true}).click();
    await page.getByRole('checkbox',{name:'Emplacement deuxième page',exact:true}).check();
    await capture(page,`resources-selected-${name}`);
    await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
    await expect.poll(async()=>(await audit(page)).programmeSaves.length).toBe(2);
    const result=await audit(page);programmeSave=result.programmeSaves[1];
    assert.equal(programmeSave.revision,5);assert.equal(programmeSave.data.logo,logo(1));assert.equal(programmeSave.data.voiceProfileId,id(21));assert.deepEqual([...programmeSave.data.directoryIds].sort(),[id(31),id(41),id(93)].sort());
    assert.equal(programmeSave.data.notes,'Notes vérifiées');assert.deepEqual(programmeSave.data.aliases,['Magazine']);
    assert.ok(result.voiceQueries.some(options=>options.kind==='voice'&&options.limit===50&&options.next?.afterId===id(16)),'Voice cursor passed to the next page');
    assert.ok(result.directoryOffsets.includes(100),'Directory numeric cursor passed to the next page');
    checks.push(`${width} ${theme}: lazy resource loading, eligible-only choices, legacy references preserved, paginated resource selection, identity dirty-close guard and exact save payloads`);
    await page.close();
  }
  for(const pagination of [false,true]){
    const fail=pagination?'voices-next,directories-next':'media,voices,directories',page=await open(pagination?1366:320,pagination?'light':'dark',fail);
    await programme(page);await advanced(page);
    if(pagination){await readyProgrammeResources(page);await page.getByRole('button',{name:'Charger d’autres voix',exact:true}).click();await page.getByRole('button',{name:'Charger d’autres emplacements',exact:true}).click();}
    for(const [resource,legend] of pagination?[['voices-next','Voix habituelle'],['directories-next','Emplacements partagés']]:[['media','Logo de l’émission'],['voices','Voix habituelle'],['directories','Emplacements partagés']]){
      const group=page.getByRole('group',{name:legend,exact:true});
      await expect(group.getByText(`Erreur de recette · ${resource}`,{exact:true})).toBeVisible();
      await expect(group.locator('p').filter({hasText:/Aucun(?:e)? (?:image|voix validée|emplacement|dossier)/})).toHaveCount(0);
      if(pagination&&resource==='voices-next')await expect(group.getByRole('option',{name:'Voix validée première page',exact:true})).toBeAttached();
      if(pagination&&resource==='directories-next')await expect(group.getByRole('checkbox',{name:'Emplacement première page',exact:true})).toBeAttached();
      await group.getByRole('button',{name:'Réessayer',exact:true}).click();
      await expect(group.getByText(`Erreur de recette · ${resource}`,{exact:true})).toHaveCount(0);
    }
    await readyProgrammeResources(page);
    await expect(page.getByRole('combobox',{name:'Logo de l’émission',exact:true})).toHaveValue(logo(90));
    await expect(page.getByRole('combobox',{name:'Voix habituelle',exact:true})).toHaveValue(id(92));
    if(pagination){await expect(page.getByRole('option',{name:'Voix validée deuxième page',exact:true})).toBeAttached();await expect(page.getByRole('checkbox',{name:'Emplacement deuxième page',exact:true})).toBeAttached();}
    assert.equal((await audit(page)).programmeSaves.length,0,'Reading/retrying resource lists never saves the programme');
    await capture(page,`retry-${pagination?'pagination':'initial'}`);
    checks.push(`${pagination?'Pagination':'Initial'} failures: explicit scoped errors, no false empty state, retry retains old selections and prior page entries`);await page.close();
  }
  for(const role of ['designer','broadcaster']){
    const page=await open(1366,'dark','',role);
    await programme(page);
    const permanent=page.getByRole('checkbox',{name:/^Habillage permanent à réutiliser/});
    const recipes=page.getByRole('group',{name:'Livrables habituels',exact:true});
    if(role==='designer'){
      await expect(permanent).toBeDisabled();await expect(permanent).not.toBeChecked();
      for(const choice of await recipes.getByRole('checkbox').all())await expect(choice).toBeDisabled();
      await expect(recipes.getByRole('checkbox',{name:'Bande-annonce',exact:true})).toBeChecked();
      await expect(page.getByText('Recette à valider par un administrateur ou diffuseur.',{exact:true})).toBeVisible();
      await page.getByRole('textbox',{name:'Titre officiel',exact:true}).fill('Magazine de recette — corrigé');
      await page.getByRole('textbox',{name:'Notes de préparation',exact:true}).fill('Métadonnées modifiées par le graphiste');
      await advanced(page);const {image,voice}=await readyProgrammeResources(page);
      await expect(image).toBeEnabled();await expect(voice).toBeEnabled();
      await image.selectOption(logo(1));await voice.selectOption(id(11));
      await page.getByRole('checkbox',{name:'Emplacement première page',exact:true}).check();
      await capture(page,'designer-editable-metadata');
      await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
      await expect.poll(async()=>(await audit(page)).programmeSaves.length).toBe(1);
      let saved=(await audit(page)).programmeSaves[0].data;
      assert.deepEqual(saved.recipe,['ba']);assert.equal(saved.recurring,false);assert.equal(saved.logo,logo(1));assert.equal(saved.voiceProfileId,id(11));assert.equal(saved.name,'Magazine de recette — corrigé');
      assert.deepEqual([...saved.directoryIds].sort(),[id(31),id(93)].sort());
      await page.getByRole('button',{name:'Nouvelle émission',exact:true}).click();
      await expect(permanent).toBeDisabled();await expect(permanent).not.toBeChecked();
      for(const choice of await recipes.getByRole('checkbox').all()){await expect(choice).toBeDisabled();await expect(choice).not.toBeChecked();}
      await page.getByRole('textbox',{name:'Titre officiel',exact:true}).fill('Nouvelle fiche graphiste');
      await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
      await expect.poll(async()=>(await audit(page)).programmeSaves.length).toBe(2);
      saved=(await audit(page)).programmeSaves[1].data;assert.deepEqual(saved.recipe,[]);assert.equal(saved.recurring,false);
      checks.push('Designer: shared recipe/permanent controls disabled; existing recipe retained; metadata, logo, voice and directories editable; new programme starts with false/empty shared recipe');
    }else{
      await expect(permanent).toBeEnabled();await permanent.check();
      await recipes.getByRole('checkbox',{name:'Bande-annonce',exact:true}).uncheck();
      await recipes.getByRole('checkbox',{name:'Pop-up',exact:true}).check();
      await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
      await expect.poll(async()=>(await audit(page)).programmeSaves.length).toBe(1);
      const saved=(await audit(page)).programmeSaves[0].data;assert.deepEqual(saved.recipe,['popup']);assert.equal(saved.recurring,true);
      checks.push('Broadcaster: permanent and shared recipe controls editable and chosen values passed to save');
    }
    await page.close();
  }
  {
    const page=await open(320,'dark','','admin',{hold:'media,voices,directories'});
    await programme(page);await advanced(page);
    for(const [legend,label] of [['Logo de l’émission','Chargement des images partagées…'],['Voix habituelle','Chargement des voix validées…'],['Emplacements partagés','Chargement des emplacements…']]){
      const group=page.getByRole('group',{name:legend,exact:true});
      await expect(group.getByRole('status')).toHaveText(label);
      await expect(group.locator('p').filter({hasText:/Aucun(?:e)? (?:image|voix validée|emplacement|dossier)/})).toHaveCount(0);
    }
    await expect(page.getByRole('combobox',{name:'Logo de l’émission',exact:true})).toHaveValue(logo(90));
    await expect(page.getByRole('combobox',{name:'Voix habituelle',exact:true})).toHaveValue(id(92));
    assert.deepEqual((await audit(page)).calls,{media:1,voices:1,directories:1});
    await capture(page,'loading-in-progress');
    await page.evaluate(()=>{for(const resource of ['media','voices','directories'])window.channelResourceRelease(resource);});
    await readyProgrammeResources(page);
    await expect(page.getByRole('status').filter({hasText:/Chargement des (?:images partagées|voix validées|emplacements)/})).toHaveCount(0);
    checks.push('Held async requests: real loading states stay visible until released, no false empty state, existing references retained, successful completion');await page.close();
  }
  {
    const page=await open(1366,'light','','admin',{'legacy-logo-absent':'1'});
    await programme(page);await navigate(page,'Accueil');
    await expect(page.getByRole('dialog',{name:'Conserver cette fiche ouverte ?',exact:true})).toHaveCount(0);
    await programme(page);await advanced(page);const {image}=await readyProgrammeResources(page);
    await expect(image).toHaveValue('');
    await page.getByRole('textbox',{name:'Notes de préparation',exact:true}).fill('Ancienne fiche conservée');
    await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
    await expect.poll(async()=>(await audit(page)).programmeSaves.length).toBe(1);
    const saved=(await audit(page)).programmeSaves[0].data;assert.equal(saved.logo,'');assert.equal(saved.voiceProfileId,id(92));assert.deepEqual(saved.directoryIds,[id(93)]);
    checks.push('Legacy programme without a logo property: no false dirty state on open/close; empty logo normalized on save without losing other resource references');await page.close();
  }
  {
    const page=await open(320,'light');let manager=await identity(page);
    const name=page.getByRole('textbox',{name:'Nom de la chaîne',exact:true});
    await name.fill('Modification à abandonner');await page.keyboard.press('Escape');
    await expect(page.getByRole('button',{name:'Continuer la modification',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Fermer sans enregistrer',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Gérer les chaînes',exact:true})).toBeFocused();
    assert.equal((await audit(page)).channelSaves.length,0);
    manager=await identity(page);await expect(name).toHaveValue('Bénin TV');
    await name.fill('Modification à rétablir');await manager.getByRole('button',{name:'Rétablir',exact:true}).click();
    await expect(name).toHaveValue('Bénin TV');await expect(manager.getByRole('button',{name:'Enregistrer l’identité',exact:true})).toBeDisabled();
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Gérer les chaînes',exact:true})).toBeFocused();
    assert.equal((await audit(page)).channelSaves.length,0);
    checks.push('Native Escape while dirty opens confirmation; discard makes no write and restores trigger focus; Reset restores saved identity and removes dirty guard');await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
  const report={scope:'Local Studio fixtures with stubbed APIs and synthetic media bytes only. No live account, external resource, backend or production verification. 720px screenshots emulate 1440px at 200% geometry; native browser zoom is not claimed.',checks,errors,unexpectedRequests};
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
