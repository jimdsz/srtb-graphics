import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,beforeEach,expect,it,inject,vi} from 'vitest';
import {api} from '../../server/router';
import worker from '../../server/pages-worker';
import {broadcastTemplates,templateDefaults} from '../../src/studio/domain';
import type {Member} from '../../src/studio/domain';
import type {PreparationProfile,PreparationProfilePage,PreparationRevisionPage,PreparationProfileRevision} from '../../src/studio/preparation-profile-model';
import {MAX_PREPARATION_PROFILES} from '../../src/studio/preparation-profile-model';
import {validateProfileAssets} from '../../server/preparation-profile-assets';

const origin='https://studio.example',base='/api/graphics/preparation-profiles';
const admin:Member={email:'admin@example.com',name:'Admin',role:'admin',active:1};
const designer:Member={email:'preparation-designer@example.test',name:'Préparateur',role:'designer',active:1};
const colleague:Member={email:'preparation-colleague@example.test',name:'Collègue',role:'designer',active:1};
const broadcaster:Member={email:'preparation-broadcaster@example.test',name:'Diffuseur',role:'broadcaster',active:1};
const audioId='00000000-0000-4000-8000-000000000071',imageId='00000000-0000-4000-8000-000000000072',unfinishedId='00000000-0000-4000-8000-000000000073';
const audio={url:`/api/graphics/media/${audioId}/content`,name:'Annonce.wav',mimeType:'audio/wav'};
const logo={url:`/api/graphics/media/${imageId}/content`,name:'Logo.png',mimeType:'image/png'};
const programme=()=>({kind:'programme',name:'Journal',data:{title:'Le journal',logo:null,palette:['#f0b900','#ffffff'],appointments:[{announcement:'Ce soir',time:'20:30'}],voice:null}});
const voice=()=>({kind:'voice',name:'Voix ce soir',data:{source:audio,start:1,end:2,label:'Ce soir',cue:{kind:'announcement',value:'Ce soir'},humanValidated:true}});
const call=(path='',method='GET',body?:unknown,member=designer)=>api(new Request(origin+base+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,member);
const create=async(body:unknown,member=designer)=>(await (await call('','POST',body,member))!.json<PreparationProfile>());
let legacyBefore:unknown,legacyAfter:unknown;
it('pages complete validated active voice records in one private query without a detail N+1',async()=>{
  const first=await create(voice()),second=await create({...voice(),name:'Seconde voix'}),archived=await create({...voice(),name:'Archivée'});
  await call(`/${archived.id}/archive`,'POST',{revision:1,archived:true});await create(programme());
  const prepare=vi.spyOn(env.DB,'prepare');
  try{
    const response=(await call('/voice-catalogue?limit=1'))!,page=await response.json<{profiles:PreparationProfile[];next:{before:string;afterId:string}|null}>();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');expect(page.profiles).toHaveLength(1);expect(page.next).not.toBeNull();
    expect(prepare.mock.calls.filter(([sql])=>sql.includes('FROM preparation_profiles'))).toHaveLength(1);expect(page.profiles[0]).toMatchObject({kind:'voice',archived:false,revision:1,validated_by:designer.email,data:voice().data});
    const next=await (await call(`/voice-catalogue?limit=1&before=${encodeURIComponent(page.next!.before)}&afterId=${page.next!.afterId}`))!.json<{profiles:PreparationProfile[];next:null}>();
    expect(next.next).toBeNull();expect(new Set([...page.profiles,...next.profiles].map(profile=>profile.id))).toEqual(new Set([first.id,second.id]));
  }finally{prepare.mockRestore();}
});
it('bounds voice catalogue pages and forbids mutations, filters, incomplete cursors and suspended access',async()=>{
  for(const query of ['?limit=101','?archived=1','?kind=programme','?before=2026-09-23T00:00:00.000Z'])await expect(call('/voice-catalogue'+query)).rejects.toThrow();
  await expect(call('/voice-catalogue','POST',voice())).rejects.toMatchObject({status:405});
  await expect(call('/voice-catalogue','GET',undefined,{...designer,active:0})).rejects.toMatchObject({status:403});
  const response=await worker.fetch(new Request(origin+base+'/voice-catalogue'),{...env,AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35),ASSETS:{fetch:vi.fn()} as Fetcher},{waitUntil:vi.fn()} as ExecutionContext);
  expect(response.status).toBe(401);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});
