import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5234',directory=resolve('reports/media-preparation-paths-2026-10-01');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=','base64');
const movie=await readFile('tests/fixtures/weekly-witnesses-v2/media-1.mp4');
const job='22222222-2222-4222-8222-222222222222',fingerprint='c'.repeat(64),ticket='d'.repeat(64);
const descriptor={url:`local-media:${fingerprint}:${movie.length}`,name:'Programme - Graphics.mp4',mimeType:'video/mp4'};
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],unexpected=[],checks=[];
await mkdir(directory,{recursive:true});
async function open(path,width=1366){
 const page=await browser.newPage({viewport:{width,height:768},reducedMotion:'reduce'});
 const connector={mode:'error',starts:0,cancels:0,reads:0,leases:0,release:null};
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),method=route.request().method();
  if(url.origin==='http://127.0.0.1:43871'){
   const json=value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value),headers:{'Access-Control-Allow-Origin':base}});
   if(method==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST'}});
   if(url.pathname==='/v1/pair')return json({token:'a'.repeat(64),expires:Date.now()+3600000});
   if(url.pathname==='/v1/health')return json({protocol:1,version:'0.3.0',capabilities:['media-preparation-v1']});
   if(url.pathname==='/v1/preparation/pick'){connector.starts++;return json({id:job});}
   if(url.pathname===`/v1/preparation/${job}/cancel`){connector.cancels++;return json({ok:true});}
   if(url.pathname===`/v1/preparation/${job}`){
    connector.reads++;
    if(connector.mode==='hold')await new Promise(resolve=>{connector.release=resolve;});
    return json({id:job,status:connector.mode==='error'?'error':connector.mode==='running'?'running':'ready',stage:'Préparation de la copie',progress:37,...(connector.mode==='error'?{error:'Le disque de recette est indisponible.'}:{})}).catch(()=>{});
   }
   if(url.pathname===`/v1/preparation/${job}/lease`){connector.leases++;return json({descriptor,mediaPath:`/v1/media/${ticket}`});}
   if(url.pathname===`/v1/media/${ticket}`)return route.fulfill({status:200,contentType:'video/mp4',body:movie,headers:{'Access-Control-Allow-Origin':base}});
  }
  if(url.origin!==base||url.pathname.startsWith('/api/')||!['GET','HEAD'].includes(method)){unexpected.push({url:url.href,method});return route.abort();}
  return route.continue();
 });
 await page.goto(`${base}/tests/${path}`);
 return {page,connector};
}
const choose=(page,name,buffer=png,mimeType='image/png')=>page.locator('input[type=file]').setInputFiles({name,buffer,mimeType});
const pair=page=>page.evaluate(async()=>{const connector=await import('/src/studio/connector-client.ts');await connector.pairConnector('123456');});
const audit=page=>page.evaluate(()=>structuredClone(window.programmeMediaEvidence));
async function capture(page,name){await page.screenshot({path:resolve(directory,`${name}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: page overflow`);}
try{
 for(const width of [1366,390]){
  const {page,connector}=await open('programme-media-resources.html?mode=empty-catalogue',width);
  await choose(page,'Choix conservé.png');await expect(page.getByRole('img',{name:'Média sélectionné',exact:true})).toBeVisible();
  const original=await page.getByRole('img',{name:'Média sélectionné',exact:true}).getAttribute('src');
  await choose(page,'Invalide.mp4',Buffer.from('not a video'),'video/mp4');await expect(page.getByRole('alert')).toContainText('ne peut pas être lu');
  await expect(page.getByRole('img',{name:'Média sélectionné',exact:true})).toHaveAttribute('src',original);
  await choose(page,'Programme.mxf',Buffer.from('synthetic MXF candidate'),'application/mxf');await expect(page.getByText('Copie MP4 sur ce poste',{exact:true})).toBeVisible();
  assert.equal(connector.starts,0);await expect(page.getByRole('button',{name:'Utiliser ce média',exact:true})).toBeDisabled();
  await capture(page,`planner-candidate-${width}`);await pair(page);
  await page.getByRole('button',{name:'Préparer et utiliser',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Le disque de recette est indisponible.');
  await expect(page.getByRole('img',{name:'Média sélectionné',exact:true})).toHaveAttribute('src',original);assert.deepEqual((await audit(page)).bindings,[]);
  connector.mode='running';await page.getByRole('button',{name:'Réessayer la préparation',exact:true}).click();await expect(page.getByRole('progressbar')).toHaveAttribute('value','37');
  await capture(page,`planner-progress-${width}`);await page.getByRole('button',{name:'Annuler la préparation',exact:true}).click();await expect(page.getByText('Préparation annulée. Le média actuel reste utilisé.',{exact:true})).toBeVisible();
  await expect(page.getByRole('img',{name:'Média sélectionné',exact:true})).toHaveAttribute('src',original);assert.deepEqual((await audit(page)).bindings,[]);
  connector.mode='ready';await page.getByRole('button',{name:'Préparer et utiliser',exact:true}).click();await expect(page.getByText('Programme - Graphics.mp4',{exact:true})).toBeVisible();
  await expect(page.locator('.planner-media-preview video')).toHaveAttribute('src',`http://127.0.0.1:43871/v1/media/${ticket}`);assert.deepEqual((await audit(page)).bindings,[],'Preparation still requires manual planner confirmation');
  await page.getByRole('button',{name:'Utiliser ce média',exact:true}).click();await expect.poll(async()=>(await audit(page)).bindings.length).toBe(1);
  assert.deepEqual((await audit(page)).bindings[0].media,descriptor);assert.equal((await audit(page)).bindings[0].location,null,'Prepared copy must not acquire the original source path');
  assert.deepEqual((await audit(page)).writes,[]);checks.push({flow:'planner',width,invalidPreserves:true,preparationErrorPreserves:true,cancelPreserves:true,validatedPreparedCopy:true,explicitConfirmation:true});await page.close();
 }
 {
  const {page,connector}=await open('programme-media-resources.html?mode=empty-catalogue');await pair(page);
  await choose(page,'Programme.mov',Buffer.from('synthetic MOV candidate'),'video/quicktime');connector.mode='hold';
  await page.getByRole('button',{name:'Préparer et utiliser',exact:true}).click();await expect.poll(()=>connector.release!==null).toBe(true);
  await choose(page,'Nouveau choix.png');await expect(page.getByText('Nouveau choix.png',{exact:true})).toBeVisible();connector.mode='ready';connector.release();
  await expect.poll(()=>connector.cancels).toBe(1);assert.equal(connector.leases,0);await expect(page.getByText('Nouveau choix.png',{exact:true})).toBeVisible();assert.deepEqual((await audit(page)).bindings,[]);
  checks.push({flow:'planner-late-result',newChoicePreserved:true,noLateLease:true});await page.close();
 }
 for(const width of [1366,390]){
  const {page,connector}=await open('media-library-import.html',width);await page.locator('.media-upload-disclosure summary').click();
  await choose(page,'Partage précédent.png');await expect(page.locator('.media-import-filename')).toContainText('Partage précédent.png');
  await page.getByRole('checkbox').check();await expect(page.getByRole('button',{name:'Partager ce média',exact:true})).toBeEnabled();
  await choose(page,'Programme.mxf',Buffer.from('synthetic MXF candidate'),'application/mxf');await expect(page.getByRole('region',{name:'Préparation locale nécessaire'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Partager ce média',exact:true})).toBeDisabled();await expect(page.getByRole('checkbox')).not.toBeChecked();assert.equal(connector.starts,0);
  await capture(page,`library-guidance-${width}`);await page.getByRole('button',{name:'Ouvrir mes projets',exact:true}).click();assert.equal(await page.evaluate(()=>window.mediaLibraryEvidence.projectActions),1);
  await page.getByRole('button',{name:'Conserver le fichier précédent',exact:true}).click();await expect(page.locator('.media-import-filename')).toContainText('Partage précédent.png');await expect(page.getByRole('checkbox')).not.toBeChecked();
  await choose(page,'Cassé.mp4',Buffer.from('not a video'),'video/mp4');await expect(page.getByRole('alert')).toContainText('ne peut pas être lu');await expect(page.locator('.media-import-filename')).toContainText('Partage précédent.png');
  await expect(page.getByRole('button',{name:'Partager ce média',exact:true})).toBeDisabled();assert.equal(await page.evaluate(()=>window.mediaLibraryEvidence.refreshes),0);
  checks.push({flow:'library',width,noUpload:true,noPreparationStarted:true,projectAction:true,previousFilePreserved:true,consentReset:true});await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 const report={scope:'Isolated browser UI; synthetic files, existing synthetic MP4 fixture and intercepted connector responses. All production/API requests blocked; no uploads, native engine, real permissions or codec support qualification.',checks,errors,unexpected};
 await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
