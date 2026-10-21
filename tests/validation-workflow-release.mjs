import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {chromium,expect} from '@playwright/test';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain.ts';

// Sealed built client → built Worker → isolated D1, synthetic accounts only.
// No production calls, e-mail provider, shared media or collaborator password.
const build=resolve('dist-studio-native'),output=resolve('reports/validation-workflow-release');
const origin='https://studio.example',email='validation-built@example.test',other='other-built@example.test',token='d'.repeat(64);
const requests=[],errors=[],unexpected=[];
const runtime=new Miniflare(convertV4MiniflareOptions({
 script:await readFile(resolve(build,'_worker.js'),'utf8'),modules:true,compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],
 d1Databases:['DB'],bindings:{AUTH_MODE:'firebase',APP_ENV:'production',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)},
 serviceBindings:{ASSETS:async request=>{
  const path=new URL(request.url).pathname,file=/^\/(assets|fonts|thumbnails|library|studio-engines)\//.test(path)?resolve(build,'.'+decodeURIComponent(path)):resolve(build,'index.html');
  if(!file.startsWith(build+sep))return new Response(null,{status:404});
  const types={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.ttf':'font/ttf','.otf':'font/otf','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json'};
  try{return new Response(await readFile(file),{headers:{'Content-Type':types[extname(file)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}
 }},outboundService:async()=>{throw Error('Unexpected external request in built validation test');}
}));
let browser;
try{
 const db=await runtime.getD1Database('DB');
 for(const name of (await readdir('migrations')).filter(name=>name.endsWith('.sql')).sort())await db.exec((await readFile(resolve('migrations',name),'utf8')).split(/\r?\n/).filter(line=>!line.trimStart().startsWith('--')).join(' '));
 for(const account of [email,other])await db.prepare("INSERT INTO members(email,name,role,firebase_uid,updated_by) VALUES(?,'Recette validation','designer',?,?)").bind(account,account,account).run();
 await db.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind(createHash('sha256').update(token).digest('hex'),email,email,Date.now()+3600000,Date.now()).run();
 const template=getTemplate('BTV_Relais_Antenne'),ids={submitted:randomUUID(),rejected:randomUUID(),approved:randomUUID()};
 for(const status of Object.keys(ids))for(const owner of [email,other])await db.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by,channel_id,status) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(owner===email?ids[status]:randomUUID(),`${owner===email?'Ma':'Autre'} version ${status}`,template.id,template.version,template.libraryVersion,JSON.stringify(templateDefaults(template)),owner,owner,'benin-tv',status).run();
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin){unexpected.push(url.origin);await route.abort();return;}
  requests.push({path:url.pathname,status:url.searchParams.get('status'),scope:url.searchParams.get('scope'),method:request.method()});
  const headers={...request.headers(),Cookie:'__Host-srtb_session='+token};delete headers['content-length'];
  const response=await runtime.dispatchFetch(request.url(),{method:request.method(),headers,...(!['GET','HEAD'].includes(request.method())?{body:request.postDataBuffer()}: {})});
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto(origin+'/graphics');await page.getByRole('navigation',{name:'Navigation Graphics',exact:true}).getByRole('button',{name:'Mes envois',exact:true}).click();
 const views=page.getByRole('group',{name:'Suivi des envois'}),search=page.getByRole('searchbox',{name:'Rechercher un projet',exact:true});
 for(const [label,status,action]of [['En attente','submitted','Voir'],['À corriger','rejected','Corriger'],['Validés','approved','Ouvrir']]){
  await views.getByRole('button',{name:label,exact:true}).click();await expect(page.getByRole('button',{name:`${action} : Ma version ${status}`,exact:true})).toBeVisible();
  await expect(page.locator('.project-row')).toHaveCount(1);await expect(page.locator('video,audio')).toHaveCount(0);
  assert.ok(requests.some(request=>request.status===status&&request.scope==='mine'));
 }
 await views.getByRole('button',{name:'À corriger',exact:true}).click();await search.fill('rejected');await page.getByRole('button',{name:'Corriger : Ma version rejected',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Nom du projet',exact:true})).toHaveValue('Ma version rejected');await expect(page.getByRole('button',{name:'Réglages',exact:true})).toHaveAttribute('aria-current','page');
 await page.locator('.workspace-back').click();await expect(search).toHaveValue('rejected');await expect(views.getByRole('button',{name:'À corriger',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Corriger : Ma version rejected',exact:true}).click();await page.getByRole('textbox',{name:'Nom du projet',exact:true}).fill('Ma version corrigée');await page.getByRole('button',{name:'Enregistrer les modifications',exact:true}).click();
 await expect(page.getByText('Corrections enregistrées. Soumettez cette nouvelle version au diffuseur.',{exact:true})).toBeVisible();
 const saved=await db.prepare('SELECT title,status,revision,visibility FROM projects WHERE id=?').bind(ids.rejected).first();assert.deepEqual(saved,{title:'Ma version corrigée',status:'draft',revision:2,visibility:'private'});
 await page.locator('.workspace-back').click();await expect(search).toHaveValue('rejected');await search.fill('');await expect(page.getByRole('heading',{name:'Aucune correction demandée',exact:true})).toBeVisible();
 await views.getByRole('button',{name:'En attente',exact:true}).click();await expect(page.getByRole('button',{name:'Voir : Ma version submitted',exact:true})).toBeVisible();
 await mkdir(output,{recursive:true});await page.screenshot({path:resolve(output,'mes-envois.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.equal(requests.filter(request=>request.method==='PUT').length,1);assert.ok(!requests.some(request=>request.method==='POST'));assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM projects').first()).n,6);
 await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,scope:'Sealed built client → built Worker → isolated D1; synthetic accounts only.',threeStatusViews:true,privateOwnerScope:true,returnKeepsViewAndQuery:true,correctionSavesAsPrivateDraft:true,explicitResubmissionNotice:true,noAutomaticExportOrSubmission:true,noMediaDecodedInLists:true,errors,unexpected},null,2));
 console.log('PASS built validation: three views, real private ACL, return context, corrected private draft and explicit resubmission.');
}finally{await browser?.close();await runtime.dispose();}
