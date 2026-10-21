import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {chromium,expect} from '@playwright/test';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain.ts';

// Actual sealed client -> actual Worker -> isolated D1. Synthetic account only.
// The guide must not write, share, submit, export, or bypass a dirty-project guard.
const build=resolve('dist-studio-native'),output=resolve('reports/graphics-help-release');
const origin='https://studio.example',email='help-built@example.test',token='e'.repeat(64);
const requests=[],errors=[],unexpected=[],checks=[];
const runtime=new Miniflare(convertV4MiniflareOptions({
 script:await readFile(resolve(build,'_worker.js'),'utf8'),modules:true,compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],
 d1Databases:['DB'],bindings:{AUTH_MODE:'firebase',APP_ENV:'production',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)},
 serviceBindings:{ASSETS:async request=>{
  const path=new URL(request.url).pathname,file=/^\/(assets|fonts|thumbnails|library|studio-engines)\//.test(path)?resolve(build,'.'+decodeURIComponent(path)):resolve(build,'index.html');
  if(!file.startsWith(build+sep))return new Response(null,{status:404});
  const types={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.ttf':'font/ttf','.otf':'font/otf','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json'};
  try{return new Response(await readFile(file),{headers:{'Content-Type':types[extname(file)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}
 }},outboundService:async()=>{throw Error('Unexpected external request in built guide test');}
}));
let browser;
async function navigate(page,label){
 const menu=page.getByRole('button',{name:'Menu',exact:true});
 if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')!=='true')await menu.click();
 await page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name:label,exact:true}).click();
}
async function selectTopic(page,id,title){
 const picker=page.getByRole('combobox',{name:'Rubrique',exact:true});
 if(await picker.isVisible())await picker.selectOption(id);
 else await page.getByRole('navigation',{name:'Rubriques du guide',exact:true}).getByRole('button',{name:title,exact:true}).click();
}
async function assertFit(page){
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No document overflow');
 for(const selector of ['.graphics-masthead .graphics-help-trigger','.graphics-masthead .theme-toggle','.graphics-masthead .profile .icon-button','.graphics-channel select']){
  const box=await page.locator(selector).boundingBox();assert.ok(box&&box.x>=-1&&box.x+box.width<=page.viewportSize().width+1,selector+' fits');
 }
 const overlap=await page.evaluate(()=>{
  const channel=document.querySelector('.graphics-channel').getBoundingClientRect(),profile=document.querySelector('.profile').getBoundingClientRect();
  return Math.min(channel.right,profile.right)-Math.max(channel.left,profile.left)>1&&Math.min(channel.bottom,profile.bottom)-Math.max(channel.top,profile.top)>1;
 });assert.equal(overlap,false,'Channel and account actions do not overlap');
}
try{
 const db=await runtime.getD1Database('DB');
 for(const name of (await readdir('migrations')).filter(name=>name.endsWith('.sql')).sort())await db.exec((await readFile(resolve('migrations',name),'utf8')).split(/\r?\n/).filter(line=>!line.trimStart().startsWith('--')).join(' '));
 await db.prepare("INSERT INTO members(email,name,role,firebase_uid,updated_by) VALUES(?,'Recette guide','designer',?,?)").bind(email,email,email).run();
 await db.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind(createHash('sha256').update(token).digest('hex'),email,email,Date.now()+3600000,Date.now()).run();
 const template=getTemplate('BTV_Relais_Antenne'),id=randomUUID();
 await db.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by,channel_id,status) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,'Mon projet de contrôle',template.id,template.version,template.libraryVersion,JSON.stringify(templateDefaults(template)),email,email,'benin-tv','draft').run();
 const before=await db.prepare('SELECT * FROM projects WHERE id=?').bind(id).first();
 browser=await chromium.launch({channel:'msedge',headless:true});await mkdir(output,{recursive:true});
 for(const width of [1366,1024,683,320])for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width,height:width>=1024?768:844},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==origin){unexpected.push(url.origin);await route.abort();return;}
   requests.push({path:url.pathname,method:request.method()});
   const headers={...request.headers(),Cookie:'__Host-srtb_session='+token};delete headers['content-length'];
   const response=await runtime.dispatchFetch(request.url(),{method:request.method(),headers,...(!['GET','HEAD'].includes(request.method())?{body:request.postDataBuffer()}: {})});
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  await page.goto(origin+'/graphics');await expect(page.getByRole('heading',{name:'Aujourd’hui',exact:true})).toBeVisible();
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await assertFit(page);
  await page.getByRole('button',{name:'Prise en main',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Un repère pour chaque étape.',exact:true});await expect(dialog).toBeVisible();
  assert.equal(await dialog.locator('video,audio,iframe').count(),0,'No guide media decoder/network');
  const topics=dialog.locator('.graphics-help-topic-picker option');assert.equal(await topics.count(),21);
  assert.equal(await topics.filter({hasText:'Équipe & accès'}).count(),0);
  await selectTopic(page,'programmes','Émissions');await expect(dialog.getByText('Fiches partagées par chaîne',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Suivant',exact:true}).click();await expect(dialog.getByText('Étape 2 / 4',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await page.getByRole('button',{name:'Guide',exact:true}).click();
  await expect(dialog.getByText('Étape 2 / 4',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Ouvrir Émissions',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Émissions',exact:true})).toBeVisible();await expect(page.getByText('Les fiches communes à votre chaîne. Vos montages restent dans Projets.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Aide : Émissions',exact:true}).click();
  const bubble=page.locator('.graphics-help-bubble:popover-open');await expect(bubble).toBeVisible();await bubble.getByRole('button',{name:'Voir pas à pas',exact:true}).click();
  await expect(dialog.getByText('Étape 1 / 4',{exact:true})).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.locator('video,audio')).toHaveCount(0);await assertFit(page);
  await page.screenshot({path:resolve(output,`emissions-${theme}-${width}.png`),fullPage:true});
  if(width===1366&&theme==='dark'){
   await navigate(page,'Projets');await page.locator('.project-row-title').filter({hasText:'Mon projet de contrôle'}).click();
   await page.getByRole('textbox',{name:'Nom du projet',exact:true}).fill('Retouche locale à préserver');
   await page.getByRole('button',{name:'Guide',exact:true}).click();await selectTopic(page,'programmes','Émissions');
   await dialog.getByRole('button',{name:'Ouvrir Émissions',exact:true}).click();
   const guard=page.getByRole('dialog',{name:'Conserver vos modifications ?',exact:true});await expect(guard).toBeVisible();
   await guard.getByRole('button',{name:'Rester sur le projet',exact:true}).click();
   await expect(page.getByRole('textbox',{name:'Nom du projet',exact:true})).toHaveValue('Retouche locale à préserver');
   await expect(page.getByRole('dialog')).toHaveCount(0);
   checks.push({dirtyGuard:true,localRetouchPreserved:true,guideNavigationDoesNotSave:true});
  }
  checks.push({width,theme,mastheadFit:true,memberRoleTopics:true,resume:true,contextBubble:true,noMediaDecoded:true});await page.close();
 }
 assert.deepEqual(await db.prepare('SELECT * FROM projects WHERE id=?').bind(id).first(),before,'No project changes');
 assert.equal(requests.filter(request=>!['GET','HEAD'].includes(request.method)).length,0,'No mutation by guide');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,scope:'Sealed built client -> built Worker -> isolated D1, synthetic account only.',checks,noBusinessWrites:true,noProjectChange:true,errors,unexpected},null,2));
 console.log('PASS built guide: responsive shell, role-aware topics, contextual help, progress, no writes and dirty-draft guard.');
}finally{await browser?.close();await runtime.dispose();}