beforeAll(async()=>{
  const migrations=inject('migrations');
  await applyD1Migrations(env.DB,migrations.filter(migration=>migration.name<'0003'));
  for(const member of [designer,colleague,broadcaster])await env.DB.prepare('INSERT INTO members(email,name,role,updated_by) VALUES(?,?,?,?)').bind(member.email,member.name,member.role,admin.email).run();
  for(const [id,mime,status]of [[audioId,'audio/wav','ready'],[imageId,'image/png','ready'],[unfinishedId,'audio/wav','uploading']])await env.DB.prepare('INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES(?,?,?,?,?,?,?)').bind(id,'uploads/'+id,'Fixture',mime,100,status,admin.email).run();
  const template=broadcastTemplates[0];
  await env.DB.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),'Projet antérieur',template.id,template.version,template.libraryVersion,JSON.stringify(templateDefaults(template)),designer.email,designer.email).run();
  const legacy=()=>Promise.all(['members','projects','revisions','media','activity'].map(async table=>(await env.DB.prepare(`SELECT * FROM ${table}`).all()).results.map(({channel_id,visibility,...row})=>row)));
  legacyBefore=await legacy();await applyD1Migrations(env.DB,migrations);legacyAfter=await legacy();
});
beforeEach(async()=>{await env.DB.prepare('DELETE FROM preparation_profile_revisions').run();await env.DB.prepare('DELETE FROM preparation_profiles').run();});

it('keeps existing data and saves validated presets for all seven pinned templates',async()=>{
  const normalised=(legacyAfter as Array<Array<Record<string,unknown>>>).map(rows=>rows.map(({removed_at,...row})=>{if(removed_at!==undefined)expect(removed_at).toBeNull();return row;}));
  expect(normalised).toEqual(legacyBefore);
  const members=await env.DB.prepare('SELECT COUNT(*) n FROM members').first<{n:number}>(),media=await env.DB.prepare('SELECT COUNT(*) n FROM media').first<{n:number}>();
  for(const template of broadcastTemplates){
    const result=await create({kind:'preset',name:'Favori '+template.id,favorite:true,templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,data:templateDefaults(template)});
    expect(result).toMatchObject({kind:'preset',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,favorite:true,revision:1,validated_by:null});
    expect(result.data).toEqual(templateDefaults(template));
  }
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM members').first()).toEqual(members);
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM media').first()).toEqual(media);
});

it('lets team roles prepare and favorite without changing projects or creating a broadcast decision',async()=>{
  const projects=await env.DB.prepare('SELECT COUNT(*) n FROM projects').first();
  const created=await create(programme());expect(created).toMatchObject({kind:'programme',created_by:designer.email,updated_by:designer.email,revision:1,favorite:false,archived:false,template_id:null});
  const edited=await (await call(`/${created.id}`,'PUT',{revision:created.revision,name:'Journal édition',data:{...created.data,title:'Journal du soir'}},broadcaster))!.json<PreparationProfile>();
  const favorite=await (await call(`/${created.id}/favorite`,'POST',{revision:edited.revision,favorite:true},admin))!.json<PreparationProfile>();
  expect(favorite).toMatchObject({favorite:true,revision:3,created_by:designer.email,updated_by:admin.email});
  const list=await (await call('?kind=programme&favorite=1'))!.json<PreparationProfilePage>();expect(list.profiles).toHaveLength(1);expect(list.profiles[0]).not.toHaveProperty('data');
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM projects').first()).toEqual(projects);
  const audit=await env.DB.prepare('SELECT actor,action FROM activity WHERE target=? ORDER BY id').bind(created.id).all();
  expect(audit.results).toEqual([{actor:designer.email,action:'preparation_profile.created'},{actor:broadcaster.email,action:'preparation_profile.saved'},{actor:admin.email,action:'preparation_profile.favorite'}]);
  const history=await (await call(`/${created.id}/revisions?limit=2`))!.json<PreparationRevisionPage>();expect(history.revisions.map(r=>r.revision)).toEqual([3,2]);expect(history.next).toBe(2);
  expect((await (await call(`/${created.id}/revisions?before=2`))!.json<PreparationRevisionPage>()).revisions.map(r=>r.revision)).toEqual([1]);
  expect((await (await call(`/${created.id}/revisions/1`))!.json<PreparationProfileRevision>()).data).toEqual(created.data);
});

