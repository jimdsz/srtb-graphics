import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll,afterEach,expect,it,inject,vi } from 'vitest';
import { generateKeyPair,exportJWK,SignJWT } from 'jose';
import { api } from '../../server/router';
import { authenticate } from '../../server/auth';
import { readJson,checkOrigin,secureHeaders } from '../../server/http';
import { broadcastTemplates,templateDefaults,validateProjectData,safeMediaUrl } from '../../src/studio/domain';
import type { Member } from '../../src/studio/domain';
import {textFields,patchTextStyle} from '../../src/studio/typography-model';

declare module 'vitest' { export interface ProvidedContext { migrations: import('@cloudflare/vitest-plugin').D1Migration[] } }
const admin:Member={email:'admin@example.com',name:'Jimmy de Souza',role:'admin',active:1};
const designer:Member={email:'designer@example.test',name:'Test infographiste',role:'designer',active:1};
const broadcaster:Member={email:'broadcast@example.test',name:'Test diffuseur',role:'broadcaster',active:1};
const request=(path:string,method='GET',body?:unknown)=>new Request(`https://studio.example${path==="/api/me"||path.startsWith('/api/graphics/')?path:path.replace("/api/","/api/graphics/")}`,{method,headers:{Origin:'https://studio.example','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
const call=(path:string,method='GET',body?:unknown,member=admin)=>api(request(path,method,body),env,member);
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));for(const m of [designer,broadcaster])await env.DB.prepare('INSERT INTO members(email,name,role,updated_by) VALUES(?,?,?,?)').bind(m.email,m.name,m.role,admin.email).run();});
afterEach(()=>vi.restoreAllMocks());
it('persists an optional local voice on every model without uploading it or replacing music',async()=>{
  const source={url:'local-media:'+'b'.repeat(64)+':123456',name:'Voix équipe.wav',mimeType:'audio/wav'};
  const requests=vi.spyOn(globalThis,'fetch');
  for(const template of broadcastTemplates){
    const base=templateDefaults(template),ba=template.id==='BTV_BA_1P';
    const data={...base,_audio_voice_enabled:true,_audio_voice_url:source,
      [ba?'_audio_voice_in_seconds':'_audio_voice_start_seconds']:.12,
      [ba?'_audio_voice_out_seconds':'_audio_voice_end_seconds']:2.16};
    const created=await (await call('/api/projects','POST',{title:'Voix locale '+template.id,templateId:template.id,data},designer))!.json();
    expect(created.revision).toBe(1);
    const reopened=await (await call(`/api/projects/${created.id}`,'GET',undefined,broadcaster))!.json();
    expect(reopened.data._audio_voice_url).toEqual(source);
    expect(reopened.data._audio_voice_enabled).toBe(true);
    for(const key of Object.keys(base).filter(key=>key.startsWith('_audio')&&!key.startsWith('_audio_voice')))expect(reopened.data[key]).toEqual(base[key]);
    const disabled=await (await call(`/api/projects/${created.id}`,'PUT',{title:created.title,revision:1,data:{...data,_audio_voice_enabled:false}},designer))!.json();
    expect(disabled.data._audio_voice_url).toEqual(source);
    expect(disabled.data._audio_voice_enabled).toBe(false);
    await expect(call(`/api/projects/${created.id}`,'PUT',{title:created.title,revision:1,data},broadcaster)).rejects.toMatchObject({status:409});
  }
  expect(requests).not.toHaveBeenCalled();
});
it('persists custom text and local font references across team members without uploading fonts',async()=>{
  for(const template of broadcastTemplates){
    const field=textFields(template)[0][0],base=templateDefaults(template),patch=patchTextStyle(base,field,{font:'local-font:'+'a'.repeat(64),fontName:'Police équipe.otf',size:73,x:-140,rotation:4,case:'typed'});
    const created=await (await call('/api/projects','POST',{title:'Texte libre '+template.id,templateId:template.id,data:{...base,...patch}},designer))!.json();
    const reopened=await (await call(`/api/projects/${created.id}`,'GET',undefined,broadcaster))!.json();expect(reopened.data._studio_typography).toBe(patch._studio_typography);
    const changed=await (await call(`/api/projects/${created.id}`,'PUT',{title:created.title,revision:created.revision,data:{...created.data,...patchTextStyle(created.data,field,{x:200})}},broadcaster))!.json();
    await expect(call(`/api/projects/${created.id}`,'PUT',{title:created.title,revision:created.revision,data:created.data},designer)).rejects.toMatchObject({status:409});
    const history=await (await call(`/api/projects/${created.id}/revisions`))!.json();expect(history[1].data._studio_typography).toBe(patch._studio_typography);expect(changed.data._studio_typography).not.toBe(patch._studio_typography);
  }
});
it('saves and reopens all destination layouts while preserving pinned TV versions and hidden appointments',async()=>{
  for(const template of broadcastTemplates){
    const data={...templateDefaults(template),_studio_format:'vertical',...(template.id==='BTV_BA_1P'?{_studio_ba_mode:'simple',_jour_1:'Demain',_jour_2:'Vendredi'}:{})};
    const created=await (await call('/api/projects','POST',{title:'Recette formats '+template.id,templateId:template.id,data},designer))!.json();
    expect(created.data).toEqual(data);expect(created.template_version).toBe(template.version);expect(created.library_version).toBe('1.7.0');
    const updated=await (await call(`/api/projects/${created.id}`,'PUT',{title:created.title,revision:created.revision,data:{...created.data,_studio_format:'portrait'}},designer))!.json();
    const reopened=await (await call(`/api/projects/${created.id}`,'GET',undefined,broadcaster))!.json();
    expect(reopened).toEqual(updated);expect(reopened.data._studio_format).toBe('portrait');
    const previous=await (await call(`/api/projects/${created.id}/revisions`))!.json();expect(previous[1].data._studio_format).toBe('vertical');
    if(template.id==='BTV_BA_1P')expect(reopened.data._jour_2).toBe('Vendredi');
  }
});
it('imports the seven original schemas plus the three converted templates and validates defaults',()=>{
  expect(broadcastTemplates).toHaveLength(10);
  // 353 previous fields + IN/OUT for 12 media tracks in the three AE adapters.
  expect(broadcastTemplates.reduce((n,t)=>n+Object.keys(t.fields).filter(key=>!key.startsWith('_studio_')).length,0)).toBe(377);
  for(const [id,tracks] of Object.entries({BTV_Renvoi:['renvoi'],BTV_Evenement:['intro','event'],BTV_Semainier:['intro','final',...Array.from({length:7},(_,i)=>`programme_${i+1}`)]})){
    const t=broadcastTemplates.find(item=>item.id===id)!;
    for(const track of tracks)for(const point of ['start','end'])expect(t.fields[`_media_${track}_${point}_seconds`]).toMatchObject({type:'number',default:0,minimum:0,maximum:86400});
  }
  expect(broadcastTemplates.some(t=>t.id==='BTV_HabDyn_PopUp_RDV')).toBe(false);
  for(const t of broadcastTemplates)expect(validateProjectData(t,templateDefaults(t))).toEqual(templateDefaults(t));
});
it('rejects remote, local machine, encoded traversal and unsafe media sources',()=>{
  for(const url of ['https://evil.example/a.mp4','C:\\Users\\x.mp4','//evil.example/file','lib/../x.png','lib/%2e%2e/x.png','lib/%252e%252e/x.png','lib/%5cx.png','data:text/html,hello','blob:123'])expect(safeMediaUrl(url)).toBe(false);
  expect(safeMediaUrl('lib/media/prepared/native-v102/slow-25b341c2aeb35dc28530.mp4')).toBe(true);
});
it('validates media passage ordering, charter choices and QR schemes',()=>{
  const ba=broadcastTemplates[0],defaults=templateDefaults(ba);
  expect(()=>validateProjectData(ba,{...defaults,_media_intro_sequence:'[{"url":"lib/media/a.mp4","start":5,"end":4}]'})).toThrow();
  expect(()=>validateProjectData(ba,{...defaults,unexpected:'x'})).toThrow();
  const replay=broadcastTemplates.find(t=>t.id==='BTV_Passerelle_Replay')!;
  expect(()=>validateProjectData(replay,{_replay_url:'javascript:alert(1)'})).toThrow();
});
it('accepts only complete content-pinned local references, never file paths or temporary blobs',()=>{
  const t=broadcastTemplates[0],url=`local-media:${'b'.repeat(64)}:100`;
  expect(validateProjectData(t,{_media_body_url:{url,name:'Local.mp4',mimeType:'video/mp4'}})._media_body_url).toEqual({url,name:'Local.mp4',mimeType:'video/mp4'});
  for(const value of [url,{url,name:'X',mimeType:'text/html'},{url:'local-media:fake:100',name:'X',mimeType:'video/mp4'}])expect(()=>validateProjectData(t,{_media_body_url:value})).toThrow();
});
it('persists a local-only project and produces its delivery manifest without cloud media',async()=>{
  const url=`local-media:${'c'.repeat(64)}:100`,descriptor={url,name:'Mon son.wav',mimeType:'audio/wav'};
  const p=await (await call('/api/projects','POST',{title:'Sources locales',templateId:'BTV_Relais_Antenne',data:{_audio_url:descriptor,_audio_enabled:true}},designer))!.json();
  const submitted=await (await call(`/api/projects/${p.id}/status`,'POST',{revision:p.revision,status:'submitted'},designer))!.json();
  const approved=await (await call(`/api/projects/${p.id}/status`,'POST',{revision:submitted.revision,status:'approved'},broadcaster))!.json();
  const delivery=await (await call(`/api/projects/${p.id}/delivery?revision=${approved.revision}`,'GET',undefined,broadcaster))!.json();
  expect(delivery.files.some((f:{url:string})=>f.url===url)).toBe(true);
});
it('refuses cross-site writes and excessive request bodies',async()=>{
  expect(()=>checkOrigin(new Request('https://studio.example/api/projects',{method:'POST',headers:{Origin:'https://evil.example'}}))).toThrow();
  await expect(readJson(request('/api/projects','POST',{data:'x'.repeat(140000)}))).rejects.toMatchObject({status:413});
});
it('lets every team role export draft screen settings without saving or approving',async()=>{
  const p=await (await call('/api/projects','POST',{title:'Projet partagé inchangé',templateId:'BTV_PopUp'},designer))!.json();
  for(const member of [designer,broadcaster,admin]){
    const plan=await (await call(`/api/projects/${p.id}/export`,'POST',{title:'Titre non enregistré',revision:p.revision,data:{...p.data,_background_visible:false}},member))!.json();
    expect(plan.project.title).toBe('Titre non enregistré');
    expect(plan.data._background_visible).toBe(false);
    expect(plan.snapshot.purpose).toBe('working-copy');expect(plan.snapshot.id).toMatch(/^[a-f\d-]{36}$/);
    expect(plan.filename).toContain('_export_');
  }
  expect(await (await call(`/api/projects/${p.id}`))!.json()).toEqual(p);
  expect(await (await call(`/api/projects/${p.id}/revisions`))!.json()).toHaveLength(1);
  await expect(call(`/api/projects/${p.id}/delivery?revision=${p.revision}`,'GET',undefined,broadcaster)).rejects.toMatchObject({status:403});
});
it('exports an older working copy independently of a colleague save or archive',async()=>{
  const p=await (await call('/api/projects','POST',{title:'Export A',templateId:'BTV_Relais_Antenne'},designer))!.json();
  const updated=await (await call(`/api/projects/${p.id}`,'PUT',{title:'Version collègue',revision:p.revision,data:p.data},broadcaster))!.json();
  const archived=await (await call(`/api/projects/${p.id}/archive`,'POST',{revision:updated.revision,archived:true},broadcaster))!.json();
  const plan=await (await call(`/api/projects/${p.id}/export`,'POST',{title:p.title,revision:p.revision,data:p.data},designer))!.json();
  expect(plan.project.revision).toBe(p.revision);expect(plan.project.title).toBe(p.title);
  expect(await (await call(`/api/projects/${p.id}`))!.json()).toEqual(archived);
});
it('keeps export source validation, same-origin protection and version pinning',async()=>{
  const p=await (await call('/api/projects','POST',{title:'Contrôles export',templateId:'BTV_PopUp'},designer))!.json();
  const input={title:p.title,revision:p.revision,data:p.data};
  const missing='/api/graphics/media/00000000-0000-4000-8000-000000000088/content';
  await expect(call(`/api/projects/${p.id}/export`,'POST',{...input,data:{...p.data,_media_popup_url:missing}},designer)).rejects.toMatchObject({status:422});
  await expect(call(`/api/projects/${p.id}/export`,'POST',{...input,data:{...p.data,_media_popup_url:'lib/absent.png'}},designer)).rejects.toMatchObject({status:422});
  await expect(call(`/api/projects/${p.id}/export`,'POST',{...input,data:{...p.data,_media_popup_url:'https://evil.example/x.png'}},designer)).rejects.toThrow();
  await expect(api(new Request(`https://studio.example/api/graphics/projects/${p.id}/export`,{method:'POST',headers:{Origin:'https://evil.example'},body:JSON.stringify(input)}),env,designer)).rejects.toMatchObject({status:403});
  await env.DB.prepare('UPDATE projects SET template_version=?,revision=revision+1 WHERE id=?').bind('99.0.0',p.id).run();
  await expect(call(`/api/projects/${p.id}/export`,'POST',input,designer)).rejects.toMatchObject({status:422});
});
it('creates durable revisions and rejects a concurrent overwrite',async()=>{
  const created=await (await call('/api/projects','POST',{title:'Concurrence',templateId:'BTV_Relais_Antenne'},designer))!.json();
  const saved=await (await call(`/api/projects/${created.id}`,'PUT',{title:'Version designer',revision:created.revision,data:created.data},designer))!.json();
  expect(saved.revision).toBe(2);
  await expect(call(`/api/projects/${created.id}`,'PUT',{title:'Perte interdite',revision:created.revision,data:created.data},broadcaster)).rejects.toMatchObject({status:409});
  const revisions=await (await call(`/api/projects/${created.id}/revisions`))!.json();expect(revisions.map((r:{revision:number})=>r.revision)).toEqual([2,1]);
});
it('ignores disabled or replaced shared media throughout save, approval and delivery',async()=>{
  const missing='/api/graphics/media/00000000-0000-4000-8000-000000000088/content';
  const p=await (await call('/api/projects','POST',{title:'Alternatives conservées',templateId:'BTV_PopUp',data:{
    _background_visible:false,_media_background_url:missing,
    _media_background_sequence:JSON.stringify([{url:missing,start:0,end:2}]),
    _media_popup_url:missing,_media_popup_sequence:JSON.stringify([{url:'lib/media/default-popup.png',start:0,end:3}]),
  }},designer))!.json();
  const saved=await (await call(`/api/projects/${p.id}`,'PUT',{title:p.title,revision:p.revision,data:p.data},designer))!.json();
  expect(saved.data._media_background_url).toBe(missing);
  const submitted=await (await call(`/api/projects/${p.id}/status`,'POST',{revision:saved.revision,status:'submitted'},designer))!.json();
  const approved=await (await call(`/api/projects/${p.id}/status`,'POST',{revision:submitted.revision,status:'approved'},broadcaster))!.json();
  const delivery=await (await call(`/api/projects/${p.id}/delivery?revision=${approved.revision}`,'GET',undefined,broadcaster))!.json();
  expect(delivery.files.some((f:{url:string})=>f.url===missing)).toBe(false);
  await expect(call(`/api/projects/${p.id}`,'PUT',{title:p.title,revision:approved.revision,data:{...p.data,_background_visible:true}},designer)).rejects.toMatchObject({status:422});
  const audio=await (await call('/api/projects','POST',{title:'Son désactivé',templateId:'BTV_Relais_Antenne',data:{_audio_url:missing,_audio_enabled:false}},designer))!.json();
  expect(audio.data._audio_url).toBe(missing);
  await expect(call(`/api/projects/${audio.id}`,'PUT',{title:audio.title,revision:audio.revision,data:{...audio.data,_audio_enabled:true}},designer)).rejects.toMatchObject({status:422});
});
it('does not interpret editorial text containing a media URL as a selected file',async()=>{
  const url='/api/graphics/media/00000000-0000-4000-8000-000000000088/content';
  const p=await (await call('/api/projects','POST',{title:'Texte littéral',templateId:'BTV_Passerelle_Replay',data:{_replay_url:`https://www.srtb.bj${url}`}},designer))!.json();
  expect(p.status).toBe('draft');
});
it('accepts exactly one of two simultaneous writes and retains both revisions',async()=>{
  const p=await (await call('/api/projects','POST',{title:'Deux postes',templateId:'BTV_Relais_Antenne'},designer))!.json();
  const results=await Promise.allSettled([designer,broadcaster].map((member,index)=>call(`/api/projects/${p.id}`,'PUT',{title:`Poste ${index+1}`,revision:p.revision,data:p.data},member)));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{status:409}});
  const revisions=await (await call(`/api/projects/${p.id}/revisions`))!.json();expect(revisions.map((r:{revision:number})=>r.revision)).toEqual([2,1]);
});
it('rechecks active shared media before approving a submitted project',async()=>{
  const id=crypto.randomUUID(),url=`/api/graphics/media/${id}/content`;
  const upload=await (await call('/api/media','POST',{name:'check.wav',mimeType:'audio/wav',bytes:44,consent:true}))!.json();
  await env.DB.prepare("UPDATE media SET status='ready' WHERE id=?").bind(upload.id).run();
  const p=await (await call('/api/projects','POST',{title:'Contrôle validation',templateId:'BTV_Relais_Antenne',data:{_audio_enabled:true,_audio_url:url.replace(id,upload.id)}},designer))!.json();
  const submitted=await (await call(`/api/projects/${p.id}/status`,'POST',{revision:p.revision,status:'submitted'},designer))!.json();
  await env.DB.prepare("UPDATE media SET status='failed' WHERE id=?").bind(upload.id).run();
  await expect(call(`/api/projects/${p.id}/status`,'POST',{revision:submitted.revision,status:'approved'},broadcaster)).rejects.toMatchObject({status:422});
  expect((await (await call(`/api/projects/${p.id}`))!.json()).status).toBe('submitted');
});
it('reserves validation to the broadcaster and retains prior approvals',async()=>{
  const p=await (await call('/api/projects','POST',{title:'Validation',templateId:'BTV_Relais_Antenne'},designer))!.json();
  const submitted=await (await call(`/api/projects/${p.id}/status`,'POST',{revision:p.revision,status:'submitted'},designer))!.json();
  await expect(call(`/api/projects/${p.id}/status`,'POST',{revision:submitted.revision,status:'approved'},designer)).rejects.toMatchObject({status:403});
  const approved=await (await call(`/api/projects/${p.id}/status`,'POST',{revision:submitted.revision,status:'approved'},broadcaster))!.json();expect(approved.status).toBe('approved');
  await expect(call(`/api/projects/${p.id}/delivery?revision=${approved.revision}`,'GET',undefined,designer)).rejects.toMatchObject({status:403});
  await expect(call(`/api/projects/${p.id}/delivery?revision=1`,'GET',undefined,broadcaster)).rejects.toMatchObject({status:409});
  const delivery=await (await call(`/api/projects/${p.id}/delivery?revision=${approved.revision}`,'GET',undefined,broadcaster))!.json();expect(delivery.format).toBe('srtb-review-package');expect(delivery.project.revision).toBe(approved.revision);
  const draft=await (await call(`/api/projects/${p.id}`,'PUT',{revision:approved.revision,title:'Correction',data:p.data},designer))!.json();expect(draft.status).toBe('draft');
  const revisions=await (await call(`/api/projects/${p.id}/revisions`))!.json();expect(revisions.some((r:{status:string})=>r.status==='approved')).toBe(true);
});
it('refuses submitting a replay without an URL and editing an archived project',async()=>{
  const p=await (await call('/api/projects','POST',{title:'Replay',templateId:'BTV_Passerelle_Replay'}))!.json();
  await expect(call(`/api/projects/${p.id}/status`,'POST',{revision:p.revision,status:'submitted'})).rejects.toMatchObject({status:422});
  const archived=await (await call(`/api/projects/${p.id}/archive`,'POST',{revision:p.revision,archived:true}))!.json();
  await expect(call(`/api/projects/${p.id}`,'PUT',{revision:archived.revision,title:'Impossible',data:p.data})).rejects.toMatchObject({status:409});
});
it('protects administration, self-access and the last administrator',async()=>{
  await expect(call('/api/members','GET',undefined,designer)).rejects.toMatchObject({status:403});
  await expect(call('/api/members','POST',{...admin,active:false})).rejects.toMatchObject({status:409});
  await expect(env.DB.prepare("UPDATE members SET active=0 WHERE email=?").bind(admin.email).run()).rejects.toThrow('last_admin');
});
it('requires explicit upload consent and validates actual media signatures',async()=>{
  await expect(call('/api/media','POST',{name:'x.png',mimeType:'image/png',bytes:20})).rejects.toThrow();
  const upload=await (await call('/api/media','POST',{name:'x.png',mimeType:'image/png',bytes:20,consent:true}))!.json();
  const req=new Request(`https://studio.example/api/graphics/media/${upload.id}/part/1`,{method:'PUT',headers:{Origin:'https://studio.example','Content-Length':'20'},body:new Uint8Array(20)});
  await expect(api(req,env,admin)).rejects.toMatchObject({status:415});
  await expect(call(`/api/graphics/media/${upload.id}/complete`,'POST',{})).rejects.toMatchObject({status:409});
  await call(`/api/graphics/media/${upload.id}/cancel`,'POST',{});
  expect((await env.DB.prepare('SELECT status FROM media WHERE id=?').bind(upload.id).first())?.status).toBe('failed');
});
it('uploads, finalises idempotently and serves authenticated byte ranges',async()=>{
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
  const upload=await (await call('/api/media','POST',{name:'image.png',mimeType:'image/png',bytes:bytes.length,consent:true}))!.json();
  const req=new Request(`https://studio.example/api/graphics/media/${upload.id}/part/1`,{method:'PUT',headers:{Origin:'https://studio.example','Content-Length':String(bytes.length)},body:bytes});
  await expect(api(req,env,designer)).rejects.toMatchObject({status:403});
  expect((await api(req,env,admin))?.status).toBe(200);
  const first=await (await call(`/api/graphics/media/${upload.id}/complete`,'POST',{}))!.json();
  const second=await (await call(`/api/graphics/media/${upload.id}/complete`,'POST',{}))!.json();expect(first).toEqual(second);
  const range=await api(new Request(`https://studio.example${first.url}`,{headers:{Range:'bytes=1-3'}}),env,designer);expect(range?.status).toBe(206);expect(new TextDecoder().decode(await range!.arrayBuffer())).toBe('PNG');
  const invalid=await api(new Request(`https://studio.example${first.url}`,{headers:{Range:'bytes=900-'}}),env,designer);expect(invalid?.status).toBe(416);
  const events=await env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE action='media.shared' AND target=?").bind(upload.id).first();expect(events?.n).toBe(1);
});
it('fails closed before any private content when Access is not configured',async()=>{
  await expect(authenticate(request('/library/private.mp4'),env)).rejects.toMatchObject({status:503});
  const configured={...env,ACCESS_TEAM_DOMAIN:'https://srtb-test.cloudflareaccess.com',ACCESS_AUDIENCE:'a'.repeat(64)};
  await expect(authenticate(request('/api/me'),configured)).rejects.toMatchObject({status:401});
  const forged=new Request('https://studio.example/api/me',{headers:{'Cf-Access-Authenticated-User-Email':admin.email,'Cf-Access-Jwt-Assertion':'fake'}});
  await expect(authenticate(forged,configured)).rejects.toMatchObject({status:401});
});
it('checks signed JWT issuer/audience/expiry and DB membership on every request',async()=>{
  const issuer='https://srtb-test.cloudflareaccess.com',aud='a'.repeat(64),configured={...env,ACCESS_TEAM_DOMAIN:issuer,ACCESS_AUDIENCE:aud};
  const {publicKey,privateKey}=await generateKeyPair('RS256'),key={...await exportJWK(publicKey),kid:'test-key',alg:'RS256',use:'sig'};
  vi.spyOn(globalThis,'fetch').mockImplementation(async()=>Response.json({keys:[key]}));
  const sign=(email:string,audience=aud,expiry='5m')=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(issuer).setAudience(audience).setSubject(email).setIssuedAt().setExpirationTime(expiry).sign(privateKey);
  const req=(jwt:string)=>new Request('https://studio.example/api/me',{headers:{'Cf-Access-Jwt-Assertion':jwt}});
  expect((await authenticate(req(await sign(admin.email)),configured)).role).toBe('admin');
  await expect(authenticate(req(await sign(admin.email,'wrong')),configured)).rejects.toMatchObject({status:401});
  await expect(authenticate(req(await sign(admin.email,aud,'-1h')),configured)).rejects.toMatchObject({status:401});
  await expect(authenticate(req(await sign('unknown@example.test')),configured)).rejects.toMatchObject({status:403});
  await env.DB.prepare('UPDATE members SET active=0 WHERE email=?').bind(designer.email).run();
  await expect(authenticate(req(await sign(designer.email)),configured)).rejects.toMatchObject({status:403});
  await env.DB.prepare('UPDATE members SET active=1 WHERE email=?').bind(designer.email).run();
});
it('sets private cache policy, CSP, nosniff and framing controls',()=>{
  const response=secureHeaders(new Response('ok'));expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-security-policy')).toContain("object-src 'none'");expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});
it('keeps graphics routes separate from future tools',async()=>{
  expect(await api(new Request('https://studio.example/api/projects'),env,admin)).toBeNull();
  expect(await api(new Request('https://studio.example/api/signatures/projects'),env,admin)).toBeNull();
  expect((await api(new Request('https://studio.example/api/graphics/projects'),env,admin))?.status).toBe(200);
});
