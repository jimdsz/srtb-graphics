import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {afterEach,beforeAll,beforeEach,expect,inject,it,vi} from 'vitest';
import worker from '../../server/pages-worker';
import {getTemplate,templateDefaults} from '../../src/studio/domain';
import type {Project,Role} from '../../src/studio/domain';
import type {DerivationBatch,DerivationOrigin,DerivationPage} from '../../src/studio/derivation-types';
import type {ProjectPage} from '../../src/studio/api';
import type {DeliveryPlan} from '../../src/studio/delivery-plan';

const origin='https://studio.example',base='/api/graphics';
const template=getTemplate('BTV_BA_1P');
// Real Worker authentication against synthetic local sessions only. No external
// identity request, asset download, production binding or authentication bypass.
const assetFetch=vi.fn(async()=>{throw Error('Private API requests cannot fall through to assets.');});
const bindings={...env,AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35),ASSETS:{fetch:assetFetch} as unknown as Fetcher};
const context={waitUntil:vi.fn()} as unknown as ExecutionContext;
type Actor={email:string;cookie:string};
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');

async function session(role:Role):Promise<Actor>{
  const uid=crypto.randomUUID(),email=`derivation-privacy-${uid}@example.test`;
  const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
  await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by,firebase_uid) VALUES(?,?,?,1,?,?)').bind(email,'Recette de confidentialité',role,email,uid).run();
  await env.DB.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind(await hash(token),email,uid,Date.now()+3600000,Date.now()).run();
  return {email,cookie:`__Host-srtb_session=${token}`};
}
async function call(path:string,actor:Actor,method='GET',body?:unknown){
  const response=await worker.fetch(new Request(origin+base+path,{method,headers:{Cookie:actor.cookie,Origin:origin,'Content-Type':'application/json','X-SRTB-Client-Capabilities':'derivations-v1'},body:body===undefined?undefined:JSON.stringify(body)}),bindings,context);
  expect(response.headers.get('Cache-Control'),path).toBe('private, no-store');
  return response;
}
async function denied(path:string,actor:Actor,status=404,method='GET',body?:unknown){
  const response=await call(path,actor,method,body);expect(response.status,path).toBe(status);
  const result=await response.json<Record<string,unknown>>();
  expect(result).toHaveProperty('error');
  for(const field of ['data','sourceSnapshot','sourceProjectId','allowedLibraryUrls','children','batches'])expect(result,path).not.toHaveProperty(field);
}
async function fixture(){
  const actors={owner:await session('designer'),colleague:await session('designer'),admin:await session('admin'),broadcaster:await session('broadcaster')};
  const created=await call('/projects',actors.owner,'POST',{title:'Source privée de recette',templateId:template.id,data:{...templateDefaults(template),_media_body_rate:1}});
  expect(created.status).toBe(201);const source=await created.json<Project>();
  const response=await call(`/projects/${source.id}/derivations`,actors.owner,'POST',{requestId:crypto.randomUUID(),name:'Lot privé de recette',sourceRevision:source.revision,sourceTitle:'Instantané source non partagé',sourceData:source.data,targets:['popup-1','ba-portrait']});
  expect(response.status).toBe(201);const batch=await response.json<DerivationBatch>();
  expect(source.visibility).toBe('private');expect(batch.children.every(child=>child.project.visibility==='private')).toBe(true);
  return {actors,source,batch,child:batch.children[0].project,sibling:batch.children[1].project};
}

beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));});
beforeEach(()=>{
  assetFetch.mockClear();
  vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('External network is forbidden in privacy regression tests.'));
});
afterEach(()=>{
  expect(assetFetch).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();vi.restoreAllMocks();
});

