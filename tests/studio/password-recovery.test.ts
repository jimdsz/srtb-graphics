import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,beforeEach,afterEach,it,expect,inject,vi} from 'vitest';
import {passwordRecoveryRoutes} from '../../server/password-recovery';
import {authenticateSession,isPublicAppPath} from '../../server/firebase-auth';
const config={...env,AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)};
const origin='https://studio.example',email='recovery@example.test',code='test-only-single-use-code';
const call=(action:string,body:unknown)=>passwordRecoveryRoutes(new Request(origin+'/api/auth/recovery/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.120'},body:JSON.stringify(body)}),config);
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));await env.DB.prepare("INSERT INTO members(email,name,role,active,firebase_uid,updated_by) VALUES(?,'Recette','designer',1,'test-uid',?)").bind(email,email).run();});
beforeEach(async()=>{await env.DB.batch([env.DB.prepare('DELETE FROM login_limits'),env.DB.prepare('DELETE FROM recovery_barriers'),env.DB.prepare('DELETE FROM app_sessions'),env.DB.prepare('UPDATE members SET active=1 WHERE email=?').bind(email)]);});
afterEach(()=>vi.restoreAllMocks());
function provider(){return vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json({email,requestType:'PASSWORD_RESET'}));}
async function session(){const token='b'.repeat(64);await env.DB.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind(await hash(token),email,'test-uid',Date.now()+3600000,Date.now()-1000).run();return new Request(origin,{headers:{Cookie:'__Host-srtb_session='+token}});}
it('keeps the action shell public, passwords and resources private',()=>{expect(isPublicAppPath('/auth/action')).toBe(true);expect(isPublicAppPath('/api/auth/recovery/confirm')).toBe(false);});
it('requests recovery with the same generic result for present and absent accounts',async()=>{const fetch=provider();const first=await(await call('request',{email}))!.json();fetch.mockResolvedValueOnce(Response.json({error:{message:'EMAIL_NOT_FOUND'}},{status:400}));expect(await(await call('request',{email:'absent@example.test'}))!.json()).toEqual(first);expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({requestType:'PASSWORD_RESET',email,continueUrl:'https://srtb-graphics.pages.dev/login'});});
it('uses only provider-verified identity and rejects browser identity overrides',async()=>{const fetch=provider();await expect(call('confirm',{code,password:'long-enough-test-password',email:'victim@example.test'})).rejects.toMatchObject({name:'ZodError'});expect(fetch).not.toHaveBeenCalled();expect(await(await call('verify',{code}))!.json()).toEqual({email});});
it('revokes old opaque sessions before the provider confirms, preserving role and activity',async()=>{const old=await session();let count=0;vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{if(++count===2)await expect(authenticateSession(old,config)).rejects.toMatchObject({status:401});return Response.json({email,requestType:'PASSWORD_RESET'});});expect((await call('confirm',{code,password:'a new test password'}))!.status).toBe(200);await expect(authenticateSession(old,config)).rejects.toMatchObject({status:401});expect(await env.DB.prepare('SELECT role,active FROM members WHERE email=?').bind(email).first()).toEqual({role:'designer',active:1});});
it('does not reactivate a suspended Graphics member',async()=>{await env.DB.prepare('UPDATE members SET active=0 WHERE email=?').bind(email).run();provider();await call('confirm',{code,password:'a new test password'});expect((await env.DB.prepare('SELECT active FROM members WHERE email=?').bind(email).first<{active:number}>())?.active).toBe(0);});
it('never revokes sessions when a code is invalid or belongs to another action',async()=>{await session();const fetch=provider();fetch.mockResolvedValueOnce(Response.json({error:{message:'EXPIRED_OOB_CODE'}},{status:400}));await expect(call('confirm',{code,password:'a new test password'})).rejects.toMatchObject({status:410});fetch.mockResolvedValueOnce(Response.json({email,requestType:'VERIFY_EMAIL'}));await expect(call('confirm',{code,password:'a new test password'})).rejects.toMatchObject({status:410});expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM app_sessions').first<{n:number}>())?.n).toBe(1);});
it('rejects a used code with a resend action instead of a raw provider error',async()=>{provider().mockResolvedValue(Response.json({error:{message:'INVALID_OOB_CODE'}},{status:400}));await expect(call('verify',{code})).rejects.toMatchObject({status:410,message:'Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien.'});});
it('keeps the short login barrier if confirmation response is lost',async()=>{await session();provider().mockResolvedValueOnce(Response.json({email,requestType:'PASSWORD_RESET'})).mockRejectedValueOnce(Error('network'));await expect(call('confirm',{code,password:'a new test password'})).rejects.toMatchObject({status:503});const barrier=await env.DB.prepare('SELECT blocked_until FROM recovery_barriers WHERE email=?').bind(email).first<{blocked_until:number}>();expect(barrier!.blocked_until).toBeGreaterThan(Date.now());expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM app_sessions').first<{n:number}>())!.n).toBe(0);});
it('barrier invalidates sessions even if a worker stops before physical deletion',async()=>{const old=await session();await env.DB.prepare('INSERT INTO recovery_barriers VALUES(?,?,?,?)').bind(email,'interrupted',Date.now()+120000,Date.now()).run();await expect(authenticateSession(old,config)).rejects.toMatchObject({status:401});});
it('limits recovery spam without storing an email in the limiter key',async()=>{provider();for(let i=0;i<5;i++)await call('request',{email});await expect(call('request',{email})).rejects.toMatchObject({status:429});const keys=(await env.DB.prepare('SELECT key FROM login_limits').all<{key:string}>()).results;expect(keys.every(r=>/^[a-f0-9]{64}$/.test(r.key))).toBe(true);});
it('enforces 12 characters and rejects a cross-site submission',async()=>{const fetch=provider();await expect(call('confirm',{code,password:'short'})).rejects.toMatchObject({name:'ZodError'});await expect(passwordRecoveryRoutes(new Request(origin+'/api/auth/recovery/request',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:JSON.stringify({email})}),config)).rejects.toMatchObject({status:403});expect(fetch).not.toHaveBeenCalled();});
it('does not reveal a disabled provider account in the request response',async()=>{
 const fetch=provider();const ordinary=await(await call('request',{email}))!.json();
 fetch.mockResolvedValueOnce(Response.json({error:{message:'USER_DISABLED'}},{status:400}));
 expect(await(await call('request',{email:'disabled@example.test'}))!.json()).toEqual(ordinary);
});
it('blocks a simultaneous confirmation without submitting a second new password',async()=>{
 await session();let release!:()=>void,entered!:()=>void;const inside=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});let passwordWrites=0;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(_input,init)=>{
  const body=JSON.parse(String(init?.body));
  if(body.newPassword){passwordWrites++;entered();await gate;}
  return Response.json({email,requestType:'PASSWORD_RESET'});
 });
 const first=call('confirm',{code,password:'first fixture password'});await inside;
 try{await expect(call('confirm',{code,password:'second fixture password'})).rejects.toMatchObject({status:409});expect(passwordWrites).toBe(1);}
 finally{release();await first;}
});
it('releases a rejected-password barrier so the same valid link can be retried',async()=>{
 const fetch=provider();fetch.mockResolvedValueOnce(Response.json({email,requestType:'PASSWORD_RESET'})).mockResolvedValueOnce(Response.json({error:{message:'PASSWORD_DOES_NOT_MEET_REQUIREMENTS'}},{status:400}));
 await expect(call('confirm',{code,password:'long fixture password'})).rejects.toMatchObject({status:422});
 expect((await env.DB.prepare('SELECT blocked_until FROM recovery_barriers WHERE email=?').bind(email).first<{blocked_until:number}>())!.blocked_until).toBe(0);
 expect((await call('confirm',{code,password:'second fixture password'}))!.status).toBe(200);
});
it('stores neither the action code nor password in activity or rate-limit records',async()=>{
 provider();const password='fixture-only-password-never-log';await call('confirm',{code,password});
 const stored=JSON.stringify({activity:(await env.DB.prepare('SELECT actor,action,target,detail FROM activity').all()).results,limits:(await env.DB.prepare('SELECT * FROM login_limits').all()).results,barriers:(await env.DB.prepare('SELECT * FROM recovery_barriers').all()).results});
 expect(stored).not.toContain(code);expect(stored).not.toContain(password);
});
it('turns a malformed provider reply into a recoverable error without deleting sessions',async()=>{
 await session();provider().mockResolvedValueOnce(new Response('upstream debug details',{status:502}));
 await expect(call('confirm',{code,password:'long fixture password'})).rejects.toMatchObject({status:503,message:'Réponse incomplète. Réessayez dans un instant.'});
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM app_sessions').first<{n:number}>())!.n).toBe(1);
});
