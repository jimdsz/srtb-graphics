import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {afterEach,beforeAll,beforeEach,expect,inject,it,vi} from 'vitest';
import worker from '../../server/pages-worker';
import {getTemplate,templateDefaults} from '../../src/studio/domain';
import type {Project,Role} from '../../src/studio/domain';
import type {DerivationBatch,DerivationOrigin} from '../../src/studio/derivation-types';
import type {ProjectPage} from '../../src/studio/api';
import {DERIVATION_CLIENT_REQUIRED} from '../../server/derivation-client';

const origin='https://studio.example',base='/api/graphics';
const template=getTemplate('BTV_BA_1P');
// Synthetic settings only. Session rows live in the isolated Workers test D1;
// no Firebase request, credential, auth bypass route or production binding.
const config={...env,AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)};
const assetFetch=vi.fn(async()=>{throw Error('An API request must never fall through to static assets.');});
const bindings={...config,ASSETS:{fetch:assetFetch} as unknown as Fetcher};
const context={waitUntil:vi.fn()} as unknown as ExecutionContext;
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');

function call(path:string,cookie:string,method='GET',body?:unknown,headers:Record<string,string>={}){
  return worker.fetch(new Request(origin+path,{method,headers:{Cookie:cookie,'X-SRTB-Client-Capabilities':'derivations-v1',...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)}),bindings,context);
}
async function fixture(role:Role='designer'){
  const uid=crypto.randomUUID(),email=`derivation-worker-${uid}@example.test`;
  const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),cookie=`__Host-srtb_session=${token}`;
  await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by,firebase_uid) VALUES(?,?,?,1,?,?)').bind(email,'Session locale de qualification',role,email,uid).run();
  await env.DB.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind(await hash(token),email,uid,Date.now()+3600000,Date.now()).run();
  const response=await call(base+'/projects',cookie,'POST',{title:'BA source locale',templateId:template.id,data:{...templateDefaults(template),_media_body_rate:1}});
  expect(response.status).toBe(201);
  return {email,cookie,project:await response.json<Project>()};
}
function intent(project:Project){
  return {requestId:crypto.randomUUID(),name:'Lot authentifié de qualification',sourceRevision:project.revision,sourceTitle:project.title,sourceData:project.data,targets:['ba-portrait','popup-1']};
}
async function counts(){
  return Promise.all(['projects','revisions','activity','derivation_batches','project_derivations','media'].map(table=>env.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first<{n:number}>()));
}
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));});
beforeEach(()=>{
  assetFetch.mockClear();
  vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('External network is forbidden in this local session test.'));
});
afterEach(()=>{
  expect(assetFetch).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it.each(['designer','broadcaster','admin'] as const)('routes a real %s session through the Worker to one idempotent draft batch',async role=>{
  const {email,cookie,project}=await fixture(role),body=intent(project),path=`${base}/projects/${project.id}/derivations`;
  const response=await call(path,cookie,'POST',body);
  expect(response.status).toBe(201);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const batch=await response.json<DerivationBatch>();
  expect(batch.createdBy).toBe(email);expect(batch.childCount).toBe(2);
  expect(batch.children.every(child=>child.project.status==='draft'&&child.project.revision===1&&child.project.created_by===email)).toBe(true);
  const after=await counts(),repeated=await call(path,cookie,'POST',body);
  expect(repeated.status).toBe(200);expect((await repeated.json<DerivationBatch>()).id).toBe(batch.id);expect(await counts()).toEqual(after);
  const detail=await call(`${base}/derivations/${batch.id}`,cookie);
  expect(detail.status).toBe(200);expect(await detail.json()).toEqual(batch);
  const provenance=await call(`${base}/projects/${batch.children[1].project.id}/derivation-origin`,cookie);
  expect(provenance.status).toBe(200);expect((await provenance.json<DerivationOrigin>()).batchId).toBe(batch.id);
  const original=await call(`${base}/projects/${project.id}`,cookie);
  expect(await original.json()).toEqual(project);
  // An ordinary project has no derivation provenance; its normal UI expects
  // this authenticated 404 after the additive migration, never a table error.
  expect((await call(`${base}/projects/${project.id}/derivation-origin`,cookie)).status).toBe(404);
});

it.each(['logout','suspension'] as const)('rejects batch reads, voice catalogue and writes after %s without consuming an intent',async reason=>{
  const {email,cookie,project}=await fixture(),body=intent(project),path=`${base}/projects/${project.id}/derivations`;
  const created=await call(path,cookie,'POST',body);expect(created.status).toBe(201);
  const batch=await created.json<DerivationBatch>();
  if(reason==='logout')expect((await call('/api/auth/logout',cookie,'POST',{})).status).toBe(200);
  else {
    const admin=await fixture('admin');
    expect((await call(base+'/members',admin.cookie,'POST',{email,name:'Session suspendue',role:'designer',active:false})).status).toBe(200);
    // Re-enabling the member cannot resurrect their deleted session cookie.
    expect((await call(base+'/members',admin.cookie,'POST',{email,name:'Session réactivée',role:'designer',active:true})).status).toBe(200);
  }
  const before=await counts();
  for(const route of [path,`${base}/derivations/${batch.id}`,`${base}/projects/${batch.children[0].project.id}/derivation-origin`,base+'/preparation-profiles/voice-catalogue']){
    const response=await call(route,cookie);expect(response.status).toBe(401);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).not.toHaveProperty('sourceSnapshot');
  }
  // Both a receipt replay and a fresh intent must reauthenticate at the Worker.
  for(const request of [body,intent(project)])expect((await call(path,cookie,'POST',request)).status).toBe(401);
  expect(await counts()).toEqual(before);
});

const crossSiteHeaders:Record<string,string>[]=[{Origin:'https://other.example'},{Origin:origin,'Sec-Fetch-Site':'cross-site'}];
it.each(crossSiteHeaders)('rejects a cross-site batch write with a valid cookie: %j',async headers=>{
  const {cookie,project}=await fixture(),body=intent(project),path=`${base}/projects/${project.id}/derivations`,before=await counts();
  const refused=await call(path,cookie,'POST',body,headers);
  expect(refused.status).toBe(403);expect(refused.headers.get('Cache-Control')).toBe('private, no-store');expect(await counts()).toEqual(before);
  expect((await call(path,cookie,'POST',body)).status).toBe(201);
});

const legacyHeaders={'X-SRTB-Client-Capabilities':''};
it('keeps pending Tout de suite children on the dedicated TDS engine, inaccessible to old tabs in all formats',async()=>{
  const {cookie,project}=await fixture();
  const body={...intent(project),targets:[],announcements:[{key:'now',formats:['tv','portrait','vertical'],voice:{mode:'pending'}}]};
  const created=await call(`${base}/projects/${project.id}/derivations`,cookie,'POST',body);expect(created.status).toBe(201);
  const batch=await created.json<DerivationBatch>();expect(batch.childCount).toBe(3);
  for(const [index,child] of batch.children.entries()){
    expect(child.project.template_id).toBe('BTV_BA_TDS');
    expect(child.project.data._studio_format).toBe(['tv','portrait','vertical'][index]);
    expect(child.project.data._background_visible).toBe(true);
    expect(Object.keys(child.project.data).some(key=>/^_(jour|heure)_/.test(key))).toBe(false);
    expect(child.announcement).toMatchObject({key:'now',time:'',voice:{mode:'pending',status:'pending'}});
    const path=`${base}/projects/${child.project.id}`;
    const provenance=await (await call(path+'/derivation-origin',cookie)).json<DerivationOrigin>();
    expect(provenance.announcement?.voice.status).toBe('pending');
    expect((await call(path,cookie,'GET',undefined,legacyHeaders)).status).toBe(409);
    expect((await call(path+'/export',cookie,'POST',{title:child.project.title,revision:1,data:child.project.data},legacyHeaders)).status).toBe(409);
  }
  expect(await (await call(`${base}/projects/${project.id}`,cookie)).json()).toEqual(project);
});

it.each([0,1])('filters derived children before the 100-item legacy pagination, archived=%i',async archived=>{
  // Other fixture authors' private projects must not enter this pagination.
  const {cookie,project}=await fixture(),created=await call(`${base}/projects/${project.id}/derivations`,cookie,'POST',intent(project));
  const batch=await created.json<DerivationBatch>(),ordinaryIds=[project.id,...Array.from({length:102},()=>crypto.randomUUID())];
  await env.DB.batch(ordinaryIds.slice(1).map(id=>env.DB.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by,archived,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind(id,'Projet ordinaire',project.template_id,project.template_version,project.library_version,JSON.stringify(project.data),project.created_by,project.updated_by,archived,'2026-09-24T00:00:00.000Z')));
  await env.DB.prepare('UPDATE projects SET archived=?,updated_at=?,revision=revision+1 WHERE id=?').bind(archived,'2026-09-24T00:00:00.000Z',project.id).run();
  for(const child of batch.children)await env.DB.prepare('UPDATE projects SET archived=?,updated_at=?,revision=revision+1 WHERE id=?').bind(archived,'2026-09-25T00:00:00.000Z',child.project.id).run();
  const first=await call(`${base}/projects?archived=${archived}`,cookie,'GET',undefined,legacyHeaders);
  expect(first.status).toBe(200);expect(first.headers.get('Cache-Control')).toBe('private, no-store');
  const page=await first.json<ProjectPage>();expect(page.projects).toHaveLength(100);expect(page.next).not.toBeNull();
  const second=await (await call(`${base}/projects?archived=${archived}&${new URLSearchParams(page.next!)}`,cookie,'GET',undefined,legacyHeaders)).json<ProjectPage>();
  expect(second.projects).toHaveLength(3);expect(second.next).toBeNull();
  expect([...page.projects,...second.projects].map(item=>item.id).sort()).toEqual(ordinaryIds.sort());
  const modern=await (await call(`${base}/projects?archived=${archived}`,cookie)).json<ProjectPage>();
  expect(modern.projects.slice(0,2).map(item=>item.id).sort()).toEqual(batch.children.map(child=>child.project.id).sort());
});

it('targets 409 to every derived-child operation and receipt route without writes or session termination',async()=>{
  const {cookie,project}=await fixture(),body=intent(project);
  const batch=await (await call(`${base}/projects/${project.id}/derivations`,cookie,'POST',body)).json<DerivationBatch>();
  const child=batch.children[0].project,childPath=`${base}/projects/${child.id}`,before=await counts();
  const routes:[string,string,unknown?][]=[
    [childPath,'GET'],[childPath,'PUT',{}],[childPath+'/revisions','GET'],[childPath+'/status','POST',{}],
    [childPath+'/archive','POST',{}],[childPath+'/comments','GET'],[childPath+'/comments','POST',{}],
    [childPath+'/export','POST',{}],[childPath+'/delivery?revision=1','GET'],[childPath+'/derivation-origin','GET'],
    [childPath+'/derivations','GET'],[`${base}/projects/${project.id}/derivations`,'GET'],
    [`${base}/projects/${project.id}/derivations`,'POST',body],[`${base}/derivations/${batch.id}`,'GET'],
  ];
  for(const [path,method,payload] of routes){
    const response=await call(path,cookie,method,payload,legacyHeaders);
    expect(response.status,path).toBe(409);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({error:DERIVATION_CLIENT_REQUIRED});
    expect(response.headers.has('Set-Cookie')).toBe(false);
  }
  expect(await counts()).toEqual(before);
  expect((await call(childPath,cookie)).status).toBe(200);
  expect((await call(`${base}/projects/${project.id}`,cookie,'GET',undefined,legacyHeaders)).status).toBe(200);
  expect((await call('/api/me',cookie,'GET',undefined,legacyHeaders)).status).toBe(200);
  expect((await call(`${base}/projects/${crypto.randomUUID()}`,cookie,'GET',undefined,legacyHeaders)).status).toBe(404);
});

it('preserves the complete ordinary-project workflow in an old authenticated tab',async()=>{
  const {cookie}=await fixture('admin');
  const legacy=(path:string,method='GET',body?:unknown)=>call(base+path,cookie,method,body,legacyHeaders);
  const created=await legacy('/projects','POST',{title:'Ordinaire ancien onglet',templateId:template.id,data:templateDefaults(template)});
  expect(created.status).toBe(201);let project=await created.json<Project>();const path=`/projects/${project.id}`;
  const saved=await legacy(path,'PUT',{title:'Brouillon conservé',revision:project.revision,data:project.data});expect(saved.status).toBe(200);project=await saved.json<Project>();
  expect((await legacy(path+'/export','POST',{title:project.title,revision:project.revision,data:project.data})).status).toBe(200);
  expect((await legacy(path+'/comments','POST',{revision:project.revision,body:'Commentaire ordinaire'})).status).toBe(201);
  expect((await legacy(path+'/comments')).status).toBe(200);expect((await legacy(path+'/revisions')).status).toBe(200);
  for(const status of ['submitted','approved']){
    const response=await legacy(path+'/status','POST',{revision:project.revision,status});expect(response.status).toBe(200);project=await response.json<Project>();
  }
  expect((await legacy(path+`/delivery?revision=${project.revision}`)).status).toBe(200);
  for(const archived of [true,false]){
    const response=await legacy(path+'/archive','POST',{revision:project.revision,archived});expect(response.status).toBe(200);project=await response.json<Project>();
  }
  expect(await (await legacy(path)).json()).toEqual(project);expect(project.title).toBe('Brouillon conservé');
});

it('isolates capability per request and idempotency per user while retaining intentional team sharing',async()=>{
  const first=await fixture(),second=await fixture();
  const hidden=await call(`${base}/projects/${first.project.id}/derivations`,second.cookie,'POST',intent(first.project));expect(hidden.status).toBe(404);
  first.project=await (await call(`${base}/projects/${first.project.id}/sharing`,first.cookie,'POST',{revision:first.project.revision,visibility:'team'})).json<Project>();
  const body=intent(first.project),path=`${base}/projects/${first.project.id}/derivations`;
  const batch=await (await call(path,first.cookie,'POST',body)).json<DerivationBatch>();
  // Same request UUID is scoped to its authenticated actor, not a global receipt cache.
  const other=await call(path,second.cookie,'POST',body);expect(other.status).toBe(201);
  const otherBatch=await other.json<DerivationBatch>();expect(otherBatch.id).not.toBe(batch.id);expect(otherBatch.createdBy).toBe(second.email);
  const childPath=`${base}/projects/${batch.children[0].project.id}`;
  await call(childPath+'/sharing',first.cookie,'POST',{revision:batch.children[0].project.revision,visibility:'team'});
  const responses=await Promise.all([
    call(childPath,first.cookie),call(childPath,second.cookie,'GET',undefined,legacyHeaders),
    call(childPath,'', 'GET'),call(childPath,second.cookie,'GET',undefined,{'X-SRTB-Client-Capabilities':'other-v1, derivations-v1'}),
    call(childPath,first.cookie,'GET',undefined,{'X-SRTB-Client-Capabilities':'derivations-v10'}),
  ]);
  expect(responses.map(response=>response.status)).toEqual([200,409,401,200,409]);
  for(const response of responses)expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect((await call(`${base}/derivations/${batch.id}`,second.cookie)).status).toBe(404,'sharing a project does not expose the creator’s full derivation snapshots');
  await env.DB.prepare('UPDATE members SET firebase_uid=? WHERE email=?').bind(crypto.randomUUID(),first.email).run();
  const invalidated=await call(childPath,first.cookie);expect(invalidated.status).toBe(401);expect(await invalidated.json()).not.toHaveProperty('data');
  expect((await call(childPath,second.cookie)).status).toBe(200);
});
