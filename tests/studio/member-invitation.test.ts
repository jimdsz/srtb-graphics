import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,beforeEach,afterEach,it,expect,inject,vi} from 'vitest';
import {memberRoutes} from '../../server/members';
import {assertNoMemberInvitation,memberInvitationLockKey,requestMemberInvitation} from '../../server/member-invitation';
import type {Member} from '../../src/studio/domain';

const origin='https://studio.example';
const admin:Member={email:'admin@example.com',name:'Jimmy',role:'admin',active:1};
const config={...env,AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)};
let email='';
const call=(path:string,body?:unknown,actor=admin,requestOrigin=origin)=>memberRoutes(new Request(origin+'/api/members'+path,{method:body===undefined?'GET':'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),config,actor);
const add=(active=true)=>call('',{email,name:'Membre test',role:'designer',active});
const invite=()=>call('/invitation',{email});
const existing=async(active=1)=>env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,?,?)').bind(email,'Membre test','designer',active,admin.email).run();
function provider(){return vi.spyOn(globalThis,'fetch').mockImplementation(async(_input,init)=>{
  const body=JSON.parse(String(init?.body));
  return Response.json(body.password?{localId:'fixture-created-uid',email:body.email,idToken:'never-return-provider-token',refreshToken:'never-return-refresh'}:{email:body.email});
});}
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));});
beforeEach(async()=>{email=crypto.randomUUID()+'@example.test';await env.DB.prepare('DELETE FROM login_limits').run();});
afterEach(()=>vi.restoreAllMocks());

