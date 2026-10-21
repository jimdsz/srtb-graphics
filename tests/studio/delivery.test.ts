import {env} from 'cloudflare:workers';
import {applyD1Migrations} from 'cloudflare:test';
import {afterEach,beforeAll,expect,inject,it,vi} from 'vitest';
import {unzipSync,strFromU8} from 'fflate';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import inventory from '../../reports/library-intake.json';
import {broadcastTemplates,templateDefaults} from '../../src/studio/domain';
import type {Project,MediaAsset,Member} from '../../src/studio/domain';
import {buildDeliveryPlan,safePackagePath} from '../../src/studio/delivery-plan';
import {packageDocuments} from '../../src/studio/delivery-runtime';
import {writeDeliveryZip} from '../../src/studio/delivery-zip';
import type {DeliveryPlan,DeliveryFile} from '../../src/studio/delivery-plan';
import {deliveryPlan} from '../../server/delivery';
import {projectRoutes} from '../../server/projects';
import {readyMedia} from '../../server/ready-media';
import {sharedMediaReferences} from '../../server/media-references';

declare module 'vitest' { export interface ProvidedContext { migrations: import('@cloudflare/vitest-plugin').D1Migration[] } }
const admin:Member={email:'admin@example.com',name:'Jimmy de Souza',role:'admin',active:1};
beforeAll(async()=>{await applyD1Migrations(env.DB,inject('migrations'));});
afterEach(()=>vi.restoreAllMocks());
const project=(template=broadcastTemplates[0]):Project=>({id:'00000000-0000-4000-8000-000000000001',title:'Recette </script>',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,status:'approved',revision:3,data:templateDefaults(template),created_by:'author@example.test',updated_by:'admin@example.test',created_at:'',updated_at:'',archived:0});

