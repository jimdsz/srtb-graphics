import {chromium,expect} from '@playwright/test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain.ts';

// Sealed production build, isolated D1 and synthetic users only. No real mail,
// collaborator password, production deletion or remote Firebase call.
const build=resolve('dist-studio-native'),output=resolve('reports/member-recreation');
const origin='https://studio.example',admin='admin@example.com',target='returning-member@example.test',token='c'.repeat(64);
const errors=[],unexpected=[],requests=[];
let invitationCreates=0,invitationMails=0;
const runtime=new Miniflare(convertV4MiniflareOptions({
 script:await readFile(resolve(build,'_worker.js'),'utf8'),modules:true,compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
 bindings:{AUTH_MODE:'firebase',APP_ENV:'production',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)},
 serviceBindings:{ASSETS:async request=>{
  const path=new URL(request.url).pathname,file=/^\/(assets|fonts|thumbnails|library|studio-engines)\//.test(path)?resolve(build,'.'+decodeURIComponent(path)):resolve(build,'index.html');
  if(!file.startsWith(build+sep))return new Response(null,{status:404});
  const types={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.ttf':'font/ttf','.otf':'font/otf','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json'};
  try{return new Response(await readFile(file),{headers:{'Content-Type':types[extname(file)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}
 }},outboundService:async request=>{
  const url=new URL(request.url),body=await request.json();
  assert.equal(request.method,'POST');assert.equal(request.headers.get('Authorization'),null);
  if(url.origin==='https://identitytoolkit.googleapis.com'&&url.pathname==='/v1/accounts:signUp'){
   invitationCreates++;assert.equal(body.email,target);assert.match(body.password,/^Aa1![a-f0-9]{64}$/);
   return Response.json({error:{message:'EMAIL_EXISTS'}},{status:400});
  }
  if(url.origin==='https://identitytoolkit.googleapis.com'&&url.pathname==='/v1/accounts:sendOobCode'){
   invitationMails++;assert.deepEqual(body,{requestType:'PASSWORD_RESET',email:target,continueUrl:'https://srtb-graphics.pages.dev/login'});
   return Response.json({email:target});
  }
  unexpected.push(url.origin+url.pathname);throw Error('Unexpected external request in member test');
 }
}));
let browser;
try{
 const db=await runtime.getD1Database('DB');
 for(const name of (await readdir('migrations')).filter(name=>name.endsWith('.sql')).sort())await db.exec((await readFile(resolve('migrations',name),'utf8')).split(/\r?\n/).filter(line=>!line.trimStart().startsWith('--')).join(' '));
 await db.prepare('UPDATE members SET firebase_uid=? WHERE email=?').bind('synthetic-admin',admin).run();
 await db.prepare('INSERT INTO members(email,name,role,firebase_uid,updated_by) VALUES(?,?,?,?,?)').bind(target,'Membre à réautoriser','designer','retained-identity',admin).run();
 for(const [secret,email,uid]of [[token,admin,'synthetic-admin'],['b'.repeat(64),target,'retained-identity']])await db.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind(createHash('sha256').update(secret).digest('hex'),email,uid,Date.now()+3600000,Date.now()).run();
 const template=getTemplate('BTV_Relais_Antenne'),id=randomUUID();
 await db.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)').bind(id,'Projet à conserver',template.id,template.version,template.libraryVersion,JSON.stringify(templateDefaults(template)),target,target).run();
 const before=await db.prepare('SELECT * FROM projects WHERE id=?').bind(id).first();
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin){unexpected.push(url.origin);await route.abort();return;}
  requests.push({path:url.pathname,method:request.method()});
  const headers={...request.headers(),Cookie:'__Host-srtb_session='+token};delete headers['content-length'];
  const response=await runtime.dispatchFetch(request.url(),{method:request.method(),headers,...(!['GET','HEAD'].includes(request.method())?{body:request.postDataBuffer()}: {})});
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto(origin+'/graphics');await page.getByRole('button',{name:'Équipe & accès',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Ajouter un membre',exact:true})).toBeVisible();
 // Suspension is deliberately distinct from irreversible deletion. It retains
 // the identity and project, and must never call Firebase account deletion.
 await page.getByRole('button',{name:`Modifier : Membre à réautoriser (${target})`,exact:true}).click();await page.getByLabel('Accès autorisé',{exact:true}).uncheck();await page.getByRole('button',{name:'Enregistrer l’accès suspendu',exact:true}).click();
 await expect(page.locator('.notice[role="status"]')).toContainText('conserve son identifiant');await expect(page.locator('.member-row').filter({hasText:target})).toContainText('Suspendu');
 assert.equal(invitationCreates,0);assert.equal(invitationMails,0);
 const removed=await db.prepare('SELECT active,removed_at,firebase_uid FROM members WHERE email=?').bind(target).first();assert.equal(removed.active,0);assert.equal(removed.removed_at,null);assert.equal(removed.firebase_uid,'retained-identity');
 assert.equal((await runtime.dispatchFetch(origin+'/api/me',{headers:{Cookie:'__Host-srtb_session='+'b'.repeat(64)}})).status,401);
 await page.getByRole('button',{name:`Modifier : Membre à réautoriser (${target})`,exact:true}).click();await expect(page.getByLabel('Adresse e-mail',{exact:true})).toHaveValue(target);assert.equal((await db.prepare('SELECT active FROM members WHERE email=?').bind(target).first()).active,0,'Preparing restoration does not grant access');await page.getByLabel('Nom',{exact:true}).fill('Membre de retour');await page.getByLabel('Adresse e-mail',{exact:true}).fill(target.toUpperCase());await page.getByLabel('Accès autorisé',{exact:true}).check();await page.getByRole('combobox',{name:/Rôle/}).selectOption('broadcaster');await page.getByRole('button',{name:'Réautoriser et inviter',exact:true}).click();
 await expect(page.locator('.notice[role="status"]')).toContainText('conserve son identifiant');await expect(page.locator('.member-row').filter({hasText:target})).toHaveCount(1);
 await expect(page.locator('.member-row').filter({hasText:target})).toContainText('Envoi demandé');assert.equal(invitationCreates,1);assert.equal(invitationMails,1);
 assert.deepEqual(await db.prepare('SELECT role,active,removed_at,firebase_uid FROM members WHERE email=?').bind(target).first(),{role:'broadcaster',active:1,removed_at:null,firebase_uid:'retained-identity'});
 assert.deepEqual(await db.prepare('SELECT * FROM projects WHERE id=?').bind(id).first(),before);assert.equal((await db.prepare('SELECT COUNT(*) n FROM app_sessions WHERE email=?').bind(target).first()).n,0);
 await mkdir(output,{recursive:true});await page.screenshot({path:resolve(output,'admin-reauthorisation.png'),fullPage:true});await page.close();
 const loginChecks=[];
 for(const width of [1366,320]){
  const login=await browser.newPage({viewport:{width,height:768}});login.on('pageerror',error=>errors.push(error.message));let creates=0,signins=0,recovery=0;
  await login.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.hostname==='identitytoolkit.googleapis.com'&&url.pathname.endsWith('/accounts:signUp')){creates++;await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:{code:400,message:'EMAIL_EXISTS'}})});return;}
   if(url.hostname==='identitytoolkit.googleapis.com'&&url.pathname.endsWith('/accounts:signInWithPassword')){signins++;await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:{code:400,message:'INVALID_LOGIN_CREDENTIALS'}})});return;}
   if(url.origin!==origin){unexpected.push(url.origin+url.pathname);await route.abort();return;}
   if(url.pathname==='/api/auth/recovery/request'){recovery++;assert.equal(request.postDataJSON().email,target);await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})});return;}
   const response=await runtime.dispatchFetch(request.url(),{method:request.method(),headers:request.headers(),...(!['GET','HEAD'].includes(request.method())?{body:request.postDataBuffer()}: {})});
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  await login.goto(origin+'/graphics');await login.getByRole('button',{name:'Première connexion',exact:true}).click();await login.getByLabel('Adresse e-mail',{exact:true}).fill(target);await login.getByLabel('Mot de passe SRTB',{exact:true}).fill('Synthetic-only-12345');await login.getByRole('button',{name:'Activer mon compte',exact:true}).click();
  await expect(login.getByRole('heading',{name:'Reprendre votre accès.',exact:true})).toBeVisible();await expect(login.getByLabel('Mot de passe SRTB',{exact:true})).toHaveValue('');await expect(login.getByLabel('Mot de passe SRTB',{exact:true})).toHaveAttribute('autocomplete','current-password');assert.equal(creates,1);assert.equal(signins,0);assert.equal(recovery,0);
  await login.getByLabel('Mot de passe SRTB',{exact:true}).fill('Synthetic-only-wrong-123');await login.getByRole('button',{name:'Se connecter',exact:true}).click();await expect(login.getByRole('alert')).toHaveText('Adresse ou mot de passe incorrect.');assert.equal(signins,1);
  await login.getByRole('button',{name:'Recevoir un lien',exact:true}).click();await expect(login.getByLabel('Adresse e-mail',{exact:true})).toHaveValue(target);assert.equal(recovery,0);await login.getByRole('button',{name:'Recevoir le lien',exact:true}).click();await expect(login.getByRole('heading',{name:'Vérifiez votre messagerie.',exact:true})).toBeVisible();assert.equal(recovery,1);
  assert.equal(await login.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await login.screenshot({path:resolve(output,`reprise-${width}.png`),fullPage:true});loginChecks.push({width,creates,signins,recovery,passed:true});await login.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.equal(requests.filter(request=>request.method==='DELETE').length,0);assert.equal(requests.filter(request=>request.path==='/api/graphics/members'&&request.method==='POST').length,2);
 await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,scope:'Sealed build → isolated Worker/D1; synthetic identities and intercepted Firebase error responses only; no real mail.',suspendedAccessRevoked:true,projectsPreserved:true,sameEmailReauthorised:true,identityPinPreserved:true,oldSessionNotRestored:true,loginChecks,errors,unexpected},null,2));console.log('PASS suspended/reactivated access: real isolated admin flow and explicit existing-identity recovery, desktop and narrow viewport.');
}finally{await browser?.close();await runtime.dispose();}
