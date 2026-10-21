import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,it,expect,inject} from 'vitest';
import {api} from '../../server/router';
import type {Member,MediaAsset} from '../../src/studio/domain';
import type {Plan,PlannerRecord,PlannerTask} from '../../src/studio/day-planner-model';
const origin='https://studio.example',member:Member={email:'logo-test@example.test',name:'Logo test',role:'designer',active:1};
const call=(path:string,method='GET',body?:unknown,channel='benin-tv')=>api(new Request(origin+'/api/graphics'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-SRTB-Channel':channel},body:body===undefined?undefined:JSON.stringify(body)}),env,member);
function fixture():Plan{return {kind:'plan',name:'Test logos',source:'recette.xlsx',sourceHash:'a'.repeat(64),rows:[{id:'row',sheet:'RECETTE',cell:'A1',raw:'',title:'Émission',subtitle:'Épisode 1',category:'Magazine',broadcastDate:'2026-09-28',airDate:'2026-09-28',time:'20:30:00',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null}]};}
async function media(mime='image/png',status='ready',channel='benin-tv'){
 const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by,channel_id) VALUES(?,?,?,?,?,?,?,?)').bind(id,'private-storage-key-'+id,'Logo.png',mime,200,status,member.email,channel).run();return {id,url:`/api/graphics/media/${id}/content`,name:'Logo.png',mimeType:mime};
}
const save=(data:Plan,id=crypto.randomUUID(),revision=0)=>call('/planner/'+id,'PUT',{revision,data});
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,?,?)').bind(member.email,member.name,member.role,1,member.email).run();await env.DB.prepare("INSERT INTO channels(id,name,created_by) VALUES('logo-other','Autre',?)").bind(member.email).run();});
it('returns ready metadata without storage keys and does not expose unfinished or other-channel assets',async()=>{
 const ready=await media(),uploading=await media('image/png','uploading'),other=await media('image/png','ready','logo-other');
 const result=await(await call('/media/'+ready.id))!.json<MediaAsset>();expect(result).toMatchObject({id:ready.id,status:'ready',mime_type:'image/png',name:'Logo.png'});expect(JSON.stringify(result)).not.toContain('private-storage-key');
 for(const id of [uploading.id,other.id,crypto.randomUUID()])await expect(call('/media/'+id)).rejects.toMatchObject({status:404});
 await expect(call('/media/'+ready.id,'POST',{})).rejects.toMatchObject({status:405});
});
it('verifies shared logo type, availability and channel before saving a preparation',async()=>{
 const good=await media(),video=await media('video/mp4'),pending=await media('image/png','uploading'),other=await media('image/png','ready','logo-other');
 const plan=fixture();plan.rows[0].logo={url:good.url,name:good.name,mimeType:good.mimeType};expect((await save(plan))!.status).toBe(201);
 for(const item of [video,pending,other]){plan.rows[0].logo={url:item.url,name:item.name,mimeType:'image/png'};await expect(save(plan)).rejects.toMatchObject({status:422});}
});
it('copies a confirmed logo into new private projects and preserves already retouched drafts',async()=>{
 const image=await media(),plan=fixture();plan.rows[0].logo={url:image.url,name:image.name,mimeType:image.mimeType};
 const record=await(await save(plan))!.json<PlannerRecord<Plan>>(),choices=[{kind:'ba',format:'tv',rowIds:['row']},{kind:'ba',format:'vertical',rowIds:['row']}];
 const tasks=(await(await call(`/planner/${record.id}/tasks`,'POST',{revision:1,tasks:choices}))!.json<{tasks:PlannerTask[]}>()).tasks;
 for(const task of tasks){const p=await env.DB.prepare('SELECT visibility,data_json FROM projects WHERE id=?').bind(task.projectId).first<{visibility:string;data_json:string}>();expect(p!.visibility).toBe('private');expect(JSON.parse(p!.data_json)).toMatchObject({_studio_overlay_logo_url:plan.rows[0].logo,_studio_overlay_logo_enabled:true});}
 const p=await env.DB.prepare('SELECT data_json FROM projects WHERE id=?').bind(tasks[0].projectId).first<{data_json:string}>(),edited={...JSON.parse(p!.data_json),_studio_overlay_logo_size:7};
 await env.DB.prepare('UPDATE projects SET data_json=?,revision=revision+1 WHERE id=?').bind(JSON.stringify(edited),tasks[0].projectId).run();
 plan.rows[0].logo=null;await save(plan,record.id,1);await call(`/planner/${record.id}/tasks`,'POST',{revision:2,tasks:choices});
 expect(JSON.parse((await env.DB.prepare('SELECT data_json FROM projects WHERE id=?').bind(tasks[0].projectId).first<{data_json:string}>())!.data_json)).toEqual(edited);
});
it('revalidates missing logos at project creation and leaves no partial drafts',async()=>{
 const image=await media(),plan=fixture();plan.rows[0].logo={url:image.url,name:image.name,mimeType:image.mimeType};const record=await(await save(plan))!.json<PlannerRecord<Plan>>();
 await env.DB.prepare("UPDATE media SET status='failed' WHERE id=?").bind(image.id).run();
 await expect(call(`/planner/${record.id}/tasks`,'POST',{revision:1,tasks:[{kind:'ba',format:'tv',rowIds:['row']}]})).rejects.toMatchObject({status:422});
 expect((await(await call(`/planner/${record.id}/tasks`))!.json<{tasks:PlannerTask[]}>()).tasks).toEqual([]);
});