it('accepts exactly one concurrent edit and retains immutable authors and revision history',async()=>{
  const created=await create(programme());
  const results=await Promise.allSettled([designer,colleague].map((member,index)=>call(`/${created.id}`,'PUT',{revision:1,name:'Édition '+index,data:created.data},member)));
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.find(result=>result.status==='rejected')).toMatchObject({reason:{status:409}});
  await expect(call(`/${created.id}/favorite`,'POST',{revision:1,favorite:true})).rejects.toMatchObject({status:409});
  const history=await (await call(`/${created.id}/revisions`))!.json<PreparationRevisionPage>();expect(history.revisions.map(r=>r.revision)).toEqual([2,1]);
  expect((await (await call(`/${created.id}`))!.json<PreparationProfile>()).created_by).toBe(designer.email);
  await expect(env.DB.prepare('UPDATE preparation_profiles SET created_by=?,revision=revision+1 WHERE id=?').bind(colleague.email,created.id).run()).rejects.toThrow('preparation_profile_immutable');
});

it('archives and restores without deletion, and restricts archive control to author or broadcaster/admin',async()=>{
  const created=await create({...programme(),favorite:true});
  await expect(call(`/${created.id}/archive`,'POST',{revision:1,archived:true},colleague)).rejects.toMatchObject({status:403});
  const archived=await (await call(`/${created.id}/archive`,'POST',{revision:1,archived:true},broadcaster))!.json<PreparationProfile>();
  expect(archived).toMatchObject({archived:true,favorite:true,revision:2});
  await expect(call(`/${created.id}`,'PUT',{revision:2,name:'Interdit',data:created.data})).rejects.toMatchObject({status:409});
  await expect(call(`/${created.id}/favorite`,'POST',{revision:2,favorite:false})).rejects.toMatchObject({status:409});
  expect((await (await call())!.json<PreparationProfilePage>()).profiles).toEqual([]);
  expect((await (await call('?archived=1'))!.json<PreparationProfilePage>()).profiles).toHaveLength(1);
  const restored=await (await call(`/${created.id}/archive`,'POST',{revision:2,archived:false}))!.json<PreparationProfile>();expect(restored).toMatchObject({archived:false,revision:3});expect(restored.data).toEqual(created.data);
  await expect(call(`/${created.id}`,'DELETE')).rejects.toMatchObject({status:405});
});

it('records human voice validation and pins programme links to the chosen historical cue',async()=>{
  const recorded=await create(voice(),broadcaster);expect(recorded).toMatchObject({kind:'voice',validated_by:broadcaster.email,validated_at:expect.any(String)});
  const changed=await (await call(`/${recorded.id}`,'PUT',{revision:1,name:'Demain',data:{...recorded.data,label:'Demain',cue:{kind:'announcement',value:'Demain'}}},colleague))!.json<PreparationProfile>();
  expect(changed.validated_by).toBe(colleague.email);
  const prepared=await create({...programme(),data:{...programme().data,logo,voice:{profileId:recorded.id,revision:1}}});
  expect(prepared.data).toMatchObject({voice:{profileId:recorded.id,revision:1}});
  const earlier=await (await call(`/${recorded.id}/revisions/1`))!.json<PreparationProfileRevision>();expect(earlier.data).toMatchObject({label:'Ce soir'});expect(earlier.validated_by).toBe(broadcaster.email);
  await call(`/${recorded.id}/archive`,'POST',{revision:changed.revision,archived:true},broadcaster);
  await expect(create({...programme(),data:{...programme().data,voice:{profileId:recorded.id,revision:1}}})).rejects.toMatchObject({status:422});
  expect((await (await call(`/${prepared.id}`))!.json<PreparationProfile>()).data).toEqual(prepared.data);
});

