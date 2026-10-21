import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:5221',output=resolve('reports/account-recovery');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
try{
 for(const width of [1366,720,320])for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width,height:width===720?450:768},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));let verifyCount=0,confirmCount=0,requestCount=0,verifyFailure=false,confirmExpired=false;
  await page.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
   let status=200,result;
   if(path.endsWith('/request')){requestCount++;assert.equal(body.email,'qualification@example.test');result={ok:true};}
   else if(path.endsWith('/verify')){verifyCount++;assert.equal(body.code,'local-fixture-unused-code');result=verifyFailure?{error:'Connexion interrompue. Réessayez.'}:{email:'qualification@example.test'};status=verifyFailure?503:200;}
   else if(path.endsWith('/confirm')){confirmCount++;assert.deepEqual(Object.keys(body).sort(),['code','password']);assert.equal(body.password,'Fixture-only-12345');status=confirmExpired?410:200;result=confirmExpired?{error:'Ce lien a expiré ou a déjà été utilisé.'}:{ok:true};}
   else{status=500;result={error:'Unexpected endpoint in isolated fixture'};}
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  const open=async action=>{await page.goto(`${base}/tests/account-recovery.html${action?'?mode=resetPassword&oobCode=local-fixture-unused-code&continueUrl=https://untrusted.invalid':''}`);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);};
  const capture=async name=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}/${width} no overflow`);await page.screenshot({path:resolve(output,`${name}-${theme}-${width}.png`),fullPage:true});};
  await open(false);await page.getByLabel('Adresse e-mail').fill('qualification@example.test');await page.getByRole('button',{name:'Recevoir le lien'}).click();
  await expect(page.getByRole('heading',{name:'Vérifiez votre messagerie.'})).toBeVisible();await expect(page.getByRole('status')).toContainText('Si un compte correspond');assert.equal(requestCount,1);await capture('request');
  verifyFailure=true;await open(true);await expect(page.getByRole('button',{name:'Réessayer la vérification'})).toBeVisible();assert.equal(new URL(page.url()).search,'','credential and redirect removed from address');await capture('retry');
  verifyFailure=false;await page.getByRole('button',{name:'Réessayer la vérification'}).click();await expect(page.getByRole('heading',{name:'Nouveau mot de passe.'})).toBeVisible();
  const password=page.getByLabel('Nouveau mot de passe',{exact:true}),confirmation=page.getByLabel('Confirmer le mot de passe');await expect(password).toHaveAttribute('autocomplete','new-password');await expect(password).toHaveAttribute('minlength','12');
  await password.fill('Fixture-only-12345');await confirmation.fill('Not-matching-1234');await page.getByRole('button',{name:'Enregistrer le mot de passe'}).click();await expect(page.getByRole('alert')).toContainText('ne correspondent pas');assert.equal(confirmCount,0);
  await page.getByRole('button',{name:'Afficher',exact:true}).click();await expect(password).toHaveAttribute('type','text');await page.getByRole('button',{name:'Masquer',exact:true}).click();await expect(password).toHaveAttribute('type','password');await capture('reset');
  await confirmation.fill('Fixture-only-12345');await page.getByRole('button',{name:'Enregistrer le mot de passe'}).click();await expect(page.getByRole('button',{name:'Se connecter',exact:true})).toBeVisible();assert.equal(confirmCount,1);await capture('done');
  confirmExpired=true;await open(true);await expect(password).toBeVisible();await password.fill('Fixture-only-12345');await confirmation.fill('Fixture-only-12345');await page.getByRole('button',{name:'Enregistrer le mot de passe'}).click();await expect(page.getByRole('button',{name:'Demander un nouveau lien'})).toBeVisible();await expect(page.getByRole('button',{name:'Réessayer la vérification'})).toHaveCount(0);await page.getByRole('button',{name:'Demander un nouveau lien'}).click();await expect(page.getByLabel('Adresse e-mail')).toBeVisible();
  checks.push({width,theme,requestCount,verifyCount,confirmCount,passed:true});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(resolve(output,'report.json'),JSON.stringify({scope:'UI isolated API responses; not real email delivery or Firebase credentials',checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,errors}));
}finally{await browser.close();}
