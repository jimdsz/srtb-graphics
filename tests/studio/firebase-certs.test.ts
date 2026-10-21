import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {afterEach,beforeAll,beforeEach,expect,inject,it,vi} from 'vitest';
import {generateKeyPair,SignJWT} from 'jose';
import * as jose from 'jose';

vi.mock('jose',async original=>({...await original<typeof import('jose')>(),importX509:vi.fn()}));
const config={...env,AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)};
const email='admin@example.com',origin='https://studio.example';
let auth:typeof import('../../server/firebase-auth');
let pair:Awaited<ReturnType<typeof generateKeyPair>>,rotated:Awaited<ReturnType<typeof generateKeyPair>>;
const account=()=>({users:[{localId:'verified-uid',email,emailVerified:true,disabled:false,validSince:'0'}]});
const post=(path:string,token:string,cookie='')=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({idToken:token})});
function sign(kid='old',claims:Record<string,unknown>={},key=pair.privateKey){return new SignJWT({email,email_verified:true,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'password'},...claims}).setProtectedHeader({alg:'RS256',kid}).setIssuer(`https://securetoken.google.com/${config.FIREBASE_PROJECT_ID}`).setAudience(config.FIREBASE_PROJECT_ID).setSubject('verified-uid').setIssuedAt().setExpirationTime(typeof claims.exp==='number'?claims.exp:'45m').sign(key);}
function setup(headers:HeadersInit={'Cache-Control':'public, max-age=3600'}){
  let certificates:Record<string,string>={old:'old-certificate'},lookup:()=>Promise<Response>=async()=>Response.json(account());
  const calls={certificates:0,accounts:0};
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{
    if(String(input).includes('/metadata/x509/')){calls.certificates++;return Response.json(certificates,{headers});}
    calls.accounts++;return lookup();
  });
  return {calls,fetch,certificates:(next:Record<string,string>)=>{certificates=next;},lookup:(next:()=>Promise<Response>)=>{lookup=next;}};
}
async function route(request:Request){
  const {onRequest}=await import('../../server/router');
  return onRequest({request,env:config,params:{},data:{},functionPath:'/',waitUntil:()=>{},passThroughOnException:()=>{throw Error('No public fallback');},next:async()=>new Response('unexpected public fallback')});
}
async function session(token:string){const response=await auth.firebaseRoutes(post('/api/auth/session',token),config);return response!.headers.get('Set-Cookie')!.split(';')[0];}
async function sessionRow(cookie:string){
  const token=cookie.split('=')[1],digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  const key=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return env.DB.prepare('SELECT token_hash,expires_at FROM app_sessions WHERE token_hash=?').bind(key).first<{token_hash:string;expires_at:number}>();
}
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));pair=await generateKeyPair('RS256');rotated=await generateKeyPair('RS256');});
beforeEach(async()=>{
  // Reload only module state: no production reset hook or cached-user fixture.
  vi.resetModules();auth=await import('../../server/firebase-auth');
  vi.mocked(jose.importX509).mockReset().mockImplementation(async certificate=>certificate==='new-certificate'?rotated.publicKey:pair.publicKey);
});
afterEach(()=>vi.restoreAllMocks());

it('caches only public keys while performing an uncached account lookup on every verification',async()=>{
  const mock=setup(),token=await sign();
  for(let request=0;request<3;request++)expect((await auth.verifyFirebaseToken(token,config)).email).toBe(email);
  expect(mock.calls).toEqual({certificates:1,accounts:3});expect(jose.importX509).toHaveBeenCalledTimes(1);
  mock.lookup(async()=>Response.json({...account(),users:[{...account().users[0],disabled:true}]}));
  await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:401});
  mock.lookup(async()=>Response.json(account()));
  expect((await auth.verifyFirebaseToken(token,config)).email).toBe(email);
  expect(mock.calls).toEqual({certificates:1,accounts:5});
});