async function seedMedia(count:number,status:MediaAsset['status']='ready',mime='video/mp4') {
  const media:MediaAsset[]=Array.from({length:count},()=>({id:crypto.randomUUID(),name:'Clip.mp4',mime_type:mime,bytes:30,status,created_by:admin.email,created_at:''}));
  for(let offset=0;offset<media.length;offset+=12){
    const chunk=media.slice(offset,offset+12);
    await env.DB.prepare(`INSERT INTO media(id,object_key,name,mime_type,bytes,status,created_by) VALUES ${chunk.map(()=>'(?,?,?,?,?,?,?)').join(',')}`)
      .bind(...chunk.flatMap(row=>[row.id,`media/${row.id}`,row.name,row.mime_type,row.bytes,row.status,row.created_by])).run();
  }
  return media;
}
const sharedUrl=(id:string)=>`/api/graphics/media/${id}/content`;
function multiMediaProject(media:MediaAsset[]) {
  const p=project(broadcastTemplates.find(template=>template.id==='BTV_BA_1P')!);
  for(const [index,track] of ['intro','body','pack'].entries())p.data[`_media_${track}_sequence`]=JSON.stringify(media.slice(index*20,index*20+20).map(row=>({url:sharedUrl(row.id),start:0,end:1})));
  return p;
}
const projectRequest=(path:string,method='GET',body?:unknown)=>projectRoutes(new Request(`https://studio.example/api/projects${path}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,admin);

it('reads ready media with bound, deduplicated batches of at most 90 parameters',async()=>{
  const media=await seedMedia(181),ids=media.map(row=>row.id).reverse(),prepare=vi.spyOn(env.DB,'prepare');
  expect(await readyMedia(env.DB,[])).toEqual([]);expect(prepare).not.toHaveBeenCalled();
  const rows=await readyMedia(env.DB,[...ids,...ids]);
  expect(rows.map(row=>row.id)).toEqual(ids);expect(prepare).toHaveBeenCalledTimes(3);
  expect(prepare.mock.calls.map(([sql])=>(sql.match(/\?/g)??[]).length)).toEqual([90,90,1]);
  for(const [sql] of prepare.mock.calls){expect(sql).toContain("AND status='ready'");expect(ids.some(id=>sql.includes(id))).toBe(false);}
  expect(rows.every(row=>!Object.hasOwn(row,'object_key')&&!Object.hasOwn(row,'upload_id'))).toBe(true);
});

it('builds the identical delivery plan for 60 shared references in one media query',async()=>{
  const media=await seedMedia(60),p=multiMediaProject(media),template=broadcastTemplates.find(t=>t.id===p.template_id)!;
  expect(sharedMediaReferences(template,p.data)).toHaveLength(60);
  const expected=buildDeliveryPlan(p,template,inventory.assets,media),prepare=vi.spyOn(env.DB,'prepare');
  expect(await deliveryPlan(p,env.DB)).toEqual(expected);expect(prepare).toHaveBeenCalledTimes(1);
  expect(expected.files.filter(file=>file.url.startsWith('/api/graphics/media/'))).toHaveLength(60);
});

it('saves, submits and delivers 60 shared references without per-media reads or public caching',async()=>{
  const media=await seedMedia(60),p=multiMediaProject(media),prepare=vi.spyOn(env.DB,'prepare');
  const createdResponse=(await projectRequest('','POST',{title:p.title,templateId:p.template_id,data:p.data}))!;
  expect(createdResponse.status).toBe(201);expect(createdResponse.headers.get('Cache-Control')).toBe('private, no-store');
  expect(prepare).toHaveBeenCalledTimes(3);
  let saved=await createdResponse.json<Project>();
  prepare.mockClear();
  saved=await (await projectRequest(`/${saved.id}`,'PUT',{title:saved.title,revision:saved.revision,data:saved.data}))!.json<Project>();
  expect(prepare).toHaveBeenCalledTimes(3);
  prepare.mockClear();
  const snapshot=(await projectRequest(`/${saved.id}/export`,'POST',{title:saved.title,revision:saved.revision,data:saved.data}))!;
  expect(snapshot.headers.get('Cache-Control')).toBe('private, no-store');
  expect((await snapshot.json<{files:DeliveryFile[]}>()).files.filter(file=>file.url.startsWith('/api/graphics/media/'))).toHaveLength(60);
  expect(prepare).toHaveBeenCalledTimes(3);
  for(const status of ['submitted','approved']){
    prepare.mockClear();saved=await (await projectRequest(`/${saved.id}/status`,'POST',{revision:saved.revision,status}))!.json<Project>();
    expect(prepare).toHaveBeenCalledTimes(3);
  }
  prepare.mockClear();
  const response=(await projectRequest(`/${saved.id}/delivery?revision=${saved.revision}`))!;
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect((await response.json<{files:DeliveryFile[]}>()).files.filter(file=>file.url.startsWith('/api/graphics/media/'))).toHaveLength(60);
  expect(prepare).toHaveBeenCalledTimes(3);
  expect(prepare.mock.calls.filter(([sql])=>sql.includes('FROM media'))).toHaveLength(2);
});

it('preserves missing and unfinished media errors and never caches a previous ready result',async()=>{
  const uploading=await seedMedia(1,'uploading'),failed=await seedMedia(1,'failed'),ready=await seedMedia(1);
  expect((await readyMedia(env.DB,[ready[0].id])).map(row=>row.id)).toEqual([ready[0].id]);
  await env.DB.prepare("UPDATE media SET status='failed' WHERE id=?").bind(ready[0].id).run();
  for(const id of [crypto.randomUUID(),uploading[0].id,failed[0].id,ready[0].id]){
    const p=project();p.data._media_body_url=sharedUrl(id);
    await expect(projectRequest('','POST',{title:p.title,templateId:p.template_id,data:p.data})).rejects.toMatchObject({status:422,message:'Un média partagé manque ou son transfert n’est pas terminé.'});
    await expect(deliveryPlan(p,env.DB)).rejects.toThrow('Un média partagé n’est plus disponible.');
  }
});

it('keeps MIME validation at delivery and rejects invalid project media before querying',async()=>{
  const media=await seedMedia(1,'ready','text/html'),p=project();p.data._media_body_url=sharedUrl(media[0].id);
  // Readiness-only save semantics stay unchanged; package construction rejects the MIME.
  const saved=await (await projectRequest('','POST',{title:p.title,templateId:p.template_id,data:p.data}))!.json<Project>();
  await expect(deliveryPlan(p,env.DB)).rejects.toThrow('Format média non pris en charge.');
  await expect(projectRequest(`/${saved.id}/export`,'POST',{title:saved.title,revision:saved.revision,data:saved.data})).rejects.toMatchObject({status:422,message:'Format média non pris en charge.'});
  const prepare=vi.spyOn(env.DB,'prepare');p.data._media_body_url='https://outside.example/clip.mp4';
  await expect(projectRequest('','POST',{title:p.title,templateId:p.template_id,data:p.data})).rejects.toThrow();
  expect(prepare).not.toHaveBeenCalled();
});

it('does not query absent inactive media or a shared source replaced by a playlist',async()=>{
  const template=broadcastTemplates.find(t=>t.id==='BTV_PopUp')!,p=project(template),unused=sharedUrl(crypto.randomUUID());
  p.data._background_visible=false;p.data._media_background_url=unused;
  p.data._media_background_sequence=JSON.stringify([{url:unused,start:0,end:1}]);
  p.data._media_popup_url=unused;p.data._media_popup_sequence=JSON.stringify([{url:'lib/media/default-popup.png',start:0,end:1}]);
  const prepare=vi.spyOn(env.DB,'prepare'),plan=await deliveryPlan(p,env.DB);
  expect(prepare).not.toHaveBeenCalled();expect(plan.files.some(file=>file.url===unused)).toBe(false);
  const saved=(await projectRequest('','POST',{title:p.title,templateId:p.template_id,data:p.data}))!;
  expect(saved.status).toBe(201);expect(prepare.mock.calls.some(([sql])=>sql.includes('FROM media'))).toBe(false);
});
it('builds complete, version-pinned resource inventories for all seven engines',()=>{
  for(const t of broadcastTemplates){const plan=buildDeliveryPlan(project(t),t,inventory.assets,[]);expect(plan.files.length).toBeGreaterThan(5);expect(plan.files.some(f=>f.path==='graphic.mjs')).toBe(true);expect(plan.files.some(f=>f.path.includes('fonts/'))).toBe(true);expect(plan.totalBytes).toBe(plan.files.reduce((n,f)=>n+f.bytes,0));expect(plan.files.every(f=>safePackagePath(f.path))).toBe(true);const docs=packageDocuments(plan,t);expect(docs['SRTB-PROJET.html']).toContain('SPXGCTemplateDefinition');expect(docs['srtb-project.mjs']).toContain('data:tvData(project.data)');expect(docs['PROJET.json']).not.toContain('author@example.test');}
});
it('rewrites shared assets and sequences to local paths without credentials',()=>{
  const t=broadcastTemplates[0],p=project(t),id='00000000-0000-4000-8000-000000000099',url=`/api/graphics/media/${id}/content`;
  p.data._media_intro_url={url,name:'Clip.mp4',mimeType:'video/mp4'};p.data._media_intro_sequence=JSON.stringify([{url,start:2,end:5},{url:{url,name:'Clip.mp4',mimeType:'video/mp4'},start:6,end:9}]);
  const media:MediaAsset={id,name:'Clip.mp4',mime_type:'video/mp4',bytes:30,status:'ready',created_by:'a',created_at:''};
  const plan=buildDeliveryPlan(p,t,inventory.assets,[media]);expect(plan.files.filter(f=>f.url===url)).toHaveLength(1);expect(JSON.stringify(plan.data)).not.toContain('/api/');expect(JSON.stringify(plan.data)).toContain(`lib/shared/${id}.mp4`);
  expect(()=>buildDeliveryPlan(p,t,inventory.assets,[])).toThrow('disponible');
  expect(()=>buildDeliveryPlan({...p,template_version:'9.9.9'},t,inventory.assets,[media])).toThrow('version');
});
it('exports simple BA as a TV package with only the first appointment, without studio settings',()=>{
  const t=broadcastTemplates[0],p=project(t);p.data={...p.data,_studio_format:'vertical',_studio_ba_mode:'simple',_jour_1:'Demain',_jour_2:'Vendredi'};
  const docs=packageDocuments(buildDeliveryPlan(p,t,inventory.assets,[]),t);
  const document=JSON.parse(docs['PROJET.json']);expect(document.data._studio_format).toBe('vertical');expect(document.data._jour_2).toBe('Vendredi');
  const runtime=docs['srtb-project.mjs'];
  const helper=runtime.slice(runtime.indexOf('const ceilFrameSeconds='),runtime.indexOf('\n',runtime.indexOf('const tvData=')));
  const native=new Function('project',helper+';return tvData;')(document);
  expect(native(document.data)._jour_1).toBe('Demain');expect(native(document.data)._jour_2).toBe('');expect(native(document.data)._studio_format).toBeUndefined();
  expect(native({_jour_2:'Samedi'})._jour_2).toBe('');
  expect(native({...document.data,_studio_ba_pack_scale:65})._studio_ba_pack_scale).toBe(65);
  expect(docs['studio-graphic.mjs']).toContain('applyTextEditing(configured.data,next,validateTextWidths)');
  expect(docs['studio-text-layout.mjs']).toContain('normalizeTextConfig');
  expect(docs['srtb-project.mjs']).toContain("import Graphic from './studio-graphic.mjs'");
  expect(docs['SRTB-PROJET.html']).not.toContain('"field": "_studio_');expect(docs['SRTB-PROJET.html']).not.toContain('"field": "_jour_2"');
});
it('rejects unknown resources and unsafe archive names',()=>{
  const t=broadcastTemplates[0],p=project(t);p.data._media_intro_url='lib/media/absent.mp4';expect(()=>buildDeliveryPlan(p,t,inventory.assets,[])).toThrow('absente');
  for(const value of ['/root.txt','../secret','C:/file','lib/../../a','lib//x','lib/%2e%2e/x','lib\\x'])expect(safePackagePath(value)).toBe(false);
});
it('keeps local media as hash-pinned references without requesting uploads',()=>{
  const t=broadcastTemplates[0],p=project(t),url=`local-media:${'a'.repeat(64)}:120`;
  const descriptor={url,name:'Émission.mp4',mimeType:'video/mp4'};
  p.data._media_body_url=descriptor;p.data._media_body_sequence=JSON.stringify([{url:descriptor,start:1,end:3}]);
  const plan=buildDeliveryPlan(p,t,inventory.assets,[]),files=plan.files.filter(f=>f.url===url);
  expect(files).toHaveLength(1);expect(files[0]).toMatchObject({bytes:120,sha256:'a'.repeat(64)});
  expect(JSON.stringify(plan.data)).not.toContain('local-media:');expect(JSON.stringify(plan.data)).toContain('lib/local/');
});
it('allows a video-render snapshot with a large local source but still blocks an oversized ZIP before reading it',async()=>{
  const t=broadcastTemplates[0],p=project(t),url=`local-media:${'a'.repeat(64)}:${4*1024**3}`;
  p.data._media_body_url={url,name:'Long.mp4',mimeType:'video/mp4'};
  p.data._media_body_start_seconds=600;p.data._media_body_end_seconds=606;
  const plan=buildDeliveryPlan(p,t,inventory.assets,[]);expect(plan.totalBytes).toBeGreaterThan(4*1024**3);
  let read=false;await expect(writeDeliveryZip(plan,{}, {write:async()=>{},close:async()=>{},abort:async()=>{}},new AbortController().signal,()=>{},async()=>{read=true;return new Response();})).rejects.toThrow('volumineuse');expect(read).toBe(false);
});
it('streams local media through the supplied local resolver and verifies content',async()=>{
  const {plan,bodies}=tiny(),file=plan.files[0],body=bodies.get(file.url)!;
  file.url=`local-media:${file.sha256}:${body.length}`;bodies.clear();bodies.set(file.url,body);
  const job=await archive(plan,bodies);await job.done;expect(job.state()).toEqual({closed:true,aborted:false});
});
it('does not require inactive or playlist-replaced local files in exported projects',()=>{
  const t=broadcastTemplates.find(t=>t.id==='BTV_PopUp')!,p=project(t);
  const hidden={url:`local-media:${'a'.repeat(64)}:120`,name:'unused.mp4',mimeType:'video/mp4'};
  p.data._background_visible=false;p.data._media_background_url=hidden;
  p.data._media_background_sequence=JSON.stringify([{url:hidden,start:0,end:3}]);
  p.data._media_popup_url=hidden;p.data._media_popup_sequence=JSON.stringify([{url:'lib/media/default-popup.png',start:0,end:5}]);
  const before=JSON.stringify(p.data),plan=buildDeliveryPlan(p,t,inventory.assets,[]);
  expect(plan.files.some(file=>file.url===hidden.url)).toBe(false);
  expect(plan.data._media_background_sequence).toBe('[]');
  expect(plan.data._media_popup_url).toBe('');expect(JSON.stringify(p.data)).toBe(before);
});
async function archive(plan:DeliveryPlan,bodies:Map<string,Uint8Array>,signal=new AbortController().signal){
  const chunks:Uint8Array[]=[];let closed=false,aborted=false;
  const sink={write:async(c:Uint8Array)=>{chunks.push(c);},close:async()=>{closed=true;},abort:async()=>{aborted=true;}};
  const fetcher:typeof fetch=async(input)=>new Response(bodies.get(String(input)) as Uint8Array<ArrayBuffer>,{headers:{'Content-Type':'application/octet-stream'}});
  const done=writeDeliveryZip(plan,{'PROJET.json':'{"title":"Émission"}'},sink,signal,()=>{},fetcher);
  return {done,result:()=>{const all=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}return {files:unzipSync(all),closed,aborted};},state:()=>({closed,aborted})};
}
const tiny=():{plan:DeliveryPlan;bodies:Map<string,Uint8Array>}=>{const body=new TextEncoder().encode('export default "image";'),file:DeliveryFile={path:'graphic.mjs',url:'/library/v1.7.0/BTV_Relais_Antenne/graphic.mjs',bytes:body.length,sha256:bytesToHex(sha256(body))};return {plan:{format:'srtb-review-package',version:1,filename:'test.zip',project:{id:'test',title:'Test',revision:3,templateId:'BTV_Relais_Antenne',templateVersion:'1.0.0',libraryVersion:'1.7.0'},data:{},files:[file],totalBytes:body.length},bodies:new Map([[file.url,body]])};};
it('streams a readable ZIP with verified hashes and an integrity inventory',async()=>{
  const {plan,bodies}=tiny(),job=await archive(plan,bodies);await job.done;const {files,closed,aborted}=job.result();expect(closed).toBe(true);expect(aborted).toBe(false);expect(Object.keys(files)).toEqual(['graphic.mjs','PROJET.json','INVENTAIRE.json']);const manifest=JSON.parse(strFromU8(files['INVENTAIRE.json']));for(const f of manifest.files)expect(f.sha256).toBe(bytesToHex(sha256(files[f.path])));
});
it('never finalises a truncated or altered resource',async()=>{
  for(const wrong of [new Uint8Array([1]),new Uint8Array(23)]){const {plan,bodies}=tiny();bodies.set(plan.files[0].url,wrong);const job=await archive(plan,bodies);await expect(job.done).rejects.toThrow();expect(job.state()).toEqual({closed:false,aborted:true});}
});
it('aborts instead of emitting a partial success on cancellation',async()=>{
  const {plan,bodies}=tiny(),controller=new AbortController();controller.abort();const job=await archive(plan,bodies,controller.signal);await expect(job.done).rejects.toThrow();expect(job.state()).toEqual({closed:false,aborted:true});
});
it('refuses to commit a ZIP when its final approval check fails',async()=>{
  const {plan,bodies}=tiny();let closed=false,aborted=false,checked=false,writes=0;
  const sink={write:async()=>{writes++;},close:async()=>{closed=true;},abort:async()=>{aborted=true;}};
  const fetcher:typeof fetch=async input=>new Response(bodies.get(String(input)) as Uint8Array<ArrayBuffer>);
  await expect(writeDeliveryZip(plan,{},sink,new AbortController().signal,()=>{},fetcher,async()=>{checked=true;throw Error('Révision modifiée par un collègue.');})).rejects.toThrow('Révision modifiée');
  expect({closed,aborted,checked}).toEqual({closed:false,aborted:true,checked:true});expect(writes).toBeGreaterThan(0);
});
it('honours cancellation while the final approval check is pending',async()=>{
  const {plan,bodies}=tiny(),controller=new AbortController();let closed=false,aborted=false;
  const sink={write:async()=>{},close:async()=>{closed=true;},abort:async()=>{aborted=true;}};
  const fetcher:typeof fetch=async input=>new Response(bodies.get(String(input)) as Uint8Array<ArrayBuffer>);
  await expect(writeDeliveryZip(plan,{},sink,controller.signal,()=>{},fetcher,async()=>{controller.abort();})).rejects.toThrow();
  expect({closed,aborted}).toEqual({closed:false,aborted:true});
});
