import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,it,expect,inject} from 'vitest';
import {api} from '../../server/router';
import type {Member} from '../../src/studio/domain';
const origin='https://studio.example';
const admin:Member={email:'admin@example.com',name:'Admin',role:'admin',active:1};
const editor:Member={email:'channel-editor@example.test',name:'Équipe',role:'designer',active:1};
const outsider:Member={email:'channel-outsider@example.test',name:'Autre équipe',role:'broadcaster',active:1};
const call=(path:string,method='GET',body?:unknown,channel='benin-tv',member=admin)=>api(new Request(origin+'/api/graphics'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-SRTB-Channel':channel},body:body===undefined?undefined:JSON.stringify(body)}),env,member);
let channel:string;
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));for(const m of [editor,outsider])await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,?,?)').bind(m.email,m.name,m.role,m.active,admin.email).run();channel=(await(await call('/channels','POST',{name:'Chaîne de recette',accent:'#AA2233',timezone:'Africa/Porto-Novo'}))!.json<{id:string}>()).id;await call(`/channels/${channel}/members`,'POST',{email:editor.email,allowed:true});});
it('creates Alafia and Kids as separate empty spaces, without silently granting team access',async()=>{
 for(const name of ['Bénin TV Alafia','Bénin TV Kids']){
  const created=await(await call('/channels','POST',{name,accent:'#EFBD32',timezone:'Africa/Porto-Novo'}))!.json<{id:string}>();
  for(const path of ['/templates','/media','/programmes'])expect(await(await call(path,'GET',undefined,created.id))!.json()).toEqual([]);
  expect((await(await call('/projects','GET',undefined,created.id))!.json<{projects:unknown[]}>()).projects).toEqual([]);
  await expect(call('/templates','GET',undefined,created.id,editor)).rejects.toMatchObject({status:404});
 }
 await expect(call('/channels','POST',{name:' BENIN TV  ALAFIA ',accent:'#EFBD32',timezone:'UTC'})).rejects.toMatchObject({status:409});
});
it('serialises concurrent channel creation and prevents duplicate identity renames',async()=>{
 const results=await Promise.allSettled([1,2].map(()=>call('/channels','POST',{name:'Chaîne concurrente',accent:'#EFBD32',timezone:'UTC'})));
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect(results.find(result=>result.status==='rejected')).toMatchObject({reason:{status:409}});
 const names=await env.DB.prepare("SELECT id FROM channels WHERE name_key='chaine concurrente'").all();expect(names.results).toHaveLength(1);
 await expect(call(`/channels/${channel}`,'PUT',{revision:1,data:{name:'BÉNIN TV KIDS',logo:'',accent:'#EFBD32',timezone:'UTC'}})).rejects.toMatchObject({status:409});
});
it('creates an empty authorised channel without copying BTV templates or media',async()=>{expect(await(await call('/templates','GET',undefined,channel,editor))!.json()).toEqual([]);expect(await(await call('/media','GET',undefined,channel,editor))!.json()).toEqual([]);await expect(call('/projects','POST',{title:'Interdit',templateId:'BTV_BA_1P'},channel,editor)).rejects.toMatchObject({status:422});expect((await(await call('/channels','GET',undefined,'invalid',editor))!.json<Array<{id:string}>>()).map(c=>c.id)).toContain(channel);});
it('enforces channel membership server-side even for a broadcaster',async()=>{for(const path of ['/templates','/projects','/media','/planner?kind=plan','/programmes','/search?q=programme'])await expect(call(path,'GET',undefined,channel,outsider)).rejects.toMatchObject({status:404});await expect(call('/channels','POST',{name:'Non',accent:'#AAAAAA',timezone:'UTC'},'benin-tv',editor)).rejects.toMatchObject({status:403});});
it('isolates programme records and revisions, with optimistic concurrency',async()=>{const data={name:'Le journal',aliases:['JT'],category:'Information',replayUrl:'',recurring:true,recipe:[],notes:'Garder l’habillage permanent',directoryIds:[],voiceProfileId:null};const p=await(await call('/programmes','POST',{revision:0,data},channel,admin))!.json<{id:string;revision:number}>();expect(p.revision).toBe(1);expect(await(await call('/programmes'))!.json()).toEqual([]);await expect(call(`/programmes/${p.id}`,'PUT',{revision:1,data},'benin-tv')).rejects.toMatchObject({status:404});await call(`/programmes/${p.id}`,'PUT',{revision:1,data:{...data,name:'JT national'}},channel,editor);await expect(call(`/programmes/${p.id}`,'PUT',{revision:1,data},channel,editor)).rejects.toMatchObject({status:409});expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM programme_revisions WHERE programme_id=?').bind(p.id).first<{n:number}>())!.n).toBe(2);});
it('does not permit attaching another channel’s shared voice, directory or media',async()=>{const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO planner_documents(id,kind,name,data_json,created_by,updated_by) VALUES(?,'directory','Dossier','{}',?,?)").bind(id,admin.email,admin.email).run();await expect(call('/programmes','POST',{revision:0,data:{name:'Essai',aliases:[],category:'',replayUrl:'',recurring:false,recipe:[],notes:'',directoryIds:[id],voiceProfileId:null}},channel,editor)).rejects.toMatchObject({status:422});});
it('search never reveals private projects to another creator',async()=>{const created=await(await call('/projects','POST',{title:'Recherche confidentielle',templateId:'BTV_BA_1P'},'benin-tv',editor))!.json<{id:string}>();const own=await(await call('/search?q=confidentielle','GET',undefined,'benin-tv',editor))!.json<{projects:Array<{id:string}>}>();expect(own.projects.map(p=>p.id)).toContain(created.id);const other={...outsider,role:'designer' as const};expect((await(await call('/search?q=confidentielle','GET',undefined,'benin-tv',other))!.json<{projects:unknown[]}>()).projects).toEqual([]);expect((await(await call('/search?q=confidentielle','GET',undefined,channel,editor))!.json<{projects:unknown[]}>()).projects).toEqual([]);});
it('revoking membership closes subsequent access without changing project visibility',async()=>{await call(`/channels/${channel}/members`,'POST',{email:editor.email,allowed:false});await expect(call('/programmes','GET',undefined,channel,editor)).rejects.toMatchObject({status:404});await call(`/channels/${channel}/members`,'POST',{email:editor.email,allowed:true});});
it('updates channel identity only for administrators with revision and same-channel images',async()=>{
 const id=crypto.randomUUID(),foreign=crypto.randomUUID();
 for(const [mediaId,scope]of [[id,channel],[foreign,'benin-tv']])await env.DB.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by,channel_id) VALUES(?,?,?,'image/png',512,'ready',?,?)").bind(mediaId,mediaId,'Logo',admin.email,scope).run();
 const data={name:'Identité de recette',accent:'#AABBCC',timezone:'Africa/Porto-Novo',logo:`/api/graphics/media/${id}/content`};
 await expect(call(`/channels/${channel}`,'PUT',{revision:1,data},channel,editor)).rejects.toMatchObject({status:403});
 await expect(call(`/channels/${channel}`,'PUT',{revision:1,data:{...data,logo:`/api/graphics/media/${foreign}/content`}})).rejects.toMatchObject({status:422});
 const saved=await(await call(`/channels/${channel}`,'PUT',{revision:1,data}))!.json<{revision:number;logo:string}>();expect(saved.revision).toBe(2);expect(saved.logo).toBe(data.logo);
 await expect(call(`/channels/${channel}`,'PUT',{revision:1,data})).rejects.toMatchObject({status:409});
 expect(await(await call('/templates','GET',undefined,channel,editor))!.json()).toEqual([]);
});
it('programme resources must exist with the correct kind and cannot invent a revision',async()=>{
 const data={name:'Références',aliases:[],category:'',replayUrl:'',recurring:false,recipe:[],notes:'',directoryIds:[],voiceProfileId:null};
 await expect(call('/programmes','POST',{revision:4,data})).rejects.toMatchObject({status:409});
 await expect(call('/programmes','POST',{revision:0,data:{...data,voiceProfileId:crypto.randomUUID()}})).rejects.toMatchObject({status:422});
 await expect(call('/programmes','POST',{revision:0,data:{...data,directoryIds:[crypto.randomUUID()]}})).rejects.toMatchObject({status:422});
 const wrong=crypto.randomUUID();await env.DB.prepare("INSERT INTO planner_documents(id,kind,name,data_json,created_by,updated_by) VALUES(?,'plan','Pas un dossier','{}',?,?)").bind(wrong,admin.email,admin.email).run();
 await expect(call('/programmes','POST',{revision:0,data:{...data,directoryIds:[wrong]}})).rejects.toMatchObject({status:422});
 await expect(call('/programmes','POST',{revision:0,data:{...data,logo:`/api/graphics/media/${crypto.randomUUID()}/content`}})).rejects.toMatchObject({status:422});
});
it('requires reviewer approval for programme automation while preserving designer metadata edits',async()=>{
 const data={name:'Magazine de recette',aliases:[],category:'',replayUrl:'',recurring:false,recipe:[],notes:'',directoryIds:[],voiceProfileId:null};
 for(const automation of [{recurring:true},{recipe:['ba']}])await expect(call('/programmes','POST',{revision:0,data:{...data,...automation}},'benin-tv',editor)).rejects.toMatchObject({status:403});
 const saved=await(await call('/programmes','POST',{revision:0,data:{...data,recipe:['ba']}},'benin-tv',admin))!.json<{id:string}>();
 const path=`/programmes/${saved.id}`;
 await expect(call(path,'PUT',{revision:1,data},'benin-tv',editor)).rejects.toMatchObject({status:403});
 await expect(call(path,'PUT',{revision:1,data:{...data,recurring:true,recipe:['ba']}},'benin-tv',editor)).rejects.toMatchObject({status:403});
 expect((await call(path,'PUT',{revision:1,data:{...data,recipe:['ba'],notes:'Texte relu par l’équipe'}},'benin-tv',editor))!.status).toBe(200);
 expect((await call(path,'PUT',{revision:2,data:{...data,recurring:true}},'benin-tv',outsider))!.status).toBe(200);
});
it('reads a linked programme only in its authorised active channel',async()=>{
 const data={name:'Fiche ciblée',aliases:[],category:'',replayUrl:'',recurring:false,recipe:[],notes:'',directoryIds:[],voiceProfileId:null};
 const p=await(await call('/programmes','POST',{revision:0,data},channel,admin))!.json<{id:string}>();
 const path=`/programmes/${p.id}`;
 expect((await(await call(path,'GET',undefined,channel,editor))!.json<{data:unknown}>()).data).toEqual(data);
 await expect(call(path,'GET',undefined,'benin-tv',admin)).rejects.toMatchObject({status:404});
 await expect(call(path,'GET',undefined,channel,outsider)).rejects.toMatchObject({status:404});
 await env.DB.prepare('UPDATE programmes SET archived=1,revision=revision+1 WHERE id=?').bind(p.id).run();
 await expect(call(path,'GET',undefined,channel,admin)).rejects.toMatchObject({status:404});
});
