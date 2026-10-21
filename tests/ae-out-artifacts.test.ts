import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {transform} from 'esbuild';
import {aeOutArtifacts} from '../scripts/build-ae-out.mjs';
import {previewNetworkArtifacts} from '../scripts/build-preview-network.mjs';
import {copyNativePublicAssets} from '../scripts/native-public-assets.mjs';
import {writeNativeInventory,verifyNativeInventory} from '../scripts/native-release-audit.mjs';
import {packageDocuments} from '../src/studio/delivery-runtime';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {DeliveryPlan} from '../src/studio/delivery-plan';

const projectRoot=new URL('../',import.meta.url);
const read=(path:string)=>readFile(new URL(path,projectRoot),'utf8');
const sha256=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const generated=await aeOutArtifacts(),preview=await previewNetworkArtifacts(true);
const helper=await import('data:text/javascript;base64,'+Buffer.from(generated.runtime).toString('base64'));
const contracts=[{id:'BTV_Evenement',outFrame:443,outDuration:3.32},{id:'BTV_Semainier',outFrame:581,outDuration:3.08}];

test('complete AE OUT generator reproduces every public artifact and the embedded portable engine',async()=>{
  assert.deepEqual([...generated.files.keys()].sort(),['BTV_Evenement.mjs','BTV_Semainier.mjs','ae-engine.mjs','complete-out.mjs']);
  for(const [name,content]of generated.files)assert.equal(await read('public/studio-engines/ae-out-v1/'+name),content,name);
  const embedded=JSON.parse(await read('src/studio/ae-out-runtime.generated.json'));
  assert.equal(embedded.code,generated.runtime);assert.equal(embedded.engine,generated.portableEngine);
  assert.match(generated.files.get('ae-engine.mjs')!,/import \{aeOutFinished\} from '\.\/complete-out\.mjs'/);
  assert.match(generated.portableEngine,/import \{aeOutFinished\} from '\.\/studio-ae-out\.mjs'/);
  for(const [name,content]of preview)assert.equal(await read('public/studio-engines/preview-network-v2/'+name),content,'preview-network-v2/'+name);
});

for(const {id,outFrame,outDuration}of contracts)test(`${id}: portable documents execute the generated complete-tail configuration without rewriting project values`,async()=>{
  const template=getTemplate(id),configModule=await import(new URL(`public/library/v1.7.0/${id}/config.mjs`,projectRoot).href);
  for(const mode of ['duration','manual']){
    const data={...templateDefaults(template),_out_mode:mode,_out_duration_seconds:28.013};
    const plan:DeliveryPlan={format:'srtb-review-package',version:1,filename:'qualification.zip',
      project:{id:'local-qualification',title:'Complete native OUT',revision:7,templateId:id,templateVersion:template.version,libraryVersion:template.libraryVersion},data,files:[],totalBytes:0};
    const before=JSON.stringify(plan),sourceBefore=JSON.stringify(configModule.CONFIG);
    const documents=packageDocuments(plan,template);
    for(const name of ['studio-ae-out.mjs','studio-ae-engine.mjs','studio-graphic.mjs','srtb-project.mjs','PROJET.json'])assert.ok(documents[name],name);
    assert.equal(documents['studio-ae-out.mjs'],generated.runtime);
    assert.equal(documents['studio-ae-engine.mjs'],generated.portableEngine);
    assert.match(documents['srtb-project.mjs'],/^import Graphic from '\.\/studio-graphic\.mjs';/);
    assert.match(documents['studio-graphic.mjs'],/from '\.\/studio-ae-engine\.mjs'/);
    assert.match(documents['studio-graphic.mjs'],/from '\.\/studio-ae-out\.mjs'/);
    // Execute the real generated entry/module glue. Rendering is outside this
    // packaging test, so only the engine factory is replaced by a config capture.
    const captured:any[]=[],module={exports:{}};
    const {code}=await transform(documents['studio-graphic.mjs'],{loader:'js',format:'cjs',target:'es2022',define:{'import.meta.url':JSON.stringify('file:///qualification/studio-graphic.mjs')}});
    runInNewContext(code,{URL,module,exports:module.exports,require(path:string){
      if(path==='./lib/lottie-web.esm.mjs')return {};
      if(path==='./config.mjs')return configModule;
      if(path==='./studio-ae-out.mjs')return helper;
      if(path==='./studio-ae-engine.mjs')return {createAETemplate(_lottie:unknown,config:unknown,url:string){captured.push({config,url});return class PortableGraphic {};}};
      throw Error('Unexpected portable dependency: '+path);
    }},{timeout:1000});
    assert.equal(captured.length,1);
    const adapted=captured[0].config;
    assert.equal(adapted.timing.outFrame,outFrame);assert.equal(adapted.timing.outDuration,outDuration);
    assert.equal(adapted.defaults,configModule.CONFIG.defaults);assert.equal(adapted.media,configModule.CONFIG.media);
    assert.equal((module.exports as any).TIMING,adapted.timing);
    assert.equal(captured[0].url,'file:///qualification/graphic.mjs');
    assert.deepEqual(JSON.parse(documents['PROJET.json']).data,data);
    assert.equal(JSON.parse(documents['PROJET.json']).data._out_duration_seconds,28.013);
    assert.equal(JSON.stringify(plan),before);assert.equal(JSON.stringify(configModule.CONFIG),sourceBefore);
  }
});