it.each(['','max-age=0','max-age=abc','max-age=60, max-age=120','max-age=3600, no-store','max-age=3600, no-cache'])('does not retain keys without usable cache permission: %s',async control=>{
  const mock=setup({'Cache-Control':control}),token=await sign();
  await auth.verifyFirebaseToken(token,config);await auth.verifyFirebaseToken(token,config);
  expect(mock.calls).toEqual({certificates:2,accounts:2});
});

it('subtracts Age and refreshes at max-age expiry without a stale-key fallback',async()=>{
  let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
  const mock=setup({'Cache-Control':'public, max-age=2','Age':'1'}),token=await sign();
  await auth.verifyFirebaseToken(token,config);now+=900;await auth.verifyFirebaseToken(token,config);
  expect(mock.calls.certificates).toBe(1);
  now+=101;mock.fetch.mockImplementation(async input=>{
    if(String(input).includes('/metadata/x509/')){mock.calls.certificates++;return new Response('Unavailable',{status:503});}
    mock.calls.accounts++;return Response.json(account());
  });
  await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:503});
  expect(mock.calls).toEqual({certificates:2,accounts:2});
});

it('bounds even excessive upstream cache lifetimes to 24 hours',async()=>{
  let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
  const mock=setup({'Cache-Control':'max-age=31536000'}),token=await sign('old',{exp:Math.floor(now/1000)+2*86400});
  await auth.verifyFirebaseToken(token,config);now+=86400000+1;await auth.verifyFirebaseToken(token,config);
  expect(mock.calls.certificates).toBe(2);
});

it('keeps 50 cold fetches request-owned, then reuses resolved keys for 50 warm verifications',async()=>{
  const mock=setup(),token=await sign();
  const results=await Promise.all(Array.from({length:50},()=>auth.verifyFirebaseToken(token,config)));
  expect(results).toHaveLength(50);expect(mock.calls).toEqual({certificates:50,accounts:50});
  await Promise.all(Array.from({length:50},()=>auth.verifyFirebaseToken(token,config)));
  expect(mock.calls).toEqual({certificates:50,accounts:100});
});

it('refreshes a rotated unknown kid once per cold request and reuses its resolved key thereafter',async()=>{
  const mock=setup(),old=await sign();await auth.verifyFirebaseToken(old,config);
  mock.certificates({old:'old-certificate',new:'new-certificate'});
  const token=await sign('new',{},rotated.privateKey);
  const results=await Promise.all(Array.from({length:20},()=>auth.verifyFirebaseToken(token,config)));
  expect(results.every(result=>result.sub==='verified-uid')).toBe(true);
  expect(mock.calls).toEqual({certificates:21,accounts:21});
  await auth.verifyFirebaseToken(token,config);expect(mock.calls).toEqual({certificates:21,accounts:22});
});

it('does not negative-cache an unknown kid or a prior user rejection',async()=>{
  const mock=setup(),token=await sign('new',{},rotated.privateKey);
  await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:401});
  expect(mock.calls).toEqual({certificates:1,accounts:0});
  mock.certificates({new:'new-certificate'});
  expect((await auth.verifyFirebaseToken(token,config)).sub).toBe('verified-uid');
  expect(mock.calls).toEqual({certificates:2,accounts:1});
});

it('keeps a failed rotation refresh transient while valid cached keys still require account verification',async()=>{
  const mock=setup(),old=await sign(),token=await sign('new',{},rotated.privateKey);
  await auth.verifyFirebaseToken(old,config);
  mock.fetch.mockRejectedValueOnce(new TypeError('offline during rotation'));
  await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:503});
  expect((await auth.verifyFirebaseToken(old,config)).email).toBe(email);
  expect(mock.calls.accounts).toBe(2);
  mock.certificates({new:'new-certificate'});
  expect((await auth.verifyFirebaseToken(token,config)).email).toBe(email);
});

