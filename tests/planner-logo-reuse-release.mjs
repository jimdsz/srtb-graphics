import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {chromium,expect} from '@playwright/test';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

// Real built UI/Worker and isolated D1. Only synthetic PNG/account/conductor.
// This never connects to the production site, mail provider or media storage.
const build=resolve('dist-studio-native'),output=resolve('reports/planner-logo-reuse-release');
const origin='https://studio.example',email='logo-built@example.test',token='e'.repeat(64);
const requests=[],errors=[],unexpected=[];
const runtime=new Miniflare(convertV4MiniflareOptions({
 script:await readFile(resolve(build,'_worker.js'),'utf8'),modules:true,compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],
 d1Databases:['DB'],bindings:{AUTH_MODE:'firebase',APP_ENV:'production',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)},
 serviceBindings:{ASSETS:async request=>{
  const path=new URL(request.url).pathname,file=/^\/(assets|fonts|thumbnails|library)\//.test(path)?resolve(build,'.'+decodeURIComponent(path)):resolve(build,'index.html');
  if(!file.startsWith(build+sep))return new Response(null,{status:404});
  const types={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
  try{return new Response(await readFile(file),{headers:{'Content-Type':types[extname(file)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}
 }},outboundService:async()=>{throw Error('Unexpected network in built logo test');}
}));
let browser;
try{
 const db=await runtime.getD1Database('DB');
 for(const name of (await readdir('migrations')).filter(name=>name.endsWith('.sql')).sort())await db.exec((await readFile(resolve('migrations',name),'utf8')).split(/\r?\n/).filter(line=>!line.trimStart().startsWith('--')).join(' '));
 await db.prepare("INSERT INTO members(email,name,role,firebase_uid,updated_by) VALUES(?,'Recette logo','designer',?,?)").bind(email,email,email).run();
 await db.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind(createHash('sha256').update(token).digest('hex'),email,email,Date.now()+3600000,Date.now()).run();
 const programmeId=randomUUID(),otherId=randomUUID(),planId=randomUUID(),oldLogo={url:'local-media:'+'c'.repeat(64)+':100',name:'Logo particulier.png',mimeType:'image/png'};
 for(const [id,name] of [[programmeId,'LOGO TEST'],[otherId,'AUTRE FICHE']]){
  const data={name,aliases:[],category:'Magazine',logo:'',replayUrl:'',recurring:false,recipe:['ba'],notes:'',directoryIds:[],voiceProfileId:null};
  await db.prepare('INSERT INTO programmes(id,channel_id,name,identity,data_json,updated_by) VALUES(?,?,?,?,?,?)').bind(id,'benin-tv',name,name.toLowerCase(),JSON.stringify(data),email).run();
 }
 const rows=Array.from({length:7},(_,i)=>({id:'row-'+i,title:i===0?'LOGO SOURCE':'LOGO TEST',subtitle:'Épisode '+(i+1),category:'Magazine',sheet:'Grille',cell:'B'+(i+2),raw:'ORIGINAL '+i,broadcastDate:'2026-09-29',airDate:'2026-09-29',time:`${String(10+i).padStart(2,'0')}:30:00`,duration:1200,included:i!==5,kinds:['ba','popup'],formats:['tv','vertical'],issues:[],media:null,location:null,...(i===6?{}:{programmeId:i===3?otherId:programmeId,programmeRevision:1}),...(i===2?{logo:oldLogo}:{}),...(i===4?{sourceRemoved:true}:{})}));
 const initial={kind:'plan',name:'Reprise logo construite',source:'conducteur-fictif.xlsx',sourceHash:'d'.repeat(64),rows,sourceRows:structuredClone(rows),weekly:{rowIds:[],formats:['tv']}};
 await db.prepare("INSERT INTO planner_documents(id,kind,name,data_json,created_by,updated_by) VALUES(?,'plan',?,?,?,?)").bind(planId,initial.name,JSON.stringify(initial),email,email).run();
 const stored=async()=>JSON.parse((await db.prepare('SELECT data_json FROM planner_documents WHERE id=?').bind(planId).first()).data_json);
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin){unexpected.push(url.origin);await route.abort();return;}
  requests.push({path:url.pathname,method:request.method()});
  const headers={...request.headers(),Cookie:'__Host-srtb_session='+token};delete headers['content-length'];
  const response=await runtime.dispatchFetch(request.url(),{method:request.method(),headers,...(!['GET','HEAD'].includes(request.method())?{body:request.postDataBuffer()}: {})});
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto(origin+'/graphics');await page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name:'À faire',exact:true}).click();await page.getByLabel('Reprendre une préparation d’équipe').selectOption(planId);
 await page.getByRole('button',{name:'Préparer LOGO SOURCE',exact:true}).click();await page.getByRole('button',{name:'Logo de l’émission : LOGO SOURCE',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Logo facultatif',exact:true});await expect(dialog).toBeVisible();
 const png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=48;c.height=24;const x=c.getContext('2d');x.fillStyle='#efbd32';x.fillRect(0,0,48,24);return c.toDataURL('image/png').split(',')[1];}),'base64');
 async function chooseGroup(){
  await dialog.locator('input[type=file]').setInputFiles({name:'Logo local vérifié.png',mimeType:'image/png',buffer:png});
  const consent=dialog.getByRole('checkbox',{name:'J’ai vérifié ce logo pour cette émission.',exact:true});await expect(consent).toBeEnabled();await consent.check();
  const group=dialog.getByRole('checkbox',{name:'Autres occurrences de cette fiche',exact:true});await expect(group).not.toBeChecked();await group.check();
  await expect(dialog.locator('.planner-logo-occurrence')).toHaveCount(3);await expect(dialog.locator('.planner-logo-occurrence').filter({hasText:'Logo particulier.png'}).getByRole('checkbox')).toBeDisabled();
  await dialog.getByRole('button',{name:'Sélectionner les lignes sans logo',exact:true}).click();await expect(dialog.getByRole('button',{name:'Appliquer à 2 lignes',exact:true})).toBeEnabled();
 }
 await chooseGroup();await mkdir(output,{recursive:true});
 const layouts=[];
 for(const [width,height,theme] of [[1366,768,'dark'],[1366,768,'light'],[320,720,'dark'],[320,720,'light']]){
  await page.setViewportSize({width,height});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const geometry=await dialog.evaluate(element=>{
   const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};};
   return {dialog:rect(element),scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,labels:[...element.querySelectorAll('.planner-logo-confirm,.planner-logo-occurrence')].map(label=>{
    const input=label.querySelector('input'),span=label.querySelector('span'),style=getComputedStyle(input);
    return {label:rect(label),input:rect(input),text:rect(span),css:{display:getComputedStyle(label).display,width:style.width,minWidth:style.minWidth,flex:style.flex}};
   })};
  });
  layouts.push({width,height,theme,...geometry});
  await writeFile(resolve(output,'layout.json'),JSON.stringify(layouts,null,2));
  await page.screenshot({path:resolve(output,`built-logo-review-${width}-${theme}.png`),fullPage:true});
  assert.ok(geometry.scrollWidth<=geometry.clientWidth+1,`${width}/${theme}: dialog horizontal overflow`);
  for(const item of geometry.labels){
   assert.ok(item.input.width>=16&&item.input.width<=22,`${width}/${theme}: checkbox has intrinsic size, got ${item.input.width}`);
   assert.ok(item.input.x>=item.label.x-1&&item.text.right<=item.label.right+1,`${width}/${theme}: checkbox and label stay inside their row`);
   assert.ok(item.text.x>=item.input.right&&item.text.x-item.input.right<=16,`${width}/${theme}: readable adjacent label`);
  }
 }
 await page.setViewportSize({width:1366,height:768});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 await dialog.getByRole('button',{name:'Appliquer à 2 lignes',exact:true}).click();await expect(dialog).toHaveCount(0);
 assert.deepEqual(await stored(),initial,'No shared save while applying local logo');
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Annuler le dernier choix de logo',exact:true}).click();assert.deepEqual(await stored(),initial);
 await page.getByRole('button',{name:'Préparer LOGO SOURCE',exact:true}).click();await page.getByRole('button',{name:'Logo de l’émission : LOGO SOURCE',exact:true}).click();await chooseGroup();await dialog.getByRole('button',{name:'Appliquer à 2 lignes',exact:true}).click();await page.keyboard.press('Escape');
 const save=page.getByRole('button',{name:'Enregistrer les modifications',exact:true});await expect(save).toBeEnabled();
 const [saveResponse]=await Promise.all([page.waitForResponse(response=>response.url()===origin+'/api/graphics/planner/'+planId&&response.request().method()==='PUT'),save.click()]);
 assert.equal(saveResponse.status(),200,await saveResponse.text());await expect(save).toBeDisabled();
 const saved=await stored();assert.equal(saved.rows[0].logo.name,'Logo local vérifié.png');assert.deepEqual(saved.rows[0].logo,saved.rows[1].logo);assert.deepEqual(saved.rows[2].logo,oldLogo);
 for(let i=0;i<rows.length;i++){const {logo,...rest}=saved.rows[i],{logo:previous,...expected}=rows[i];assert.deepEqual(rest,expected);if(i>=3)assert.equal(logo,undefined);}
 assert.deepEqual(saved.sourceRows,initial.sourceRows);assert.deepEqual(saved.weekly,initial.weekly);
 // A later shared edit wins over our stale revision; the local choice remains recoverable.
 await page.getByRole('button',{name:'Préparer LOGO SOURCE',exact:true}).click();await page.getByRole('button',{name:'Logo de l’émission : LOGO SOURCE',exact:true}).click();
 await dialog.getByRole('button',{name:'Retirer le logo',exact:true}).click();await dialog.getByRole('checkbox',{name:'Je confirme le retrait du logo pour les nouveaux brouillons.',exact:true}).check();await dialog.getByRole('button',{name:'Confirmer le retrait',exact:true}).click();await page.keyboard.press('Escape');
 const concurrent=structuredClone(saved);concurrent.rows[1].subtitle='Retouche du collègue conservée';
 await db.prepare('UPDATE planner_documents SET data_json=?,revision=revision+1 WHERE id=?').bind(JSON.stringify(concurrent),planId).run();
 await save.click();await expect(page.getByRole('alert')).toContainText('Un collègue a modifié ou archivé cette préparation');await expect(save).toBeEnabled();assert.deepEqual(await stored(),concurrent);
 await page.getByRole('button',{name:'Préparer LOGO SOURCE',exact:true}).click();await expect(page.getByRole('button',{name:'Logo de l’émission : LOGO SOURCE',exact:true})).toContainText('À choisir ou proposer depuis la fiche');
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM projects').first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM media').first()).n,0);
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(requests.filter(item=>item.method==='PUT'),Array.from({length:2},()=>({path:'/api/graphics/planner/'+planId,method:'PUT'})));
 assert.ok(!requests.some(item=>/\.(mp4|mov|wav|mp3)$/.test(item.path)));assert.ok(!requests.some(item=>item.method==='POST'&&item.path!=='/api/graphics/planner/rules'));
 await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,scope:'Built UI → built Worker → isolated D1; synthetic account, PNG and conductor only.',layoutConfigurations:layouts.map(({width,height,theme})=>({width,height,theme})),matchedOccurrences:3,confirmedLogosApplied:2,manualLogoProtected:true,homonymRemovedExcludedUnlinkedUnchanged:true,undoAfterClose:true,sharedSaveExplicit:true,concurrentSharedEditProtected:true,localChoiceKeptAfterConflict:true,mediaUploaded:0,projectsCreated:0,errors,unexpected},null,2));
 console.log('PASS built grouped logos: real D1, local PNG, explicit scope/save, protected choices, safe undo, no upload or project creation.');
}finally{await browser?.close();await runtime.dispose();}
