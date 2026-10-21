import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {beforeAll,expect,it,inject,vi} from 'vitest';
import {api} from '../../server/router';
import worker from '../../server/pages-worker';
import type {Member} from '../../src/studio/domain';
import {isMediaField} from '../../src/studio/domain';
import {plannerProject,plannerSignature} from '../../src/studio/day-planner-project';
import {createPlannerQueue} from '../../src/studio/day-planner-queue';
import {checkedPlannerPreparation} from '../../src/studio/planner-validation';
import {weeklyChoices} from '../../src/studio/planner-weekly';
import {directorySchema,rankMedia,relativePathSchema,taskKey} from '../../src/studio/day-planner-model';
import type {Plan,PlannerRow,PlannerTask,PlannerRecord,DirectoryIndex} from '../../src/studio/day-planner-model';

const origin='https://studio.example';
const designer:Member={email:'planner-designer@example.test',name:'Planning',role:'designer',active:1};
const colleague:Member={email:'planner-colleague@example.test',name:'Collègue',role:'designer',active:1};
const row=(id='a'):PlannerRow=>({id,sheet:'LUNDI',cell:'B12',raw:'MAGAZINE : FITFORME N°31',title:'FITFORME',subtitle:'N°31',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'06:00:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:null,location:null});
const plan=():Plan=>({kind:'plan',name:'Lundi',source:'test.xlsx',sourceHash:'a'.repeat(64),rows:[row()]});
const call=(path='',method='GET',body?:unknown,member=designer)=>api(new Request(origin+'/api/graphics/planner'+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,member);
async function save(data:Plan=plan()){const id=crypto.randomUUID();await call('/'+id,'PUT',{revision:0,data});return id;}
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));for(const m of [designer,colleague])await env.DB.prepare('INSERT INTO members(email,name,role,active,updated_by) VALUES(?,?,?,?,?)').bind(m.email,m.name,m.role,m.active,m.email).run();});

it('validates a preparation before writes, then creates and reads only its owner’s corrected drafts',async()=>{
 const data=plan();data.rows[0].time='';
 const id=await save(checkedPlannerPreparation(data)),choice={rowIds:['a'],kind:'ba' as const,format:'portrait' as const};
 expect(()=>checkedPlannerPreparation(data,choice.rowIds)).toThrow('FITFORME (2026-09-07) — Renseignez une heure');
 expect((await(await call(`/${id}/tasks`))!.json<{tasks:PlannerTask[]}>()).tasks).toHaveLength(0);
 data.rows[0].time='21:45:00';data.rows[0].title='FITFORME — édition relue';
 const checked=checkedPlannerPreparation(data,choice.rowIds);
 const saved=await(await call('/'+id,'PUT',{revision:1,data:checked}))!.json<PlannerRecord<Plan>>();
 const result=await createPlannerQueue({record:saved,choices:[choice],signal:new AbortController().signal,onProgress:()=>{},api:{
  tasks:async()=>await(await call(`/${id}/tasks`))!.json<{tasks:PlannerTask[]}>(),
  create:async(_id,revision,tasks,options)=>await(await call(`/${id}/tasks`,'POST',{revision,tasks,response:options?.response}))!.json<{tasks:PlannerTask[]}>(),
 }});
 expect(result.completed).toBe(1);
 const project=await env.DB.prepare('SELECT visibility,created_by,data_json FROM projects WHERE id=?').bind(result.tasks[0].projectId).first<{visibility:string;created_by:string;data_json:string}>();
 expect(project!.visibility).toBe('private');expect(project!.created_by).toBe(designer.email);
 expect(JSON.parse(project!.data_json)).toMatchObject({_heure_1:'21h45',_jour_1:'lundi',_studio_format:'portrait'});
 expect((await(await call(`/${id}/tasks`,'GET',undefined,colleague))!.json<{tasks:PlannerTask[]}>()).tasks).toHaveLength(0);
 const repeated=await(await call(`/${id}/tasks`,'POST',{revision:2,tasks:[choice]}))!.json<{tasks:PlannerTask[]}>();
 expect(repeated.tasks.map(t=>t.projectId)).toEqual(result.tasks.map(t=>t.projectId));
});