it('authorizes a new active member then requests the Firebase password choice email',async()=>{
  const fetch=provider();const response=await add();
  expect(response!.status).toBe(200);expect(await response!.json()).toMatchObject({ok:true,invitation:{status:'requested',message:expect.stringContaining('accepté')}});
  const created=JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(Object.keys(created).sort()).toEqual(['email','password']);expect(created.email).toBe(email);expect(created.password).toMatch(/^Aa1![a-f0-9]{64}$/);
  expect(created).not.toHaveProperty('emailVerified');expect(created).not.toHaveProperty('idToken');
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({requestType:'PASSWORD_RESET',email,continueUrl:'https://srtb-graphics.pages.dev/login'});
  expect(fetch.mock.calls[1][1]).toMatchObject({redirect:'manual',cache:'no-store',headers:{'X-Firebase-Locale':'fr'}});
  expect(await env.DB.prepare('SELECT active,firebase_uid FROM members WHERE email=?').bind(email).first()).toEqual({active:1,firebase_uid:null});
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM app_sessions WHERE email=?').bind(email).first()).toEqual({n:0});
});
it('does not send invitations when editing an active member or adding an inactive one',async()=>{
  const fetch=provider();await existing();expect(await(await add())!.json()).not.toHaveProperty('invitation');
  email=crypto.randomUUID()+'@example.test';await add(false);expect(fetch).not.toHaveBeenCalled();
});
it('sends again when an inactive or removed member is explicitly reauthorized',async()=>{
  const fetch=provider();await existing(0);await add();expect(fetch).toHaveBeenCalledTimes(2);
  email=crypto.randomUUID()+'@example.test';await existing(0);await env.DB.prepare("UPDATE members SET removed_at='2026-01-01' WHERE email=?").bind(email).run();
  await add();expect(fetch).toHaveBeenCalledTimes(4);
});
it('never alters an existing Firebase identity and only asks for an email link',async()=>{
  await existing();await env.DB.prepare("UPDATE members SET firebase_uid='existing-uid' WHERE email=?").bind(email).run();
  const fetch=provider().mockResolvedValueOnce(Response.json({error:{message:'EMAIL_EXISTS'}},{status:400}));
  expect(await(await invite())!.json()).toMatchObject({invitation:{status:'requested'}});
  expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls.every(([url])=>!String(url).includes(':update'))).toBe(true);
  expect(await env.DB.prepare('SELECT firebase_uid FROM members WHERE email=?').bind(email).first()).toEqual({firebase_uid:'existing-uid'});
});
it('keeps the saved access and exposes failed status after a provider rejection',async()=>{
  const fetch=provider().mockResolvedValueOnce(Response.json({error:{message:'QUOTA_EXCEEDED provider sensitive details'}},{status:400}));
  const body=await(await add())!.json();expect(body).toMatchObject({ok:true,invitation:{status:'failed'}});expect(JSON.stringify(body)).not.toContain('QUOTA');
  expect(fetch).toHaveBeenCalledTimes(1);expect(await env.DB.prepare('SELECT active FROM members WHERE email=?').bind(email).first()).toEqual({active:1});
  const list=await(await call(''))!.json() as Record<string,unknown>[];expect(list.find(row=>row.email===email)).toMatchObject({has_connected:false,invitation:{status:'failed'}});
});
it('retains a durable deletion barrier when a provision response is lost',async()=>{
  await existing();provider().mockRejectedValueOnce(Error('lost response with secrets'));
  expect(await(await invite())!.json()).toMatchObject({invitation:{status:'failed'}});
  await expect(assertNoMemberInvitation(env.DB,email)).rejects.toMatchObject({status:409});
  expect((await env.DB.prepare('SELECT expires_at FROM login_limits WHERE key=?').bind(await memberInvitationLockKey(email)).first<{expires_at:number}>())!.expires_at).toBeGreaterThan(Date.now());
});
it('holds one lease for concurrent attempts and sends exactly one email',async()=>{
  await existing();let release!:()=>void,entered!:()=>void;
  const inside=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const fetch=provider().mockImplementationOnce(async()=>{entered();await gate;return Response.json({localId:'fixture-created-uid',email});});
  const first=invite();await inside;
  try{
    await expect(invite()).rejects.toMatchObject({status:429});await expect(assertNoMemberInvitation(env.DB,email)).rejects.toMatchObject({status:409});
    const list=await(await call(''))!.json() as Record<string,unknown>[];expect(list.find(row=>row.email===email)).toMatchObject({invitation:{status:'pending'}});
  }
  finally{release();await first;}
  expect(fetch).toHaveBeenCalledTimes(2);await expect(assertNoMemberInvitation(env.DB,email)).resolves.toBeUndefined();
});
it('limits repeated sends to the same address without keeping plaintext limiter keys',async()=>{
  await existing();const fetch=provider();await invite();await expect(invite()).rejects.toMatchObject({status:429});expect(fetch).toHaveBeenCalledTimes(2);
  const keys=(await env.DB.prepare('SELECT key FROM login_limits').all<{key:string}>()).results;expect(keys.every(row=>/^[a-f0-9]{64}$/.test(row.key))).toBe(true);
});
it('limits an administrator to twenty requests in ten minutes',async()=>{
  const fetch=provider();for(let i=0;i<20;i++){email=crypto.randomUUID()+'@example.test';await existing();await invite();}
  email=crypto.randomUUID()+'@example.test';await existing();await expect(invite()).rejects.toMatchObject({status:429});expect(fetch).toHaveBeenCalledTimes(40);
});
it('rejects missing, suspended, removed, non-admin, cross-origin and malformed requests',async()=>{
  const fetch=provider();await expect(invite()).rejects.toMatchObject({status:409});await existing(0);await expect(invite()).rejects.toMatchObject({status:409});
  await env.DB.prepare("UPDATE members SET removed_at='2026-01-01' WHERE email=?").bind(email).run();await expect(invite()).rejects.toMatchObject({status:409});
  await expect(call('/invitation',{email},{...admin,role:'designer'})).rejects.toMatchObject({status:403});
  await expect(call('/invitation',{email},admin,'https://evil.example')).rejects.toMatchObject({status:403});
  await expect(call('/invitation',{email,password:'unwanted'})).rejects.toMatchObject({name:'ZodError'});
  await expect(requestMemberInvitation(config,{...admin,active:0},email)).rejects.toMatchObject({status:403});expect(fetch).not.toHaveBeenCalled();
});
it('rechecks suspension after provisioning, before asking Firebase to send email',async()=>{
  await existing();const fetch=provider().mockImplementationOnce(async()=>{await env.DB.prepare('UPDATE members SET active=0 WHERE email=?').bind(email).run();return Response.json({localId:'fixture-created-uid',email});});
  expect(await(await invite())!.json()).toMatchObject({invitation:{status:'failed'}});expect(fetch).toHaveBeenCalledTimes(1);
});
it('blocks a member whose purge is already in progress before any provider call',async()=>{
  await existing();const fetch=provider(),id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO member_purge_jobs(slot,id,email,impact_json,created_at) VALUES(1,?,?,?,?)').bind(id,email,'{}',Date.now()).run();
  try{await expect(invite()).rejects.toMatchObject({status:409});expect(fetch).not.toHaveBeenCalled();}
  finally{await env.DB.prepare('DELETE FROM member_purge_jobs WHERE id=?').bind(id).run();}
});
it('returns only latest invitation metadata and connection presence, never UID or secrets',async()=>{
  const fetch=provider();await add();const password=JSON.parse(String(fetch.mock.calls[0][1]?.body)).password;
  await env.DB.prepare("UPDATE members SET firebase_uid='uid-private' WHERE email=?").bind(email).run();
  const list=await(await call(''))!.json() as Record<string,unknown>[];
  const member=list.find(row=>row.email===email)!;expect(member).toMatchObject({has_connected:true,invitation:{status:'requested'}});expect(member).not.toHaveProperty('firebase_uid');
  const stored=JSON.stringify({member,activity:(await env.DB.prepare('SELECT * FROM activity WHERE target=?').bind(email).all()).results});
  for(const secret of [password,'never-return-provider-token','never-return-refresh','uid-private'])expect(stored).not.toContain(secret);
});
it('does not claim success for a malformed or mismatched successful provider response',async()=>{
  await existing();provider().mockResolvedValueOnce(Response.json({localId:'other',email:'another@example.test'}));
  expect(await(await invite())!.json()).toMatchObject({invitation:{status:'failed'}});await expect(assertNoMemberInvitation(env.DB,email)).rejects.toMatchObject({status:409});
});
it('retries an uncertain provisioning after the lease expires without replacing its password',async()=>{
  await existing();const fetch=provider().mockRejectedValueOnce(Error('lost provisioning response'));
  await invite();await env.DB.prepare('UPDATE login_limits SET expires_at=0').run();
  fetch.mockResolvedValueOnce(Response.json({error:{message:'EMAIL_EXISTS'}},{status:400}));
  expect(await(await invite())!.json()).toMatchObject({invitation:{status:'requested'}});expect(fetch).toHaveBeenCalledTimes(3);
  expect(String(fetch.mock.calls[2][0])).toContain(':sendOobCode');
});
it('records rejected email dispatch separately from successful provisioning and permits a later resend',async()=>{
  await existing();const fetch=provider();
  fetch.mockResolvedValueOnce(Response.json({localId:'created',email})).mockResolvedValueOnce(Response.json({error:{message:'TOO_MANY_ATTEMPTS_TRY_LATER'}},{status:429}));
  expect(await(await invite())!.json()).toMatchObject({invitation:{status:'failed'}});
  await expect(assertNoMemberInvitation(env.DB,email)).resolves.toBeUndefined();
  await env.DB.prepare('UPDATE login_limits SET expires_at=0').run();fetch.mockResolvedValueOnce(Response.json({error:{message:'EMAIL_EXISTS'}},{status:400}));
  expect(await(await invite())!.json()).toMatchObject({invitation:{status:'requested'}});
});
it('keeps a pending deletion barrier when the email dispatch response is lost',async()=>{
  await existing();provider().mockResolvedValueOnce(Response.json({localId:'created',email})).mockRejectedValueOnce(Error('lost dispatch response'));
  expect(await(await invite())!.json()).toMatchObject({invitation:{status:'failed'}});
  await expect(assertNoMemberInvitation(env.DB,email)).rejects.toMatchObject({status:409});
});
