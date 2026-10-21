import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {afterEach,beforeAll,expect,inject,it,vi} from 'vitest';
import {api} from '../../server/router';
import worker from '../../server/pages-worker';
import {getTemplate,templateDefaults} from '../../src/studio/domain';
import type {Member,Project,ProjectData} from '../../src/studio/domain';
import type {DerivationBatch,DerivationOrigin,DerivationPage} from '../../src/studio/derivation-types';
import {canonicalJson,getValidatedProjectOrigin,snapshotHash} from '../../server/derivation-origin';
import {deliveryPlan} from '../../server/delivery';

const origin='https://studio.example',base='/api/graphics';
const admin:Member={email:'admin@example.com',name:'Admin',role:'admin',active:1};
const designer:Member={email:'derivation-designer@example.test',name:'Infographiste',role:'designer',active:1};
const broadcaster:Member={email:'derivation-broadcaster@example.test',name:'Diffuseur',role:'broadcaster',active:1};
const sourceTemplate=getTemplate('BTV_BA_1P');
const call=(path:string,method='GET',body?:unknown,member=designer)=>api(new Request(origin+base+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-SRTB-Client-Capabilities':'derivations-v1'},body:body===undefined?undefined:JSON.stringify(body)}),env,member);
async function source(data:ProjectData={}){return (await call('/projects','POST',{title:'Source conservée',templateId:sourceTemplate.id,data:{...templateDefaults(sourceTemplate),_media_body_rate:1,...data}}))!.json<Project>();}
const input=(project:Project)=>({requestId:crypto.randomUUID(),name:'Campagne du soir',sourceRevision:project.revision,sourceTitle:'Réglages affichés',sourceData:{...project.data,_titre_ligne_1:'Titre non enregistré'},targets:['ba-vertical','ba-portrait','popup-1']});
const create=async(project:Project,body=input(project),member=designer)=>(await (await call(`/projects/${project.id}/derivations`,'POST',body,member))!.json<DerivationBatch>());
const counts=async()=>Promise.all(['projects','revisions','activity','derivation_batches','project_derivations','media'].map(table=>env.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first<{n:number}>()));
beforeAll(async()=>{
  await applyD1Migrations(env.DB,inject('migrations'));
  for(const member of [designer,broadcaster])await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,1,?)').bind(member.email,member.name,member.role,admin.email).run();
});
afterEach(()=>vi.restoreAllMocks());

it.each(['BTV_Renvoi','BTV_Evenement','BTV_Semainier'])('creates safe independent social recipes for %s',async id=>{
  const template=getTemplate(id),project=await (await call('/projects','POST',{title:'Source extension',templateId:id,data:templateDefaults(template)}))!.json<Project>();
  const body={requestId:crypto.randomUUID(),name:'Réseaux',sourceRevision:project.revision,sourceTitle:project.title,sourceData:project.data,targets:['ba-vertical','ba-portrait']};
  const response=(await call(`/projects/${project.id}/derivations`,'POST',body))!,batch=await response.json<DerivationBatch>();
  expect(response.status).toBe(201);expect(batch.children).toHaveLength(2);
  expect(batch.children.map(c=>c.project.data._studio_format)).toEqual(['vertical','portrait']);
  expect(batch.children.every(c=>c.project.template_id===id&&c.project.status==='draft')).toBe(true);
  expect(await (await call(`/projects/${project.id}`))!.json()).toEqual(project);
  const replay=await (await call(`/projects/${project.id}/derivations`,'POST',body))!.json<DerivationBatch>();expect(replay.id).toBe(batch.id);
  const invalid={...body,requestId:crypto.randomUUID(),sourceData:{...project.data,_titre_ligne_1:'champ du mauvais modèle'}};
  await expect(call(`/projects/${project.id}/derivations`,'POST',invalid)).rejects.toThrow('Champ inconnu : _titre_ligne_1');
});

it('atomically creates linked draft r1 projects from displayed settings without changing the source or uploading',async()=>{
  const project=await source(),before=await counts(),prepare=vi.spyOn(env.DB,'prepare'),fetch=vi.spyOn(globalThis,'fetch');
  const body=input(project),response=(await call(`/projects/${project.id}/derivations`,'POST',body))!,batch=await response.json<DerivationBatch>();
  expect(response.status).toBe(201);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(batch).toMatchObject({name:body.name,sourceProjectId:project.id,sourceRevision:1,sourceTemplateId:sourceTemplate.id,sourceTemplateVersion:sourceTemplate.version,sourceLibraryVersion:sourceTemplate.libraryVersion,childCount:3,createdBy:designer.email});
  expect(batch.sourceSnapshot.title).toBe(body.sourceTitle);expect(batch.sourceSnapshot.data._titre_ligne_1).toBe('Titre non enregistré');
  expect(batch.sourceSnapshot.sha256).toBe(await snapshotHash(canonicalJson({title:body.sourceTitle,data:body.sourceData})));
  expect(batch.sourceSnapshot.sha256).toBe(batch.sourceSnapshotSha256);
  expect(new Set(batch.children.map(child=>child.project.id)).size).toBe(3);
  expect(batch.children.map(child=>child.targetKey)).toEqual(body.targets);
  for(const child of batch.children){
    expect(child.project).toMatchObject({status:'draft',revision:1,archived:0,created_by:designer.email,updated_by:designer.email});
    const history=await (await call(`/projects/${child.project.id}/revisions`))!.json<unknown[]>();expect(history).toHaveLength(1);
  }
  expect(await (await call(`/projects/${project.id}`))!.json()).toEqual(project);
  expect(prepare.mock.calls.some(([sql])=>/UPDATE projects/i.test(sql))).toBe(false);expect(fetch).not.toHaveBeenCalled();
  const after=await counts();expect(after.map((row,index)=>row!.n-before[index]!.n)).toEqual([3,3,3,1,3,0]);
});

it.each(['BTV_Renvoi','BTV_Evenement'])('preserves the reviewed excerpt through stored linked pop-up creation for %s',async id=>{
  const template=getTemplate(id),track=id==='BTV_Renvoi'?'renvoi':'event';
  const media={url:`local-media:${'e'.repeat(64)}:987654321`,name:'Programme réseau.mp4',mimeType:'video/mp4'};
  const data={...templateDefaults(template),[`_media_${track}_url`]:media,[`_media_${track}_start_seconds`]:120.04,[`_media_${track}_end_seconds`]:125.28};
  const project=await (await call('/projects','POST',{title:'Passage retenu',templateId:id,data}))!.json<Project>();
  const body={requestId:crypto.randomUUID(),name:'Pop-up lié',sourceRevision:1,sourceTitle:project.title,sourceData:project.data,targets:['popup-follow']};
  const network=vi.spyOn(globalThis,'fetch');
  const batch=await (await call(`/projects/${project.id}/derivations`,'POST',body))!.json<DerivationBatch>();
  expect(batch.mappingVersion).toBe('campaign-6');expect(batch.children).toHaveLength(1);
  const child=batch.children[0].project;
  expect(child).toMatchObject({template_id:'BTV_PopUp',status:'draft',visibility:'private',created_by:designer.email,data:{_media_popup_url:media,_media_popup_start_seconds:120.04,_media_popup_end_seconds:125.28,_media_popup_loop:false,_background_visible:false,_media_popup_audio_enabled:false}});
  expect(await (await call(`/projects/${child.id}`))!.json<Project>()).toEqual(child);
  expect(await (await call(`/projects/${project.id}`))!.json<Project>()).toEqual(project);
  const retry=await (await call(`/projects/${project.id}/derivations`,'POST',body))!.json<DerivationBatch>();
  expect(retry.id).toBe(batch.id);expect(retry.children[0].project).toEqual(child);expect(network).not.toHaveBeenCalled();
});

it('returns the same receipt for a reordered JSON object and preserves a subsequently edited child',async()=>{
  const project=await source(),body=input(project),first=await create(project,body),child=first.children[0].project;
  const edited=await (await call(`/projects/${child.id}`,'PUT',{title:'Retouche indépendante',revision:1,data:{...child.data,_titre_ligne_1:'Corrigé'}}))!.json<Project>();
  await call(`/projects/${project.id}`,'PUT',{title:'Source r2',revision:1,data:project.data});
  await call(`/projects/${project.id}/archive`,'POST',{revision:2,archived:true});
  const before=await counts(),response=(await call(`/projects/${project.id}/derivations`,'POST',{...body,sourceData:Object.fromEntries(Object.entries(body.sourceData).reverse())}))!;
  expect(response.status).toBe(200);const replay=await response.json<DerivationBatch>();
  expect(replay.id).toBe(first.id);expect(replay.children.map(item=>item.project.id)).toEqual(first.children.map(item=>item.project.id));
  expect(replay.children[0].project).toEqual(edited);expect(replay.sourceSnapshot).toEqual(first.sourceSnapshot);expect(await counts()).toEqual(before);
});

it('replays an original v1 receipt without inventing announcement metadata or remapping its children',async()=>{
  const project=await source(),body={...input(project),targets:['ba-vertical']},child=await (await call('/projects','POST',{title:'Ancienne déclinaison',templateId:sourceTemplate.id,data:{...body.sourceData,_studio_format:'vertical'}}))!.json<Project>();
  const {requestId,...intent}=body,batchId=crypto.randomUUID(),snapshot=canonicalJson({title:body.sourceTitle,data:body.sourceData});
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO derivation_batches(id,request_id,request_hash,name,source_project_id,source_revision,source_template_id,source_template_version,source_library_version,source_snapshot_json,source_snapshot_sha256,mapping_version,target_count,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'ba-campaign-1',1,?)`).bind(batchId,requestId,await snapshotHash(canonicalJson({sourceProjectId:project.id,...intent})),body.name,project.id,1,sourceTemplate.id,sourceTemplate.version,sourceTemplate.libraryVersion,snapshot,await snapshotHash(snapshot),designer.email),
    env.DB.prepare("INSERT INTO project_derivations(batch_id,project_id,target_key,label,ordinal,warnings_json) VALUES(?,?,'ba-vertical','Ancienne BA',0,'[]')").bind(batchId,child.id),
  ]);
  const before=await counts(),response=(await call(`/projects/${project.id}/derivations`,'POST',body))!,batch=await response.json<DerivationBatch>();
  expect(response.status).toBe(200);expect(batch.mappingVersion).toBe('ba-campaign-1');expect(batch.id).toBe(batchId);expect(batch.children[0].project).toEqual(child);
  expect(batch.children[0]).not.toHaveProperty('announcement');expect((await getValidatedProjectOrigin(env.DB,child.id))!).not.toHaveProperty('announcement');expect(await counts()).toEqual(before);
});

it('rejects a reused request key with changed content and never overwrites its children',async()=>{
  const project=await source(),body=input(project);await create(project,body);const before=await counts();
  await expect(create(project,{...body,name:'Autre campagne'})).rejects.toMatchObject({status:409});expect(await counts()).toEqual(before);
});

it('concurrent double clicks create one batch and one set of children',async()=>{
  const project=await source(),body=input(project),before=await counts();
  const results=await Promise.all(Array.from({length:8},()=>create(project,body)));
  expect(new Set(results.map(batch=>batch.id)).size).toBe(1);
  expect(new Set(results.flatMap(batch=>batch.children.map(child=>child.project.id))).size).toBe(3);
  const after=await counts();expect(after.map((row,index)=>row!.n-before[index]!.n)).toEqual([3,3,3,1,3,0]);
});

it('recovers a committed batch after an uncertain D1 response using its durable receipt',async()=>{
  const project=await source(),body=input(project),original=env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB,'batch').mockImplementationOnce(async statements=>{await original(statements);throw new Error('Response lost after commit');});
  const batch=await create(project,body),before=await counts(),retry=await create(project,body);
  expect(retry.id).toBe(batch.id);expect(await counts()).toEqual(before);
});

it('rolls back receipt, children, revision triggers and activity when a later child insert fails',async()=>{
  const project=await source(),body=input(project),before=await counts();
  await env.DB.exec("CREATE TRIGGER fail_derivation_fixture BEFORE INSERT ON projects WHEN NEW.template_id='BTV_PopUp' BEGIN SELECT RAISE(ABORT,'fixture_insert_failure'); END;");
  try{await expect(create(project,body)).rejects.toMatchObject({status:503});expect(await counts()).toEqual(before);}
  finally{await env.DB.exec('DROP TRIGGER fail_derivation_fixture;');}
  const batch=await create(project,body);expect(batch.childCount).toBe(3);
});

it.each(['revision','archive'])('CAS rejects a source %s change after validation but before the transaction',async change=>{
  const project=await source(),original=env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB,'batch').mockImplementationOnce(async statements=>{
    await env.DB.prepare(`UPDATE projects SET revision=revision+1${change==='archive'?',archived=1':''} WHERE id=?`).bind(project.id).run();return original(statements);
  });
  await expect(create(project)).rejects.toMatchObject({status:409});
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM derivation_batches WHERE source_project_id=?').bind(project.id).first()).toEqual({n:0});
});

it('rechecks active membership inside the transaction after the request was authenticated',async()=>{
  const project=await source(),original=env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB,'batch').mockImplementationOnce(async statements=>{await env.DB.prepare('UPDATE members SET active=0 WHERE email=?').bind(designer.email).run();return original(statements);});
  try{await expect(create(project)).rejects.toMatchObject({status:403});}
  finally{await env.DB.prepare('UPDATE members SET active=1 WHERE email=?').bind(designer.email).run();}
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM derivation_batches WHERE source_project_id=?').bind(project.id).first()).toEqual({n:0});
});

it('permits each active team role to create drafts without approving them',async()=>{
  const project=await source();
  for(const member of [admin,designer,broadcaster])expect((await create(project,input(project),member)).children.every(child=>child.project.status==='draft')).toBe(true);
  await expect(create(project,input(project),{...designer,active:0})).rejects.toMatchObject({status:403});
});

it('rejects stale, archived and unavailable source template versions before creating any receipt',async()=>{
  const project=await source();
  await expect(create(project,{...input(project),sourceRevision:2})).rejects.toMatchObject({status:409});
  await call(`/projects/${project.id}/archive`,'POST',{revision:1,archived:true});
  await expect(create(project)).rejects.toMatchObject({status:409});
  const other=await source();await env.DB.prepare("UPDATE projects SET template_version='missing',revision=revision+1 WHERE id=?").bind(other.id).run();
  await expect(create(other,{...input(other),sourceRevision:2})).rejects.toMatchObject({status:409});
});

it('lists a batch from its source or a child, paginates summaries and returns current child state in detail',async()=>{
  const project=await source(),first=await create(project),second=await create(project),child=first.children[0].project;
  const page=await (await call(`/projects/${project.id}/derivations?limit=1`))!.json<DerivationPage>();
  expect(page.batches).toHaveLength(1);expect(page.batches[0]).not.toHaveProperty('sourceSnapshot');expect(page.batches[0]).not.toHaveProperty('children');expect(page.next).not.toBeNull();
  const next=await (await call(`/projects/${project.id}/derivations?limit=1&before=${encodeURIComponent(page.next!.before)}&id=${page.next!.id}`))!.json<DerivationPage>();
  expect(new Set([...page.batches,...next.batches].map(batch=>batch.id))).toEqual(new Set([first.id,second.id]));expect(next.next).toBeNull();
  const linked=await (await call(`/projects/${child.id}/derivations`))!.json<DerivationPage>();expect(linked.batches.map(batch=>batch.id)).toEqual([first.id]);
  const detail=await (await call(`/derivations/${first.id}`))!.json<DerivationBatch>();expect(detail).toEqual(first);
});

it.each(['blob:temporary','https://outside.example/video.mp4','C:\\private.mp4'])('refuses nonpersistent or external sources: %s',async url=>{
  const project=await source();await expect(create(project,{...input(project),sourceData:{...project.data,_media_body_url:url}})).rejects.toThrow();
});

it('persists reusable local metadata without uploading or claiming another computer has the file',async()=>{
  const project=await source(),descriptor={url:`local-media:${'a'.repeat(64)}:100`,name:'Local.mp4',mimeType:'video/mp4'},fetch=vi.spyOn(globalThis,'fetch');
  const batch=await create(project,{...input(project),sourceData:{...project.data,_media_body_url:descriptor}});
  expect(batch.children[2].project.data._media_popup_url).toEqual(descriptor);expect(fetch).not.toHaveBeenCalled();
  expect((await deliveryPlan(batch.children[2].project,env.DB)).files.some(file=>file.url===descriptor.url)).toBe(true);
});

it.each(['uploading','failed','missing','invalid-mime'])('rejects selected shared media that is %s',async state=>{
  const project=await source(),id=crypto.randomUUID(),url=`/api/graphics/media/${id}/content`;
  if(state!=='missing')await env.DB.prepare('INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES(?,?,?,?,?,?,?)').bind(id,'uploads/'+id,'Fixture',state==='invalid-mime'?'text/html':'video/mp4',100,state==='invalid-mime'?'ready':state,designer.email).run();
  await expect(create(project,{...input(project),sourceData:{...project.data,_media_body_url:url}})).rejects.toMatchObject({status:422});
});

it('rechecks shared readiness inside the atomic creation, without public cache or uploads',async()=>{
  const project=await source(),id=crypto.randomUUID(),url=`/api/graphics/media/${id}/content`;
  await env.DB.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES(?,?,?,'video/mp4',100,'ready',?)").bind(id,'uploads/'+id,'Fixture',designer.email).run();
  const original=env.DB.batch.bind(env.DB);vi.spyOn(env.DB,'batch').mockImplementationOnce(async statements=>{await env.DB.prepare("UPDATE media SET status='failed' WHERE id=?").bind(id).run();return original(statements);});
  await expect(create(project,{...input(project),sourceData:{...project.data,_media_body_url:url}})).rejects.toMatchObject({status:422});
});

it('origin authorizes only exact source assets in the immutable child r1, never a library prefix',async()=>{
  const project=await source({_media_body_url:'lib/media/programme.mp4'}),batch=await create(project),child=batch.children[2].project;
  const result=await (await call(`/projects/${child.id}/derivation-origin`))!.json<DerivationOrigin>();
  const allowed='/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4';
  expect(result.allowedLibraryUrls).toEqual([allowed]);expect(result.sourceSnapshotSha256).toBe(batch.sourceSnapshot.sha256);
  await call(`/projects/${child.id}`,'PUT',{title:child.title,revision:1,data:{...child.data,_media_popup_url:'/library/v1.7.0/BTV_BA_1P/lib/media/prepared/native-v102/slow-25b341c2aeb35dc28530.mp4'}});
  expect((await getValidatedProjectOrigin(env.DB,child.id))!.allowedLibraryUrls).toEqual([allowed]);
  const changed=await (await call(`/projects/${child.id}`))!.json<Project>();await expect(deliveryPlan(changed,env.DB)).rejects.toThrow();
  await expect(call(`/projects/${project.id}/derivation-origin`)).rejects.toMatchObject({status:404});
  await expect(call(`/projects/${crypto.randomUUID()}/derivation-origin`)).rejects.toMatchObject({status:404});
});

it('exports linked programme and prepared slow-clip assets, and a custom source sponsor, under exact provenance',async()=>{
  for(const bodyUrl of ['lib/media/programme.mp4','lib/media/prepared/native-v102/slow-25b341c2aeb35dc28530.mp4']){
    const project=await source({_media_body_url:bodyUrl,_sponsor_visible:true,_sponsor_original:false,_sponsor_url:'lib/media/sponsor.png'}),request=input(project);request.targets=['popup-1','tds'];
    const batch=await create(project,request);
    for(const child of batch.children){
      const plan=await deliveryPlan(child.project,env.DB),file=plan.files.find(file=>file.url.endsWith('/BTV_BA_1P/'+bodyUrl));
      expect(file?.sha256).toMatch(/^[a-f\d]{64}$/);expect(file?.path).toMatch(/^lib\/derived\//);
      expect(JSON.stringify(plan.data)).not.toContain('/library/v1.7.0/BTV_BA_1P/');
      if(child.targetKey==='tds'){
        expect(plan.files.find(file=>file.url==='/library/v1.7.0/BTV_BA_1P/lib/media/sponsor.png')?.sha256).toMatch(/^[a-f\d]{64}$/);
        expect(child.project.data._sponsor_visible).toBe(true);
      }
    }
  }
});

it('rejects a forged foreign source in an unrelated project even if the asset exists in the frozen library',async()=>{
  const project=await (await call('/projects','POST',{title:'Non lié',templateId:'BTV_PopUp',data:{_media_popup_url:'/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4'}}))!.json<Project>();
  expect(await getValidatedProjectOrigin(env.DB,project.id)).toBeNull();await expect(deliveryPlan(project,env.DB)).rejects.toThrow();
});

it('deduplicates shared readiness reads across three children and enforces MIME without uploading',async()=>{
  const project=await source(),id=crypto.randomUUID(),url=`/api/graphics/media/${id}/content`;
  await env.DB.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES(?,?,?,'video/mp4',100,'ready',?)").bind(id,'uploads/'+id,'Fixture',designer.email).run();
  const prepare=vi.spyOn(env.DB,'prepare');
  const batch=await create(project,{...input(project),sourceData:{...project.data,_media_body_url:{url,name:'Fixture',mimeType:'video/mp4'}}});
  expect(batch.children).toHaveLength(3);
  expect(prepare.mock.calls.filter(([sql])=>sql.includes('FROM media')&&!sql.startsWith('SELECT id,channel_id'))).toHaveLength(1);
  await expect(create(project,{...input(project),sourceData:{...project.data,_media_body_url:{url,name:'Forged',mimeType:'image/png'}}})).rejects.toMatchObject({status:422});
});

it('bounds request bytes and rejects unsupported methods or malformed pagination without changing data',async()=>{
  const project=await source(),before=await counts();
  await expect(create(project,{...input(project),sourceTitle:'x'.repeat(140000)})).rejects.toMatchObject({status:413});
  await expect(call(`/projects/${project.id}/derivations`,'DELETE')).rejects.toMatchObject({status:405});
  await expect(call(`/projects/${project.id}/derivations?limit=51`)).rejects.toThrow();
  await expect(call(`/projects/${project.id}/derivations?before=2026-09-23T00:00:00.000Z`)).rejects.toThrow();
  await expect(call(`/derivations/${crypto.randomUUID()}`)).rejects.toMatchObject({status:404});expect(await counts()).toEqual(before);
});

it('rejects unknown own keys, forged outputs, duplicate selections and more than eight children',async()=>{
  const project=await source(),body=input(project),before=await counts();
  for(const key of ['__proto__','constructor','toString']){
    const data=JSON.parse(JSON.stringify(project.data).slice(0,-1)+`,"${key}":"forged"}`);
    await expect(create(project,{...body,sourceData:data})).rejects.toThrow('Champ inconnu');
  }
  for(const patch of [{children:[]},{targets:['ba-portrait','ba-portrait']},{targets:Array(9).fill('ba-vertical')},{targets:['BTV_Ce_Soir']}])await expect(call(`/projects/${project.id}/derivations`,'POST',{...body,...patch})).rejects.toThrow();
  expect(await counts()).toEqual(before);
});

it('keeps receipt/provenance immutable and rejects CSRF and unauthenticated real Worker access',async()=>{
  const project=await source(),batch=await create(project);
  await expect(env.DB.prepare('UPDATE derivation_batches SET name=? WHERE id=?').bind('Forged',batch.id).run()).rejects.toThrow('derivation_batch_immutable');
  await expect(env.DB.prepare('UPDATE project_derivations SET label=? WHERE batch_id=?').bind('Forged',batch.id).run()).rejects.toThrow('project_derivation_immutable');
  await expect(api(new Request(origin+base+`/projects/${project.id}/derivations`,{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify(input(project))}),env,designer)).rejects.toMatchObject({status:403});
  const response=await worker.fetch(new Request(origin+base+`/derivations/${batch.id}`),{...env,AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35),ASSETS:{fetch:vi.fn()} as Fetcher},{waitUntil:vi.fn()} as ExecutionContext);
  expect(response.status).toBe(401);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});
