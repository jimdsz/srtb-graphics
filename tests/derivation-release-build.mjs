import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {build as viteBuild,loadConfigFromFile} from 'vite';
import {build as workerBuild} from 'esbuild';
import {studioWorkerOptionsFor} from '../scripts/studio-worker-options.mjs';
import {nativeReleaseProfile,assertWorkerDerivationProfile} from '../scripts/studio-release-profile.mjs';

// Local build qualification only: no deployment, remote DB or existing release
// output. Capture the Vite graph in memory instead of overwriting its live seal.
const root=resolve(import.meta.dirname,'..'),tools=resolve(root,'.tools');
await mkdir(tools,{recursive:true});
const directory=await mkdtemp(resolve(tools,'derivation-release-build-'));
const models=['BTV_BA_TDS','BTV_Renvoi','BTV_Evenement','BTV_Semainier'];
const results=[];
for(const name of ['native-only','native-derivations']){
  const profile=nativeReleaseProfile(name),loaded=await loadConfigFromFile({command:'build',mode:name},resolve(root,'vite.studio-native.config.ts'));
  assert.ok(loaded);let modules=[],outputs=[];
  const config=loaded.config,plugins=config.plugins.map(plugin=>plugin?.name==='native-release-graph'?{
    ...plugin,
    generateBundle(_options,bundle){
      modules=[...this.getModuleIds()].map(id=>id.replaceAll('\\','/'));
      outputs=Object.entries(bundle).filter(([,output])=>output.type==='chunk').map(([fileName,output])=>({fileName,code:output.code}));
    },
  }:plugin);
  await viteBuild({...config,configFile:false,root,mode:name,plugins,build:{...config.build,outDir:resolve(directory,name),emptyOutDir:false}});
  const clientCode=outputs.map(output=>output.code).join('\n');
  for(const model of models)assert.ok(clientCode.includes(model),name+' client catalogue missing '+model);
  assert.ok(modules.some(path=>path.endsWith('src/studio/catalogue.extensions.json')));
  assert.ok(modules.some(path=>path.endsWith('src/studio/video/opaque-native-adapter.ts')));
  assert.ok(!modules.some(path=>/\/cbr-fallback(?:\.worker)?\.ts(?:\?|$)/.test(path)));
  assert.equal(config.define.__SRTB_DERIVATIONS__,String(profile.derivations));
  assert.equal(config.define.__SRTB_NATIVE_ONLY__,'true');
  assert.equal(config.define['import.meta.env.VITE_STUDIO_QUALIFICATION'],'false');
  if(profile.derivations)for(const suffix of ['src/studio/DerivationPanel.tsx','src/studio/derivation-api.ts','src/studio/client-capabilities.ts'])assert.ok(modules.some(path=>path.endsWith(suffix)),suffix);
  const worker=await workerBuild({...studioWorkerOptionsFor(name),absWorkingDir:root,entryPoints:['server/pages-worker.ts'],write:false,metafile:true});
  const workerCode=worker.outputFiles[0].text,inputs=Object.keys(worker.metafile.inputs);
  assertWorkerDerivationProfile(inputs,workerCode,profile);
  for(const model of models)assert.ok(workerCode.includes(model),name+' Worker catalogue missing '+model);
  assert.ok(inputs.some(path=>path.endsWith('@aws-sdk/client-s3/dist-es/runtimeConfig.browser.js')));
  assert.ok(!inputs.some(path=>path.endsWith('@aws-sdk/client-s3/dist-es/runtimeConfig.js')));
  assert.doesNotMatch(workerCode,/new DOMParser\s*\(/);
  const workerGzipBytes=gzipSync(workerCode).byteLength;assert.ok(workerGzipBytes<3*1024**2);
  await writeFile(resolve(directory,name,'_worker.js'),workerCode);
  results.push({profile:name,clientChunks:outputs.length,clientBytes:Buffer.byteLength(clientCode),workerGzipBytes,models,flags:config.define});
}
const library=[];
for(const model of models){
  const path=`public/library/v1.7.0/${model}/graphic.mjs`,bytes=await readFile(resolve(root,path));assert.ok(bytes.length>0);library.push({path,bytes:bytes.length});
}
const report={outputDirectory:directory,results,library,scope:'Compiled client and Worker; public model sources checked. Final copy/history/inventory/publication pipeline not executed; no remote request.'};
await writeFile(resolve(directory,'qualification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
