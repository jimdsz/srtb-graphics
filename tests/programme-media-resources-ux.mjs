import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',directory=resolve('reports/programme-media-resources');
const id=value=>`22222222-2222-4222-8222-${String(value).padStart(12,'0')}`;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=','base64');
const checks=[],errors=[],unexpectedRequests=[];
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const audit=page=>page.evaluate(()=>structuredClone(window.programmeMediaEvidence));
const folder=page=>page.locator('details').filter({has:page.locator('summary').filter({hasText:'Dossiers d’équipe et recherche de médias'})});
async function open(width=1366,theme='dark',mode='single',hold=false){
  const page=await browser.newPage({viewport:{width,height:width===720?450:768},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(request.method())){unexpectedRequests.push({url:url.href,method:request.method()});return route.abort();}
    return route.continue();
  });
  await page.goto(`${base}/tests/programme-media-resources.html?${new URLSearchParams({mode,...(hold?{hold:'1'}:{})})}`);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect(page.getByRole('dialog',{name:'Le média de « Magazine de recette »',exact:true})).toBeVisible();
  await folder(page).locator('summary').click();
  return page;
}
async function settled(page){await expect(page.getByRole('status',{name:'Lecture des dossiers d’équipe',exact:true})).toHaveCount(0);await expect(folder(page).getByRole('button',{name:/^(?:Réessayer les dossiers|Actualiser les dossiers d’équipe)$/})).toBeEnabled();}
async function noAutomaticSelection(page){
  const evidence=await audit(page);assert.equal(evidence.pickerCalls,0);assert.equal(evidence.permissionCalls,0);assert.equal(evidence.diskReads,0);assert.deepEqual(evidence.bindings,[]);assert.deepEqual(evidence.writes,[]);assert.equal(evidence.mediaReads,0);
  await expect(page.getByRole('heading',{name:'Vérifier le média',exact:true})).toHaveCount(0);
  await expect(page.locator('audio,video,img')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Utiliser ce média',exact:true})).toHaveCount(0);
}
async function capture(page,name){
  await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: page overflow`);
  assert.equal(await page.locator('dialog[open]').evaluate(node=>node.scrollWidth>node.clientWidth+1),false,`${name}: dialog overflow`);
}
async function localChoice(page){
  await page.locator('input[type=file]').setInputFiles({name:'Choix manuel conservé.png',mimeType:'image/png',buffer:png});
  await expect(page.getByRole('heading',{name:'Vérifier le média',exact:true})).toBeVisible();
  await expect(page.getByText('Choix manuel conservé.png',{exact:true})).toBeVisible();
}
try{
  for(const width of [1366,720,320])for(const theme of ['dark','light']){
    const page=await open(width,theme);await settled(page);
    await expect(page.getByRole('combobox',{name:'Dossier indexé',exact:true})).toHaveValue(id(1));
    await expect(folder(page).getByRole('status')).toHaveText('Dossier proposé par la fiche émission. Vérifiez l’épisode ; l’accès reste à autoriser sur ce poste.');
    await expect(page.getByRole('heading',{name:'Suggestions à vérifier',exact:true})).toBeVisible();
    const evidence=await audit(page);assert.deepEqual(evidence.directoryOffsets,[0,100]);assert.deepEqual(evidence.directoryGets,[id(1)]);assert.equal(evidence.programmeCalls.length,1);
    assert.deepEqual(await page.getByRole('combobox',{name:'Dossier indexé',exact:true}).locator('option').allTextContents(),['Nouvel emplacement','Émission — dossier suggéré','Dossier choisi manuellement','Dossier de la source enregistrée']);
    await noAutomaticSelection(page);await capture(page,`suggested-${theme}-${width}`);
    await page.getByRole('heading',{name:'Suggestions à vérifier',exact:true}).scrollIntoViewIfNeeded();await capture(page,`candidates-${theme}-${width}`);
    // A suggested index is not a grant. Only this explicit action invokes the fake picker.
    await page.getByRole('button',{name:'Connecter ce dossier sur mon poste',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Choix du dossier annulé. Vos choix sont conservés.'})).toBeVisible();
    const after=await audit(page);assert.equal(after.pickerCalls,1);assert.equal(after.permissionCalls,0);assert.equal(after.diskReads,0);assert.deepEqual(after.bindings,[]);assert.deepEqual(after.writes,[]);
    checks.push({name:`${theme}-${width}`,pagination:true,suggestionOnly:true,explicitPickerOnly:true});await page.close();
  }
  for(const mode of ['multiple','location','mismatch','empty','empty-catalogue','unlinked','directory-error']){
    const page=await open(320,'light',mode);await settled(page);
    const select=page.getByRole('combobox',{name:'Dossier indexé',exact:true});
    await expect(select).toHaveValue(mode==='location'?id(3):'');
    if(mode==='multiple')await expect(folder(page).getByRole('status')).toHaveText('Plusieurs dossiers habituels sont disponibles : choisissez celui de cet épisode.');
    if(mode==='mismatch')await expect(folder(page).getByRole('status')).toHaveText('La fiche émission a changé. Confirmez à nouveau son rapprochement pour utiliser ses nouvelles ressources.');
    if(mode==='directory-error')await expect(folder(page).getByRole('status')).toHaveText('Le dossier mémorisé n’est pas disponible. Choisissez un autre dossier ou un fichier sur ce poste.');
    if(['empty','empty-catalogue','unlinked','location'].includes(mode))await expect(folder(page).getByRole('status')).toHaveCount(0);
    if(mode==='location')assert.deepEqual((await audit(page)).directoryGets,[id(3)],'Explicit row source overrides programme proposal');
    if(mode==='unlinked')assert.deepEqual((await audit(page)).programmeCalls,[],'No lookup by guessed title');
    if(mode==='empty-catalogue')await expect(select.locator('option')).toHaveCount(1);
    await noAutomaticSelection(page);await capture(page,`${mode}-light-320`);checks.push({name:mode,noAutomaticBinding:true});await page.close();
  }
  for(const mode of ['programme-error','catalogue-error']){
    const page=await open(320,'dark',mode);await settled(page);
    await expect(folder(page).getByRole('status')).toContainText(mode==='programme-error'?'Ressources de la fiche indisponibles.':'Erreur du catalogue de dossiers de recette');
    await expect(page.getByRole('combobox',{name:'Dossier indexé',exact:true})).toHaveValue('');await noAutomaticSelection(page);
    await capture(page,`${mode}-dark-320`);
    await folder(page).getByRole('button',{name:'Réessayer les dossiers',exact:true}).click();await settled(page);
    await expect(page.getByRole('combobox',{name:'Dossier indexé',exact:true})).toHaveValue(id(1));await noAutomaticSelection(page);
    checks.push({name:mode,retry:true,noFalseEmpty:true});await page.close();
  }
  for(const mode of ['single','mismatch']){
    const page=await open(320,'light',mode,true);
    await expect(folder(page).getByRole('status').filter({hasText:'Lecture des dossiers d’équipe'})).toBeVisible();
    await localChoice(page);const initial=await page.getByRole('img',{name:'Média sélectionné',exact:true}).getAttribute('src');
    await page.evaluate(()=>window.programmeMediaControl.release(1));await settled(page);
    await expect(page.getByRole('img',{name:'Média sélectionné',exact:true})).toHaveAttribute('src',initial);
    await expect(page.getByText('Choix manuel conservé.png',{exact:true})).toBeVisible();
    if(mode==='mismatch')await expect(folder(page).getByRole('status')).toHaveText('La fiche émission a changé. Confirmez à nouveau son rapprochement pour utiliser ses nouvelles ressources.');
    const evidence=await audit(page);assert.deepEqual(evidence.bindings,[]);assert.deepEqual(evidence.writes,[]);assert.equal(evidence.pickerCalls,0);assert.equal(evidence.permissionCalls,0);assert.equal(evidence.diskReads,0);
    await page.locator('.planner-media-preview').scrollIntoViewIfNeeded();
    await capture(page,`manual-file-late-${mode}-light-320`);checks.push({name:`manual-file-during-held-${mode}`,selectionPreserved:true,noAutomaticBinding:true});await page.close();
  }
  {
    const page=await open();await settled(page);
    await page.evaluate(()=>window.programmeMediaControl.holdNext());await folder(page).getByRole('button',{name:'Réessayer les dossiers',exact:true}).click();
    await expect.poll(async()=>(await audit(page)).programmeCalls.length).toBe(2);
    await page.getByRole('combobox',{name:'Dossier indexé',exact:true}).selectOption(id(2));await expect(page.getByRole('combobox',{name:'Dossier indexé',exact:true})).toHaveValue(id(2));
    await page.evaluate(()=>window.programmeMediaControl.release(2));await settled(page);
    await expect(page.getByRole('combobox',{name:'Dossier indexé',exact:true})).toHaveValue(id(2));await noAutomaticSelection(page);
    checks.push({name:'manual-directory-during-held-refresh',selectionPreserved:true});await page.close();
  }
  for(const [number,revision,expected]of [[12,6,3],[11,5,2]]){
    const page=await open(720,'dark','single',true);
    await expect.poll(async()=>(await audit(page)).programmeCalls.length).toBe(1);
    await page.evaluate(({number,revision})=>window.programmeMediaControl.change(number,revision),{number,revision});
    await settled(page);await expect(page.getByRole('combobox',{name:'Dossier indexé',exact:true})).toHaveValue(id(expected));
    await page.evaluate(()=>window.programmeMediaControl.release(1));
    await expect.poll(async()=>(await audit(page)).programmeCalls[0].settled).toBe(true);
    await expect(page.getByRole('combobox',{name:'Dossier indexé',exact:true})).toHaveValue(id(expected));
    const evidence=await audit(page);assert.equal(evidence.programmeCalls[0].aborted,true);assert.equal(evidence.programmeCalls.length,2);assert.deepEqual(evidence.directoryGets,[id(expected)],'Stale programme reply must not even open its old directory index');
    await noAutomaticSelection(page);checks.push({name:number===12?'changed-programme-id':'changed-programme-revision',staleReplyDiscarded:true});await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
  const report={scope:'Isolated PlannerMediaDialog with fake api.programme/plannerAPI metadata, blocked API/external requests and trapped disk permission methods. A synthetic in-memory PNG exercises manual choice; no audio, real files, real account, backend, network-share permissions or production tested. 720×450 is CSS reflow geometry, not native 200% browser zoom.',checks,errors,unexpectedRequests};
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
