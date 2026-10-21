import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,it,expect,inject} from 'vitest';
import {api} from '../../server/router';
import type {Member,Project} from '../../src/studio/domain';
import type {ProjectPage} from '../../src/studio/api';
const origin='https://studio.example';
const admin:Member={email:'admin@example.com',name:'Admin',role:'admin',active:1};
const designer:Member={email:'validation-author@example.test',name:'Auteur',role:'designer',active:1};
const other:Member={email:'validation-other@example.test',name:'Collègue',role:'designer',active:1};
const call=(query:string,member=admin)=>api(new Request(origin+'/api/graphics/projects?'+query,{headers:{Origin:origin,'X-SRTB-Channel':'benin-tv'}}),env,member);
beforeAll(async()=>{
 await applyD1Migrations(env.DB,inject('migrations'));
 for(const member of [designer,other])await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,?,?)').bind(member.email,member.name,member.role,1,admin.email).run();
 const inserts=[];
 for(let i=0;i<214;i++){
  const status=i<110?'draft':'submitted',author=i===213?other.email:designer.email;
  inserts.push(env.DB.prepare("INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by,status,updated_at,visibility) VALUES(?,?,'BTV_BA_1P','1.0.0','1.7.0','{}',?,?,?,?,'private')").bind(crypto.randomUUID(),`Projet ${i}`,author,author,status,i<110?'2026-09-30T12:00:00Z':'2026-09-29T12:00:00Z'));
 }
 await env.DB.batch(inserts);
});
it('filters pending approvals before pagination, even behind more than 100 newer drafts',async()=>{
 const first=await(await call('status=submitted'))!.json<ProjectPage>();
 expect(first.projects).toHaveLength(100);expect(first.projects.every(project=>project.status==='submitted')).toBe(true);expect(first.next).not.toBeNull();
 const second=await(await call('status=submitted&'+new URLSearchParams(first.next!)))!.json<ProjectPage>();
 expect(second.projects).toHaveLength(4);expect(second.next).toBeNull();
 expect(new Set([...first.projects,...second.projects].map(project=>project.id)).size).toBe(104);
});
it('preserves private-project ACLs, scope and cursor under the status filter',async()=>{
 const page=await(await call('status=submitted',other))!.json<ProjectPage>();
 expect(page.projects).toHaveLength(1);expect(page.projects[0].created_by).toBe(other.email);expect(page.next).toBeNull();
 expect((await(await call('status=submitted&scope=team'))!.json<ProjectPage>()).projects).toEqual([]);
 const own=await(await call('status=submitted&scope=mine',designer))!.json<ProjectPage>();
 expect(own.projects.every((project:Project)=>project.created_by===designer.email)).toBe(true);
 const next=await(await call('status=submitted&scope=mine&'+new URLSearchParams(own.next!),designer))!.json<ProjectPage>();
 expect(next.projects).toHaveLength(3);
});
it('rejects unknown status values instead of silently showing unrelated projects',async()=>{
 await expect(call('status=everything')).rejects.toThrow();
});
