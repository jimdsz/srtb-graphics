import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {chromium,expect} from '@playwright/test';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Actual built Worker and UI, in-memory D1, simulated provider only. No remote
// account, real email, user password or production database is touched.
const build=resolve('dist-studio-native'),output=resolve('reports/account-recovery-release');
const code='release-fixture-single-use-code',email='release-fixture@example.test';let consumed=false;
const providerCalls=[],browserErrors=[];
const runtime=new Miniflare(convertV4MiniflareOptions({
 script:await readFile(resolve(build,'_worker.js'),'utf8'),modules:true,compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],
 d1Databases:['DB'],bindings:{AUTH_MODE:'firebase',APP_ENV:'production',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)},
 serviceBindings:{ASSETS:async request=>{
  const path=new URL(request.url).pathname;
  const allowed=path.startsWith('/assets/')||path.startsWith('/fonts/');
  const file=allowed?resolve(build,'.'+path):resolve(build,'index.html');
  if(!file.startsWith(build+'\\'))return new Response(null,{status:404});
  const types={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png'};
  try{return new Response(await readFile(file),{headers:{'Content-Type':types[extname(file)]||'application/octet-stream'}});}catch{return new Response(null,{status:404});}
 }},
 outboundService:async request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://identitytoolkit.googleapis.com');
  const input=await request.json();providerCalls.push({path:url.pathname,changing:!!input.newPassword});
  if(url.pathname.endsWith(':sendOobCode')){assert.equal(input.email,email);return Response.json({email});}
  assert.equal(url.pathname,'/v1/accounts:resetPassword');assert.equal(input.oobCode,code);
  if(consumed)return Response.json({error:{message:'INVALID_OOB_CODE'}},{status:400});
  if(input.newPassword){assert.equal(input.newPassword,'Release-fixture-only-12345');consumed=true;}
  return Response.json({email,requestType:'PASSWORD_RESET'});
 }
}));
let browser;
try{
 const db=await runtime.getD1Database('DB');
 for(const file of (await readdir('migrations')).filter(name=>name.endsWith('.sql')).sort()){
  const source=await readFile(resolve('migrations',file),'utf8');
  // D1 exec separates statements by line. Keep each trigger/body together.
  await db.exec(source.split(/\r?\n/).filter(line=>!line.trimStart().startsWith('--')).join(' '));
 }
 await db.prepare("INSERT INTO members(email,name,role,firebase_uid,updated_by) VALUES(?,'Recette récupération','designer','fixture-uid','admin@example.com')").bind(email).run();
 const token='c'.repeat(64),hash=createHash('sha256').update(token).digest('hex');
 await db.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind(hash,email,'fixture-uid',Date.now()+3600000,Date.now()-5000).run();
 const privateUrl='https://studio.example/api/me';assert.equal((await runtime.dispatchFetch(privateUrl,{headers:{Cookie:'__Host-srtb_session='+token}})).status,200);
 const base=String(await runtime.ready).replace(/\/$/,'');browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:768}});
 page.on('pageerror',e=>browserErrors.push(e.message));
 await page.goto(base+'/login');await page.getByRole('button',{name:/Mot de passe oublié/}).click();
 await page.getByLabel('Adresse e-mail').fill(email);await page.getByRole('button',{name:'Recevoir le lien'}).click();await expect(page.getByRole('heading',{name:'Vérifiez votre messagerie.'})).toBeVisible();
 await page.goto(base+'/auth/action?mode=resetPassword&oobCode='+code+'&continueUrl=https://untrusted.invalid');
 await expect(page.getByRole('heading',{name:'Nouveau mot de passe.'})).toBeVisible();assert.equal(new URL(page.url()).search,'');
 await page.getByLabel('Nouveau mot de passe',{exact:true}).fill('Release-fixture-only-12345');await page.getByLabel('Confirmer le mot de passe').fill('Release-fixture-only-12345');await page.getByRole('button',{name:'Enregistrer le mot de passe'}).click();await expect(page.getByRole('button',{name:'Se connecter',exact:true})).toBeVisible();
 assert.equal((await runtime.dispatchFetch(privateUrl,{headers:{Cookie:'__Host-srtb_session='+token}})).status,401);
 assert.equal((await db.prepare('SELECT active FROM members WHERE email=?').bind(email).first()).active,1);
 await page.getByRole('button',{name:'Se connecter',exact:true}).click();await expect(page.getByRole('button',{name:/Mot de passe oublié/})).toBeVisible();assert.equal(new URL(page.url()).pathname,'/login');
 await page.goto(base+'/auth/action?mode=resetPassword&oobCode='+code);await expect(page.getByRole('button',{name:'Demander un nouveau lien'})).toBeVisible();
 await mkdir(output,{recursive:true});await page.screenshot({path:resolve(output,'used-link.png'),fullPage:true});assert.deepEqual(browserErrors,[]);
 const response=await runtime.dispatchFetch('https://studio.example/auth/action?mode=resetPassword&oobCode='+code);assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.equal((await runtime.dispatchFetch('https://studio.example/library/v1.7.0/private.png')).status,401);
 await writeFile(resolve(output,'report.json'),JSON.stringify({passed:true,scope:'Built UI → built Worker → in-memory D1 → simulated Firebase provider. Real email reception and real cross-browser credentials NOT validated.',providerCalls,browserErrors,oldGraphicsSessionRejected:true,usedLinkHandled:true},null,2));console.log('PASS built recovery flow, provider-bound identity, real D1 session invalidation and one-use error. Email delivery remains untested.');
}finally{await browser?.close();await runtime.dispose();}
