import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,mkdtemp,readFile,rm,symlink,truncate,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {writeNativeInventory,verifyNativeInventory} from '../scripts/native-release-audit.mjs';
import {derivationMigrationRequirement} from '../scripts/derivation-migration-gate.mjs';
import {fileURLToPath} from 'node:url';

const modules=['src/studio/video/release-profile.ts','src/studio/video/opaque-native-adapter.ts','src/studio/Workspace.tsx'];
const worker='async function authenticateSession() {}\nexport default {fetch() {throw Error("Public fallback is forbidden.");}};';
const sha256=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function put(path:string,bytes:string|Buffer){await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
async function fixture(t:TestContext){
  const root=await mkdtemp(join(tmpdir(),'srtb-native-audit-'));
  t.after(async()=>{assert.equal(dirname(root),resolve(tmpdir()));await rm(root,{recursive:true,force:true});});
  const build=join(root,'build'),graph=join(root,'reports','graph.json'),inventory=join(root,'reports','inventory.json');
  await put(join(build,'index.html'),'<script type="module" src="/assets/app.js"></script>');
  await put(join(build,'assets','app.js'),'export const nativeOnly=true;');
  await put(join(build,'_worker.js'),worker);
  await put(join(build,'_routes.json'),JSON.stringify({version:1,include:['/*'],exclude:[]}));
  await put(graph,JSON.stringify({profile:'native-only',modules,outputs:['index.html','assets/app.js']}));
  return {root,build,graph,inventory,write:()=>writeNativeInventory(build,graph,inventory),verify:()=>verifyNativeInventory(build,graph,inventory)};
}

test('seals and verifies a complete native release without publishing its graph or inventory',async t=>{
  const f=await fixture(t);
  await put(join(f.build,'licenses','NOTICE.txt'),'Encoder derived from FFmpeg proresenc_kostya.c; LGPL source available.');
  // Source archives are not unpacked or mistaken for the excluded software encoder.
  await put(join(f.build,'licenses','prores-wasm-encoder-0.3.1-source.tar.gz'),gzipSync('FFmpeg source material including libx264 references'));
  const inventory=await f.write();
  assert.equal(inventory.profile,'native-only');assert.equal(inventory.files.length,6);
  assert.deepEqual(inventory.routes,{version:1,include:['/*'],exclude:[]});
  assert.equal(inventory.worker.path,'_worker.js');
  assert.equal(inventory.graph.sha256,sha256(await readFile(f.graph)));
  assert.ok(inventory.files.every((file:{path:string;bytes:number;sha256:string})=>file.bytes>0&&/^[a-f0-9]{64}$/.test(file.sha256)&&!file.path.includes('inventory')));
  const {sha256:seal,...payload}=inventory;assert.equal(seal,sha256(JSON.stringify(payload)));
  assert.deepEqual(await f.verify(),inventory);
});

test('requires a nonempty native-only module graph and both native policy modules',async t=>{
  for(const graph of [
    {},{profile:'native-only',modules:[]},{profile:'native-only',modules:[null]},
    {profile:'strict-cbr',modules},{profile:'native-only',modules:modules.slice(1)},
    {profile:'native-only',modules:[modules[0]]},
  ])await t.test(JSON.stringify(graph),async sub=>{
    const f=await fixture(sub);await put(f.graph,JSON.stringify(graph));
    await assert.rejects(f.write(),/module graph|required native module/);
  });
});

test('rejects excluded modules including absolute Windows paths and worker query suffixes',async t=>{
  for(const module of ['src/studio/video/cbr-fallback.ts','src/studio/video/cbr-fallback.worker.ts?worker','C:\\checkout\\vendor\\ffmpeg-core-0.12.10\\index.js','node_modules/@ffmpeg/core/dist/esm/index.js'])await t.test(module,async sub=>{
    const f=await fixture(sub);await put(f.graph,JSON.stringify({profile:'native-only',modules:[...modules,module]}));
    await assert.rejects(f.write(),/software fallback module forbidden/);
  });
});

test('rejects stale fallback chunks, a fallback directory and core license notices by path',async t=>{
  for(const name of ['assets/cbr-fallback.worker-old.js','assets/cbr-fallback-old.js','nested/ffmpeg/opaque.data','licenses/ffmpeg-core-0.12.10-NOTICE.md','licenses/ffmpeg-core-0.12.10-GPL-2.0-or-later.txt'])await t.test(name,async sub=>{
    const f=await fixture(sub);await put(join(f.build,name),'unchanged old artifact');
    await assert.rejects(f.write(),/software fallback artifact forbidden/);
  });
  const f=await fixture(t);await mkdir(join(f.build,'ffmpeg'));await assert.rejects(f.write(),/software fallback artifact forbidden/);
});

test('detects renamed forbidden payloads in every executable/text output kind',async t=>{
  const contaminated=[['old.js','ffmpeg-core'],['style.css','url(/ffmpeg/hidden.wasm)'],['old.html','libx264'],['old.json','"@ffmpeg/core"'],['old.mjs','cbr-fallback.worker'],['old.cjs','nal-hrd']];
  for(const [name,payload] of contaminated)await t.test(name,async sub=>{
    const f=await fixture(sub);await put(join(f.build,'assets',name),payload);
    await assert.rejects(f.write(),/software fallback content forbidden/);
  });
});

test('detects the pinned compressed vendor binary even when its filename and extension change',async t=>{
  const f=await fixture(t),source=new URL('../vendor/ffmpeg-core-0.12.10/ffmpeg-core.wasm.gz',import.meta.url);
  // Qualification fixture only: the audit itself never reads mutable vendor paths.
  const bytes=await readFile(source);
  assert.equal(sha256(bytes),'1767a2d0c6d6b14de37876261443397cecd591f298b162eded99018de4f6355d');
  await put(join(f.build,'assets','renamed.data'),bytes);
  await assert.rejects(f.write(),/pinned software fallback binary forbidden/);
});

test('allows only the exact frozen offline preparation source, never its mutation, renamed copy or graph import',async t=>{
  const path='library/v1.7.0/BTV_BA_1P/prepare-slow-motion.mjs';
  const bytes=await readFile(new URL('../public/'+path,import.meta.url));
  assert.equal(sha256(bytes),'be860549b99529de284aea3f88faf391125d586d8e569c8177bc9200fb818e16');
  for(const variant of ['exact','modified','renamed','module'])await t.test(variant,async sub=>{
    const f=await fixture(sub);
    await put(join(f.build,variant==='renamed'?'assets/renamed-utility.mjs':path),variant==='modified'?Buffer.concat([bytes,Buffer.from('\n// changed')]):bytes);
    if(variant==='module')await put(f.graph,JSON.stringify({profile:'native-only',modules:[...modules,'C:/checkout/public/'+path]}));
    if(variant==='exact'){await f.write();await f.verify();}
    else await assert.rejects(f.write(),/software fallback content forbidden|offline preparation source forbidden/);
  });
});

test('rejects changes, additions, removals, empty directories and graph changes after sealing',async t=>{
  for(const change of ['modify','add','remove','directory','graph'])await t.test(change,async sub=>{
    const f=await fixture(sub);await f.write();
    if(change==='modify')await put(join(f.build,'assets','app.js'),'export const nativeOnly=1;');
    if(change==='add')await put(join(f.build,'assets','old-open-session.js'),'export const obsolete=true;');
    if(change==='remove')await rm(join(f.build,'assets','app.js'));
    if(change==='directory')await mkdir(join(f.build,'old-session-assets'));
    if(change==='graph')await put(f.graph,JSON.stringify({profile:'native-only',modules:[...modules,'src/new.ts']}));
    await assert.rejects(f.verify(),/inventory mismatch|module graph output missing/);
  });
});

test('rejects a corrupt inventory, mismatched inventory fields and an unsealed inventory',async t=>{
  for(const change of ['syntax','field','seal','self-consistent-but-wrong'])await t.test(change,async sub=>{
    const f=await fixture(sub),inventory=await f.write();
    if(change==='syntax'){await put(f.inventory,'{');}
    else{
      if(change==='field')inventory.files[0].bytes++;
      if(change==='seal')delete inventory.sha256;
      if(change==='self-consistent-but-wrong'){
        inventory.files[0].bytes++;const {sha256:_seal,...payload}=inventory;inventory.sha256=sha256(JSON.stringify(payload));
      }
      await put(f.inventory,JSON.stringify(inventory));
    }
    await assert.rejects(f.verify(),/inventory unreadable|self-hash mismatch|inventory mismatch/);
  });
});

test('rejects private-route bypasses and missing or fail-open private workers',async t=>{
  for(const routes of [null,{version:1,include:['/api/*'],exclude:[]},{version:1,include:['/*'],exclude:['/assets/*']},{version:1,include:['/*','/other'],exclude:[]}])await t.test(JSON.stringify(routes),async sub=>{
    const f=await fixture(sub);await put(join(f.build,'_routes.json'),JSON.stringify(routes));
    await assert.rejects(f.write(),/all routes/);
  });
  for(const code of ['',worker.replace('authenticateSession','authenticate'),worker.replace('Public fallback is forbidden.','Allowed'),worker+'\ncontext.passThroughOnException();'])await t.test(code||'missing worker',async sub=>{
    const f=await fixture(sub);await put(join(f.build,'_worker.js'),code);
    await assert.rejects(f.write(),/private worker|public pass-through/);
  });
});

test('bug-fix inventory refuses an accidentally bundled unreleased derivation API',async t=>{
  for(const table of ['derivation_batches','project_derivations'])await t.test(table,async sub=>{
    const f=await fixture(sub);await put(join(f.build,'_worker.js'),worker+`\nconst query="SELECT * FROM ${table}";`);
    await assert.rejects(f.write(),/unreleased derivation API\/tables forbidden/);
  });
});

async function activatedFixture(t:TestContext){
  const f=await fixture(t),migration=await derivationMigrationRequirement(fileURLToPath(new URL('../',import.meta.url)));
  const graph={profile:'native-derivations',requirements:{version:1,nativeOnly:true,derivations:true,qualification:false,migrations:[migration]},modules:[...modules,'src/studio/DerivationPanel.tsx','src/studio/derivation-api.ts','src/studio/client-capabilities.ts'],outputs:['index.html','assets/app.js']};
  await put(f.graph,JSON.stringify(graph));
  const cataloguePaths=['BTV_BA_TDS','BTV_Renvoi','BTV_Evenement','BTV_Semainier'].flatMap(id=>[id==='BTV_BA_TDS'?'graphic.mjs':'graphic-v2.mjs','preview.html'].map(entry=>`library/v1.7.0/${id}/${entry}`));
  const catalogue=`\nconst catalogue=${JSON.stringify(cataloguePaths.map(path=>'/'+path))};`;
  for(const path of cataloguePaths)await put(join(f.build,path),'qualified catalogue fixture');
  for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier'])await put(join(f.build,`library/v1.7.0/${id}/graphic.mjs`),'preserved original');
  await put(join(f.build,'assets','app.js'),'export const nativeOnly=true;'+catalogue);
  await put(join(f.build,'_worker.js'),worker+'\nconst schema="derivation_batches project_derivations derivations-v1";'+catalogue);
  return {...f,manifest:graph,write:()=>writeNativeInventory(f.build,f.graph,f.inventory,'native-derivations'),verify:()=>verifyNativeInventory(f.build,f.graph,f.inventory,'native-derivations')};
}

test('seals an explicit native ON release with migration requirements and rejects a mismatched requested profile',async t=>{
  const f=await activatedFixture(t),inventory=await f.write();
  assert.equal(inventory.profile,'native-derivations');assert.equal(inventory.version,2);
  assert.equal(inventory.requirements.qualification,false);assert.equal(inventory.requirements.nativeOnly,true);
  assert.equal(inventory.requirements.migrations[0].name,'0004_project_derivations.sql');
  assert.deepEqual(await f.verify(),inventory);
  await assert.rejects(verifyNativeInventory(f.build,f.graph,f.inventory),/native-only module graph/);
  const off=await fixture(t);await off.write();
  await assert.rejects(verifyNativeInventory(off.build,off.graph,off.inventory,'native-derivations'),/native-derivations module graph/);
});

test('ON rejects absent migration metadata, mismatched frontend flags, missing UI modules and an OFF Worker',async t=>{
  for(const change of ['manifest','native','qualification','derivations','migration','ui','worker','capability'])await t.test(change,async sub=>{
    const f=await activatedFixture(sub),graph=f.manifest;
    if(change==='manifest')delete (graph as Partial<typeof graph>).requirements;
    if(change==='native')graph.requirements.nativeOnly=false;
    if(change==='qualification')graph.requirements.qualification=true;
    if(change==='derivations')graph.requirements.derivations=false;
    if(change==='migration')graph.requirements.migrations=[];
    if(change==='ui')graph.modules=graph.modules.filter(item=>!item.endsWith('DerivationPanel.tsx'));
    if(change==='worker')await put(join(f.build,'_worker.js'),worker);
    if(change==='capability')await put(join(f.build,'_worker.js'),worker+'\nconst schema="derivation_batches project_derivations";');
    await put(f.graph,JSON.stringify(graph));
    await assert.rejects(f.write(),/requirements mismatch|required derivation client module|Worker marker missing/);
  });
});

test('ON retains native encoder exclusion, private routing and post-seal byte integrity',async t=>{
  const f=await activatedFixture(t);await f.write();
  await put(join(f.build,'assets','unexpected.js'),'export const encoder="libx264";');
  await assert.rejects(f.verify(),/software fallback content forbidden/);
  const other=await activatedFixture(t);await other.write();
  await put(join(other.build,'_routes.json'),JSON.stringify({version:1,include:['/*'],exclude:['/library/*']}));
  await assert.rejects(other.verify(),/all routes/);
});

test('ON requires all four catalogue entries in current client, Worker and copied public assets',async t=>{
  for(const id of ['BTV_BA_TDS','BTV_Renvoi','BTV_Evenement','BTV_Semainier'])for(const entry of id==='BTV_BA_TDS'?['graphic.mjs','preview.html']:['graphic.mjs','graphic-v2.mjs','preview.html'])await t.test(id+'/'+entry,async sub=>{
    const f=await activatedFixture(sub);await rm(join(f.build,'library/v1.7.0',id,entry));
    await assert.rejects(f.write(),/catalogue asset missing/);
  });
  for(const change of ['empty-asset','current-client','worker'])await t.test(change,async sub=>{
    const f=await activatedFixture(sub);
    if(change==='empty-asset')await put(join(f.build,'library/v1.7.0/BTV_Renvoi/graphic.mjs'),'');
    else{
      const path=join(f.build,change==='worker'?'_worker.js':'assets/app.js'),bytes=await readFile(path,'utf8');
      // A previously published chunk is deliberately still present: it cannot
      // make up for catalogue references absent from this release's own graph.
      await put(join(f.build,'assets','old-published.js'),bytes);
      await put(path,bytes.replaceAll('BTV_Renvoi','Missing_Renvoi'));
    }
    await assert.rejects(f.write(),/catalogue asset missing|catalogue reference missing/);
  });
});

test('rejects environment files, source maps and files above 25 MiB',async t=>{
  for(const name of ['.env','.env.production','nested/.dev.vars','assets/app.js.map','nested/node_modules/a.js'])await t.test(name,async sub=>{
    const f=await fixture(sub);await put(join(f.build,name),'fixture');await assert.rejects(f.write(),/environment, source map or development/);
  });
  const f=await fixture(t),large=join(f.build,'oversize.bin');await put(large,'');await truncate(large,25*1024**2+1);
  await assert.rejects(f.write(),/exceeds 25 MiB/);
});

test('requires graph outputs to be safe existing paths',async t=>{
  for(const outputs of [['../outside.js'],['/absolute.js'],['C:\\absolute.js'],['assets/missing.js'],['assets/app.js','assets/app.js'],[{}]])await t.test(JSON.stringify(outputs),async sub=>{
    const f=await fixture(sub);await put(f.graph,JSON.stringify({profile:'native-only',modules,outputs}));
    await assert.rejects(f.write(),/unsafe output|output missing|duplicate|outputs must be paths/);
  });
});

test('rejects an empty build and refuses graph or inventory files inside the publish directory',async t=>{
  const f=await fixture(t);
  await assert.rejects(writeNativeInventory(f.build,f.graph,join(f.build,'inventory.json')),/outside the build/);
  await copyFile(f.graph,join(f.build,'graph.json'));
  await assert.rejects(writeNativeInventory(f.build,join(f.build,'graph.json'),f.inventory),/outside the build/);
  await assert.rejects(writeNativeInventory(f.build,f.graph,f.graph),/outside the build/);
  const empty=join(f.root,'empty');await mkdir(empty);await assert.rejects(writeNativeInventory(empty,f.graph,f.inventory),/index.html required/);
});

test('rejects symlinked output directories, build roots and report ancestors',async t=>{
  const f=await fixture(t),outside=join(f.root,'outside');await mkdir(outside);
  // Directory junctions work on Windows without requiring Developer Mode.
  await symlink(outside,join(f.build,'linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(f.write(),/symbolic link forbidden/);
  const alias=join(f.root,'build-alias');await symlink(f.build,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(writeNativeInventory(alias,f.graph,f.inventory),/symbolic link forbidden/);
  const reportsAlias=join(f.root,'reports-alias');await symlink(dirname(f.graph),reportsAlias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(writeNativeInventory(f.build,f.graph,join(reportsAlias,'inventory.json')),/symbolic link forbidden/);
});
