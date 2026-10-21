import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {nativeViteProfile,nativeClientDefines} from './scripts/studio-release-profile.mjs';
import {derivationMigrationRequirement} from './scripts/derivation-migration-gate.mjs';
import {plannerMigrationRequirement} from './scripts/planner-migration-gate.mjs';
import {privacyMigrationRequirement} from './scripts/project-privacy-gate.mjs';
import {automationMigrationRequirement} from './scripts/automation-migration-gate.mjs';

// Separate output, no default public copy and no legacy asset-history hook.
// The software encoder import is replaced before graph resolution: tree-shaking
// alone is not sufficient because a Worker constructor can emit an asset early.
export default defineConfig(({mode})=>{
 const profile=nativeViteProfile(mode),defines=nativeClientDefines(profile);
 return {
  publicDir:false,
  define:defines,
  resolve:{alias:[{find:/^\.\/cbr-fallback(?:\.ts)?$/,replacement:resolve(import.meta.dirname,'src/studio/video/opaque-native-adapter.ts')}]},
  plugins:[react(),{
    name:'native-release-graph',
    configResolved(config){
      for(const [key,value] of Object.entries(defines))if(config.define[key]!==value)throw Error('Profil client natif incohérent : '+key);
    },
    async generateBundle(_options,bundle){
      const modules=[...this.getModuleIds()].map(id=>id.replaceAll('\\','/')).sort();
      const folder=resolve(import.meta.dirname,'.tools/native-release');await mkdir(folder,{recursive:true});
      const requirements={version:1,nativeOnly:true,derivations:profile.derivations,qualification:false,migrations:profile.derivations?[await derivationMigrationRequirement(import.meta.dirname)]:[],planner:await plannerMigrationRequirement(import.meta.dirname),privacy:await privacyMigrationRequirement(import.meta.dirname),automation:await automationMigrationRequirement(import.meta.dirname)};
      await writeFile(resolve(folder,'graph.json'),JSON.stringify({profile:profile.name,requirements,modules,outputs:Object.keys(bundle).sort()},null,2)+'\n');
    },
  }],
  build:{target:'es2022',outDir:'dist-studio-native',emptyOutDir:true,rolldownOptions:{input:'studio.html'}},
 };
});