it('bounds provider key counts and response bytes before importing keys',async()=>{
  const mock=setup(),token=await sign();
  mock.certificates(Object.fromEntries(Array.from({length:65},(_,index)=>[`key-${index}`,'certificate'])));
  await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:503});
  expect(jose.importX509).not.toHaveBeenCalled();
  mock.fetch.mockResolvedValue(new Response(' '.repeat(128*1024+1)));
  await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:503});
  expect(jose.importX509).not.toHaveBeenCalled();
});

it.each([408,429,500,502,503])('maps Google certificate HTTP %s to 503 without a user lookup',async status=>{
  const mock=setup(),token=await sign();mock.fetch.mockResolvedValue(new Response('temporary',{status}));
  await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:503});
  expect(mock.fetch).toHaveBeenCalledTimes(1);
});

it.each(['network','timeout','bad-json','bad-shape','bad-certificate'])('treats certificate provider failure as unavailable: %s',async failure=>{
  const mock=setup(),token=await sign();
  if(failure==='network')mock.fetch.mockRejectedValue(new TypeError('network unavailable'));
  if(failure==='timeout')mock.fetch.mockRejectedValue(new DOMException('deadline','TimeoutError'));
  if(failure==='bad-json')mock.fetch.mockResolvedValue(new Response('not JSON'));
  if(failure==='bad-shape')mock.fetch.mockResolvedValue(Response.json({keys:[]}));
  if(failure==='bad-certificate')vi.mocked(jose.importX509).mockRejectedValue(new Error('invalid certificate'));
  await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:503});
});

it('allows retry after a failed certificate fetch without caching the failure',async()=>{
  const mock=setup(),token=await sign();mock.fetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:503});
  expect((await auth.verifyFirebaseToken(token,config)).email).toBe(email);
});

it.each([408,429,500,502,503])('maps Google account HTTP %s to 503, never an invalid-token response',async status=>{
  const mock=setup(),token=await sign();mock.lookup(async()=>new Response('temporary',{status}));
  await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:503});
  expect(mock.calls).toEqual({certificates:1,accounts:1});
});

it.each(['network','timeout','bad-json','bad-shape','configuration'])('keeps account provider failures distinct from revocation: %s',async failure=>{
  const mock=setup(),token=await sign();
  mock.lookup(async()=>{
    if(failure==='network')throw new TypeError('network unavailable');
    if(failure==='timeout')throw new DOMException('deadline','TimeoutError');
    if(failure==='bad-json')return new Response('{');
    if(failure==='configuration')return Response.json({error:{message:'API_KEY_INVALID'}},{status:400});
    return Response.json({users:'malformed'});
  });
  await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:503});
});

it.each(['INVALID_ID_TOKEN','TOKEN_EXPIRED','USER_DISABLED','USER_NOT_FOUND','CREDENTIAL_TOO_OLD_LOGIN_AGAIN'])('preserves true Google identity rejection %s as 401',async message=>{
  const mock=setup(),token=await sign();mock.lookup(async()=>Response.json({error:{message}},{status:400}));
  await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:401});
});

it('rejects account revocation, deletion, mismatched identity and token expiration as 401',async()=>{
  const mock=setup(),token=await sign();
  for(const users of [[],[{...account().users[0],disabled:true}],[{...account().users[0],emailVerified:false}],[{...account().users[0],localId:'other-user'}],[{...account().users[0],validSince:String(Math.floor(Date.now()/1000)+1)}]]){
    mock.lookup(async()=>Response.json({users}));await expect(auth.verifyFirebaseToken(token,config)).rejects.toMatchObject({status:401});
  }
  const lookups=mock.calls.accounts;
  await expect(auth.verifyFirebaseToken(await sign('old',{exp:Math.floor(Date.now()/1000)-1}),config)).rejects.toMatchObject({status:401});
  await expect(auth.verifyFirebaseToken(await sign('old',{},rotated.privateKey),config)).rejects.toMatchObject({status:401});
  expect(mock.calls.accounts).toBe(lookups);
});

