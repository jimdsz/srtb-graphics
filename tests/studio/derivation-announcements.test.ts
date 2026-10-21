import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {afterEach,beforeAll,expect,inject,it,vi} from 'vitest';
import {api} from '../../server/router';
import {getTemplate,templateDefaults} from '../../src/studio/domain';
import type {Member,Project,ProjectData,Revision} from '../../src/studio/domain';
import type {DerivationAnnouncement} from '../../src/studio/derivation-model';
import type {DerivationBatch,DerivationOrigin} from '../../src/studio/derivation-types';
import type {PreparationProfile,ProfileAsset} from '../../src/studio/preparation-profile-model';
import {canonicalJson,snapshotHash} from '../../server/derivation-origin';

const origin='https://studio.example',base='/api/graphics';
const admin:Member={email:'admin@example.com',name:'Admin',role:'admin',active:1};
const designer:Member={email:'announcement-designer@example.test',name:'Préparateur annonces',role:'designer',active:1};
const broadcaster:Member={email:'announcement-broadcaster@example.test',name:'Diffuseur annonces',role:'broadcaster',active:1};
const template=getTemplate('BTV_BA_1P');
const keys=['day-time','tomorrow','today','tonight','now'] as const;
const audioId='00000000-0000-4000-8000-000000000091';
const audio:ProfileAsset={url:`/api/graphics/media/${audioId}/content`,name:'Annonce validée.wav',mimeType:'audio/wav'};
const call=(path:string,method='GET',body?:unknown,member=designer)=>api(new Request(origin+base+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-SRTB-Client-Capabilities':'derivations-v1'},body:body===undefined?undefined:JSON.stringify(body)}),env,member);
async function source(patch:ProjectData={}){
  return (await call('/projects','POST',{title:'Source annonces',templateId:template.id,data:{...templateDefaults(template),_jour_1:'Lundi',_heure_1:'20h35',_jour_2:'Mardi',_heure_2:'09h00',_jour_3:'Jeudi',_heure_3:'10h00',...patch}}))!.json<Project>();
}
function announcement(key:DerivationAnnouncement['key'],voice:DerivationAnnouncement['voice']={mode:'pending'},formats:DerivationAnnouncement['formats']=['tv']):DerivationAnnouncement{
  return {key,voice,formats};
}
function input(project:Project,announcements=keys.map(key=>announcement(key))){
  return {requestId:crypto.randomUUID(),name:'Annonces du programme',sourceRevision:project.revision,sourceTitle:'Titre affiché non enregistré',sourceData:{...project.data,_titre_ligne_1:'Titre affiché'},targets:[],announcements};
}
async function create(project:Project,body=input(project)){
  return (await call(`/projects/${project.id}/derivations`,'POST',body))!.json<DerivationBatch>();
}
async function createVoice(data:Record<string,unknown>={},member=designer){
  const profile=await (await call('/preparation-profiles','POST',{kind:'voice',name:'Voix pour les annonces',data:{source:audio,start:.17,end:1.37,label:'Aujourd’hui',cue:{kind:'announcement',value:'Aujourd’hui'},humanValidated:true,...data}},member))!.json<PreparationProfile>();
  if(profile.kind!=='voice')throw Error('Expected a voice preparation profile.');
  return profile;
}
function pin(profile:PreparationProfile,revision=profile.revision):DerivationAnnouncement['voice']{return {mode:'profile',profileId:profile.id,revision};}
async function counts(){
  return Promise.all(['projects','revisions','activity','derivation_batches','project_derivations','media'].map(table=>env.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first<{n:number}>()));
}
async function noBatchFor(project:Project){
  expect(await env.DB.prepare('SELECT COUNT(*) n FROM derivation_batches WHERE source_project_id=?').bind(project.id).first()).toEqual({n:0});
}
async function sharedAudio(mime='audio/wav',status='ready'){
  const id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES(?,?,?,?,?,?,?)').bind(id,'uploads/'+id,'Voix fixture',mime,100,status,designer.email).run();
  return {id,asset:{url:`/api/graphics/media/${id}/content`,name:'Voix fixture.wav',mimeType:'audio/wav'}};
}

beforeAll(async()=>{
  await applyD1Migrations(env.DB,inject('migrations'));
  for(const member of [designer,broadcaster])await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,1,?)').bind(member.email,member.name,member.role,admin.email).run();
  await env.DB.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES(?,?,?,'audio/wav',100,'ready',?)").bind(audioId,'uploads/'+audioId,audio.name,designer.email).run();
});
afterEach(()=>vi.restoreAllMocks());

it('creates five linked TV drafts atomically with pending voices while preserving the complete source',async()=>{
  const project=await source(),before=await counts(),body=input(project);
  const transaction=vi.spyOn(env.DB,'batch'),prepare=vi.spyOn(env.DB,'prepare'),fetch=vi.spyOn(globalThis,'fetch');
  const response=(await call(`/projects/${project.id}/derivations`,'POST',body))!,batch=await response.json<DerivationBatch>();
  expect(response.status).toBe(201);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(batch).toMatchObject({sourceProjectId:project.id,sourceRevision:1,childCount:5,mappingVersion:'campaign-6',createdBy:designer.email});
  expect(batch.sourceSnapshot.sha256).toBe(await snapshotHash(canonicalJson({title:body.sourceTitle,data:body.sourceData})));
  expect(batch.children.map(child=>child.targetKey)).toEqual(keys.map(key=>`ba-${key}-tv`));
  expect(new Set(batch.children.map(child=>child.project.id)).size).toBe(5);
  for(const [index,child] of batch.children.entries()){
    const immediate=keys[index]==='now';
    expect(child.project).toMatchObject({template_id:immediate?'BTV_BA_TDS':'BTV_BA_1P',revision:1,status:'draft',archived:0});
    if(immediate){
      expect(child.project.data).toMatchObject({_studio_format:'tv',_titre_ligne_1:'Titre affiché',_background_visible:true,_audio_voice_enabled:false,_audio_voice_url:''});
      expect(child.project.data).not.toHaveProperty('_jour_1');expect(child.project.data).not.toHaveProperty('_heure_1');
    }else expect(child.project.data).toMatchObject({_studio_ba_mode:'simple',_studio_format:'tv',_titre_ligne_1:'Titre affiché',_jour_2:'',_heure_2:'',_jour_3:'',_heure_3:'',_audio_voice_enabled:false,_audio_voice_url:'',_audio_voice_in_seconds:0,_audio_voice_out_seconds:.04});
    expect(child.announcement).toMatchObject({key:keys[index],format:'tv',voice:{mode:'pending',status:'pending'}});
    if(immediate){
      expect(child.project.data._audio_bed_url).toBe('lib/audio/BTV_BA TDS -23LUFS.wav');expect(child.project.data._audio_bed_enabled).toBe(project.data._audio_bed_enabled);
      expect(child.project.data._media_background_audio_enabled).toBe(false);
    }else{
      expect(child.project.data._audio_bed_url).toBe(project.data._audio_bed_url);
      expect(child.project.data._media_body_audio_enabled).toBe(project.data._media_body_audio_enabled);
    }
    expect((await (await call(`/projects/${child.project.id}/revisions`))!.json<unknown[]>())).toHaveLength(1);
  }
  expect(await (await call(`/projects/${project.id}`))!.json<Project>()).toEqual(project);
  expect(prepare.mock.calls.some(([sql])=>/UPDATE projects/i.test(sql))).toBe(false);expect(fetch).not.toHaveBeenCalled();
  const after=await counts();expect(after.map((row,index)=>row!.n-before[index]!.n)).toEqual([5,5,5,1,5,0]);
});

it('persists an explicit no-voice decision without looking up profiles or muting music and media',async()=>{
  const project=await source(),prepare=vi.spyOn(env.DB,'prepare');
  const batch=await create(project,input(project,[announcement('now',{mode:'none'})])),child=batch.children[0];
  expect(child.announcement).toEqual({key:'now',day:'Tout de suite',time:'',format:'tv',voice:{mode:'none',status:'none'}});
  expect(child.project).toMatchObject({template_id:'BTV_BA_TDS'});
  expect(child.project.data).toMatchObject({_background_visible:true,_audio_voice_enabled:false,_audio_voice_url:'',_media_background_audio_enabled:false});
  expect(child.project.data).not.toHaveProperty('_jour_1');expect(child.project.data).not.toHaveProperty('_heure_1');
  expect(prepare.mock.calls.some(([sql])=>sql.includes('FROM preparation_profiles'))).toBe(false);
});

it('pins the complete Tout de suite voice once on the dedicated TDS animation',async()=>{
  const profile=await createVoice({start:.25,end:3.65,label:'Tout de suite',cue:{kind:'announcement',value:'Tout de suite'}}),project=await source();
  const child=(await create(project,input(project,[announcement('now',pin(profile))]))).children[0];
  expect(child.project).toMatchObject({template_id:'BTV_BA_TDS'});
  expect(child.project.data).toMatchObject({_audio_voice_enabled:true,_audio_voice_url:audio,_audio_voice_start_seconds:.25,_audio_voice_end_seconds:3.65,_audio_voice_delay_seconds:2.4});
  expect(child.announcement?.voice).toMatchObject({mode:'profile',status:'resolved',profileId:profile.id,revision:profile.revision,label:'Tout de suite',start:.25,end:3.65,placement:'source'});
  expect(child.warnings.some(warning=>warning.includes('une seule fois'))).toBe(true);
});

it('persists optional empty hours across the five drafts, source snapshot, revisions and repeated receipt',async()=>{
  const project=await source({_heure_1:'20h35'});
  const selections=keys.map(key=>({...announcement(key,{mode:'none'}),time:''}));
  const request=input(project,selections),batch=await create(project,request);
  expect(batch.childCount).toBe(5);expect(batch.sourceSnapshot.data._heure_1).toBe('20h35');
  for(const child of batch.children){
    if(child.announcement?.key==='now')expect(child.project.data).not.toHaveProperty('_heure_1');else expect(child.project.data._heure_1).toBe('');
    expect(child.announcement?.time).toBe('');
    expect(child.project.title).not.toMatch(/20:35|00:00/);
    const persisted=await (await call(`/projects/${child.project.id}`))!.json<Project>();
    if(child.announcement?.key==='now'){
      expect(persisted.data).not.toHaveProperty('_heure_1');expect(persisted.data).not.toHaveProperty('_jour_1');
    }else{
      expect(persisted.data._heure_1).toBe('');expect(persisted.data._jour_1).toBe(child.announcement?.day);
      expect(persisted.data._audio_bed_enabled).toBe(project.data._audio_bed_enabled);
      for(const key of ['_sponsor_visible','_sponsor_original','_sponsor_url'])expect(persisted.data[key]).toEqual(project.data[key]);
    }
    const revisions=await (await call(`/projects/${child.project.id}/revisions`))!.json<Revision[]>();
    expect(revisions).toHaveLength(1);if(child.announcement?.key==='now')expect(revisions[0].data).not.toHaveProperty('_heure_1');else expect(revisions[0].data._heure_1).toBe('');
  }
  const repeated=await create(project,request);expect(repeated.id).toBe(batch.id);
  expect(repeated.children.map(child=>child.project.id)).toEqual(batch.children.map(child=>child.project.id));
  const retrieved=await (await call(`/derivations/${batch.id}`))!.json<DerivationBatch>();
  expect(retrieved.children.every(child=>(child.announcement?.key==='now'?!Object.hasOwn(child.project.data,'_heure_1'):child.project.data._heure_1==='')&&child.announcement?.time==='')).toBe(true);
  expect((await (await call(`/projects/${project.id}`))!.json<Project>()).data._heure_1).toBe('20h35');
});

it('resolves the exact validated r1 after a different r2 is saved, never silently choosing the latest voice',async()=>{
  const profile=await createVoice({start:.17,end:2.51},broadcaster),replacement=await sharedAudio();
  const updated=await (await call(`/preparation-profiles/${profile.id}`,'PUT',{revision:1,name:'Demain r2',data:{...profile.data,source:replacement.asset,start:3,end:4,label:'Demain',cue:{kind:'announcement',value:'Demain'}}}))!.json<PreparationProfile>();
  expect(updated.revision).toBe(2);
  const project=await source(),batch=await create(project,input(project,[announcement('today',pin(profile,1))])),child=batch.children[0];
  expect(child.project.data).toMatchObject({_audio_voice_enabled:true,_audio_voice_url:audio,_audio_voice_in_seconds:.17,_audio_voice_out_seconds:2.51});
  expect(child.announcement?.voice).toEqual({mode:'profile',status:'resolved',profileId:profile.id,revision:1,label:'Aujourd’hui',validatedBy:broadcaster.email,validatedAt:profile.validated_at,source:audio,start:.17,end:2.51,placement:'source',introOffset:1.92,outroOffset:68.48});
  expect(child.warnings.some(warning=>warning.startsWith('Voix à préparer'))).toBe(false);
  expect(child.project.data._audio_bed_gain).toBe(project.data._audio_bed_gain);
});

it.each(["Aujourd'hui",'Aujourd’hui',' AUJOURD’HUI '])('matches today voice cue %s through the normal profile API',async value=>{
  const profile=await createVoice({cue:{kind:'announcement',value}}),project=await source();
  const child=(await create(project,input(project,[announcement('today',pin(profile))]))).children[0];
  expect(profile.data.cue).toEqual({kind:'announcement',value:'Aujourd’hui'});
  expect(child.announcement?.voice.status).toBe('resolved');expect(child.project.data._audio_voice_enabled).toBe(true);
});

it.each([
  {kind:'announcement',value:'Demain'},
  {kind:'time',value:'20:35'},
  {kind:'variant',value:'rediffusion'},
])('rejects a wrong or incomplete semantic cue $kind/$value without creating any child',async cue=>{
  const profile=await createVoice({cue}),project=await source(),before=await counts();
  await expect(create(project,input(project,[announcement('today',pin(profile))]))).rejects.toMatchObject({status:422});
  expect(await counts()).toEqual(before);await noBatchFor(project);
});

it.each(['missing','unvalidated','undated','archived-revision'])('refuses a pinned revision that is %s',async state=>{
  const profile=await createVoice(),project=await source();
  // Explicit legacy/corrupt-history fixtures: normal profile writes always attest voices.
  if(state==='unvalidated')await env.DB.prepare('UPDATE preparation_profile_revisions SET validated_by=NULL WHERE profile_id=? AND revision=1').bind(profile.id).run();
  if(state==='undated')await env.DB.prepare('UPDATE preparation_profile_revisions SET validated_at=NULL WHERE profile_id=? AND revision=1').bind(profile.id).run();
  if(state==='archived-revision')await env.DB.prepare('UPDATE preparation_profile_revisions SET archived=1 WHERE profile_id=? AND revision=1').bind(profile.id).run();
  const before=await counts();
  await expect(create(project,input(project,[announcement('today',pin(profile,state==='missing'?99:1))]))).rejects.toMatchObject({status:422});
  expect(await counts()).toEqual(before);
});

it.each(['uploading','failed','wrong-mime','missing'])('revalidates the pinned private source when its media is %s',async state=>{
  const resource=await sharedAudio(),profile=await createVoice({source:resource.asset}),project=await source();
  if(state==='missing')await env.DB.prepare('DELETE FROM media WHERE id=?').bind(resource.id).run();
  else if(state==='wrong-mime')await env.DB.prepare("UPDATE media SET mime_type='image/png' WHERE id=?").bind(resource.id).run();
  else await env.DB.prepare('UPDATE media SET status=? WHERE id=?').bind(state,resource.id).run();
  const before=await counts();
  await expect(create(project,input(project,[announcement('today',pin(profile))]))).rejects.toMatchObject({status:422});
  expect(await counts()).toEqual(before);
});

it('reuses a typed local voice reference without upload, network access or guessed file availability',async()=>{
  const local={url:`local-media:${'c'.repeat(64)}:1200`,name:'Voix locale.wav',mimeType:'audio/wav'};
  const profile=await createVoice({source:local}),project=await source(),before=await counts(),fetch=vi.spyOn(globalThis,'fetch');
  const child=(await create(project,input(project,[announcement('today',pin(profile))]))).children[0];
  expect(child.project.data._audio_voice_url).toEqual(local);expect(child.announcement?.voice.source).toEqual(local);expect(fetch).not.toHaveBeenCalled();
  const after=await counts();expect(after[5]).toEqual(before[5]);
});

it('accepts exactly 2.44 seconds without rounding or truncating the approved source range',async()=>{
  const profile=await createVoice({start:.1,end:2.54}),project=await source();
  const child=(await create(project,input(project,[announcement('today',pin(profile))]))).children[0];
  expect(child.project.data._audio_voice_in_seconds).toBe(.1);expect(child.project.data._audio_voice_out_seconds).toBe(2.54);
});

it.each([
  {label:'too-long',voice:{start:0,end:2.44001},source:{}},
  {label:'intro-before-duck',voice:{start:0,end:1},source:{_audio_voice_intro_offset_seconds:1.8}},
  {label:'intro-after-duck',voice:{start:0,end:1},source:{_audio_voice_intro_offset_seconds:3.4}},
  {label:'outro-before-duck',voice:{start:0,end:1},source:{_audio_voice_outro_offset_seconds:68.4}},
  {label:'outro-after-duck',voice:{start:0,end:1},source:{_audio_voice_outro_offset_seconds:70}},
  {label:'muted-gain',voice:{start:0,end:1},source:{_audio_voice_gain:0}},
])('refuses $label without cutting voice, moving another track or writing a partial batch',async fixture=>{
  const profile=await createVoice(fixture.voice),project=await source(fixture.source as ProjectData),before=await counts();
  await expect(create(project,input(project,[announcement('today',pin(profile))]))).rejects.toMatchObject({status:422});
  expect(await counts()).toEqual(before);expect(await (await call(`/projects/${project.id}`))!.json<Project>()).toEqual(project);
});

it('preserves compatible custom placements and gains instead of silently resetting them',async()=>{
  const profile=await createVoice({start:0,end:1}),project=await source({_audio_voice_intro_offset_seconds:2,_audio_voice_outro_offset_seconds:68.56,_audio_voice_gain:.65,_audio_bed_gain:.8});
  const child=(await create(project,input(project,[announcement('today',pin(profile))]))).children[0];
  expect(child.project.data).toMatchObject({_audio_voice_intro_offset_seconds:2,_audio_voice_outro_offset_seconds:68.56,_audio_voice_gain:.65,_audio_bed_gain:.8,_audio_voice_in_seconds:0,_audio_voice_out_seconds:1});
});

it('retains explicitly selected manual timing in every derived format without moving or trimming a voice',async()=>{
  const profile=await createVoice({start:.125,end:3.625}),project=await source({_studio_ba_voice_fit:'manual',_audio_voice_intro_offset_seconds:2.137,_audio_voice_outro_offset_seconds:65.123,_audio_bed_gain:.8});
  const request=input(project,[announcement('today',{...pin(profile),placement:'manual'},['tv','portrait','vertical'])]);
  const batch=await create(project,request);
  for(const child of batch.children){
    expect(child.project.data).toMatchObject({_studio_ba_voice_fit:'manual',_audio_voice_intro_offset_seconds:2.137,_audio_voice_outro_offset_seconds:65.123,_audio_voice_in_seconds:.125,_audio_voice_out_seconds:3.625,_audio_bed_gain:.8});
    expect(child.announcement?.voice).toMatchObject({placement:'manual',introOffset:2.137,outroOffset:65.123});
    expect(child.warnings.some(warning=>warning.startsWith('Calage personnalisé repris'))).toBe(true);
  }
  expect(await (await call(`/projects/${project.id}`))!.json<Project>()).toEqual(project);
});

it('refuses a manually placed voice outside either animation phase before any batch is created',async()=>{
  const profile=await createVoice({start:0,end:3.5}),project=await source({_studio_ba_voice_fit:'manual',_audio_voice_intro_offset_seconds:7,_audio_voice_outro_offset_seconds:65}),before=await counts();
  await expect(create(project,input(project,[announcement('today',{...pin(profile),placement:'manual'})]))).rejects.toMatchObject({status:422});
  expect(await counts()).toEqual(before);
});

it.each([3.531792,4.04])('fits a complete %s-second voice only with explicit consent, preserving every sample bound and other audio track',async duration=>{
  const profile=await createVoice({start:.123456,end:.123456+duration}),project=await source({_audio_bed_gain:.8,_audio_voice_gain:.7,_media_body_volume:.6,_media_intro_audio_enabled:true});
  const request=input(project,[announcement('today',{mode:'profile',profileId:profile.id,revision:1,placement:'fit-complete'},['tv','portrait','vertical'])]);
  const batch=await create(project,request);
  for(const child of batch.children){
    expect(child.project.data).toMatchObject({_audio_voice_url:audio,_audio_voice_in_seconds:.123456,_audio_voice_out_seconds:.123456+duration,_studio_ba_voice_fit:'fit-complete',_audio_voice_gain:.7,_audio_bed_gain:.8,_media_body_volume:.6});
    expect(Number(child.project.data._audio_voice_intro_offset_seconds)+duration).toBeCloseTo(4.36,12);expect(child.project.data._audio_voice_outro_offset_seconds).toBe(68.48);
    expect(child.project.data._media_body_start_seconds).toBe(project.data._media_body_start_seconds);expect(child.project.data._media_body_end_seconds).toBe(project.data._media_body_end_seconds);
    expect(child.announcement?.voice).toMatchObject({placement:'fit-complete',introOffset:4.36-duration,outroOffset:68.48,start:.123456,end:.123456+duration});
    expect(child.warnings.some(value=>value.includes('mélange à l’écoute'))).toBe(true);
  }
  expect(await (await call(`/projects/${project.id}`))!.json<Project>()).toEqual(project);
  await expect(create(project,{...request,announcements:[announcement('today',pin(profile))]})).rejects.toMatchObject({status:409});
  await expect(create(project,{...request,requestId:crypto.randomUUID(),announcements:[announcement('today',pin(profile))]})).rejects.toMatchObject({status:422});
});

it('refuses a full passage beyond 4.04 seconds even with fit consent and never creates partial drafts',async()=>{
  const profile=await createVoice({start:0,end:4.04001}),project=await source(),before=await counts();
  await expect(create(project,input(project,[announcement('today',{mode:'profile',profileId:profile.id,revision:1,placement:'fit-complete'})]))).rejects.toMatchObject({status:422});
  expect(await counts()).toEqual(before);
});

it('does not inherit complete-voice consent from the source project for a newly selected profile',async()=>{
  const profile=await createVoice({start:0,end:3.5}),project=await source({_studio_ba_voice_fit:'fit-complete'}),before=await counts();
  await expect(create(project,input(project,[announcement('today',pin(profile))]))).rejects.toMatchObject({status:422});
  expect(await counts()).toEqual(before);
});

it.each(['archive','update'])('atomically rejects a profile %s occurring after resolution but before the D1 batch',async change=>{
  const profile=await createVoice(),project=await source(),original=env.DB.batch.bind(env.DB),before=await counts();
  vi.spyOn(env.DB,'batch').mockImplementationOnce(async statements=>{
    if(change==='archive')await call(`/preparation-profiles/${profile.id}/archive`,'POST',{revision:1,archived:true});
    else await call(`/preparation-profiles/${profile.id}`,'PUT',{revision:1,name:'Passage modifié en parallèle',data:{...profile.data,start:.2,end:1.2}});
    return original(statements);
  });
  await expect(create(project,input(project,[announcement('today',pin(profile))]))).rejects.toMatchObject({status:409});
  await noBatchFor(project);
  const after=await counts();for(const index of [0,1,3,4,5])expect(after[index]).toEqual(before[index]);
});

it('rechecks the pinned shared audio inside the transaction, not only during preflight',async()=>{
  const resource=await sharedAudio(),profile=await createVoice({source:resource.asset}),project=await source(),before=await counts(),original=env.DB.batch.bind(env.DB);
  vi.spyOn(env.DB,'batch').mockImplementationOnce(async statements=>{await env.DB.prepare("UPDATE media SET status='failed' WHERE id=?").bind(resource.id).run();return original(statements);});
  await expect(create(project,input(project,[announcement('today',pin(profile))]))).rejects.toMatchObject({status:422});
  expect(await counts()).toEqual(before);await noBatchFor(project);
});

it('replays an existing receipt after voice archival while preserving edited children and original voice metadata',async()=>{
  const profile=await createVoice(),project=await source(),body=input(project,[announcement('today',pin(profile))]),first=await create(project,body),child=first.children[0].project;
  const edited=await (await call(`/projects/${child.id}`,'PUT',{revision:1,title:'Retouche locale du titre',data:{...child.data,_titre_ligne_1:'Retouché'}}))!.json<Project>();
  await call(`/preparation-profiles/${profile.id}/archive`,'POST',{revision:1,archived:true});
  const before=await counts(),prepare=vi.spyOn(env.DB,'prepare');
  const response=(await call(`/projects/${project.id}/derivations`,'POST',body))!,retry=await response.json<DerivationBatch>();
  expect(response.status).toBe(200);expect(retry.id).toBe(first.id);expect(retry.children[0].project).toEqual(edited);
  expect(retry.children[0].announcement).toEqual(first.children[0].announcement);expect(retry.sourceSnapshot).toEqual(first.sourceSnapshot);
  // Channel provenance is checked again; immutable voice data is not resolved again.
  expect(prepare.mock.calls.some(([sql])=>sql.includes('FROM preparation_profiles p JOIN'))).toBe(false);expect(await counts()).toEqual(before);
  await expect(create(project,{...body,requestId:crypto.randomUUID()})).rejects.toMatchObject({status:422});
});

it('includes immutable announcement and voice metadata in batch detail and verified origin',async()=>{
  const profile=await createVoice(),project=await source(),batch=await create(project,input(project,[announcement('today',pin(profile))])),child=batch.children[0];
  const detail=await (await call(`/derivations/${batch.id}`))!.json<DerivationBatch>();expect(detail).toEqual(batch);
  const result=await (await call(`/projects/${child.project.id}/derivation-origin`))!.json<DerivationOrigin>();
  expect(result).toMatchObject({batchId:batch.id,sourceProjectId:project.id,sourceRevision:1,sourceSnapshotSha256:batch.sourceSnapshotSha256,allowedLibraryUrls:[],announcement:child.announcement});
  await expect(env.DB.prepare("UPDATE project_derivations SET announcement_json='{}' WHERE project_id=?").bind(child.project.id).run()).rejects.toThrow('project_derivation_immutable');
});

it('accepts a linked social BA as the next campaign source and preserves its media and source pin',async()=>{
  const project=await source(),socialBatch=await (await call(`/projects/${project.id}/derivations`,'POST',{...input(project),announcements:undefined,targets:['ba-vertical']}))!.json<DerivationBatch>();
  const social=socialBatch.children[0].project,batch=await create(social,input(social,[announcement('tomorrow',{mode:'none'},['tv','portrait'])]));
  expect(batch.sourceProjectId).toBe(social.id);expect(batch.sourceSnapshot.data._studio_format).toBe('vertical');
  expect(batch.children.map(child=>child.project.data._studio_format)).toEqual(['tv','portrait']);
  for(const child of batch.children){expect(child.project.template_id).toBe('BTV_BA_1P');expect(child.project.data._media_body_url).toEqual(social.data._media_body_url);}
  expect(await (await call(`/projects/${social.id}`))!.json<Project>()).toEqual(social);
});

it.each(['private','local'])('resolves one %s voice profile once for three formats with a bounded SQL budget',async kind=>{
  const sourceAsset=kind==='private'?audio:{url:`local-media:${'d'.repeat(64)}:1200`,name:'Trois formats.wav',mimeType:'audio/wav'};
  const profile=await createVoice({source:sourceAsset}),project=await source(),prepare=vi.spyOn(env.DB,'prepare'),fetch=vi.spyOn(globalThis,'fetch');
  const batch=await create(project,input(project,[announcement('today',pin(profile),['tv','portrait','vertical'])]));
  expect(batch.children).toHaveLength(3);expect(batch.children.every(child=>child.announcement?.voice.status==='resolved')).toBe(true);
  expect(prepare.mock.calls.filter(([sql])=>sql.includes('FROM preparation_profiles p JOIN preparation_profile_revisions'))).toHaveLength(1);
  expect(prepare.mock.calls.filter(([sql])=>sql.includes('FROM media'))).toHaveLength(kind==='private'?1:0);
  // Route-level budget: 2N + 6 (including access check) + one grouped voice SELECT + zero/one media SELECT.
  // Three bounded channel checks, independent of target count.
  expect(prepare).toHaveBeenCalledTimes(kind==='private'?17:16);expect(fetch).not.toHaveBeenCalled();
});

it('rolls back receipt, prior children, revisions and activity when a later announcement violates a D1 insert',async()=>{
  const project=await source(),body=input(project),before=await counts();
  await env.DB.exec("CREATE TRIGGER fail_announcement_fixture BEFORE INSERT ON project_derivations WHEN NEW.target_key='ba-today-tv' BEGIN SELECT RAISE(ABORT,'fixture_announcement_insert_failure'); END;");
  try{await expect(create(project,body)).rejects.toMatchObject({status:503});expect(await counts()).toEqual(before);}
  finally{await env.DB.exec('DROP TRIGGER fail_announcement_fixture;');}
  const retry=await create(project,body);expect(retry.childCount).toBe(5);
});
