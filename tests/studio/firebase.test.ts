import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,afterEach,expect,it,inject,vi} from 'vitest';
import {generateKeyPair,SignJWT} from 'jose';
import * as jose from 'jose';
import {authenticateSession,firebaseRoutes,isPublicAppPath} from '../../server/firebase-auth';
import {api,onRequest} from '../../server/router';
import connectorRelease from '../../connector/windows/release.json';
import type {Member,Role} from '../../src/studio/domain';

vi.mock('jose',async original=>({...await original<typeof import('jose')>(),importX509:vi.fn()}));
const config={...env,AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)};
const email='admin@example.com',origin='https://studio.example';
const post=(path:string,body:unknown,cookie='')=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
let pair:Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));pair=await generateKeyPair('RS256');});
afterEach(()=>vi.restoreAllMocks());
function mocks(disabled=false,accountEmail=email,uid='verified-uid'){vi.mocked(jose.importX509).mockResolvedValue(pair.publicKey);vi.spyOn(globalThis,'fetch').mockImplementation(async input=>String(input).includes('/metadata/x509/')?Response.json({test:'test-only-certificate-resolver'}):Response.json({users:[{localId:uid,email:accountEmail,emailVerified:true,disabled}]}));}
function sign(overrides:Record<string,unknown>={},uid='verified-uid'){return new SignJWT({email,email_verified:true,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'password'},...overrides}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(`https://securetoken.google.com/${config.FIREBASE_PROJECT_ID}`).setAudience(config.FIREBASE_PROJECT_ID).setSubject(uid).setIssuedAt().setExpirationTime('45m').sign(pair.privateKey);}
it('exposes only the shell, not templates, media or application data',()=>{
  for(const path of ['/','/graphics','/assets/main-123.js','/fonts/SuisseIntl.ttf'])expect(isPublicAppPath(path)).toBe(true);
  for(const path of ['/library/v1.7.0/private','/api/graphics/media/123/content','/api/me','/assets/../library/x','/assets/sub/secret','/preview-media/v1/ba-programme.mp4','/preview-media/v1/BTV_BA_TDS.zip','/preview-media/v2/BTV_BA_TDS.zip','/preview-media/v2/BTV_BA_TDS_SUIVI_DE.zip','/preview-media/v3/ba-prepared-slow-1280.mp4'])expect(isPublicAppPath(path)).toBe(false);
});
it('fails closed when Firebase is not configured and rejects forged sessions',async()=>{
  await expect(authenticateSession(new Request(origin),{...config,FIREBASE_PROJECT_ID:'NOT_CONFIGURED'})).rejects.toMatchObject({status:503});
  await expect(authenticateSession(new Request(origin,{headers:{Cookie:'__Host-srtb_session='+'f'.repeat(64)}}),config)).rejects.toMatchObject({status:401});
});
it('serves the Windows pilot only after authenticating an active SRTB member',async()=>{
 const download=origin+'/downloads/'+connectorRelease.file;let assetReads=0;
 const serve=(cookie='')=>onRequest({request:new Request(download,{headers:{Cookie:cookie}}),env:config,next:async()=>{assetReads++;return new Response(new Uint8Array([77,90]),{headers:{'Content-Type':'application/octet-stream'}});},waitUntil:()=>{}} as unknown as Parameters<typeof onRequest>[0]);
 const denied=await serve();expect(denied.status).toBe(401);expect(assetReads).toBe(0);
 mocks();const login=await firebaseRoutes(post('/api/auth/session',{idToken:await sign()}),config),cookie=login!.headers.get('set-cookie')!.split(';')[0];
 try{
  const allowed=await serve(cookie);expect(allowed.status).toBe(200);expect(assetReads).toBe(1);
  expect(allowed.headers.get('Cache-Control')).toBe('private, no-store');
  expect([...new Uint8Array(await allowed.arrayBuffer())]).toEqual([77,90]);
 }finally{await firebaseRoutes(post('/api/auth/logout',{},cookie),config);}
});
it('issues HttpOnly opaque sessions for verified invited members and revokes them at logout',async()=>{
  mocks();const response=await firebaseRoutes(post('/api/auth/session',{idToken:await sign()}),config);expect(response?.status).toBe(200);
  const setCookie=response!.headers.get('set-cookie')!;expect(setCookie).toContain('HttpOnly; Secure; SameSite=Lax');expect(setCookie).not.toContain('eyJ');const cookie=setCookie.split(';')[0];
  const request=new Request(origin+'/api/me',{headers:{Cookie:cookie}});expect((await authenticateSession(request,config)).role).toBe('admin');
  await firebaseRoutes(post('/api/auth/logout',{},cookie),config);await expect(authenticateSession(request,config)).rejects.toMatchObject({status:401});
});
it('refuses unverified email, revoked accounts and wrong audience',async()=>{
  mocks();await expect(firebaseRoutes(post('/api/auth/session',{idToken:await sign({email_verified:false})}),config)).rejects.toMatchObject({status:401});
  mocks(true);await expect(firebaseRoutes(post('/api/auth/session',{idToken:await sign()}),config)).rejects.toMatchObject({status:401});
  await expect(firebaseRoutes(post('/api/auth/session',{idToken:await sign()}),{...config,FIREBASE_PROJECT_ID:'another-project'})).rejects.toMatchObject({status:401});
});
it('renews in place across tabs and exposes only the remaining lifetime to the UI',async()=>{
  mocks();const token=await sign(),response=await firebaseRoutes(post('/api/auth/session',{idToken:token}),config),cookie=response!.headers.get('set-cookie')!.split(';')[0];
  for(let tab=0;tab<2;tab++){
    const refreshed=await firebaseRoutes(post('/api/auth/refresh',{idToken:token},cookie),config);
    expect(refreshed!.headers.get('set-cookie')!.split(';')[0]).toBe(cookie);
    const request=new Request(origin+'/api/me',{headers:{Cookie:cookie}}),member=await authenticateSession(request,config);
    const me=await api(request,config,member);expect(Number(me!.headers.get('X-SRTB-Session-Remaining-Ms'))).toBeGreaterThan(0);
    expect(await me!.json()).toEqual({email,name:member.name,role:'admin',active:1});
  }
  await firebaseRoutes(post('/api/auth/logout',{},cookie),config);
  await expect(firebaseRoutes(post('/api/auth/refresh',{idToken:token},cookie),config)).rejects.toMatchObject({status:401});
  await expect(firebaseRoutes(post('/api/auth/refresh',{idToken:token}),config)).rejects.toMatchObject({status:401});
});
it('a renewal already verifying Firebase cannot resurrect a concurrently logged-out session',async()=>{
  mocks();const token=await sign(),response=await firebaseRoutes(post('/api/auth/session',{idToken:token}),config),cookie=response!.headers.get('set-cookie')!.split(';')[0];
  let announce!:()=>void,resume!:()=>void;
  const reached=new Promise<void>(done=>{announce=done;}),hold=new Promise<void>(done=>{resume=done;});
  vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{
    if(String(input).includes('/metadata/x509/'))return Response.json({test:'test-only-certificate-resolver'});
    announce();await hold;return Response.json({users:[{localId:'verified-uid',email,emailVerified:true}]});
  });
  const pending=firebaseRoutes(post('/api/auth/refresh',{idToken:token},cookie),config);
  await reached;await firebaseRoutes(post('/api/auth/logout',{},cookie),config);resume();
  await expect(pending).rejects.toMatchObject({status:401});
  await expect(authenticateSession(new Request(origin,{headers:{Cookie:cookie}}),config)).rejects.toMatchObject({status:401});
});
it('admits 60 newsroom sessions behind one IP and isolates their renewal budgets',async()=>{
  mocks();const token=await sign();
  const send=(path:string,cookie='')=>{const request=post(path,{idToken:token},cookie);request.headers.set('CF-Connecting-IP','192.0.2.60');return firebaseRoutes(request,config);};
  const created=await Promise.all(Array.from({length:60},()=>send('/api/auth/session')));
  const cookies=created.map(response=>{expect(response!.status).toBe(200);return response!.headers.get('set-cookie')!.split(';')[0];});
  const renewed=await Promise.all(cookies.map(cookie=>send('/api/auth/refresh',cookie)));
  for(const response of renewed)expect(response!.status).toBe(200);
  await Promise.all(cookies.map(cookie=>firebaseRoutes(post('/api/auth/logout',{},cookie),config)));
});
it('rejects cross-site session creation even with a valid Google token',async()=>{
  mocks();const request=post('/api/auth/session',{idToken:await sign()});request.headers.set('Origin','https://other.example');await expect(firebaseRoutes(request,config)).rejects.toMatchObject({status:403});
});
it('refuses a verified account that was not invited',async()=>{
  const outsider='not-invited@example.test';mocks(false,outsider,'outsider-uid');
  await expect(firebaseRoutes(post('/api/auth/session',{idToken:await sign({email:outsider},'outsider-uid')}),config)).rejects.toMatchObject({status:403});
});
it('rechecks membership on every request, including after a session was issued',async()=>{
  const designer='revoked-designer@example.test';
  await env.DB.prepare("INSERT INTO members(email,name,role,updated_by) VALUES(?,'Test révocation','designer',?)").bind(designer,email).run();
  mocks(false,designer,'designer-uid');const response=await firebaseRoutes(post('/api/auth/session',{idToken:await sign({email:designer},'designer-uid')}),config),cookie=response!.headers.get('set-cookie')!.split(';')[0];
  const request=new Request(origin+'/api/me',{headers:{Cookie:cookie}});
  await env.DB.prepare('UPDATE members SET active=0 WHERE email=?').bind(designer).run();
  try{await expect(authenticateSession(request,config)).rejects.toMatchObject({status:401});}
  finally{await firebaseRoutes(post('/api/auth/logout',{},cookie),config);}
});
const admin:Member={email,name:'Administrateur recette',role:'admin',active:1};
// This suite qualifies sessions, not mail delivery. Invitation network outcomes
// have their own isolated tests; authorizing a fixture never contacts Google.
const authorize=(address:string,role:Role='designer',active=true)=>api(post('/api/graphics/members',{email:address,name:'Membre de recette',role,active}),{...config,FIREBASE_API_KEY:'NOT_CONFIGURED'},admin);
it('authorizes each role, binds its verified identity and applies the actual member permissions',async()=>{
  for(const role of ['designer','broadcaster','admin'] as const){
    const address=`onboarding-${role}@example.test`,uid=`onboarding-${role}`;
    await authorize(address.toUpperCase(),role);
    mocks(false,address,uid);
    const response=await firebaseRoutes(post('/api/auth/session',{idToken:await sign({email:address},uid)}),config);
    const session=response!.headers.get('set-cookie')!.split(';')[0];
    const request=new Request(origin+'/api/graphics/projects',{headers:{Cookie:session}});
    const member=await authenticateSession(request,config);
    expect(member).toMatchObject({email:address,role,active:1});expect((await api(request,config,member))?.status).toBe(200);
    const membersRequest=new Request(origin+'/api/graphics/members',{headers:{Cookie:session}});
    if(role==='admin')expect((await api(membersRequest,config,member))?.status).toBe(200);
    else await expect(api(membersRequest,config,member)).rejects.toMatchObject({status:403});
    await firebaseRoutes(post('/api/auth/logout',{},session),config);
  }
});
it('changes roles without duplicate members and disables both existing and new sessions',async()=>{
  const address='member-lifecycle@example.test',uid='member-lifecycle';
  await authorize(address);mocks(false,address,uid);
  const jwt=await sign({email:address},uid),response=await firebaseRoutes(post('/api/auth/session',{idToken:jwt}),config);
  const session=response!.headers.get('set-cookie')!.split(';')[0],request=new Request(origin+'/api/me',{headers:{Cookie:session}});
  await authorize(address.toUpperCase(),'broadcaster');
  expect((await authenticateSession(request,config)).role).toBe('broadcaster');
  const row=await config.DB.prepare('SELECT count(*) n, firebase_uid FROM members WHERE email=?').bind(address).first<{n:number;firebase_uid:string}>();
  expect(row).toEqual({n:1,firebase_uid:uid});
  await authorize(address,'broadcaster',false);
  await expect(authenticateSession(request,config)).rejects.toMatchObject({status:401});
  await expect(firebaseRoutes(post('/api/auth/session',{idToken:jwt}),config)).rejects.toMatchObject({status:403});
  await authorize(address,'designer',true);
  // Re-enabling a member must not restore an old (possibly compromised) cookie.
  await expect(authenticateSession(request,config)).rejects.toMatchObject({status:401});
  await expect(firebaseRoutes(post('/api/auth/refresh',{idToken:jwt},session),config)).rejects.toMatchObject({status:401});
  const reconnected=await firebaseRoutes(post('/api/auth/session',{idToken:jwt}),config);
  const newSession=reconnected!.headers.get('set-cookie')!.split(';')[0];
  expect(newSession).not.toBe(session);
  expect((await authenticateSession(new Request(origin+'/api/me',{headers:{Cookie:newSession}}),config)).role).toBe('designer');
  await firebaseRoutes(post('/api/auth/logout',{},newSession),config);
  mocks(false,address,'different-firebase-account');
  await expect(firebaseRoutes(post('/api/auth/session',{idToken:await sign({email:address},'different-firebase-account')}),config)).rejects.toMatchObject({status:403});
});
it('keeps access but reports an unconfirmed invitation when Firebase email configuration is unavailable',async()=>{
  const spy=vi.spyOn(globalThis,'fetch');
  const response=await authorize('no-message-sent@example.test');
  expect(response?.status).toBe(200);expect(await response!.json()).toMatchObject({ok:true,notice:expect.stringContaining('n’est pas confirmé'),invitation:{status:'failed'}});
  expect(spy).not.toHaveBeenCalled();
});
it('removed access refuses login; reauthorisation admits only its retained identity with a new session',async()=>{
  const address='removed-then-restored@example.test',uid='removed-identity';
  await authorize(address);mocks(false,address,uid);
  const jwt=await sign({email:address},uid),login=await firebaseRoutes(post('/api/auth/session',{idToken:jwt}),config),oldCookie=login!.headers.get('set-cookie')!.split(';')[0];
  const request=new Request(origin+'/api/me',{headers:{Cookie:oldCookie}});
  const removal=new Request(origin+'/api/graphics/members',{method:'DELETE',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:address})});
  expect((await api(removal,config,admin))!.status).toBe(200);
  await expect(authenticateSession(request,config)).rejects.toMatchObject({status:401});
  await expect(firebaseRoutes(post('/api/auth/session',{idToken:jwt}),config)).rejects.toMatchObject({status:403});
  expect(await env.DB.prepare('SELECT active FROM members WHERE email=?').bind(address).first()).toEqual({active:0});
  await authorize(address,'broadcaster');
  await expect(authenticateSession(request,config)).rejects.toMatchObject({status:401});
  const restored=await firebaseRoutes(post('/api/auth/session',{idToken:jwt}),config),newCookie=restored!.headers.get('set-cookie')!.split(';')[0];
  expect(newCookie).not.toBe(oldCookie);
  expect(await authenticateSession(new Request(origin,{headers:{Cookie:newCookie}}),config)).toMatchObject({email:address,role:'broadcaster'});
  mocks(false,address,'different-identity');
  await expect(firebaseRoutes(post('/api/auth/session',{idToken:await sign({email:address},'different-identity')}),config)).rejects.toMatchObject({status:403});
  await firebaseRoutes(post('/api/auth/logout',{},newCookie),config);
});
