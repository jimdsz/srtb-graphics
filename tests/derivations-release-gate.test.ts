import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {studioWorkerOptions,studioWorkerOptionsFor} from '../scripts/studio-worker-options.mjs';
import {nativeReleaseProfile,nativeBuildProfile,nativePublicationOptions,nativeViteProfile,nativeClientDefines,assertWorkerDerivationProfile} from '../scripts/studio-release-profile.mjs';

const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));

const fixture=`
 import {api} from './server/router';
 import {deliveryPlan} from './server/delivery';
 import {getTemplate,templateDefaults} from './src/studio/domain';
 const member={email:'test@example.test',name:'Qualification',role:'admin',active:1};
 export default {async fetch(request){
  // Catalogue access now requires channel membership even in the OFF profile.
  // Permit those read-only scope probes, never a derivation query or write.
  const DB={prepare(sql){
   if(sql.startsWith('SELECT id FROM channels c WHERE'))return {bind(){return {async first(){return {id:'benin-tv'};}}}};
   if(sql==='SELECT channel_id FROM projects WHERE id=?')return {bind(){return {async first(){return null;}}}};
   throw Error('Unexpected database call in release-profile fixture.');
  }};
  if(new URL(request.url).pathname==='/foreign-delivery'){
   const t=getTemplate('BTV_PopUp'),project={id:'test',template_id:t.id,template_version:t.version,library_version:t.libraryVersion,title:'Test',revision:1,status:'draft',data:{...templateDefaults(t),_media_popup_url:'/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4'}};
   try{await deliveryPlan(project,DB);return new Response('unexpected success',{status:500});}catch(error){return new Response(error.message,{status:422});}
  }
  return await api(request,{DB},member)||new Response('Not found',{status:404});
 }};
`;
test('bug-fix Worker physically excludes derivation routes, source tables and mapping',async()=>{
 const compiled=await build({...studioWorkerOptions,write:false,metafile:true,stdin:{contents:fixture,resolveDir:repositoryRoot,loader:'ts'}});
 const paths=Object.keys(compiled.metafile!.inputs).map(path=>path.replaceAll('\\','/'));
 assert.ok(!paths.some(path=>/server\/(?:project-derivations|derivation-origin|derivation-client)\.ts$/.test(path)));
 assert.ok(!paths.some(path=>path.endsWith('src/studio/derivation-model.ts')));
 assert.doesNotMatch(compiled.outputFiles[0].text,/derivation_batches|project_derivations/);
 assertWorkerDerivationProfile(paths,compiled.outputFiles[0].text,nativeReleaseProfile());
 const runtime=new Miniflare(convertV4MiniflareOptions({script:compiled.outputFiles[0].text,modules:true,compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat']}));
 try{
  for(const [path,method]of [['/projects/00000000-0000-4000-8000-000000000001/derivations','GET'],['/projects/00000000-0000-4000-8000-000000000001/derivations','POST'],['/projects/00000000-0000-4000-8000-000000000001/derivation-origin','GET'],['/derivations/00000000-0000-4000-8000-000000000002','GET']]){
   const response=await runtime.dispatchFetch('https://studio.example/api/graphics'+path,{method,headers:{Origin:'https://studio.example','Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});assert.equal(response.status,404,path);
  }
  const foreign=await runtime.dispatchFetch('https://studio.example/foreign-delivery');assert.equal(foreign.status,422);assert.doesNotMatch(await foreign.text(),/database call|unexpected success/i);
  assert.equal((await runtime.dispatchFetch('https://studio.example/api/graphics/templates')).status,200);
 }finally{await runtime.dispose();}
});
test('explicit production ON includes the complete API and compatibility guard without changing OFF default',async()=>{
 assert.equal(studioWorkerOptions.define.__SRTB_DERIVATIONS__,'false');
 const compiled=await build({...studioWorkerOptionsFor('native-derivations'),write:false,metafile:true,stdin:{contents:fixture,resolveDir:repositoryRoot,loader:'ts'}});
 const paths=Object.keys(compiled.metafile!.inputs).map(path=>path.replaceAll('\\','/'));
 assert.ok(paths.some(path=>path.endsWith('server/project-derivations.ts')));assert.ok(paths.some(path=>path.endsWith('server/derivation-origin.ts')));assert.ok(paths.some(path=>path.endsWith('src/studio/derivation-model.ts')));
 assert.ok(paths.some(path=>path.endsWith('server/derivation-client.ts')));
 assertWorkerDerivationProfile(paths,compiled.outputFiles[0].text,nativeReleaseProfile('native-derivations'));
 assert.throws(()=>assertWorkerDerivationProfile(paths,compiled.outputFiles[0].text,nativeReleaseProfile()),/must be absent/);
 for(const missing of ['server/project-derivations.ts','server/derivation-origin.ts','server/derivation-client.ts','src/studio/derivation-model.ts'])assert.throws(()=>assertWorkerDerivationProfile(paths.filter(path=>!path.endsWith(missing)),compiled.outputFiles[0].text,nativeReleaseProfile('native-derivations')),/module missing/);
 for(const source of ['src/studio/catalogue.generated.json','src/studio/catalogue.extensions.json'])assert.ok(paths.some(path=>path.endsWith(source)),source);
 const runtime=new Miniflare(convertV4MiniflareOptions({script:compiled.outputFiles[0].text,modules:true,compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat']}));
 try{
  const response=await runtime.dispatchFetch('https://studio.example/api/graphics/templates');assert.equal(response.status,200);
  const catalogue=await response.json() as {id:string;module:string;preview:string;fields:Record<string,{enum?:string[]}>}[];
  for(const id of ['BTV_BA_TDS','BTV_Renvoi','BTV_Evenement','BTV_Semainier']){
   const item=catalogue.find(template=>template.id===id);assert.ok(item,id);
   // The three AE additions use the already-published live-media v2 adapter;
   // TDS keeps its original dedicated engine. Never fall back to the old AE file.
   assert.equal(item.module,`/library/v1.7.0/${id}/${id==='BTV_BA_TDS'?'graphic.mjs':'graphic-v2.mjs'}`);assert.equal(item.preview,`/library/v1.7.0/${id}/preview.html`);
  }
  assert.deepEqual(catalogue.find(template=>template.id==='BTV_Renvoi')!.fields.variant.enum,['1L','2L']);
 }finally{await runtime.dispose();}
});

test('native client and Worker profiles select the same explicit flags with qualification disabled',()=>{
 for(const name of ['native-only','native-derivations']){
  const profile=nativeReleaseProfile(name),client=nativeClientDefines(profile),worker=studioWorkerOptionsFor(name);
  assert.equal(client.__SRTB_DERIVATIONS__,worker.define.__SRTB_DERIVATIONS__);
  assert.equal(client.__SRTB_NATIVE_ONLY__,'true');assert.equal(client['import.meta.env.VITE_STUDIO_QUALIFICATION'],'false');
  assert.equal(nativeViteProfile(name).name,name);
 }
 assert.equal(nativeViteProfile('production').name,'native-only');assert.equal(nativeBuildProfile([]).name,'native-only');
 assert.equal(nativeBuildProfile(['--derivations']).name,'native-derivations');
 assert.deepEqual(nativePublicationOptions(['--derivations','--check']),{production:false,profile:nativeReleaseProfile('native-derivations')});
 assert.deepEqual(nativePublicationOptions(['--production']),{production:true,profile:nativeReleaseProfile()});
 for(const args of [[],['--production','--check'],['--check','--check'],['--check','--skip-migrations'],['--derivations']])assert.throws(()=>nativePublicationOptions(args));
 assert.throws(()=>nativeViteProfile('derivations'));assert.throws(()=>nativeBuildProfile(['--derivations','--derivations']));
 assert.throws(()=>studioWorkerOptionsFor('strict-cbr'));
});
