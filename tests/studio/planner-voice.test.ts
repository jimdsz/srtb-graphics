import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,expect,it,inject} from 'vitest';
import {api} from '../../server/router';
import type {Member} from '../../src/studio/domain';
import type {Plan,PlannerTask,PlannerRecord} from '../../src/studio/day-planner-model';
import type {PlannerVoice} from '../../src/studio/planner-voice-model';

const origin='https://studio.example';
const author:Member={email:'planner-voice-author@example.test',name:'Voix',role:'designer',active:1};
const colleague:Member={...author,email:'planner-voice-colleague@example.test'};
const call=(path:string,method='GET',body?:unknown,member=author)=>api(new Request(origin+'/api/graphics/planner'+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,member);
const plan=():Plan=>({kind:'plan',name:'Voix — recette',source:'recette.xlsx',sourceHash:'a'.repeat(64),rows:Array.from({length:7},(_,i)=>({id:String(i),sheet:'LUNDI',cell:'A'+i,raw:'',title:'Programme '+i,subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:30',duration:1800,included:true,kinds:['ba','popup','tds','renvoi','event'],formats:['tv','portrait','vertical'],issues:[],media:null,location:null}))});
async function voice(cue='Lundi',placement:PlannerVoice['placement']={mode:'ba-auto'}):Promise<PlannerVoice>{
 const id=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES(?,?,?,'audio/wav',100,'ready',?)").bind(id,'uploads/'+id,'Voix recette.wav',author.email).run();
 return {source:{url:`/api/graphics/media/${id}/content`,name:'Voix recette.wav',mimeType:'audio/wav'},sourceDuration:3.47,start:.25,end:3.25,cue,confirmed:true,placement};
}
async function save(data:Plan){const id=crypto.randomUUID();expect((await call('/'+id,'PUT',{revision:0,data}))!.status).toBe(201);return id;}
async function create(id:string,tasks:unknown[],revision=1,member=author){return (await(await call(`/${id}/tasks`,'POST',{revision,tasks},member))!.json<{tasks:PlannerTask[]}>()).tasks;}
async function project(id:string){return (await env.DB.prepare('SELECT data_json,visibility,created_by,revision FROM projects WHERE id=?').bind(id).first<{data_json:string;visibility:string;created_by:string;revision:number}>())!;}
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));for(const m of [author,colleague])await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,?,?)').bind(m.email,m.name,m.role,m.active,m.email).run();});

it('persists the reviewed voice and exact timing into three private formats without uploading media',async()=>{
 const data=plan(),v=await voice('Lundi',{mode:'ba-manual',intro:1,carton:2});data.rows[0].voices={ba:v};const id=await save(data);
 const read=(await(await call('/'+id,'GET',undefined,colleague))!.json<PlannerRecord<Plan>>());expect(read.data.rows[0].voices?.ba).toEqual(v);
 const before=await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first();
 const tasks=await create(id,['tv','portrait','vertical'].map(format=>({kind:'ba',format,rowIds:['0']})));
 expect(tasks).toHaveLength(3);
 for(const task of tasks){const p=await project(task.projectId),s=JSON.parse(p.data_json);expect(p.visibility).toBe('private');expect(p.created_by).toBe(author.email);expect(s._audio_voice_url).toEqual(v.source);expect(s._audio_voice_enabled).toBe(true);expect(s._audio_voice_in_seconds).toBe(.25);expect(s._audio_voice_out_seconds).toBe(3.25);expect(s._audio_voice_intro_offset_seconds).toBe(1);expect(s._audio_voice_outro_offset_seconds).toBe(66.8);expect(s._audio_bed_enabled).toBe(false);}
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first()).toEqual(before);
 expect((await(await call(`/${id}/tasks`,'GET',undefined,colleague))!.json<{tasks:PlannerTask[]}>()).tasks).toHaveLength(0);
 await expect(create(id,[{kind:'ba',format:'tv',rowIds:['0']}],1,colleague)).rejects.toMatchObject({status:409});
});

it('keeps every per-type departure and a separate semainier voice through real creation',async()=>{
 const data=plan();data.rows[0].voices={popup:await voice('Lundi',{mode:'single',delay:2}),tds:await voice('Tout de suite',{mode:'single',delay:.8}),renvoi:await voice('Lundi',{mode:'single',delay:1}),event:await voice('Lundi',{mode:'single',delay:4})};
 data.weekly={rowIds:data.rows.map(r=>r.id),formats:['tv','portrait','vertical'],voice:await voice('Cette semaine',{mode:'single',delay:.5})};const id=await save(data);
 for(const format of ['tv','portrait','vertical']){const tasks=await create(id,[...['popup','tds','renvoi','event'].map(kind=>({kind,format,rowIds:['0']})),{kind:'weekly',format,rowIds:data.weekly.rowIds}]);for(const task of tasks){const s=JSON.parse((await project(task.projectId)).data_json),kind=task.key.split(':')[0] as 'popup'|'tds'|'renvoi'|'event'|'weekly',v=kind==='weekly'?data.weekly.voice!:data.rows[0].voices![kind]!;expect(s._audio_voice_url).toEqual(v.source);expect(s._audio_voice_start_seconds).toBe(.25);expect(s._audio_voice_end_seconds).toBe(3.25);expect(s._audio_voice_delay_seconds).toBe(v.placement.mode==='single'?v.placement.delay:NaN);}}
});

it('rejects missing or mistyped shared audio and does not persist a partial preparation',async()=>{
 const data=plan(),v=await voice();data.rows[0].voices={ba:v};const assetId=v.source.url.split('/')[4];
 await env.DB.prepare("UPDATE media SET status='uploading' WHERE id=?").bind(assetId).run();
 const id=crypto.randomUUID();await expect(call('/'+id,'PUT',{revision:0,data})).rejects.toMatchObject({status:422});expect(await env.DB.prepare('SELECT id FROM planner_documents WHERE id=?').bind(id).first()).toBeNull();
 await env.DB.prepare("UPDATE media SET status='ready',mime_type='video/mp4' WHERE id=?").bind(assetId).run();await expect(call('/'+id,'PUT',{revision:0,data})).rejects.toMatchObject({status:422});
 await env.DB.prepare("UPDATE media SET mime_type='audio/wav' WHERE id=?").bind(assetId).run();expect((await call('/'+id,'PUT',{revision:0,data}))!.status).toBe(201);
 await env.DB.prepare("UPDATE media SET status='failed' WHERE id=?").bind(assetId).run();await expect(create(id,[{kind:'popup',format:'tv',rowIds:['0']},{kind:'ba',format:'tv',rowIds:['0']}])).rejects.toMatchObject({status:422});expect((await(await call(`/${id}/tasks`))!.json<{tasks:PlannerTask[]}>()).tasks).toHaveLength(0);
});

it('returns existing drafts unchanged after a date change but blocks newly mismatched voices atomically',async()=>{
 const data=plan();data.rows[0].voices={ba:await voice()};const id=await save(data),choice={kind:'ba',format:'tv',rowIds:['0']};const [first]=await create(id,[choice]),before=await project(first.projectId);
 data.rows[0].airDate='2026-09-08';await call('/'+id,'PUT',{revision:1,data});
 expect((await create(id,[choice],2))[0].projectId).toBe(first.projectId);expect(await project(first.projectId)).toEqual(before);
 await expect(create(id,[{kind:'popup',format:'tv',rowIds:['0']},{...choice,format:'vertical'}],2)).rejects.toThrow('ne correspond plus');
 expect((await(await call(`/${id}/tasks`))!.json<{tasks:PlannerTask[]}>()).tasks).toHaveLength(1);
 await expect(create(id,[choice],2,colleague)).rejects.toThrow('ne correspond plus');
 await expect(create(id,[choice],1)).rejects.toMatchObject({status:409});
 data.rows[0].voices.ba.cue='Mardi';await call('/'+id,'PUT',{revision:2,data});const result=await create(id,[{...choice,format:'vertical'}],3);expect(result).toHaveLength(2);expect(await project(first.projectId)).toEqual(before);
});