async function put(path:string,bytes:string|Buffer){await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
async function nativeFixture(t:TestContext){
  const parent=resolve(tmpdir()),root=await mkdtemp(join(parent,'srtb-ae-out-artifacts-'));
  t.after(async()=>{
    const target=resolve(root),info=await lstat(target);
    assert.equal(dirname(target),parent);assert.ok(basename(target).startsWith('srtb-ae-out-artifacts-'));
    assert.notEqual(target,parent);assert.ok(info.isDirectory()&&!info.isSymbolicLink());
    await rm(target,{recursive:true,force:true});
  });
  for(const tree of ['fonts','library','preview-media','social','studio-engines','templates','thumbnails'])await mkdir(join(root,'public',tree),{recursive:true});
  const required=['assets/srtb-theme-init.js','favicon.svg','licenses/mediabunny-prores-1.58.1-source.tar.gz','licenses/prores-wasm-encoder-0.3.1-source.tar.gz','licenses/turbores-1.2.2-source.tar.gz'];
  for(const path of required)await put(join(root,'public',path),'qualified fixture asset');
  const installer=Buffer.from('qualified internal connector fixture'),digest=sha256(installer),installerPath='downloads/graphics-connector-windows-x64-'+digest.slice(0,8)+'.exe';
  await put(join(root,'public',installerPath),installer);
  await put(join(root,'connector/windows/release.json'),JSON.stringify({status:'internal-pilot-unsigned',file:basename(installerPath),sha256:digest,bytes:installer.length}));
  required.push(installerPath);
  const assets=new Map<string,string>();
  for(const [folder,files]of [['ae-out-v1',generated.files],['preview-network-v2',preview]] as const)for(const name of files.keys()){
    assert.match(name,/^[\w.-]+$/);
    const path=`studio-engines/${folder}/${name}`,bytes=await read('public/'+path);assets.set(path,bytes);
    await put(join(root,'public',path),bytes);
  }
  // Neither a new unlisted root asset nor the forbidden software tree may leak
  // into the release just because studio-engines gained these versioned files.
  await put(join(root,'public','ffmpeg','excluded.bin'),'excluded fixture');
  await put(join(root,'public','assets','unlisted.js'),'excluded fixture');
  const build=join(root,'dist-studio-native'),graph=join(root,'reports','graph.json'),inventory=join(root,'reports','inventory.json');
  await put(join(build,'index.html'),'<script type="module" src="/assets/app.js"></script>');
  await put(join(build,'assets','app.js'),'export const nativeOnly=true;');
  await put(join(build,'_worker.js'),'async function authenticateSession() {}\nexport default {fetch() {throw Error("Public fallback is forbidden.");}};');
  await put(join(build,'_routes.json'),JSON.stringify({version:1,include:['/*'],exclude:[]}));
  await put(graph,JSON.stringify({profile:'native-only',modules:['src/studio/video/release-profile.ts','src/studio/video/opaque-native-adapter.ts','src/studio/ae-out-timing.ts'],outputs:['index.html','assets/app.js']}));
  return {root,build,graph,inventory,assets,required};
}

test('native allowlist really copies and seals both new engine trees, while exclusion and integrity guards remain active',async t=>{
  const fixture=await nativeFixture(t),{root,build,graph,inventory,assets,required}=fixture;
  assert.equal(await copyNativePublicAssets(root),assets.size+required.length);
  for(const [path,bytes]of assets)assert.equal(await readFile(join(build,path),'utf8'),bytes,path);
  for(const path of ['ffmpeg/excluded.bin','assets/unlisted.js'])await assert.rejects(readFile(join(build,path)),{code:'ENOENT'});
  const sealed=await writeNativeInventory(build,graph,inventory);
  assert.equal(sealed.profile,'native-only');
  for(const [path,bytes]of assets){
    const record=sealed.files.find((file:any)=>file.path===path);assert.ok(record,'Unsealed derived engine: '+path);
    assert.equal(record.bytes,Buffer.byteLength(bytes));assert.equal(record.sha256,sha256(bytes));
  }
  assert.ok(sealed.directories.includes('studio-engines/ae-out-v1'));
  assert.ok(sealed.directories.includes('studio-engines/preview-network-v2'));
  assert.deepEqual(await verifyNativeInventory(build,graph,inventory),sealed);
  const witness='studio-engines/ae-out-v1/complete-out.mjs';
  await put(join(build,witness),assets.get(witness)+'\n// Changed after sealing.\n');
  await assert.rejects(verifyNativeInventory(build,graph,inventory),/inventory mismatch/);
});