it('requires explicit human validation, bounded cues and no supplied audit or transcription fields',async()=>{
  for(const extra of [{humanValidated:false},{transcription:'texte reconnu'},{bytes:'base64'},{start:2,end:1},{start:0,end:601},{cue:{kind:'time',value:'25:70'}},{cue:{kind:'announcement',value:'jour inconnu'}},{cue:{kind:'variant',value:'non-validé'}}])await expect(create({...voice(),data:{...voice().data,...extra}})).rejects.toThrow();
  for(const extra of [{created_by:admin.email},{validated_by:admin.email},{status:'approved'}])await expect(create({...voice(),...extra})).rejects.toThrow();
  for(const cue of [{kind:'time',value:'20:30'},{kind:'variant',value:'rediffusion'}])expect((await create({...voice(),data:{...voice().data,cue}})).kind).toBe('voice');
  expect((await create({...voice(),data:{...voice().data,start:.08,end:.12}})).kind).toBe('voice');
});

it('persists stable local references only and verifies private media type and readiness',async()=>{
  const local={url:`local-media:${'a'.repeat(64)}:100`,name:'Local.wav',mimeType:'audio/wav'};
  expect((await create({...voice(),data:{...voice().data,source:local}})).data).toMatchObject({source:local});
  for(const url of ['blob:https://studio.example/temporary','data:audio/wav;base64,AAAA','https://outside.example/file.wav','C:\\Users\\source.wav','uploads/'+audioId])await expect(create({...voice(),data:{...voice().data,source:{...audio,url}}})).rejects.toThrow();
  for(const url of [`/api/graphics/media/${unfinishedId}/content`,`/api/graphics/media/${imageId}/content`,'/api/graphics/media/00000000-0000-4000-8000-000000000099/content'])await expect(create({...voice(),data:{...voice().data,source:{...audio,url}}})).rejects.toMatchObject({status:422});
  await expect(create({...programme(),data:{...programme().data,logo:{...logo,url:audio.url}}})).rejects.toMatchObject({status:422});
});

it('whitelists all preset sources including inactive alternatives, keeps versions fixed and rejects blobs',async()=>{
  const template=broadcastTemplates.find(t=>t.id==='BTV_PopUp')!,input={kind:'preset',name:'Favori',templateId:template.id,templateVersion:template.version,libraryVersion:template.libraryVersion,data:templateDefaults(template)};
  for(const url of ['blob:https://studio.example/x','https://outside.example/a.png','lib/absent.png','/library/v1.7.0/BTV_BA_1P/lib/media/sponsor.png',`/api/graphics/media/${unfinishedId}/content`])await expect(create({...input,data:{...input.data,_background_visible:false,_media_background_url:url}})).rejects.toThrow();
  await expect(create({...input,templateVersion:'99.0.0'})).rejects.toMatchObject({status:409});
  const created=await create(input);
  await expect(call(`/${created.id}`,'PUT',{revision:1,name:'Autre',data:created.data,templateId:'BTV_BA_1P'})).rejects.toThrow();
});

it('rejects unknown fields, invalid palettes and oversize documents without saving partial rows',async()=>{
  for(const data of [{...programme().data,palette:['#112233']},{...programme().data,palette:['#ffffff','#ffffff']},{...programme().data,appointments:Array(4).fill({announcement:'Ce soir',time:'20:30'})},{...programme().data,bytes:[1,2,3]}])await expect(create({...programme(),data})).rejects.toThrow();
  await expect(create({...programme(),name:'x'.repeat(121)})).rejects.toThrow();
  await expect(create({...programme(),extra:'x'.repeat(140000)})).rejects.toMatchObject({status:413});
  expect((await (await call())!.json<PreparationProfilePage>()).profiles).toEqual([]);
});

