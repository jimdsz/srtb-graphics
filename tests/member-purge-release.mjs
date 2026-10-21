import {chromium,expect} from '@playwright/test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPairSync,createHash,randomUUID} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults} from '../src/studio/domain.ts';

// Real sealed UI → Worker → isolated D1. ALL provider traffic is intercepted;
// generated credentials and identities below exist only in this test process.
const build=resolve('dist-studio-native'),output=resolve('reports/member-purge');
const origin='https://studio.example',admin='admin@example.com',target='purge-member@example.test',colleague='colleague@example.test',token='d'.repeat(64);
const media=randomUUID(),key='uploads/'+media,owned=randomUUID(),survivor=randomUUID();
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
let identityPresent=true,activeIdentity='synthetic-target',failDelete=true,deleteAttempts=0,deletedIdentity=0,invitationCreates=0,invitationMails=0;
const versions=new Set(['original','older-version','hide-marker']),providerCalls=[],unexpected=[],errors=[];
const xml=body=>new Response(body,{headers:{'Content-Type':'application/xml'}});
const runtime=new Miniflare(convertV4MiniflareOptions({
 script:await readFile(resolve(build,'_worker.js'),'utf8'),modules:true,compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
 bindings:{AUTH_MODE:'firebase',APP_ENV:'production',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35),
  FIREBASE_ACCOUNT_DELETER:JSON.stringify({project_id:'srtb-test-auth',client_email:'graphics-account-deleter@srtb-test-auth.iam.gserviceaccount.com',private_key:privateKey}),
  STORAGE_PROVIDER:'b2',B2_REGION:'eu-central-003',B2_BUCKET:'srtb-test-private',B2_KEY_ID:'synthetic000000000000000',B2_APPLICATION_KEY:'synthetic-key-not-real00000000000'},
 serviceBindings:{ASSETS:async request=>{
  const path=new URL(request.url).pathname,file=/^\/(assets|fonts|thumbnails|library|studio-engines)\//.test(path)?resolve(build,'.'+decodeURIComponent(path)):resolve(build,'index.html');
  if(!file.startsWith(build+sep))return new Response(null,{status:404});
  const types={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.ttf':'font/ttf','.otf':'font/otf','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json'};
  try{return new Response(await readFile(file),{headers:{'Content-Type':types[extname(file)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}
 }},outboundService:async request=>{
  const url=new URL(request.url);providerCalls.push({path:url.origin+url.pathname,method:request.method});
  if(url.href==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-test-only-token'});
  if(url.origin==='https://identitytoolkit.googleapis.com'){
   const body=await request.json();assert.ok(!('idToken' in body));
   if(url.pathname==='/v1/accounts:signUp'){
    assert.equal(request.headers.get('Authorization'),null);assert.equal(body.email,target);assert.match(body.password,/^Aa1![a-f0-9]{64}$/);assert.equal(identityPresent,false);
    invitationCreates++;identityPresent=true;activeIdentity='synthetic-recreated';return Response.json({localId:activeIdentity,email:target});
   }
   if(url.pathname==='/v1/accounts:sendOobCode'){
    assert.equal(request.headers.get('Authorization'),null);assert.equal(identityPresent,true);assert.deepEqual(body,{requestType:'PASSWORD_RESET',email:target,continueUrl:'https://srtb-graphics.pages.dev/login'});
    invitationMails++;return Response.json({email:target});
   }
   assert.equal(request.headers.get('Authorization'),'Bearer synthetic-test-only-token');
   if(url.pathname==='/v1/projects/srtb-test-auth/accounts:lookup'){
    assert.ok(body.email?.[0]===target||body.localId?.[0]===activeIdentity);return Response.json(identityPresent?{users:[{email:target,localId:activeIdentity}]}:{});
   }
   if(url.pathname==='/v1/projects/srtb-test-auth/accounts:delete'){
    assert.deepEqual(body,{localId:'synthetic-target'});deleteAttempts++;
    if(failDelete){failDelete=false;return Response.json({error:'synthetic-provider-failure'},{status:503});}
    identityPresent=false;deletedIdentity++;return Response.json({});
   }
  }
  if(url.href==='https://api.backblazeb2.com/b2api/v4/b2_authorize_account')return Response.json({apiInfo:{storageApi:{allowed:{capabilities:['listFiles','deleteFiles','writeFiles'],namePrefix:'uploads/',buckets:[{name:'srtb-test-private'}]}}}});
  if(url.origin==='https://s3.eu-central-003.backblazeb2.com'){
   if(url.searchParams.has('acl'))return xml('<AccessControlPolicy xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>owner</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>');
   if(request.method==='DELETE'){
    assert.equal(url.pathname,'/srtb-test-private/'+key);assert.ok(versions.delete(url.searchParams.get('versionId')));return new Response(null,{status:204});
   }
   if(url.searchParams.has('versions')){
    assert.equal(url.searchParams.get('prefix'),key);
    return xml('<ListVersionsResult>'+[...versions].map(version=>`<${version==='hide-marker'?'DeleteMarker':'Version'}><Key>${key}</Key><VersionId>${version}</VersionId></${version==='hide-marker'?'DeleteMarker':'Version'}>`).join('')+`<Version><Key>${key}-neighbour</Key><VersionId>untouched-neighbour</VersionId></Version></ListVersionsResult>`);
   }
  }
  unexpected.push(url.origin+url.pathname);throw Error('Unexpected external request blocked');
 }
}));
let browser;
try{
 const db=await runtime.getD1Database('DB');
 for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec((await readFile(resolve('migrations',name),'utf8')).split(/\r?\n/).filter(l=>!l.trimStart().startsWith('--')).join(' '));
 await db.prepare('UPDATE members SET firebase_uid=? WHERE email=?').bind('synthetic-admin',admin).run();
 for(const [email,name,uid]of [[target,'Membre fictif','synthetic-target'],[colleague,'Collègue fictif','synthetic-colleague']])await db.prepare('INSERT INTO members(email,name,role,firebase_uid,updated_by) VALUES(?,?,?,?,?)').bind(email,name,'designer',uid,admin).run();
 for(const [secret,email,uid]of [[token,admin,'synthetic-admin'],['e'.repeat(64),target,'synthetic-target']])await db.prepare('INSERT INTO app_sessions VALUES(?,?,?,?,?)').bind(createHash('sha256').update(secret).digest('hex'),email,uid,Date.now()+3600000,Date.now()).run();
 const template=getTemplate('BTV_Relais_Antenne');
 for(const [id,title,owner,updater]of [[owned,'Production à effacer',target,target],[survivor,'Montage du collègue',colleague,target]])await db.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)').bind(id,title,template.id,template.version,template.libraryVersion,JSON.stringify({...templateDefaults(template),logo:'/api/graphics/media/'+media+'/content'}),owner,updater).run();
 await db.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES(?,?,'Logo partagé','image/png',10,'ready',?)").bind(media,key,target).run();
 await db.prepare('INSERT INTO comments(id,project_id,revision,author,body) VALUES(?,?,1,?,?)').bind(randomUUID(),survivor,target,'Commentaire à effacer').run();
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin){unexpected.push(url.origin);await route.abort();return;}
  const headers={...request.headers(),Cookie:'__Host-srtb_session='+token};delete headers['content-length'];
  const response=await runtime.dispatchFetch(request.url(),{method:request.method(),headers,...(!['GET','HEAD'].includes(request.method())?{body:request.postDataBuffer()}: {})});
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto(origin+'/graphics');await page.getByRole('button',{name:'Équipe & accès',exact:true}).click();
 const remove=page.getByRole('button',{name:`Supprimer : Membre fictif (${target})`,exact:true});
 await remove.click();const dialog=page.getByRole('dialog',{name:'Membre fictif',exact:true});await expect(dialog.getByRole('button',{name:'Supprimer définitivement',exact:true})).toBeVisible();
 await expect(dialog).toContainText('Montage du collègue');assert.equal(deleteAttempts,0);assert.equal(versions.size,3);
 await dialog.getByText('Projets et leurs versions',{exact:true}).click();await expect(dialog).toContainText('Production à effacer');await dialog.getByText('Médias importés',{exact:true}).click();await expect(dialog).toContainText('Logo partagé');
 const confirm=dialog.getByRole('button',{name:'Supprimer définitivement',exact:true});await expect(confirm).toBeDisabled();await dialog.getByRole('checkbox').check();await expect(confirm).toBeDisabled();
 await dialog.getByLabel('Recopiez l’adresse e-mail',{exact:true}).fill('wrong@example.test');await expect(confirm).toBeDisabled();
 await mkdir(output,{recursive:true});await dialog.evaluate(node=>{node.scrollTop=0;});await page.screenshot({path:resolve(output,'impact-desktop.png')});
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(remove).toBeFocused();assert.equal(deleteAttempts,0);
 // A concurrent write makes the warning stale, and the entire commit rolls back.
 await remove.click();await expect(confirm).toBeVisible();await dialog.getByRole('checkbox').check();await dialog.getByLabel('Recopiez l’adresse e-mail',{exact:true}).fill(target);
 await db.prepare('UPDATE projects SET title=?,revision=revision+1 WHERE id=?').bind('Production modifiée après bilan',owned).run();await confirm.click();await expect(dialog.getByRole('alert')).toContainText('bilan');assert.equal(deleteAttempts,0);assert.ok(await db.prepare('SELECT email FROM members WHERE email=?').bind(target).first());
 await dialog.getByRole('button',{name:'Actualiser',exact:true}).click();await expect(confirm).toBeDisabled();await dialog.getByRole('checkbox').check();await dialog.getByLabel('Recopiez l’adresse e-mail',{exact:true}).fill(target);await confirm.click();
 await expect(page.getByRole('alert')).toContainText('Aucun effacement complet');assert.equal(deleteAttempts,1);assert.equal(identityPresent,true);assert.equal(versions.size,3);
 await page.getByRole('button',{name:'Fermer et reprendre plus tard',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Équipe & accès',exact:true}).click();await page.getByRole('button',{name:'Reprendre la suppression',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('1 fichier(s)');await page.screenshot({path:resolve(output,'reprise-apres-erreur.png')});await page.getByRole('button',{name:'Terminer la suppression',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Suppression terminée',exact:true})).toBeVisible({timeout:30000});assert.equal(deletedIdentity,1);assert.equal(identityPresent,false);assert.equal(versions.size,0);
 await page.getByRole('dialog').getByRole('button',{name:'Fermer',exact:true}).click();await expect(page.locator('.member-row').filter({hasText:target})).toHaveCount(0);
 assert.equal(await db.prepare('SELECT id FROM projects WHERE id=?').bind(owned).first(),null);assert.equal(await db.prepare('SELECT id FROM media WHERE id=?').bind(media).first(),null);
 assert.deepEqual(await db.prepare('SELECT created_by,updated_by FROM projects WHERE id=?').bind(survivor).first(),{created_by:colleague,updated_by:'deleted-contributor@system.invalid'});assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 assert.equal((await runtime.dispatchFetch(origin+'/api/me',{headers:{Cookie:'__Host-srtb_session='+'e'.repeat(64)}})).status,401);
 await page.getByLabel('Nom',{exact:true}).fill('Compte neuf');await page.getByLabel('Adresse e-mail',{exact:true}).fill(target);await page.getByRole('button',{name:'Autoriser et inviter',exact:true}).click();await expect(page.locator('.member-row').filter({hasText:target})).toHaveCount(1);
 await expect(page.locator('.member-row').filter({hasText:target})).toContainText('Envoi demandé');assert.equal(invitationCreates,1);assert.equal(invitationMails,1);assert.equal(activeIdentity,'synthetic-recreated');
 assert.deepEqual(await db.prepare('SELECT firebase_uid,removed_at FROM members WHERE email=?').bind(target).first(),{firebase_uid:null,removed_at:null});
 // New identity not yet activated: readable confirmation also on a narrow screen.
 await page.setViewportSize({width:360,height:768});await page.getByRole('button',{name:`Supprimer : Compte neuf (${target})`,exact:true}).click();await expect(page.getByRole('button',{name:'Supprimer définitivement',exact:true})).toBeVisible();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:resolve(output,'impact-narrow.png')});await page.keyboard.press('Escape');
 await page.setViewportSize({width:1366,height:768});await page.getByRole('button',{name:'Passer au thème clair',exact:true}).click();await page.getByRole('button',{name:`Supprimer : Compte neuf (${target})`,exact:true}).click();await expect(page.getByRole('button',{name:'Supprimer définitivement',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.getByRole('dialog').evaluate(node=>{node.scrollTop=0;});await page.screenshot({path:resolve(output,'impact-light.png')});await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,scope:'Sealed production UI and isolated Worker/D1, all provider traffic mocked; no real credentials, users or media.',staleWarningRollback:true,preciseSharedImpact:true,confirmationGuard:true,escapeRestoresFocus:true,reloadResumes:true,identityDeletes:deletedIdentity,mediaVersionsDeleted:3,neighbourPreserved:true,oldSessionInvalid:true,freshInvitation:true,viewports:[1366,360],themes:['dark','light'],errors,unexpected,providerCalls},null,2));
 console.log('PASS permanent deletion: detailed impact, cancel/focus, stale warning, provider failure, reload/resume, explicit B2 versions, session revocation and fresh invitation.');
}finally{await browser?.close();await runtime.dispose();}
