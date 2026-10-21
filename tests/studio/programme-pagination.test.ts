import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,beforeEach,it,expect,inject} from 'vitest';
import {api} from '../../server/router';
import type {Member} from '../../src/studio/domain';
import type {Programme} from '../../src/studio/channel-model';

const origin='https://studio.example';
const admin:Member={email:'admin@example.com',name:'Admin',role:'admin',active:1};
const outsider:Member={email:'page-outsider@example.test',name:'Autre chaîne',role:'designer',active:1};
const id=(index:number)=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const data=(index:number)=>({name:`Programme ${String(index).padStart(4,'0')}`,aliases:index===1012?['Un alias au-delà de mille fiches']:[],category:'Magazine',replayUrl:'',recurring:false,recipe:[],notes:'',directoryIds:[],voiceProfileId:null});
type Page={programmes:Programme[];next:string|null};
let channel:string,other:string;
const call=(path:string,scope=channel,member=admin)=>api(new Request(origin+'/api/graphics'+path,{headers:{Origin:origin,'X-SRTB-Channel':scope}}),env,member);
const page=async(next:string|null=null)=>(await call('/programmes?page=1'+(next?`&after=${next}`:'')))!.json<Page>();

beforeAll(async()=>{
 await applyD1Migrations(env.DB,inject('migrations'));
 for(const name of ['Pagination complète','Autre catalogue']){
  const response=await api(new Request(origin+'/api/graphics/channels',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name,accent:'#D6B52C',timezone:'Africa/Porto-Novo'})}),env,admin);
  const created=await response!.json<{id:string}>();if(!channel)channel=created.id;else other=created.id;
 }
 for(let offset=1;offset<=1012;offset+=50){
  await env.DB.batch(Array.from({length:Math.min(50,1013-offset)},(_,j)=>{
   const index=offset+j,record=data(index);
   return env.DB.prepare('INSERT INTO programmes(id,channel_id,name,identity,data_json,updated_by) VALUES(?,?,?,?,?,?)').bind(id(index),channel,record.name,record.name,JSON.stringify(record),admin.email);
  }));
 }
 await env.DB.prepare('INSERT INTO programmes(id,channel_id,name,identity,data_json,updated_by) VALUES(?,?,?,?,?,?)').bind(id(9000),other,'Invisible','invisible',JSON.stringify(data(9000)),admin.email).run();
});
beforeEach(async()=>{
 await env.DB.batch([1,100].map(index=>env.DB.prepare('UPDATE programmes SET name=?,data_json=?,revision=revision+1,archived=0 WHERE id=?').bind(data(index).name,JSON.stringify(data(index)),id(index))));
});

it('returns bounded pages with an explicit end and never truncates after 1000',async()=>{
 const ids:string[]=[],programmes:Programme[]=[];let next:string|null=null,pages=0;
 do{const result=await page(next);expect(result.programmes.length).toBeLessThanOrEqual(100);programmes.push(...result.programmes);ids.push(...result.programmes.map(p=>p.id));next=result.next;pages++;if(pages>12)throw Error('Pagination did not terminate');}while(next);
 expect(pages).toBe(11);expect(ids).toEqual(Array.from({length:1012},(_,index)=>id(index+1)));expect(new Set(ids).size).toBe(1012);
 expect(programmes.at(-1)?.data.aliases).toEqual(['Un alias au-delà de mille fiches']);
 expect(programmes.every(p=>p.channel_id===channel&&p.revision>=1&&p.archived===0)).toBe(true);
});

it('keeps the legacy array response compatible with old open tabs',async()=>{
 const result=await(await call('/programmes'))!.json<Programme[]>();
 expect(Array.isArray(result)).toBe(true);expect(result.length).toBe(1000);expect(result[0].data.name).toBe('Programme 0001');
});

it('does not accept a client-chosen unbounded size',async()=>{
 const result=await(await call('/programmes?page=1&limit=1000000'))!.json<Page>();
 expect(result.programmes.length).toBe(100);expect(result.next).toBe(id(100));
});

it('rejects malformed or duplicated page cursors',async()=>{
 for(const query of ['page=2','page=1&page=1','after='+id(100),'page=1&after=not-a-uuid','page=1&after=','page=1&after='+id(100)+'&after='+id(200)])await expect(call('/programmes?'+query)).rejects.toMatchObject({status:400});
 await expect(call('/programmes?page=1&after='+id(8000))).rejects.toMatchObject({status:409});
});

it('enforces channel membership and never accepts another channel’s anchor',async()=>{
 await expect(call('/programmes?page=1',channel,outsider)).rejects.toMatchObject({status:404});
 await expect(call('/programmes?page=1&after='+id(9000))).rejects.toMatchObject({status:409});
 await expect(call('/programmes?page=1&after='+id(100),other)).rejects.toMatchObject({status:409});
 const result=await(await call('/programmes?page=1',other))!.json<Page>();expect(result.programmes.map(p=>p.id)).toEqual([id(9000)]);expect(result.next).toBeNull();
});

it('continues after an archived anchor without resurrecting it or repeating rows',async()=>{
 const first=await page();await env.DB.prepare('UPDATE programmes SET archived=1,revision=revision+1 WHERE id=?').bind(first.next).run();
 const next=await page(first.next);expect(next.programmes[0].id).toBe(id(101));expect(next.next).toBe(id(200));
 expect((await page()).programmes.map(p=>p.id)).not.toContain(id(100));
});

it('does not reorder pages when an earlier programme is renamed',async()=>{
 const first=await page();await env.DB.prepare('UPDATE programmes SET name=?,data_json=?,revision=revision+1 WHERE id=?').bind('ZZZ renommé',JSON.stringify({...data(1),name:'ZZZ renommé'}),id(1)).run();
 const next=await page(first.next);expect(next.programmes[0].id).toBe(id(101));expect(next.programmes.map(p=>p.id)).not.toContain(id(1));
 const fresh=await page();expect(fresh.programmes[0].id).toBe(id(1));expect(fresh.programmes[0].revision).toBe(first.programmes[0].revision+1);expect(fresh.programmes[0].data.name).toBe('ZZZ renommé');
});
