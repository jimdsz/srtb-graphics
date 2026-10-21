import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,it,expect,inject,vi,afterEach} from 'vitest';
import {api,onRequest} from '../../server/router';
import {authenticateSession} from '../../server/firebase-auth';
import type {Member} from '../../src/studio/domain';
import {DEFAULT_COMMERCIAL_DATA,effectiveCommercialDuration,normalizeCommercialData,createCommercialSequences} from '../../src/studio/commercial/model';
import {COMMERCIAL_EXAMPLE_ASSETS} from '../../src/studio/commercial/example-assets';
import {commercialApi,shareCommercialFile} from '../../src/studio/commercial/api';
import {api as browserApi} from '../../src/studio/api';
import {sessionState} from '../../src/studio/session-state';
import {HttpError,json} from '../../server/http';

const origin='https://studio.example';
const admin:Member={email:'admin@example.com',name:'Admin',role:'admin',active:1};
const first:Member={email:'commercial-one@example.test',name:'Commercial 1',role:'commercial',active:1};
const second:Member={email:'commercial-two@example.test',name:'Commercial 2',role:'commercial',active:1};
const designer:Member={email:'commercial-designer@example.test',name:'Graphiste',role:'designer',active:1};
function request(path:string,method='GET',body?:unknown){return new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
const call=(path:string,method='GET',body?:unknown,member=first)=>api(request('/api/commercial'+path,method,body),env,member);
const graphic=(path:string,method='GET',body?:unknown,member=admin)=>api(request('/api/graphics'+path,method,body),env,member);
async function data(response:Promise<Response|null>){return (await response)!.json<any>();}
async function seedMedia(owner:Member,scope='commercial',mime='audio/wav'){
  const id=crypto.randomUUID(),key='uploads/'+id;await env.MEDIA!.put(key,'0123456789');
  await env.DB.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by,tool_scope) VALUES(?,?,?,?,10,'ready',?,?)").bind(id,key,'Fichier privé',mime,owner.email,scope).run();return id;
}
const audio=(id:string)=>({url:'/api/commercial/media/'+id+'/content',name:'Voix.wav',duration:10,start:0,end:0,delay:3.4,volume:1,loop:false,fadeIn:0,fadeOut:0});
beforeAll(async()=>{
  await applyD1Migrations(env.DB,inject('migrations'));
  for(const member of [first,second,designer])await graphic('/members','POST',{email:member.email,name:member.name,role:member.role,active:true});
});
afterEach(()=>{vi.restoreAllMocks();sessionState.open();});
it('persists the exact bundled example media through create, reload and revision without sharing private projects',async()=>{
  const voice={...audio('unused'),url:COMMERCIAL_EXAMPLE_ASSETS.voice,name:'Voix de l’exemple.wav'};
  const music={...audio('unused'),url:COMMERCIAL_EXAMPLE_ASSETS.music,name:'Musique de l’exemple.wav',volume:.12,delay:0,loop:true};
  const logo={url:COMMERCIAL_EXAMPLE_ASSETS.logo,name:'Bénin TV.png',mode:'original',position:'bottom-right',scale:1,presentation:'adaptive',crop:true,plate:'auto'};
  const created=await data(call('/projects','POST',{title:'Exemple Bénin TV',data:{...DEFAULT_COMMERCIAL_DATA,voice,music,logo}}));
  expect(created.data.voice.url).toBe(COMMERCIAL_EXAMPLE_ASSETS.voice);
  expect(created.data.music).toEqual(music);
  expect(created.data.logo.url).toBe(COMMERCIAL_EXAMPLE_ASSETS.logo);
  expect((await data(call('/projects/'+created.id))).data).toEqual(created.data);
  const changed={...created.data,voice:{...created.data.voice,volume:.6},logo:{...created.data.logo,alignment:'free',offsetY:-60}};
  const saved=await data(call('/projects/'+created.id,'PUT',{title:created.title,revision:created.revision,data:changed}));
  expect(saved.data).toEqual(changed);expect(saved.revision).toBe(2);
  expect((await data(call('/projects/'+saved.id))).data).toEqual(changed);
  const history=await data(call('/projects/'+saved.id+'/revisions'));
  expect(history.map((item:any)=>item.revision)).toEqual([2,1]);
  expect(history[0].data).toEqual(changed);expect(history[1].data).toEqual(created.data);
  for(const suffix of ['', '/revisions'])await expect(call('/projects/'+saved.id+suffix,'GET',undefined,second)).rejects.toMatchObject({status:404});
  await expect(call('/projects/'+saved.id,'PUT',{title:'Autre compte',revision:2,data:changed},second)).rejects.toMatchObject({status:404});
  expect((await data(call('/projects/'+saved.id,'GET',undefined,admin))).data).toEqual(changed);
  // The bundled media are reusable; each new announcement still has its own owner.
  const other=await data(call('/projects','POST',{title:'Ancien exemple privé',data:{...created.data,voice:{...voice,url:COMMERCIAL_EXAMPLE_ASSETS.legacyVoice}}},second));
  expect(other.id).not.toBe(created.id);
  expect((await data(call('/projects/'+other.id,'GET',undefined,second))).data.voice.url).toBe(COMMERCIAL_EXAMPLE_ASSETS.legacyVoice);
  await expect(call('/projects/'+other.id)).rejects.toMatchObject({status:404});
});
it('rejects wrong-kind and almost-matching bundled URLs before changing a project or its history',async()=>{
  const created=await data(call('/projects','POST',{title:'URLs intégrées protégées'}));
  const cases=[
    {kind:'voice',url:COMMERCIAL_EXAMPLE_ASSETS.logo},
    {kind:'music',url:COMMERCIAL_EXAMPLE_ASSETS.logo},
    {kind:'logo',url:COMMERCIAL_EXAMPLE_ASSETS.voice},
    {kind:'logo',url:COMMERCIAL_EXAMPLE_ASSETS.legacyVoice},
    {kind:'logo',url:COMMERCIAL_EXAMPLE_ASSETS.music},
    ...(['voice','music','logo'] as const).flatMap(kind=>{
      const exact=COMMERCIAL_EXAMPLE_ASSETS[kind];
      return [exact+'?v=1',exact+'#fragment',exact+'/',exact+'.bak',exact.replace('/examples/','/examples/../examples/'),exact.replace('/examples/','/EXAMPLES/'),origin+exact,'https://other.example'+exact,'//other.example'+exact].map(url=>({kind,url}));
    }),
    {kind:'voice',url:COMMERCIAL_EXAMPLE_ASSETS.legacyVoice+'?v=1'},
    {kind:'voice',url:'/commercial-assets/examples/other.wav'},
    {kind:'logo',url:'/commercial-assets/examples/other.png'},
  ];
  for(const {kind,url} of cases){
    const source=kind==='logo'?{url,name:'Logo',mode:'original',position:'bottom-right',scale:1}:{...audio('unused'),url};
    const input={...created.data,[kind]:source};
    await expect(call('/projects','POST',{title:'URL refusée',data:input})).rejects.toMatchObject({status:422});
    await expect(call('/projects/'+created.id,'PUT',{title:created.title,revision:1,data:input})).rejects.toMatchObject({status:422});
  }
  expect((await data(call('/projects/'+created.id))).data).toEqual(created.data);
  expect((await data(call('/projects/'+created.id+'/revisions'))).map((item:any)=>item.revision)).toEqual([1]);
});
it('readable modes and adaptive logo settings persist through the real commercial API',async()=>{
  const source='Le public est invité à participer à cette rencontre culturelle. '.repeat(22);
  const input={...DEFAULT_COMMERCIAL_DATA,textMode:'full',sequenceTiming:'auto',sequences:[{id:'readable-source',layout:'central',duration:8,pages:[{title:'COMMUNIQUÉ',body:source}]}],logo:{url:'local-media:'+'a'.repeat(64)+':100',name:'Logo.png',mode:'original',position:'bottom-right',scale:1,presentation:'adaptive',crop:true,plate:'auto'}};
  const saved=await data(call('/projects','POST',{title:'Présentation lisible',data:input}));
  expect(saved.data.textMode).toBe('full');expect(saved.data.sequences[0].pages[0].body).toBe(source);
  expect(saved.data.logo).toMatchObject({presentation:'adaptive',crop:true,plate:'auto'});
  const changed=await data(call('/projects/'+saved.id,'PUT',{title:saved.title,revision:saved.revision,data:{...saved.data,textMode:'summary'}}));
  expect(changed.data.textMode).toBe('summary');
  expect((await data(call('/projects/'+saved.id))).data.sequences[0].pages[0].body).toBe(source);
  await expect(call('/projects','POST',{title:'Mode invalide',data:{...input,textMode:'other'}})).rejects.toMatchObject({status:422});
});
it('persists the showcase logo support through updates, reload and revision history',async()=>{
  const logo={url:'local-media:'+'c'.repeat(64)+':120',name:'Logo.png',mode:'original',position:'bottom-right',scale:1,presentation:'adaptive',crop:true,plate:'showcase'};
  const created=await data(call('/projects','POST',{title:'Présentation du logo',data:{...DEFAULT_COMMERCIAL_DATA,logo}}));
  expect(created.data.logo).toMatchObject({plate:'showcase',presentation:'adaptive',crop:true,position:'bottom-right',scale:1});
  const changed={...created.data,logo:{...created.data.logo,scale:1.5}};
  const saved=await data(call('/projects/'+created.id,'PUT',{title:created.title,revision:1,data:changed}));
  expect((await data(call('/projects/'+saved.id))).data.logo).toMatchObject({plate:'showcase',presentation:'adaptive',crop:true,position:'bottom-right',scale:1.5});
  const history=await data(call('/projects/'+saved.id+'/revisions'));
  expect(history.map((item:any)=>item.revision)).toEqual([2,1]);
  expect(history[0].data.logo).toMatchObject({plate:'showcase',scale:1.5});
  expect(history[1].data.logo).toMatchObject({plate:'showcase',scale:1});
});
it('persists explicit logo background removal and right-side positions while preserving legacy absence',async()=>{
  const logo={url:'local-media:'+'d'.repeat(64)+':140',name:'Logo sur fond.png',mode:'original',position:'top-right',scale:1,presentation:'adaptive',crop:true,plate:'showcase',removeBackground:true};
  const created=await data(call('/projects','POST',{title:'Détourage du logo',data:{...DEFAULT_COMMERCIAL_DATA,logo}}));
  expect(created.data.logo).toMatchObject({removeBackground:true,position:'top-right',presentation:'adaptive',crop:true});
  expect((await data(call('/projects/'+created.id))).data.logo).toEqual(created.data.logo);
  const retained=await data(call('/projects/'+created.id,'PUT',{title:created.title,revision:1,data:{...created.data,logo:{...created.data.logo,removeBackground:false,position:'bottom-right'}}}));
  expect((await data(call('/projects/'+created.id))).data.logo).toMatchObject({removeBackground:false,position:'bottom-right',plate:'showcase'});
  const {removeBackground:omitted,...legacyLogo}=retained.data.logo;
  expect(omitted).toBe(false);
  const legacy=await data(call('/projects/'+created.id,'PUT',{title:created.title,revision:2,data:{...retained.data,logo:legacyLogo}}));
  expect(legacy.data.logo).not.toHaveProperty('removeBackground');
  expect((await data(call('/projects/'+created.id))).data.logo).not.toHaveProperty('removeBackground');
  const history=await data(call('/projects/'+created.id+'/revisions'));
  expect(history.map((item:any)=>item.revision)).toEqual([3,2,1]);
  expect(history[0].data.logo).not.toHaveProperty('removeBackground');
  expect(history[1].data.logo).toMatchObject({removeBackground:false,position:'bottom-right'});
  expect(history[2].data.logo).toMatchObject({removeBackground:true,position:'top-right'});
});
it('rejects non-boolean logo background removal before changing a project or its history',async()=>{
  const logo={url:'local-media:'+'e'.repeat(64)+':160',name:'Logo ancien.png',mode:'original',position:'bottom-right',scale:1};
  const created=await data(call('/projects','POST',{title:'Détourage invalide',data:{...DEFAULT_COMMERCIAL_DATA,logo}}));
  expect(created.data.logo).not.toHaveProperty('removeBackground');
  for(const removeBackground of ['true','false',0,1,null,{},[]]){
    const invalid={...created.data,logo:{...created.data.logo,removeBackground}};
    await expect(call('/projects','POST',{title:created.title,data:invalid})).rejects.toMatchObject({status:422});
    await expect(call('/projects/'+created.id,'PUT',{title:created.title,revision:1,data:invalid})).rejects.toMatchObject({status:422});
  }
  expect((await data(call('/projects/'+created.id))).data).toEqual(created.data);
  expect((await data(call('/projects/'+created.id+'/revisions'))).map((item:any)=>item.revision)).toEqual([1]);
});
it('the actual commercial browser client round-trips /me, audio upload, project saves, history and archive',async()=>{
  sessionState.open();
  vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    const headers=new Headers(init?.headers);headers.set('Origin',origin);
    // Browser fetch supplies the length automatically for the Blob sent by the client.
    if(init?.body instanceof Blob)headers.set('Content-Length',String(init.body.size));
    const req=new Request(new URL(String(input),origin),{...init,headers});
    try{return (await api(req,env,first))??json({error:'Absent'},404);}catch(error){if(error instanceof HttpError)return json({error:error.message},error.status);throw error;}
  });
  expect((await browserApi.me()).role).toBe('commercial');
  const bytes=new Uint8Array([82,73,70,70,4,0,0,0,87,65,86,69]);
  const file=new File([bytes],'Voix navigateur.wav',{type:'audio/wav'}),progress:number[]=[];
  const source=await shareCommercialFile(file,'audio/wav',new AbortController().signal,value=>progress.push(value));expect(source.url).toMatch(/^\/api\/commercial\/media\/[a-f0-9-]{36}\/content$/);expect(progress.at(-1)).toBe(100);
  const voice={...audio('unused'),...source};
  const created=await commercialApi.save(null,'Annonce navigateur',{...DEFAULT_COMMERCIAL_DATA,voice});
  const saved=await commercialApi.save(created,'Annonce modifiée',{...created.data,music:{...voice,volume:.16,loop:true,delay:0}});expect(saved.revision).toBe(2);
  expect((await commercialApi.project(saved.id)).data.music?.volume).toBe(.16);
  expect((await commercialApi.revisions(saved.id)).map(item=>item.revision)).toEqual([2,1]);
  expect((await commercialApi.projects()).projects.map(item=>item.id)).toContain(saved.id);
  expect((await commercialApi.media()).some(item=>source.url.includes(item.id))).toBe(true);
  const archived=await commercialApi.archive(saved,true);expect((await commercialApi.projects(true)).projects.map(item=>item.id)).toContain(saved.id);
  await expect(commercialApi.remove(saved)).rejects.toMatchObject({status:409});
  expect(await commercialApi.remove(archived)).toEqual({deleted:true});
  await expect(commercialApi.project(saved.id)).rejects.toMatchObject({status:404});
  expect((await commercialApi.media()).some(item=>source.url.includes(item.id))).toBe(true);
  await expect(browserApi.catalogue()).rejects.toMatchObject({status:403});
  sessionState.end('expired');await expect(commercialApi.projects()).rejects.toMatchObject({status:401});
});
it('creates commercial membership without Graphics channel access and exposes its effective role',async()=>{
  const row=await env.DB.prepare('SELECT role,tool_scope FROM members WHERE email=?').bind(first.email).first();expect(row).toEqual({role:'designer',tool_scope:'commercial'});
  expect((await env.DB.prepare('SELECT * FROM channel_members WHERE email=?').bind(first.email).all()).results).toEqual([]);
  expect((await data(graphic('/members'))).find((m:Member)=>m.email===first.email).role).toBe('commercial');
  await expect(graphic('/channels/benin-tv/members','POST',{email:first.email,allowed:true})).rejects.toMatchObject({status:404});
});
it('denies all Graphics routes to commercial accounts and all commercial routes to Graphics-only accounts',async()=>{
  for(const path of ['/projects','/media','/channels','/members','/activity','/templates','/planner','/members/deletion'])await expect(graphic(path,'GET',undefined,first)).rejects.toMatchObject({status:403});
  for(const role of ['designer','broadcaster'] as const)for(const path of ['/projects','/media','/templates'])await expect(call(path,'GET',undefined,{...designer,role})).rejects.toMatchObject({status:403});
  await expect(call('/projects','GET',undefined,{...first,active:0})).rejects.toMatchObject({status:403});
  await expect(api(new Request(origin+'/api/commercial/projects',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'}),env,first)).rejects.toMatchObject({status:403});
});
it('isolates announcements by creator even when the second creator guesses an ID',async()=>{
  const p=await data(call('/projects','POST',{title:'Annonce confidentielle'}));
  expect((await data(call('/projects'))).projects.map((v:any)=>v.id)).toContain(p.id);
  expect((await data(call('/projects','GET',undefined,second))).projects.map((v:any)=>v.id)).not.toContain(p.id);
  for(const [suffix,method,body] of [['','GET',undefined],['','PUT',{title:'Vol',revision:1,data:p.data}],['','DELETE',{revision:1}],['/revisions','GET',undefined],['/archive','POST',{revision:1,archived:true}]] as const)await expect(call('/projects/'+p.id+suffix,method,body,second)).rejects.toMatchObject({status:404});
  expect((await data(call('/projects/'+p.id,'GET',undefined,admin))).title).toBe(p.title);
});
it('deletes only the owned announcement and its history, retaining shared private media and sibling projects',async()=>{
  const mediaId=await seedMedia(first),voice=audio(mediaId);
  const p=await data(call('/projects','POST',{title:'À supprimer',data:{...DEFAULT_COMMERCIAL_DATA,voice}}));
  const sibling=await data(call('/projects','POST',{title:'Copie à conserver',data:p.data}));
  const saved=await data(call('/projects/'+p.id,'PUT',{title:'Version récente',revision:p.revision,data:p.data}));
  const before=await data(call('/projects/'+p.id+'/revisions'));
  await expect(call('/projects/'+p.id,'DELETE',{revision:p.revision})).rejects.toMatchObject({status:409});
  expect(await data(call('/projects/'+p.id+'/revisions'))).toEqual(before);
  expect(await env.DB.prepare("SELECT * FROM activity WHERE target=? AND action='commercial.deleted'").bind(p.id).first()).toBeNull();
  expect(await data(call('/projects/'+p.id,'DELETE',{revision:saved.revision}))).toEqual({deleted:true});
  await expect(call('/projects/'+p.id)).rejects.toMatchObject({status:404});
  expect((await env.DB.prepare('SELECT * FROM commercial_revisions WHERE project_id=?').bind(p.id).all()).results).toEqual([]);
  expect((await data(call('/projects'))).projects.map((item:any)=>item.id)).not.toContain(p.id);
  expect((await data(call('/projects/'+sibling.id))).data.voice).toEqual(voice);
  expect((await data(call('/projects/'+sibling.id+'/revisions'))).length).toBe(1);
  expect((await call('/media/'+mediaId+'/content'))!.status).toBe(200);
  expect(await env.MEDIA!.head('uploads/'+mediaId)).not.toBeNull();
  expect(await env.DB.prepare("SELECT actor,action,detail FROM activity WHERE target=? AND action='commercial.deleted'").bind(p.id).first()).toEqual({actor:first.email,action:'commercial.deleted',detail:saved.title});
  await expect(call('/projects/'+p.id,'DELETE',{revision:saved.revision})).rejects.toMatchObject({status:404});
});
it('allows admin deletion of archived announcements and rejects unauthorized or malformed deletion',async()=>{
  const p=await data(call('/projects','POST',{title:'Archive administrée'}));
  const archived=await data(call('/projects/'+p.id+'/archive','POST',{revision:1,archived:true}));
  for(const member of [second])await expect(call('/projects/'+p.id,'DELETE',{revision:archived.revision},member)).rejects.toMatchObject({status:404});
  for(const role of ['designer','broadcaster'] as const)await expect(call('/projects/'+p.id,'DELETE',{revision:archived.revision},{...designer,role})).rejects.toMatchObject({status:403});
  await expect(call('/projects/'+p.id,'DELETE',{revision:archived.revision},{...first,active:0})).rejects.toMatchObject({status:403});
  await expect(graphic('/projects/'+p.id,'DELETE',{revision:archived.revision},first)).rejects.toMatchObject({status:403});
  await expect(api(new Request(origin+'/api/commercial/projects/'+p.id,{method:'DELETE',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify({revision:archived.revision})}),env,first)).rejects.toMatchObject({status:403});
  for(const body of [{},{revision:0},{revision:1.5},{revision:'2'},{revision:2,force:true}])await expect(call('/projects/'+p.id,'DELETE',body)).rejects.toThrow();
  expect((await data(call('/projects/'+p.id+'/revisions'))).length).toBe(2);
  expect(await data(call('/projects/'+p.id,'DELETE',{revision:archived.revision},admin))).toEqual({deleted:true});
  expect((await data(call('/projects?archived=1'))).projects.map((item:any)=>item.id)).not.toContain(p.id);
  expect(await env.DB.prepare("SELECT actor FROM activity WHERE target=? AND action='commercial.deleted'").bind(p.id).first()).toEqual({actor:admin.email});
});
it('rolls back the history and audit when the announcement delete fails inside the D1 transaction',async()=>{
  const p=await data(call('/projects','POST',{title:'Suppression atomique'}));
  const before=await data(call('/projects/'+p.id+'/revisions'));
  await env.DB.exec("CREATE TRIGGER commercial_test_delete_failure BEFORE DELETE ON commercial_projects BEGIN SELECT RAISE(ABORT,'test_delete_failure'); END;");
  try{
    await expect(call('/projects/'+p.id,'DELETE',{revision:p.revision})).rejects.toThrow('test_delete_failure');
    expect((await data(call('/projects/'+p.id))).revision).toBe(p.revision);
    expect(await data(call('/projects/'+p.id+'/revisions'))).toEqual(before);
    expect(await env.DB.prepare("SELECT * FROM activity WHERE target=? AND action='commercial.deleted'").bind(p.id).first()).toBeNull();
  }finally{await env.DB.exec('DROP TRIGGER commercial_test_delete_failure;');}
});
it('saves independent audio choices, volume, revision history and archive with optimistic conflicts',async()=>{
  const voice=audio(await seedMedia(first)),music={...audio(await seedMedia(first)),delay:0,volume:.12,loop:true};
  const p=await data(call('/projects','POST',{title:'Annonce audio',data:{...DEFAULT_COMMERCIAL_DATA,voice,music}}));
  expect(p.data.voice).toEqual(voice);expect(p.data.music).toEqual(music);
  const updated=await data(call('/projects/'+p.id,'PUT',{title:p.title,revision:1,data:{...p.data,music:{...music,volume:.3}}}));expect(updated.revision).toBe(2);
  await expect(call('/projects/'+p.id,'PUT',{title:p.title,revision:1,data:p.data})).rejects.toMatchObject({status:409});
  expect((await data(call('/projects/'+p.id+'/revisions'))).map((r:any)=>r.data.music.volume)).toEqual([.3,.12]);
  expect((await data(call('/projects','POST',{title:'Annonce suivante'}))).data.voice).toBeNull();
  const archived=await data(call('/projects/'+p.id+'/archive','POST',{revision:2,archived:true}));expect(archived.archived).toBe(1);
  await expect(call('/projects/'+p.id,'PUT',{title:p.title,revision:3,data:p.data})).rejects.toMatchObject({status:409});
  expect((await data(call('/projects?archived=1'))).projects.map((v:any)=>v.id)).toContain(p.id);
  expect((await data(call('/projects/'+p.id+'/archive','POST',{revision:3,archived:false}))).revision).toBe(4);
});
it('persists voice-driven duration and all appearance settings without truncation or weakened ownership',async()=>{
  const voice={...audio(await seedMedia(first)),duration:142.4,start:11.2,end:132.05,delay:5.5};
  const logo={url:'/api/commercial/media/'+await seedMedia(first,'commercial','image/png')+'/content',name:'Annonceur.png',mode:'monochrome',position:'bottom-right',scale:3.2,opacity:.7,offsetX:-160,offsetY:120,plate:'white',motion:'slide',delay:1.5};
  const style={titleScale:1.2,bodyScale:.85,lineHeight:1.3,tracking:.05,align:'center',titleColor:'#abcdef',bodyColor:'#123456',titleFont:'benin',bodyFont:'local-font:'+'a'.repeat(64),titleFontName:'',bodyFontName:'Police locale.otf',titleBold:true,bodyBold:false,titleItalic:false,bodyItalic:true,titleCase:'upper',bodyCase:'lower',titleX:12,titleY:-8,bodyX:-16,bodyY:9,titleRotation:-3,bodyRotation:5};
  const input={...DEFAULT_COMMERCIAL_DATA,duration:38.25,voice,logo,pages:DEFAULT_COMMERCIAL_DATA.pages.map(page=>({...page,style})),signatureEnabled:false,signatureVolume:.6};
  const created=await data(call('/projects','POST',{title:'Voix longue et apparence',data:input}));
  expect(created.data.durationMode).toBe('voice');expect(created.data.duration).toBe(38.25);
  expect(created.data.voice).toEqual(voice);expect(created.data.logo).toEqual(logo);
  expect(created.data.pages.map((page:any)=>page.style)).toEqual([style,style,style,style]);
  expect(effectiveCommercialDuration(created.data)).toBeGreaterThan(129);
  expect((await data(call('/projects/'+created.id))).data).toEqual(created.data);
  const updated=await data(call('/projects/'+created.id,'PUT',{title:created.title,revision:1,data:{...created.data,voice:null,duration:123.456}}));
  expect(updated.data.durationMode).toBe('manual');expect(effectiveCommercialDuration(updated.data)).toBe(123.456);
  expect((await data(call('/projects/'+created.id+'/revisions')))[1].data).toEqual(created.data);
  const archived=await data(call('/projects/'+created.id+'/archive','POST',{revision:2,archived:true}));
  expect(archived.data).toEqual(updated.data);
  await expect(call('/projects/'+created.id,'GET',undefined,second)).rejects.toMatchObject({status:404});
  for(const duration of [14.99,600.001])await expect(call('/projects','POST',{title:'Durée hors limites',data:{...DEFAULT_COMMERCIAL_DATA,duration}})).rejects.toMatchObject({status:422});
  for(const duration of [15,600])expect((await data(call('/projects','POST',{title:'Durée manuelle limite',data:{...DEFAULT_COMMERCIAL_DATA,duration}}))).data.duration).toBe(duration);
  await expect(call('/projects','POST',{title:'Voix trop longue',data:{...DEFAULT_COMMERCIAL_DATA,voice:{...voice,duration:700,start:0,end:0}}})).rejects.toMatchObject({status:422});
  for(const patch of [{bodyFont:'https://other.example/font.otf'},{bodyFont:'local-font:invalide'},{bodyFontName:'<script>'},{titleRotation:46},{bodyX:201},{titleBold:'true'}])await expect(call('/projects','POST',{title:'Style interdit',data:{...DEFAULT_COMMERCIAL_DATA,pages:DEFAULT_COMMERCIAL_DATA.pages.map(page=>({...page,style:{...style,...patch}}))}})).rejects.toMatchObject({status:422});
});
it('reads, upgrades and archives legacy drafts without changing old revision data',async()=>{
  const id=crypto.randomUUID(),voice=audio(await seedMedia(first));
  const logo={url:'/api/commercial/media/'+await seedMedia(first,'commercial','image/png')+'/content',name:'Ancien logo.png',mode:'original',position:'top-right',scale:1};
  const legacy={issuer:'Ancienne annonce',pages:DEFAULT_COMMERCIAL_DATA.pages.map(({title,body})=>({title,body})),theme:'beige',duration:75,voice,music:null,logo,demo:false};
  await env.DB.prepare('INSERT INTO commercial_projects(id,title,data_json,created_by,updated_by) VALUES(?,?,?,?,?)').bind(id,'Ancienne version',JSON.stringify(legacy),first.email,first.email).run();
  const loaded=await data(call('/projects/'+id));expect(loaded.data).toEqual(legacy);
  const normalized=normalizeCommercialData(loaded.data);
  expect(normalized).not.toHaveProperty('sequences');expect(normalized).not.toHaveProperty('sequenceTiming');
  expect(normalized.durationMode).toBe('voice');expect(normalized.duration).toBe(75);expect(normalized.voice).toEqual(voice);
  expect(normalized.signatureEnabled).toBe(true);expect(normalized.signatureVolume).toBe(1);
  expect(normalized.logo).toEqual({...logo,opacity:1,offsetX:0,offsetY:0,plate:'none',motion:'fade',delay:0});
  const saved=await data(call('/projects/'+id,'PUT',{title:loaded.title,revision:1,data:loaded.data}));
  expect(saved.data).toEqual(normalized);
  const revisions=await data(call('/projects/'+id+'/revisions'));
  expect(revisions[0].data).toEqual(normalized);expect(revisions[1].data).toEqual(legacy);
  expect((await data(call('/projects/'+id+'/archive','POST',{revision:2,archived:true}))).data).toEqual(normalized);
  const restored=await data(call('/projects/'+id+'/archive','POST',{revision:3,archived:false}));
  expect(restored.data).toEqual(normalized);expect(restored.revision).toBe(4);
});
it('persists, reorders, duplicates and archives editable sequences independently while preserving old history',async()=>{
  const base=createCommercialSequences(normalizeCommercialData(DEFAULT_COMMERCIAL_DATA));
  const page={title:'Offre commerciale',body:'Une annonce différente à chaque séquence.',style:{...base.sequences![0].pages[0].style!,bodyItalic:true,titleColor:'#bbaa66',bodyX:24}};
  const input={...base,issuer:'',sequenceTiming:'manual' as const,sequences:[
    {id:'opening',layout:'central' as const,duration:8.5,pages:[page]},
    {id:'offers',layout:'columns' as const,duration:12,pages:[{...page,title:'Offre gauche'},{...page,title:'Offre droite'}]},
    {id:'left-only',layout:'left' as const,duration:7,pages:[{...page,title:'Informations'}]},
    {id:'right-only',layout:'right' as const,duration:9,pages:[{...page,title:'Contacts'}]},
    {id:'closing',layout:'final' as const,duration:6,pages:[{...page,title:'À bientôt'}]},
  ]};
  const created=await data(call('/projects','POST',{title:'Annonce à cinq séquences',data:input}));
  expect(created.data).toEqual(normalizeCommercialData(input));
  expect((await data(call('/projects/'+created.id))).data.sequences).toEqual(created.data.sequences);
  const changed={...created.data,sequenceTiming:'auto',sequences:[...created.data.sequences].reverse().map((sequence:any)=>({...sequence,pages:sequence.pages.map((page:any)=>({...page,body:page.body+' Modifié.'}))}))};
  const saved=await data(call('/projects/'+created.id,'PUT',{title:created.title,revision:1,data:changed}));
  expect(saved.data.sequences.map((sequence:any)=>sequence.id)).toEqual(['closing','right-only','left-only','offers','opening']);
  expect(saved.data.sequenceTiming).toBe('auto');
  const revisions=await data(call('/projects/'+created.id+'/revisions'));
  expect(revisions[0].data).toEqual(saved.data);expect(revisions[1].data).toEqual(created.data);
  const copy=await data(call('/projects','POST',{title:'Copie des séquences',data:saved.data}));
  expect(copy.id).not.toBe(created.id);expect(copy.revision).toBe(1);expect(copy.data).toEqual(saved.data);
  const archived=await data(call('/projects/'+created.id+'/archive','POST',{revision:saved.revision,archived:true}));
  expect(archived.data).toEqual(saved.data);
  expect(await data(call('/projects/'+created.id,'DELETE',{revision:archived.revision}))).toEqual({deleted:true});
  expect((await data(call('/projects/'+copy.id))).data).toEqual(saved.data);
  expect((await data(call('/projects/'+copy.id+'/revisions'))).length).toBe(1);
  await expect(call('/projects/'+copy.id,'GET',undefined,second)).rejects.toMatchObject({status:404});
  const foreignVoice=audio(await seedMedia(second));
  await expect(call('/projects','POST',{title:'Séquences et voix étrangère',data:{...input,voice:foreignVoice}})).rejects.toMatchObject({status:422});
});
it('rejects malformed sequences before normalizing or writing their history',async()=>{
  const base=createCommercialSequences(normalizeCommercialData(DEFAULT_COMMERCIAL_DATA)),sequence=base.sequences![0];
  const created=await data(call('/projects','POST',{title:'Séquences protégées',data:base}));
  const badSequences=[[],[sequence,sequence],[{...sequence,id:'../bad'}],[{...sequence,layout:'unknown'}],[{...sequence,layout:'columns',pages:[sequence.pages[0]]}],[{...sequence,duration:2.99}],[{...sequence,duration:600}],Array.from({length:33},(_,index)=>({...sequence,id:'s'+index,duration:3})),[{...sequence,pages:[{...sequence.pages[0],style:{bodyFont:'https://other.example/font.otf'}}]}]];
  for(const sequences of badSequences)await expect(call('/projects/'+created.id,'PUT',{title:created.title,revision:1,data:{...base,sequences}})).rejects.toMatchObject({status:422});
  await expect(call('/projects/'+created.id,'PUT',{title:created.title,revision:1,data:{...base,sequenceTiming:'unknown'}})).rejects.toMatchObject({status:422});
  expect((await data(call('/projects/'+created.id))).data).toEqual(created.data);
  expect((await data(call('/projects/'+created.id+'/revisions'))).length).toBe(1);
});
it('rejects foreign, unavailable and wrong-kind audio, unsafe URLs and forbidden logo positions',async()=>{
  const foreign=await seedMedia(second),graphics=await seedMedia(first,'graphics'),image=await seedMedia(first,'commercial','image/png');
  for(const id of [foreign,graphics,image,crypto.randomUUID()])await expect(call('/projects','POST',{title:'Interdit',data:{...DEFAULT_COMMERCIAL_DATA,voice:audio(id)}})).rejects.toMatchObject({status:422});
  for(const url of ['https://evil.test/a.wav','/api/graphics/media/'+graphics+'/content','blob:temporary','local-media:bad:100','/commercial-assets/../library/private.wav'])await expect(call('/projects','POST',{title:'Interdit',data:{...DEFAULT_COMMERCIAL_DATA,voice:{...audio(foreign),url}}})).rejects.toMatchObject({status:422});
  await expect(call('/projects','POST',{title:'Coin réservé',data:{...DEFAULT_COMMERCIAL_DATA,logo:{url:'/api/commercial/media/'+image+'/content',name:'Logo',mode:'original',position:'top-left',scale:1}}})).rejects.toMatchObject({status:422});
  const local={...audio(foreign),url:'local-media:'+'a'.repeat(64)+':1024'};
  expect((await data(call('/projects','POST',{title:'Local vérifié',data:{...DEFAULT_COMMERCIAL_DATA,voice:local}}))).data.voice.url).toBe(local.url);
});
it('isolates media lists, metadata, bytes, range access and multipart ownership',async()=>{
  const own=await seedMedia(first),other=await seedMedia(second),graphics=await seedMedia(designer,'graphics');
  const listed=await data(call('/media'));expect(listed.map((v:any)=>v.id)).toContain(own);expect(listed.map((v:any)=>v.id)).not.toContain(other);expect(listed.map((v:any)=>v.id)).not.toContain(graphics);
  for(const id of [other,graphics])for(const suffix of ['', '/content','/complete','/cancel','/part/1'])await expect(call('/media/'+id+suffix,suffix==='/part/1'?'PUT':suffix==='/complete'||suffix==='/cancel'?'POST':'GET')).rejects.toMatchObject({status:404});
  expect((await graphic('/media','GET',undefined,designer))!.status).toBe(200);
  expect((await data(graphic('/media'))).map((v:any)=>v.id)).not.toContain(own);
  await expect(graphic('/media/'+own+'/content')).rejects.toMatchObject({status:404});
  const rangeRequest=new Request(origin+'/api/commercial/media/'+own+'/content',{headers:{Range:'bytes=2-5'}}),r=(await api(rangeRequest,env,first))!;expect(r.status).toBe(206);expect(new TextDecoder().decode(await r.arrayBuffer())).toBe('2345');
  expect((await call('/media/'+own+'/content','HEAD'))!.headers.get('Content-Length')).toBe('10');
  expect((await call('/media/'+other+'/content','GET',undefined,admin))!.status).toBe(200);
});
it('keeps the existing multipart upload engine with commercial URLs and no cross-account continuation',async()=>{
  const bytes=new Uint8Array([82,73,70,70,4,0,0,0,87,65,86,69]);
  const upload=await data(call('/media','POST',{name:'Nouvelle voix.wav',mimeType:'audio/wav',bytes:bytes.length,consent:true}));
  const part=new Request(origin+'/api/commercial/media/'+upload.id+'/part/1',{method:'PUT',headers:{Origin:origin,'Content-Length':String(bytes.length)},body:bytes});
  expect((await api(part,env,first))!.status).toBe(200);
  await expect(call('/media/'+upload.id+'/complete','POST',undefined,second)).rejects.toMatchObject({status:404});
  const completed=await data(call('/media/'+upload.id+'/complete','POST'));expect(completed.url).toBe('/api/commercial/media/'+upload.id+'/content');
  expect((await data(call('/media/'+upload.id))).created_by).toBe(first.email);
});
it('resolves the commercial role from session storage and blocks private Graphics static assets at the Worker boundary',async()=>{
  const token='b'.repeat(64),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),n=>n.toString(16).padStart(2,'0')).join('');
  await env.DB.prepare('UPDATE members SET firebase_uid=? WHERE email=?').bind('commercial-uid',first.email).run();
  await env.DB.prepare('INSERT INTO app_sessions(token_hash,email,firebase_uid,expires_at,created_at) VALUES(?,?,?,?,?)').bind(hash,first.email,'commercial-uid',Date.now()+3600000,Date.now()).run();
  const firebaseEnv={...env,AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'srtb-graphics',FIREBASE_API_KEY:'AIza'+'a'.repeat(35)} as Env;
  const req=(path:string)=>new Request(origin+path,{headers:{Cookie:'__Host-srtb_session='+token}});
  expect((await authenticateSession(req('/api/me'),firebaseEnv)).role).toBe('commercial');
  for(const path of ['/library/v1.7.0/BTV_BA_1P/index.html','/preview-media/private.wav','/api/graphics/templates']){
    const result=await onRequest({request:req(path),env:firebaseEnv,params:{},data:{},functionPath:'/',waitUntil:()=>{},passThroughOnException:()=>{},next:async()=>new Response('private bytes')} as any);expect(result.status).toBe(403);expect(await result.text()).not.toContain('private bytes');
  }
  const asset=await onRequest({request:req('/commercial-assets/background.webp'),env:firebaseEnv,params:{},data:{},functionPath:'/',waitUntil:()=>{},passThroughOnException:()=>{},next:async()=>new Response('commercial bytes')} as any);expect(asset.status).toBe(200);
  for(const path of Object.values(COMMERCIAL_EXAMPLE_ASSETS)){
    const next=vi.fn(async()=>new Response('bundled example bytes'));
    const context={env:firebaseEnv,params:{},data:{},functionPath:'/',waitUntil:()=>{},passThroughOnException:()=>{},next};
    const anonymous=await onRequest({...context,request:new Request(origin+path)} as any);
    expect(anonymous.status).toBe(401);expect(next).not.toHaveBeenCalled();
    const authenticated=await onRequest({...context,request:req(path)} as any);
    expect(authenticated.status).toBe(200);expect(await authenticated.text()).toBe('bundled example bytes');
  }
  await graphic('/members','POST',{email:first.email,name:first.name,role:'designer',active:true});
  await expect(authenticateSession(req('/api/me'),firebaseEnv)).rejects.toMatchObject({status:401});
  expect(await env.DB.prepare('SELECT channel_id FROM channel_members WHERE email=?').bind(first.email).first()).toEqual({channel_id:'benin-tv'});
});