it.each(['owner','admin','broadcaster'] as const)('%s can share and revoke a derived child without exposing its private source, sibling or full batch to a colleague',async sharingActor=>{
  const {actors,source,batch,child:initialChild,sibling}=await fixture();
  const path=`/projects/${initialChild.id}`;
  const originalOrigin=await (await call(path+'/derivation-origin',actors.owner)).json<DerivationOrigin>();
  expect(originalOrigin.batchId).toBe(batch.id);expect(originalOrigin.sourceProjectId).toBe(source.id);
  expect(originalOrigin.allowedLibraryUrls.length).toBeGreaterThan(0);
  let child=initialChild;

  async function assertAccess(visibility:'private'|'team'){
    const body={title:child.title,revision:child.revision,data:child.data};
    for(const [name,actor] of Object.entries(actors)){
      const allowed=name!=='colleague'||visibility==='team';
      const listing=await (await call('/projects',actor)).json<ProjectPage>();
      expect(listing.projects.some(project=>project.id===child.id),name+' project list').toBe(allowed);
      if(!allowed){
        for(const suffix of ['', '/derivation-origin','/derivations','/revisions'])await denied(path+suffix,actor);
        await denied(path+'/export',actor,404,'POST',body);
      }else{
        const loaded=await call(path,actor);expect(loaded.status,name).toBe(200);expect(await loaded.json()).toEqual(child);
        const provenance=await call(path+'/derivation-origin',actor);expect(provenance.status,name).toBe(200);
        expect(await provenance.json()).toEqual(originalOrigin);
        const groups=await call(path+'/derivations',actor);expect(groups.status,name).toBe(200);
        const page=await groups.json<DerivationPage>();
        expect(page.batches.map(item=>item.id),name+' batch list').toEqual(name==='colleague'?[]:[batch.id]);
        expect(page).not.toHaveProperty('sourceSnapshot');
        const exported=await call(path+'/export',actor,'POST',body);expect(exported.status,name).toBe(200);
        const plan=await exported.json<DeliveryPlan>();
        expect(plan.project.id).toBe(child.id);expect(plan.snapshot?.purpose).toBe('working-copy');
        expect(plan).not.toHaveProperty('sourceSnapshot');expect(plan).not.toHaveProperty('children');
      }
      if(name==='colleague'){
        await denied(path+'/sharing',actor,visibility==='team'?403:404,'POST',{revision:child.revision,visibility:visibility==='team'?'private':'team'});
        await denied(`/derivations/${batch.id}`,actor);
        await denied(`/projects/${source.id}`,actor);
        await denied(`/projects/${source.id}/derivations`,actor);
        await denied(`/projects/${sibling.id}`,actor);
        expect(listing.projects.some(project=>project.id===source.id||project.id===sibling.id)).toBe(false);
      }else{
        const receipt=await call(`/derivations/${batch.id}`,actor);expect(receipt.status,name).toBe(200);
        const loaded=await receipt.json<DerivationBatch>();
        expect(loaded.sourceSnapshot).toEqual(batch.sourceSnapshot);
        expect(loaded.children.find(item=>item.project.id===child.id)?.project).toEqual(child);
        expect(loaded.children.find(item=>item.project.id===sibling.id)?.project).toEqual(sibling);
      }
    }
    // All denied sharing attempts and personal export plans leave the project
    // intact; its saved content, current revision and visibility cannot drift.
    expect(await (await call(path,actors.owner)).json()).toEqual(child);
  }

  await assertAccess('private');
  const shared=await call(path+'/sharing',actors[sharingActor],'POST',{revision:child.revision,visibility:'team'});
  expect(shared.status).toBe(200);child=await shared.json<Project>();
  expect(child).toMatchObject({revision:2,visibility:'team',created_by:actors.owner.email,data:initialChild.data});
  await denied(path+'/sharing',actors.owner,409,'POST',{revision:initialChild.revision,visibility:'private'});
  await assertAccess('team');
  const revoked=await call(path+'/sharing',actors[sharingActor],'POST',{revision:child.revision,visibility:'private'});
  expect(revoked.status).toBe(200);child=await revoked.json<Project>();
  expect(child).toMatchObject({revision:3,visibility:'private',created_by:actors.owner.email,data:initialChild.data});
  await assertAccess('private');
  expect(await (await call(`/projects/${source.id}`,actors.owner)).json()).toEqual(source);
  expect(await (await call(`/projects/${sibling.id}`,actors.owner)).json()).toEqual(sibling);
  expect(await (await call(path+'/derivation-origin',actors.owner)).json()).toEqual(originalOrigin);
});