it('returns private 503 without setting a cookie or extending an existing D1 session',async()=>{
  const mock=setup(),token=await sign(),cookie=await session(token),before=await sessionRow(cookie);
  mock.lookup(async()=>new Response('Google unavailable',{status:503}));
  const prepare=vi.spyOn(env.DB,'prepare'),response=await route(post('/api/auth/refresh',token,cookie));
  expect(response.status).toBe(503);expect(response.headers.get('Set-Cookie')).toBeNull();
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({error:'Service de connexion temporairement indisponible. Réessayez dans un instant.'});
  expect(prepare.mock.calls.some(([sql])=>/UPDATE app_sessions|INSERT INTO app_sessions|UPDATE members/.test(sql))).toBe(false);
  expect(await sessionRow(cookie)).toEqual(before);
  expect((await auth.authenticateSession(new Request(origin,{headers:{Cookie:cookie}}),config)).email).toBe(email);
});

it('does not create a D1 session when Google is temporarily unavailable during login',async()=>{
  const mock=setup(),token=await sign();mock.lookup(async()=>{throw new DOMException('deadline','TimeoutError');});
  const prepare=vi.spyOn(env.DB,'prepare'),response=await route(post('/api/auth/session',token));
  expect(response.status).toBe(503);expect(response.headers.get('Set-Cookie')).toBeNull();
  expect(prepare.mock.calls.some(([sql])=>/UPDATE app_sessions|INSERT INTO app_sessions|UPDATE members/.test(sql))).toBe(false);
});

it('refuses an already expired session before Google or rate-limit renewal work',async()=>{
  const mock=setup(),token=await sign(),cookie=await session(token),row=(await sessionRow(cookie))!;
  await env.DB.prepare('UPDATE app_sessions SET expires_at=? WHERE token_hash=?').bind(Date.now()-1,row.token_hash).run();
  mock.fetch.mockClear();const prepare=vi.spyOn(env.DB,'prepare');
  const response=await route(post('/api/auth/refresh',token,cookie));
  expect(response.status).toBe(401);expect(response.headers.get('Set-Cookie')).toBeNull();expect(mock.fetch).not.toHaveBeenCalled();
  expect(prepare.mock.calls.some(([sql])=>/UPDATE|INSERT/.test(sql))).toBe(false);
});

it('cannot renew a session that expires while the uncached Google check is pending',async()=>{
  const mock=setup(),token=await sign(),cookie=await session(token),row=(await sessionRow(cookie))!;
  let reached!:()=>void,resume!:()=>void;const waiting=new Promise<void>(done=>{reached=done;}),hold=new Promise<void>(done=>{resume=done;});
  mock.lookup(async()=>{reached();await hold;return Response.json(account());});
  const pending=route(post('/api/auth/refresh',token,cookie));await waiting;
  const expired=Date.now()-1;await env.DB.prepare('UPDATE app_sessions SET expires_at=? WHERE token_hash=?').bind(expired,row.token_hash).run();resume();
  const response=await pending;expect(response.status).toBe(401);expect(response.headers.get('Set-Cookie')).toBeNull();
  expect((await sessionRow(cookie))!.expires_at).toBe(expired);
});

it('rechecks JWT expiration after Google returns instead of creating an already-expired session',async()=>{
  const mock=setup(),started=Date.now(),token=await sign('old',{exp:Math.floor(started/1000)+1});
  mock.lookup(async()=>{vi.spyOn(Date,'now').mockReturnValue(started+2000);return Response.json(account());});
  const prepare=vi.spyOn(env.DB,'prepare'),response=await route(post('/api/auth/session',token));
  expect(response.status).toBe(401);expect(response.headers.get('Set-Cookie')).toBeNull();
  expect(prepare.mock.calls.some(([sql])=>/UPDATE app_sessions|INSERT INTO app_sessions|UPDATE members/.test(sql))).toBe(false);
});
