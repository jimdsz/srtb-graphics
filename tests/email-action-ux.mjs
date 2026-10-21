import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.argv[2]||'http://127.0.0.1:5221',output=resolve('reports/email-action');
const credential='fixture-email-action-single-use-token',untrustedEmail='not-provider@example.test';
const oldEmail='adresse.origine@example.test',newEmail='adresse.cible@example.test';
const actions=[
  {mode:'verifyEmail',operation:'VERIFY_EMAIL',title:'Confirmer votre adresse.',button:'Confirmer cette adresse',done:'Adresse confirmée.',fields:[['Adresse à confirmer',oldEmail]],response:{requestType:'VERIFY_EMAIL',email:oldEmail}},
  {mode:'recoverEmail',operation:'RECOVER_EMAIL',title:'Rétablir votre adresse.',button:'Rétablir cette adresse',done:'Adresse rétablie.',fields:[['Adresse actuelle',newEmail],['Adresse à rétablir',oldEmail]],response:{requestType:'RECOVER_EMAIL',email:oldEmail,newEmail}},
  {mode:'verifyAndChangeEmail',operation:'VERIFY_AND_CHANGE_EMAIL',title:'Changer votre adresse.',button:'Confirmer le changement',done:'Adresse modifiée.',fields:[['Adresse actuelle',oldEmail],['Nouvelle adresse',newEmail]],response:{requestType:'VERIFY_AND_CHANGE_EMAIL',email:oldEmail,newEmail}},
];
const checks=[],errors=[],unexpectedRequests=[];
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const choose=(values,index,fallback)=>values?.[Math.min(index,values.length-1)]??fallback;
const primary=(page,action)=>page.getByRole('button',{name:action.button,exact:true});
const retry=page=>page.getByRole('button',{name:'Réessayer la vérification',exact:true});
const invalid=page=>page.getByRole('heading',{name:'Ce lien n’est pas utilisable.',exact:true});
const uncertain=page=>page.getByRole('heading',{name:'Confirmation non reçue.',exact:true});
const noReset=async page=>{
  await expect(page.getByRole('button',{name:'Demander un nouveau lien',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Recevoir le lien',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Nouveau mot de passe',{exact:true})).toHaveCount(0);
};
async function open(action=actions[0],options={}){
  const width=options.width||1366,theme=options.theme||'dark';
  const page=await browser.newPage({viewport:{width,height:width===720?450:768},reducedMotion:'reduce'});
  const audit={config:0,inspect:0,inspectResponses:0,apply:0,applyResponses:0,resetVerify:0,resetConfirm:0,resetRequest:0,referrerLeaks:0,referrerEvidence:[],urlLeaks:0,consoleLeaks:0,requestProblems:[],operations:[]};
  let releaseCheck,releaseApply;
  const heldCheck=options.holdCheck?new Promise(resolve=>{releaseCheck=resolve;}):Promise.resolve();
  const heldApply=options.holdApply?new Promise(resolve=>{releaseApply=resolve;}):Promise.resolve();
  page.on('pageerror',error=>errors.push(error.message.replaceAll(credential,'[REDACTED]')));
  page.on('console',message=>{if(message.text().includes(credential))audit.consoleLeaks++;});
  page.on('request',request=>{
    const leakedHeaders=Object.entries(request.headers()).filter(([,value])=>value.includes(credential)).map(([key])=>key);
    if(leakedHeaders.length){audit.referrerLeaks++;audit.referrerEvidence.push({path:new URL(request.url()).pathname,headers:leakedHeaders});}
    if(request.url().includes(credential)&&!request.isNavigationRequest())audit.urlLeaks++;
  });
  async function reply(route,response){
    if(response==='network')return route.abort('failed');
    if(typeof response==='string')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:{code:400,message:response,errors:[{message:response,domain:'global',reason:'invalid'}]}})});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
  }
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===base&&url.pathname==='/tests/email-action.html'&&request.isNavigationRequest()){
      // Vite inserts dev modules before HTML meta tags. Mirror the production
      // /auth/action HTTP header, not just its equivalent fixture meta tag.
      const response=await route.fetch();return route.fulfill({response,headers:{...response.headers(),'referrer-policy':'no-referrer'}});
    }
    if(url.origin===base&&url.pathname==='/api/auth/config'&&request.method()==='GET'){
      audit.config++;return reply(route,{enabled:true,apiKey:'fixture-public-api-key-only',projectId:'fixture-email-actions',authDomain:'fixture-email-actions.example.test'});
    }
    if(url.origin==='https://identitytoolkit.googleapis.com'&&['/v1/accounts:resetPassword','/v1/accounts:update'].includes(url.pathname)&&request.method()==='POST'){
      const body=request.postDataJSON();
      if(Object.keys(body).sort().join(',')!=='oobCode'||body.oobCode!==credential)audit.requestProblems.push('Unexpected provider payload');
      if(url.searchParams.get('key')!=='fixture-public-api-key-only')audit.requestProblems.push('Unexpected provider key');
      if(url.pathname.endsWith(':resetPassword')){
        const number=audit.inspect++;audit.operations.push('inspect');if(number===0)await heldCheck;
        await reply(route,choose(options.inspect,number,action.response));audit.inspectResponses++;return;
      }
      const number=audit.apply++;audit.operations.push('apply');if(number===0)await heldApply;
      await reply(route,choose(options.apply,number,{}));audit.applyResponses++;return;
    }
    if(url.origin===base&&url.pathname.startsWith('/api/auth/recovery/')&&request.method()==='POST'){
      const body=request.postDataJSON(),kind=url.pathname.split('/').at(-1);
      if(kind==='verify'){
        if(Object.keys(body).join(',')!=='code'||body.code!==credential)audit.requestProblems.push('Unexpected reset verification payload');
        const number=audit.resetVerify++;return reply(route,choose(options.resetVerify,number,{email:oldEmail}));
      }
      if(kind==='confirm'){
        if(Object.keys(body).sort().join(',')!=='code,password'||body.code!==credential||body.password!=='Fixture-password-only-12345')audit.requestProblems.push('Unexpected reset confirmation payload');
        const number=audit.resetConfirm++;
        if(options.resetExpired)return route.fulfill({status:410,contentType:'application/json',body:JSON.stringify({error:'Ce lien a expiré ou a déjà été utilisé.'})});
        return reply(route,choose(options.resetConfirm,number,{ok:true}));
      }
      if(kind==='request'){
        audit.resetRequest++;if(body.email!==oldEmail)audit.requestProblems.push('Unexpected recovery email');return reply(route,{ok:true});
      }
    }
    if(url.origin===base&&!url.pathname.startsWith('/api/')&&['GET','HEAD'].includes(request.method()))return route.continue();
    unexpectedRequests.push({origin:url.origin,path:url.pathname,method:request.method()});return route.abort();
  });
  const query=new URLSearchParams({mode:options.mode??action.mode,oobCode:credential,email:untrustedEmail,continueUrl:'https://untrusted.invalid/redirect'});
  await page.goto(`${base}/tests/email-action.html?${query}#untrusted-fragment`);
  await page.evaluate(value=>{document.documentElement.dataset.theme=value;window.dispatchEvent(new Event('srtb:interface-theme'));},theme);
  return {page,audit,releaseCheck:()=>releaseCheck?.(),releaseApply:()=>releaseApply?.()};
}
async function privacy(page,audit){
  await expect.poll(()=>new URL(page.url()).search==='',{message:'Action query must be removed'}).toBe(true);assert.equal(new URL(page.url()).hash==='',true,'Action fragment must be removed');
  const exposed=await page.evaluate(secret=>({dom:document.documentElement.outerHTML.includes(secret),storage:JSON.stringify({...localStorage,...sessionStorage}).includes(secret),referrer:document.referrer.includes(secret)}),credential);
  assert.deepEqual(exposed,{dom:false,storage:false,referrer:false});assert.equal(audit.referrerLeaks,0,JSON.stringify(audit.referrerEvidence));assert.equal(audit.urlLeaks,0);assert.equal(audit.consoleLeaks,0);assert.deepEqual(audit.requestProblems,[]);
  await expect(page.getByText(untrustedEmail,{exact:true})).toHaveCount(0);
}
async function ready(page,action){
  await expect(page.getByRole('heading',{name:action.title,exact:true})).toBeVisible();await expect(primary(page,action)).toBeEnabled();
  for(const[label,value]of action.fields){const term=page.locator('dt').filter({hasText:new RegExp(`^${label}$`)});await expect(term).toHaveCount(1);await expect(term.locator('xpath=following-sibling::dd[1]')).toHaveText(value);}
  await noReset(page);
}
async function capture(page,name){
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: horizontal overflow`);
  await page.screenshot({path:resolve(output,`${name}.png`),fullPage:true});
}
async function done(page,action){await expect(page.getByRole('heading',{name:action.done,exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Se connecter',exact:true})).toBeEnabled();}
async function back(page){await page.getByRole('button',{name:'Se connecter',exact:true}).click();await expect(page.getByRole('heading',{name:'Connexion de recette',exact:true})).toBeVisible();}

try{
  for(const width of [1366,720,320])for(const theme of ['dark','light'])for(const action of actions){
    const{page,audit}=await open(action,{width,theme});await ready(page,action);await privacy(page,audit);
    assert.equal(audit.inspect,1);assert.equal(audit.apply,0,'Inspection must never apply an action');assert.equal(audit.resetVerify,0);
    await capture(page,`${action.mode}-${theme}-${width}`);
    await primary(page,action).focus();await expect(primary(page,action)).toBeFocused();await page.keyboard.press('Enter');await done(page,action);
    assert.equal(audit.apply,1);assert.deepEqual(audit.operations,['inspect','apply']);await privacy(page,audit);
    await capture(page,`${action.mode}-done-${theme}-${width}`);await back(page);await privacy(page,audit);
    checks.push({name:`${action.mode}-${theme}-${width}`,providerAddresses:true,explicitKeyboardConfirmation:true,noCredentialLeak:true});await page.close();
  }
  for(const action of actions){
    const mismatch=actions.find(value=>value.operation!==action.operation);
    const{page,audit}=await open(action,{width:320,inspect:[mismatch.response]});await expect(invalid(page)).toBeVisible();await noReset(page);await privacy(page,audit);
    for(const candidate of actions)await expect(primary(page,candidate)).toHaveCount(0);
    assert.equal(audit.inspect,1);assert.equal(audit.apply,0);await capture(page,`mismatch-${action.mode}-dark-320`);
    checks.push({name:`mismatch-${action.mode}`,writeBlocked:true,noPasswordReset:true});await page.close();
  }
  for(const phase of ['inspect','apply'])for(const providerError of ['EXPIRED_OOB_CODE','INVALID_OOB_CODE']){
    const action=actions[1],{page,audit}=await open(action,{width:320,theme:'light',[phase]:[providerError]});
    if(phase==='apply'){await ready(page,action);await primary(page,action).click();}
    await expect(invalid(page)).toBeVisible();await expect(page.getByRole('alert')).toContainText(/expiré|utilisé/);await noReset(page);await expect(retry(page)).toHaveCount(0);await privacy(page,audit);
    for(const candidate of actions)await expect(primary(page,candidate)).toHaveCount(0);
    assert.equal(audit.apply,phase==='apply'?1:0);await capture(page,`${phase}-${providerError.toLowerCase()}-light-320`);
    checks.push({name:`${phase}-${providerError}`,terminalInvalid:true,noFalseSuccess:true,noPasswordReset:true});await page.close();
  }
  for(const mode of ['revertSecondFactorAddition','signIn']){
    const{page,audit}=await open(actions[0],{width:320,mode});
    await expect(page.getByRole('heading',{name:'Action non prise en charge.',exact:true})).toBeVisible();await noReset(page);await privacy(page,audit);
    assert.equal(audit.config,0);assert.equal(audit.inspect,0);assert.equal(audit.apply,0);await capture(page,`unsupported-${mode}-dark-320`);
    checks.push({name:`unsupported-${mode}`,noProviderCall:true,noPasswordReset:true});await page.close();
  }
  {
    const{page,audit}=await open(actions[0],{inspect:[{requestType:'REVERT_SECOND_FACTOR_ADDITION',email:oldEmail,mfaInfo:{mfaEnrollmentId:'fixture-factor',enrolledAt:'2026-01-01T00:00:00.000Z',totpInfo:{}}}]});
    await expect(invalid(page)).toBeVisible();await noReset(page);await privacy(page,audit);assert.equal(audit.inspect,1);assert.equal(audit.apply,0);
    checks.push({name:'unsupported-provider-operation',noWrite:true});await page.close();
  }
  {
    const{page,audit}=await open(actions[1],{width:320,theme:'light',inspect:[{requestType:'RECOVER_EMAIL',email:oldEmail}]});
    await expect(invalid(page)).toBeVisible();await expect(page.getByRole('alert')).toContainText('adresses nécessaires');await noReset(page);await privacy(page,audit);
    for(const action of actions)await expect(primary(page,action)).toHaveCount(0);
    assert.equal(audit.inspect,1);assert.equal(audit.apply,0);await capture(page,'missing-provider-address-light-320');
    checks.push({name:'missing-provider-address',noGuessedIdentity:true,noWrite:true});await page.close();
  }
  {
    const action=actions[2],{page,audit}=await open(action,{width:320,theme:'light',inspect:['network',action.response]});
    await expect(retry(page)).toBeEnabled();await noReset(page);await privacy(page,audit);assert.equal(audit.apply,0);await capture(page,'inspect-network-light-320');
    await retry(page).focus();await page.keyboard.press('Enter');await ready(page,action);assert.equal(audit.inspect,2);assert.equal(audit.apply,0);
    await primary(page,action).click();await done(page,action);assert.equal(audit.apply,1);await privacy(page,audit);
    checks.push({name:'inspect-network-retry',freshInspect:true,noAutoApply:true});await page.close();
  }
  for(const spent of [false,true]){
    const action=actions[0],{page,audit}=await open(action,{width:320,apply:['network',{}],inspect:[action.response,spent?'INVALID_OOB_CODE':action.response]});
    await ready(page,action);await primary(page,action).click();await expect(uncertain(page)).toBeVisible();await noReset(page);
    await expect(page.getByRole('heading',{name:action.done,exact:true})).toHaveCount(0);await expect(primary(page,action)).toHaveCount(0);
    assert.equal(audit.apply,1);await capture(page,`apply-network-${spent?'spent':'retry'}-dark-320`);
    await page.getByRole('button',{name:'Revérifier le lien',exact:true}).click();
    if(spent){await expect(invalid(page)).toBeVisible();await noReset(page);assert.equal(audit.apply,1);}
    else{await ready(page,action);assert.equal(audit.apply,1);await primary(page,action).click();await done(page,action);assert.equal(audit.apply,2);}
    assert.equal(audit.inspect,2);await privacy(page,audit);
    checks.push({name:`apply-network-${spent?'spent':'retry'}`,freshInspectBeforeRetry:true,noFalseSuccess:true});await page.close();
  }
  {
    const action=actions[1],{page,audit,releaseCheck,releaseApply}=await open(action,{holdCheck:true,holdApply:true});
    await expect(page.getByRole('heading',{name:'Vérification du lien…',exact:true})).toBeVisible();await privacy(page,audit);assert.equal(audit.apply,0);
    releaseCheck();await ready(page,action);await primary(page,action).click();await expect(page.getByRole('button',{name:'Confirmation…',exact:true})).toBeDisabled();
    await expect(page.getByRole('heading',{name:action.done,exact:true})).toHaveCount(0);await expect.poll(()=>audit.apply).toBe(1);releaseApply();await done(page,action);assert.equal(audit.apply,1);
    checks.push({name:'delayed-inspection-and-confirmation',noPrematureSuccess:true,noDuplicateWrite:true});await page.close();
  }
  // Genuine wall-clock UI deadlines: do not alter the SDK timer or replace SDK
  // promises. Run the three independent cases together to keep this bounded.
  await Promise.all([
    (async()=>{
      const action=actions[0],{page,audit,releaseCheck}=await open(action,{holdCheck:true,width:320,theme:'light'});
      await expect(retry(page)).toBeEnabled({timeout:25000});assert.equal(audit.apply,0);await privacy(page,audit);await capture(page,'inspect-timeout-light-320');
      releaseCheck();await expect.poll(()=>audit.inspectResponses).toBe(1);await expect(retry(page)).toBeEnabled();await expect(primary(page,action)).toHaveCount(0);
      await retry(page).click();await ready(page,action);assert.equal(audit.inspect,2);assert.equal(audit.apply,0);
      checks.push({name:'inspection-timeout-20s',lateResponseIgnored:true,retryIsFreshRead:true});await page.close();
    })(),
    (async()=>{
      const action=actions[1],{page,audit,releaseApply}=await open(action,{holdApply:true,width:320});await ready(page,action);await primary(page,action).click();
      await expect(uncertain(page)).toBeVisible({timeout:25000});const recheck=page.getByRole('button',{name:'Revérifier le lien',exact:true});await expect(recheck).toBeDisabled();assert.equal(audit.apply,1);
      await privacy(page,audit);await capture(page,'apply-timeout-pending-dark-320');releaseApply();await expect(recheck).toBeEnabled();await expect(uncertain(page)).toBeVisible();await expect(page.getByRole('heading',{name:action.done,exact:true})).toHaveCount(0);
      await recheck.click();await ready(page,action);assert.equal(audit.inspect,2);assert.equal(audit.apply,1);
      checks.push({name:'confirmation-timeout-20s',pendingWriteLock:true,lateSuccessRemainsUncertain:true,freshInspectionRequired:true});await page.close();
    })(),
    (async()=>{
      const action=actions[2],{page,audit,releaseApply}=await open(action,{holdApply:true});await ready(page,action);await primary(page,action).click();await expect(uncertain(page)).toBeVisible({timeout:25000});
      await page.getByRole('button',{name:'Retour à la connexion',exact:true}).click();await page.getByRole('button',{name:'Rouvrir le lien de recette',exact:true}).click();
      await expect(page.getByRole('heading',{name:action.title,exact:true})).toBeVisible();await expect(primary(page,action)).toBeDisabled();await expect(page.getByRole('status')).toContainText('Aucun second envoi');
      assert.equal(audit.inspect,2);assert.equal(audit.apply,1);await privacy(page,audit);await capture(page,'remount-pending-dark-1366');releaseApply();await expect(primary(page,action)).toBeEnabled();
      await expect(page.getByRole('heading',{name:action.done,exact:true})).toHaveCount(0);assert.equal(audit.apply,1);
      checks.push({name:'confirmation-timeout-remount-lock',moduleLockSurvivesUnmount:true,noConcurrentApply:true,noLateFalseSuccess:true});await page.close();
    })(),
  ]);
  {
    const{page,audit}=await open(actions[0],{mode:'resetPassword',width:320,theme:'light'});
    await expect(page.getByRole('heading',{name:'Nouveau mot de passe.',exact:true})).toBeVisible();await privacy(page,audit);
    assert.equal(audit.config,0);assert.equal(audit.inspect,0);assert.equal(audit.apply,0);assert.equal(audit.resetVerify,1);
    const password=page.getByLabel('Nouveau mot de passe',{exact:true}),confirmation=page.getByLabel('Confirmer le mot de passe',{exact:true});
    await expect(password).toHaveAttribute('type','password');await expect(password).toHaveAttribute('autocomplete','new-password');await expect(password).toHaveAttribute('minlength','12');
    await password.fill('Fixture-password-only-12345');await confirmation.fill('Fixture-other-password-12345');await page.getByRole('button',{name:'Enregistrer le mot de passe',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('ne correspondent pas');assert.equal(audit.resetConfirm,0);
    await page.getByRole('button',{name:'Afficher',exact:true}).click();await expect(password).toHaveAttribute('type','text');await page.getByRole('button',{name:'Masquer',exact:true}).click();await expect(password).toHaveAttribute('type','password');
    await confirmation.fill('Fixture-password-only-12345');await capture(page,'reset-regression-light-320');await page.getByRole('button',{name:'Enregistrer le mot de passe',exact:true}).click();
    await expect(page.getByRole('button',{name:'Se connecter',exact:true})).toBeVisible();assert.equal(audit.resetConfirm,1);await privacy(page,audit);
    checks.push({name:'password-reset-regression',sameOriginRecovery:true,noFirebaseEmailAction:true,passwordConfirmation:true});await page.close();
  }
  {
    const{page,audit}=await open(actions[0],{mode:'resetPassword',resetExpired:true});
    await expect(page.getByLabel('Nouveau mot de passe',{exact:true})).toBeVisible();await page.getByLabel('Nouveau mot de passe',{exact:true}).fill('Fixture-password-only-12345');await page.getByLabel('Confirmer le mot de passe',{exact:true}).fill('Fixture-password-only-12345');
    await page.getByRole('button',{name:'Enregistrer le mot de passe',exact:true}).click();await page.getByRole('button',{name:'Demander un nouveau lien',exact:true}).click();
    await page.getByLabel('Adresse e-mail',{exact:true}).fill(oldEmail);await page.getByRole('button',{name:'Recevoir le lien',exact:true}).click();await expect(page.getByRole('heading',{name:'Vérifiez votre messagerie.',exact:true})).toBeVisible();
    assert.equal(audit.resetRequest,1);assert.equal(audit.apply,0);await privacy(page,audit);
    checks.push({name:'password-reset-expired-can-request',recoveryKeptForPasswordOnly:true});await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
  const report={scope:'Real AccountRecovery and unmodified installed Firebase SDK; all auth/config, Identity Toolkit and recovery HTTP responses intercepted with synthetic data. No real account, credential, email delivery or server mutation. Fixture no-referrer HTTP header and external CSS mirror the production document delivery; the actual server header is not requalified here. Three independent 20-second deadline cases use real wall-clock time, not SDK mocks or a modified clock. 720px is CSS reflow, not native zoom.',checks,errors,unexpectedRequests};
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:checks.length,checks,errors,unexpectedRequests},null,2));
}finally{await browser.close();}