it('shares reviewed plans, protects revisions and retries initial creation without duplication',async()=>{
 const data=plan(),id=await save(data);const response=await call('/'+id,'PUT',{revision:0,data});expect(response!.status).toBe(200);
 const record=await(await call('/'+id,'GET',undefined,colleague))!.json<PlannerRecord<Plan>>();expect(record.data).toEqual(data);
 await call('/'+id,'PUT',{revision:1,data:{...data,name:'Version collègue'}},colleague);
 await expect(call('/'+id,'PUT',{revision:1,data})).rejects.toMatchObject({status:409});
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM planner_revisions WHERE document_id=?').bind(id).first<{n:number}>())?.n).toBe(2);
 expect(response!.headers.get('Cache-Control')).toBe('private, no-store');
});
it('shares reviewed local cuts but creates private projects, and never replaces a previous task after a cut change',async()=>{
 const data=plan(),media={url:'local-media:'+'a'.repeat(64)+':100',name:'programme.mp4',mimeType:'video/mp4'};
 data.rows[0].media=media;data.rows[0].excerpt={source:media.url,start:12,end:24,duration:3600};
 const id=await save(data),read=await(await call('/'+id,'GET',undefined,colleague))!.json<PlannerRecord<Plan>>();expect(read.data.rows[0].excerpt).toEqual(data.rows[0].excerpt);
 const choices=['ba','popup','tds','renvoi','event'].map(kind=>({kind,format:'tv',rowIds:['a']}));
 const created=await(await call(`/${id}/tasks`,'POST',{revision:1,tasks:choices}))!.json<{tasks:PlannerTask[]}>();expect(created.tasks).toHaveLength(5);
 for(const task of created.tasks){const project=await env.DB.prepare('SELECT data_json,visibility,created_by FROM projects WHERE id=?').bind(task.projectId).first<{data_json:string;visibility:string;created_by:string}>();const settings=JSON.parse(project!.data_json);const cutKeys=Object.keys(settings).filter(k=>k.startsWith('_media_')&&k.endsWith('_start_seconds')&&settings[k]===12);expect(cutKeys.length).toBeGreaterThan(0);expect(project!.visibility).toBe('private');expect(project!.created_by).toBe(designer.email);}
 data.rows[0].excerpt.start=16;await call('/'+id,'PUT',{revision:1,data});await call(`/${id}/tasks`,'POST',{revision:2,tasks:choices});
 const preserved=JSON.parse((await env.DB.prepare('SELECT data_json FROM projects WHERE id=?').bind(created.tasks.find(t=>t.key==='ba:tv:a')!.projectId).first<{data_json:string}>())!.data_json);expect(preserved._media_body_start_seconds).toBe(12);
 for(const bad of [{...data.rows[0].excerpt,end:3601},{...data.rows[0].excerpt,end:15},{...data.rows[0].excerpt,source:media.url+'x'}]){data.rows[0].excerpt=bad;await expect(save(data)).rejects.toMatchObject({name:'ZodError'});}
});
it('shares weekly order and formats across two users, while creating private semainiers without duplicates',async()=>{
 const data=plan();data.rows=Array.from({length:7},(_,i)=>({...row(String(i)),title:`Programme ${i+1}`,airDate:`2026-09-${String(7+i).padStart(2,'0')}`,time:`${12+i}:30:00`}));
 data.weekly={rowIds:['6','1','0','3','4','5','2'],formats:['tv','portrait','vertical'],startDate:'2026-09-07'};const id=await save(data);
 const read=await(await call('/'+id,'GET',undefined,colleague))!.json<PlannerRecord<Plan>>();expect(read.data.weekly).toEqual(data.weekly);
 read.data.weekly!.rowIds=['2','5','4','3','0','1','6'];await call('/'+id,'PUT',{revision:1,data:read.data},colleague);
 await expect(call('/'+id,'PUT',{revision:1,data})).rejects.toMatchObject({status:409});
 const latest=await(await call('/'+id))!.json<PlannerRecord<Plan>>(),choices=weeklyChoices(latest.data);
 const result=await(await call(`/${id}/tasks`,'POST',{revision:2,tasks:choices}))!.json<{tasks:PlannerTask[]}>();expect(result.tasks).toHaveLength(3);
 for(const task of result.tasks){const p=await env.DB.prepare('SELECT created_by,visibility,data_json FROM projects WHERE id=?').bind(task.projectId).first<{created_by:string;visibility:string;data_json:string}>();expect(p!.created_by).toBe(designer.email);expect(p!.visibility).toBe('private');const settings=JSON.parse(p!.data_json);latest.data.weekly!.rowIds.forEach((rowId,i)=>expect(settings[`programme_${i+1}_title`]).toBe(`Programme ${Number(rowId)+1}`));}
 const again=await(await call(`/${id}/tasks`,'POST',{revision:2,tasks:choices}))!.json<{tasks:PlannerTask[]}>();expect(again.tasks.map(t=>t.projectId)).toEqual(result.tasks.map(t=>t.projectId));
 await expect(call(`/${id}/tasks`,'POST',{revision:2,tasks:choices},colleague)).rejects.toMatchObject({status:409});
 expect((await(await call(`/${id}/tasks`,'GET',undefined,colleague))!.json<{tasks:PlannerTask[]}>()).tasks).toHaveLength(0);
 latest.data.weekly!.rowIds.reverse();await call('/'+id,'PUT',{revision:2,data:latest.data});
 expect(JSON.parse((await env.DB.prepare('SELECT data_json FROM projects WHERE id=?').bind(result.tasks[0].projectId).first<{data_json:string}>())!.data_json).programme_1_title).toBe('Programme 3');
});
it('rejects invalid weekly references, repeats and excluded slots before saving the shared plan',async()=>{
 const data=plan();
 for(const weekly of [{rowIds:['absent'],formats:['tv']},{rowIds:['a','a'],formats:['tv']},{rowIds:['a'],formats:[]},{rowIds:[],formats:['tv','tv']},{rowIds:[],formats:['tv'],startDate:'2026-02-29'}])await expect(call('/'+crypto.randomUUID(),'PUT',{revision:0,data:{...data,weekly}})).rejects.toMatchObject({name:'ZodError'});
 data.rows[0].included=false;await expect(call('/'+crypto.randomUUID(),'PUT',{revision:0,data:{...data,weekly:{rowIds:['a'],formats:['tv']}}})).rejects.toMatchObject({name:'ZodError'});
});
it('creates linked drafts once and never overwrites an edited project',async()=>{
 const id=await save(),choices=[{kind:'ba',format:'tv',rowIds:['a']},{kind:'tds',format:'vertical',rowIds:['a']}];
 const result=await(await call(`/${id}/tasks`,'POST',{revision:1,tasks:choices}))!.json<{tasks:PlannerTask[]}>();expect(result.tasks).toHaveLength(2);
 const target=result.tasks[0].projectId;await env.DB.prepare("UPDATE projects SET title='Choix éditorial',revision=revision+1 WHERE id=?").bind(target).run();
 const repeated=await(await call(`/${id}/tasks`,'POST',{revision:1,tasks:choices}))!.json<{tasks:PlannerTask[]}>();expect(repeated.tasks).toHaveLength(2);expect(repeated.tasks.find(t=>t.projectId===target)?.title).toBe('Choix éditorial');
 await expect(call(`/${id}/tasks`,'POST',{revision:1,tasks:choices},colleague)).rejects.toMatchObject({status:409});
 expect((await env.DB.prepare('SELECT status FROM projects WHERE id=?').bind(target).first<{status:string}>())?.status).toBe('draft');
});
it('serializes concurrent creation of the same task without orphaned projects',async()=>{
 const id=await save(),body={revision:1,tasks:[{kind:'popup',format:'tv',rowIds:['a']}]};
 const results=await Promise.allSettled([call(`/${id}/tasks`,'POST',body),call(`/${id}/tasks`,'POST',body,colleague)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason.status)).toEqual([409]);
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM planner_personal_tasks WHERE plan_id=?').bind(id).first()).toEqual({n:1});
 const orphans=await env.DB.prepare("SELECT COUNT(*) AS n FROM projects p WHERE p.created_by IN (?,?) AND NOT EXISTS(SELECT 1 FROM planner_personal_tasks t WHERE t.project_id=p.id)").bind(designer.email,colleague.email).first<{n:number}>();expect(orphans?.n).toBe(0);
});
it('rejects invalid hours, missing rows, stale plans and changed permissions',async()=>{
 const data=plan();data.rows[0].time='';const id=await save(data);
 await expect(call(`/${id}/tasks`,'POST',{revision:1,tasks:[{kind:'ba',format:'tv',rowIds:['a']}]})).rejects.toThrow('horaires');
 await expect(call(`/${id}/tasks`,'POST',{revision:1,tasks:[{kind:'ba',format:'tv',rowIds:['unknown']}]})).rejects.toThrow('Sélection');
 await expect(call(`/${id}/tasks`,'POST',{revision:2,tasks:[{kind:'ba',format:'tv',rowIds:['a']}]})).rejects.toMatchObject({status:409});
 await expect(call('?kind=plan','GET',undefined,{...designer,active:0})).rejects.toMatchObject({status:403});
 const response=await worker.fetch(new Request(origin+'/api/graphics/planner?kind=plan'),{...env,AUTH_MODE:'firebase',FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35),ASSETS:{fetch:vi.fn()} as Fetcher},{waitUntil:vi.fn()} as ExecutionContext);expect(response.status).toBe(401);
 const dateEdit=plan();dateEdit.rows[0].airDate='';expect(()=>plannerProject(dateEdit,{kind:'ba',format:'tv',rowIds:['a']})).toThrow('dates de diffusion');
});
it('rolls back both the project and its history when the transactional plan guard fails',async()=>{
 const id=await save(),project=plannerProject(plan(),{kind:'ba',format:'tv',rowIds:['a']}),projectId=crypto.randomUUID();
 await expect(env.DB.batch([
  env.DB.prepare('INSERT INTO projects(id,title,template_id,template_version,library_version,data_json,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)').bind(projectId,project.title,project.template.id,project.template.version,project.template.libraryVersion,JSON.stringify(project.data),designer.email,designer.email),
  env.DB.prepare('INSERT INTO planner_tasks(plan_id,task_key,project_id,source_revision,actor) VALUES(?,?,?,?,?)').bind(id,'ba:tv:a',projectId,99,designer.email),
 ])).rejects.toThrow();
 expect(await env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first()).toBeNull();expect(await env.DB.prepare('SELECT project_id FROM revisions WHERE project_id=?').bind(projectId).first()).toBeNull();
});
it('clears all demo media and mismatched voice tracks in all 18 template-format combinations',()=>{
 const data=plan();data.rows=Array.from({length:7},(_,i)=>({...row(String(i)),title:'LE PROGRAMME '+i}));
 for(const kind of ['ba','popup','tds','renvoi','event','weekly'] as const)for(const format of ['tv','portrait','vertical'] as const){
  const result=plannerProject(data,{kind,format,rowIds:kind==='weekly'?data.rows.map(r=>r.id):['0']});
  for(const [key,field]of Object.entries(result.template.fields)){if(isMediaField(key,field))expect(result.data[key]).toBe('');if(/_audio.*_enabled$/.test(key))expect(result.data[key]).toBe(false);}
  expect(result.data._studio_format).toBe(format);expect(JSON.stringify(result.data).toLocaleUpperCase('fr')).not.toContain('L’ISLAM');
  expect(JSON.stringify(result.data).toLocaleUpperCase('fr')).not.toContain('RÔLE ET IMPORTANCE DE L’IMAM');
  if(kind==='ba'){expect(result.data._credit_pack).toBe('');expect(result.data._credit_visible).toBe(false);}
 }
 const ba=plannerProject(data,{kind:'ba',format:'tv',rowIds:['0']});expect(ba.data._jour_1).toBe('lundi');expect(ba.data._heure_1).toBe('06h00');expect(ba.data._jour_2).toBe('');
 const tds=plannerProject(data,{kind:'tds',format:'tv',rowIds:['0']});expect(tds.template.id).toBe('BTV_BA_TDS');expect(tds.data._heure_1).toBeUndefined();
});
it('refuses private invalid media references, audio used as video and oversized requests',async()=>{
 const data=plan();data.rows[0].media={url:'local-media:'+'a'.repeat(64)+':100',name:'son.wav',mimeType:'audio/wav'};
 await expect(save(data)).rejects.toMatchObject({status:422});
 data.rows[0].media={url:'/api/graphics/media/'+crypto.randomUUID()+'/content',name:'absent.mp4',mimeType:'video/mp4'};await expect(save(data)).rejects.toMatchObject({status:422});
 const id=await save();await expect(call(`/${id}/tasks`,'POST',{revision:1,tasks:Array.from({length:9},()=>({kind:'ba',format:'tv',rowIds:['a']}))})).rejects.toThrow();
});
it('preserves confirmed media and distinct appointments across programme and weekly proposals',()=>{
 const data=plan();data.rows=Array.from({length:7},(_,i)=>({...row(String(i)),title:`PROGRAMME ${i+1}`,subtitle:`ÉPISODE ${31+i}`,airDate:`2026-09-${String(7+i).padStart(2,'0')}`,time:`${String(6+i).padStart(2,'0')}:30:00`,media:{url:'local-media:'+String(i+1).repeat(64)+':100',name:`programme-${i+1}.mp4`,mimeType:'video/mp4'}}));
 const first=data.rows[0],ba=plannerProject(data,{kind:'ba',format:'vertical',rowIds:['0']});
 expect(ba.data._media_intro_url).toEqual(first.media);expect(ba.data._media_body_url).toEqual(first.media);expect(ba.data._media_pack_url).toEqual(first.media);expect(ba.data._heure_1).toBe('06h30');expect(ba.data._sous_titre_pack).toBe('ÉPISODE 31');
 const popup=plannerProject(data,{kind:'popup',format:'tv',rowIds:['0']});expect(popup.data._label).toBe('LUNDI 06H30');expect(popup.data._media_popup_url).toEqual(first.media);expect(popup.data._background_visible).toBe(false);
 const week=plannerProject(data,{kind:'weekly',format:'portrait',rowIds:data.rows.map(r=>r.id)});
 for(let i=0;i<7;i++){expect(week.data[`programme_${i+1}_title`]).toBe(`PROGRAMME ${i+1}`);expect(week.data[`_media_programme_${i+1}_url`]).toEqual(data.rows[i].media);}
 expect(week.data.programme_1_category).toBe('LUNDI 06H30');expect(week.data.programme_7_category).toBe('DIMANCHE 12H30');expect(week.data._media_intro_url).toEqual(first.media);expect(week.data._media_final_url).toEqual(data.rows[6].media);
});
it('stores directory metadata only and ranks, but does not select, named media',async()=>{
 const id=crypto.randomUUID(),data:DirectoryIndex={kind:'directory',name:'Programmes partagés',scannedAt:new Date().toISOString(),partial:false,files:[{path:'FITFORME/FITFORME 31.mp4',name:'FITFORME 31.mp4',size:100,modified:1},{path:'AUTRE.mp4',name:'AUTRE.mp4',size:200,modified:2}]};
 await call('/'+id,'PUT',{revision:0,data});const read=await(await call('/'+id,'GET',undefined,colleague))!.json<PlannerRecord<DirectoryIndex>>();expect(read.data).toEqual(data);expect(rankMedia(row(),read)[0].file.name).toBe('FITFORME 31.mp4');expect(row().media).toBeNull();
 for(const path of ['../outside.mp4','C:/secret.mp4','/root.mp4','folder\\file.mp4'])expect(relativePathSchema.safeParse(path).success).toBe(false);
 expect(directorySchema.safeParse({...data,handle:{},permission:'granted'}).success).toBe(false);
 expect(taskKey({rowIds:['a'],kind:'ba',format:'tv'})).toBe('ba:tv:a');
 expect(taskKey({rowIds:['a,b','c'],kind:'weekly',format:'tv'})).not.toBe(taskKey({rowIds:['a','b,c'],kind:'weekly',format:'tv'}));
});
it('allows one winner among fifty concurrent changes of the same reviewed revision',async()=>{
 const id=await save(),results=await Promise.allSettled(Array.from({length:50},(_,i)=>call('/'+id,'PUT',{revision:1,data:{...plan(),name:'Proposition '+i}},i%2?colleague:designer)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected'&&r.reason.status===409)).toHaveLength(49);
 expect((await(await call('/'+id))!.json<PlannerRecord>()).revision).toBe(2);
});

it('fetches only requested active programme rules in one bounded, authenticated request',async()=>{
 const programme='recette bulk 31',other='recette bulk 32',id=crypto.randomUUID(),hidden=crypto.randomUUID();
 const data={kind:'rule',name:'Recette',programme,keywords:'Recette',directoryId:null,preferredPath:null,kinds:['ba','popup']};
 const reviewer={...designer,role:'broadcaster' as const};
 await call('/'+id,'PUT',{revision:0,data},reviewer);await call('/'+hidden,'PUT',{revision:0,data:{...data,programme:other}},reviewer);
 await call('/'+hidden+'/archive','POST',{revision:1,archived:true},reviewer);
 const response=(await call('/rules','POST',{programmes:[programme,other,programme]},colleague))!;
 const result=await response.json<{rules:PlannerRecord[]}>();expect(result.rules.map(r=>r.id)).toEqual([id]);expect(response.headers.get('Cache-Control')).toBe('private, no-store');
 expect((await(await call('/rules','POST',{programmes:[]}))!.json<{rules:unknown[]}>()).rules).toEqual([]);
 await expect(call('/rules','POST',{programmes:Array(601).fill('a')})).rejects.toThrow();
 await expect(call('/rules','POST',{programmes:[programme]}, {...designer,active:0})).rejects.toMatchObject({status:403});
 await expect(call('/rules')).rejects.toMatchObject({status:405});
});

it('creates a private draft with its native signature, without a voice or a new media upload',async()=>{
 const id=await save(),task={kind:'ba',format:'tv',rowIds:['a'],signature:true};
 const before=await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first<{n:number}>();
 const result=await(await call(`/${id}/tasks`,'POST',{revision:1,tasks:[task]}))!.json<{tasks:PlannerTask[]}>();
 const project=await env.DB.prepare('SELECT data_json,visibility,created_by FROM projects WHERE id=?').bind(result.tasks[0].projectId).first<{data_json:string;visibility:string;created_by:string}>();
 const data=JSON.parse(project!.data_json);
 expect(data._audio_bed_enabled).toBe(true);expect(data._audio_bed_url).toBe(plannerSignature('ba')!._audio_bed_url);expect(data._audio_voice_enabled).toBe(false);
 expect(project!.visibility).toBe('private');expect(project!.created_by).toBe(designer.email);
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM media').first()).toEqual(before);
 await call(`/${id}/tasks`,'POST',{revision:1,tasks:[{...task,signature:false}]});
 expect((await env.DB.prepare('SELECT data_json FROM projects WHERE id=?').bind(result.tasks[0].projectId).first<{data_json:string}>())?.data_json).toBe(project!.data_json);
 expect((await(await call(`/${id}/tasks`,'GET',undefined,colleague))!.json<{tasks:PlannerTask[]}>()).tasks).toHaveLength(0);
});
it('checks private signature availability before creating any draft, and accepts only ready audio',async()=>{
 const id=await save(),task={kind:'event',format:'vertical',rowIds:['a'],signature:true};
 const asset=plannerSignature('event')!._audio_url as {url:string;name:string},assetId=asset.url.split('/')[4];
 await expect(call(`/${id}/tasks`,'POST',{revision:1,tasks:[{kind:'ba',format:'tv',rowIds:['a']},task]})).rejects.toMatchObject({status:422});
 expect((await(await call(`/${id}/tasks`))!.json<{tasks:PlannerTask[]}>()).tasks).toHaveLength(0);
 await env.DB.prepare("INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES(?,?,?,'audio/wav',100,'ready',?)").bind(assetId,'uploads/'+assetId,asset.name,designer.email).run();
 const result=await(await call(`/${id}/tasks`,'POST',{revision:1,tasks:[task]}))!.json<{tasks:PlannerTask[]}>();
 const data=JSON.parse((await env.DB.prepare('SELECT data_json FROM projects WHERE id=?').bind(result.tasks[0].projectId).first<{data_json:string}>())!.data_json);
 expect(data._audio_url).toEqual(asset);expect(data._audio_enabled).toBe(true);expect(data._audio_voice_enabled).toBe(false);
});

it('returns only requested personal tasks for new clients, while preserving the full legacy response',async()=>{
 const data=plan();data.rows=Array.from({length:4},(_,i)=>row(String(i)));const id=await save(data);
 const choices=data.rows.flatMap(r=>[{kind:'ba',format:'tv',rowIds:[r.id]},{kind:'popup',format:'vertical',rowIds:[r.id]}]);
 await call(`/${id}/tasks`,'POST',{revision:1,tasks:choices});
 await expect(call(`/${id}/tasks`,'POST',{revision:1,tasks:choices},colleague)).rejects.toMatchObject({status:409});
 const response=(await call(`/${id}/tasks`,'POST',{revision:1,tasks:[choices[0]],response:'requested'}))!;
 const delta=await response.json<{tasks:PlannerTask[]}>();expect(delta.tasks).toHaveLength(1);expect(delta.tasks[0].key).toBe('ba:tv:0');expect(delta.tasks[0].archived).toBe(false);
 expect(response.headers.get('Cache-Control')).toBe('private, no-store');
 const other=await(await call(`/${id}/tasks`,'GET',undefined,colleague))!.json<{tasks:PlannerTask[]}>();expect(other.tasks.some(t=>t.projectId===delta.tasks[0].projectId)).toBe(false);
 const legacy=await(await call(`/${id}/tasks`,'POST',{revision:1,tasks:[choices[0]]}))!.json<{tasks:PlannerTask[]}>();expect(legacy.tasks).toHaveLength(8);
 await expect(call(`/${id}/tasks`,'POST',{revision:1,tasks:[choices[0]],response:'all-actors'})).rejects.toThrow();
});

it('queues a 192-draft day through real transactions and resumes after a lost response without duplicates',async()=>{
 const data=plan();data.rows=Array.from({length:32},(_,i)=>({...row(String(i)),title:'PROGRAMME '+i,formats:['tv','portrait','vertical']}));const id=await save(data);
 const record=await(await call('/'+id))!.json<PlannerRecord<Plan>>(),choices=data.rows.flatMap(r=>r.kinds.flatMap(kind=>r.formats.map(format=>({rowIds:[r.id],kind,format}))));
 let lost=true;const sizes:number[]=[];
 const api={tasks:async()=>await(await call(`/${id}/tasks`))!.json<{tasks:PlannerTask[]}>(),create:async(_id:string,revision:number,tasks:typeof choices,options?:{response?:'requested'})=>{
  const result=await(await call(`/${id}/tasks`,'POST',{revision,tasks,response:options?.response}))!.json<{tasks:PlannerTask[]}>();sizes.push(result.tasks.length);
  if(lost){lost=false;throw Error('Réponse perdue après enregistrement');}return result;
 }};
 await expect(createPlannerQueue({record,choices,api,signal:new AbortController().signal,onProgress:()=>{}})).rejects.toThrow('Réponse perdue');
 const first=(await api.tasks()).tasks[0];await env.DB.prepare("UPDATE projects SET title='Version relue',revision=revision+1 WHERE id=?").bind(first.projectId).run();
 const result=await createPlannerQueue({record,choices,api,signal:new AbortController().signal,onProgress:()=>{}});
 expect(result.completed).toBe(192);expect(result.tasks).toHaveLength(192);expect(sizes).toEqual(Array(24).fill(8));expect(result.tasks.find(t=>t.projectId===first.projectId)?.title).toBe('Version relue');
 const counts=await env.DB.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT project_id) AS uniqueProjects FROM planner_personal_tasks WHERE plan_id=? AND actor=?').bind(id,designer.email).first<{n:number;uniqueProjects:number}>();expect(counts).toEqual({n:192,uniqueProjects:192});
 const wrongOwner=await env.DB.prepare("SELECT COUNT(*) AS n FROM planner_personal_tasks t JOIN projects p ON p.id=t.project_id WHERE t.plan_id=? AND (p.created_by<>? OR p.visibility<>'private')").bind(id,designer.email).first<{n:number}>();expect(wrongOwner?.n).toBe(0);
 expect((await(await call(`/${id}/tasks`,'GET',undefined,colleague))!.json<{tasks:PlannerTask[]}>()).tasks).toHaveLength(0);
},30000);