it('paginates ties and filtered favorites without leaking data or accepting unbounded cursors',async()=>{
  const created=await Promise.all(Array.from({length:5},(_,i)=>create({...programme(),name:'Fiche '+i,favorite:i%2===0})));
  const ids:string[]=[];let path='?limit=2';
  do{const page=await (await call(path))!.json<PreparationProfilePage>();ids.push(...page.profiles.map(profile=>profile.id));for(const profile of page.profiles)expect(profile).not.toHaveProperty('data');path=page.next?'?limit=2&'+new URLSearchParams(page.next):'';}while(path);
  expect(new Set(ids)).toEqual(new Set(created.map(profile=>profile.id)));expect(ids).toHaveLength(5);
  expect((await (await call('?favorite=1&kind=programme'))!.json<PreparationProfilePage>()).profiles).toHaveLength(3);
  for(const query of ['?limit=101','?limit=0','?kind=unknown','?before=2026-09-22T00%3A00%3A00.000Z','?afterId=bad'])await expect(call(query)).rejects.toThrow();
});

it('keeps authentication, roles, same-origin writes and private caching on the new routes',async()=>{
  const context={waitUntil:vi.fn()} as unknown as ExecutionContext;
  const response=await worker.fetch(new Request(origin+base),{...env,AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)},context);
  expect(response.status).toBe(401);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  await expect(call('','GET',undefined,{...designer,active:0})).rejects.toMatchObject({status:403});
  const foreign=new Request(origin+base,{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify(programme())});
  await expect(api(foreign,env,designer)).rejects.toMatchObject({status:403});
  expect((await call())!.headers.get('Cache-Control')).toBe('private, no-store');
});

it('bounds distinct asset references and enforces the normalized data cap in the database',async()=>{
  const uses=Array.from({length:65},(_,index)=>({kind:'audio' as const,value:{url:`local-media:${index.toString(16).padStart(64,'0')}:100`,name:'Local.wav',mimeType:'audio/wav'}}));
  await expect(validateProfileAssets(env.DB,uses.slice(0,64))).resolves.toBeUndefined();
  await expect(validateProfileAssets(env.DB,uses)).rejects.toMatchObject({status:422});
  await expect(env.DB.prepare("INSERT INTO preparation_profiles(id,kind,name,data_json,created_by,updated_by) VALUES(?,'programme','Too large',?,?,?)").bind(crypto.randomUUID(),JSON.stringify({title:'é'.repeat(40000)}),designer.email,designer.email).run()).rejects.toThrow();
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM preparation_profiles').first<{n:number}>())?.n).toBe(0);
});

it('reserves the final catalogue slot atomically and counts archived records without erasing them',async()=>{
  // Bounded local fixture only; no remote database or external service is used.
  await env.DB.prepare(`WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM n WHERE value<?)
    INSERT INTO preparation_profiles(id,kind,name,data_json,archived,created_by,updated_by)
    SELECT printf('10000000-0000-4000-8000-%012d',value),'programme','Catalogue fixture','{"title":"Fixture"}',1,?,? FROM n`)
    .bind(MAX_PREPARATION_PROFILES-1,designer.email,designer.email).run();
  const attempts=await Promise.allSettled([create(programme()),create(programme(),colleague)]);
  expect(attempts.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(attempts.find(result=>result.status==='rejected')).toMatchObject({reason:{status:409}});
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM preparation_profiles').first<{n:number}>())?.n).toBe(MAX_PREPARATION_PROFILES);
  expect((await env.DB.prepare('SELECT COUNT(*) n FROM preparation_profile_revisions').first<{n:number}>())?.n).toBe(MAX_PREPARATION_PROFILES);
});
