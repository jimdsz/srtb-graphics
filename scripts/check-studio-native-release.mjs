import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {verifyNativeInventory} from './native-release-audit.mjs';
import {nativePublicationOptions,assertProductionFeatureContinuity} from './studio-release-profile.mjs';
import {guardedNativePublication} from './derivation-migration-gate.mjs';
import {checkPlannerPublicationMigration} from './planner-migration-gate.mjs';
import {checkPrivacyPublicationMigration} from './project-privacy-gate.mjs';
import {checkAutomationPublicationMigration} from './automation-migration-gate.mjs';
import {checkCommercialPublicationMigration} from './commercial-migration-gate.mjs';

// This is a separate product profile, not an override of the blocked CBR build.
// The original check-studio-release.mjs --production and GPL marker stay intact.
const options=nativePublicationOptions(process.argv.slice(2));
assertProductionFeatureContinuity(options);
const root=resolve(import.meta.dirname,'..');
function run(args,env=process.env){const result=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw Error('Contrôle/publication native interrompu.');}
const accountEnv={...process.env,CLOUDFLARE_ACCOUNT_ID:'8d1be9102f391f34a6f4bde342eafc2f'};
function runJson(args){
  const result=spawnSync(process.execPath,args,{cwd:root,env:accountEnv,encoding:'utf8',maxBuffer:1024*1024});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('Contrôle de migration distante non confirmé. Aucune publication effectuée.');
  try{return JSON.parse(result.stdout);}catch{throw Error('Réponse de migration invalide. Aucune publication effectuée.');}
}
const inventory=await verifyNativeInventory(resolve(root,'dist-studio-native'),resolve(root,'.tools/native-release/graph.json'),resolve(root,'.tools/native-release/inventory.json'),options.profile.name);
run(['scripts/prepare-studio-preview.mjs','--native-only']);
run(['tests/storage-bundle.mjs']);
if(options.production){
  const commercialProof=await checkCommercialPublicationMigration(root,inventory,resolve(root,'.pages-studio-native/wrangler.jsonc'),runJson);
  console.log(`Migration ${commercialProof.name} vérifiée ; ${commercialProof.verifiedObjects} objets conformes.`);
  const automationProof=await checkAutomationPublicationMigration(root,inventory,resolve(root,'.pages-studio-native/wrangler.jsonc'),runJson);
  console.log(`Migrations de production vérifiées ; ${automationProof.verifiedObjects} objets conformes.`);
  await checkPrivacyPublicationMigration(root,inventory,resolve(root,'.pages-studio-native/wrangler.jsonc'),runJson);
  const plannerProof=await checkPlannerPublicationMigration(root,inventory,resolve(root,'.pages-studio-native/wrangler.jsonc'),runJson);
  if(plannerProof)console.log(`Migration ${plannerProof.name} vérifiée ; ${plannerProof.verifiedObjects} objets conformes.`);
  await guardedNativePublication({root,inventory,configFile:resolve(root,'.pages-studio-native/wrangler.jsonc'),runJson,publish:async proof=>{
    if(proof)console.log(`Migration ${proof.name} vérifiée sur la base cible ; ${proof.verifiedObjects} objets conformes au manifeste scellé.`);
    // Recheck after qualification/preparation and just before the publish command.
    await verifyNativeInventory(resolve(root,'dist-studio-native'),resolve(root,'.tools/native-release/graph.json'),resolve(root,'.tools/native-release/inventory.json'),options.profile.name);
    run(['node_modules/wrangler/bin/wrangler.js','pages','deploy','--cwd','.pages-studio-native','--project-name','srtb-graphics','--branch','main','--commit-dirty=true','--commit-message',options.profile.derivations?'SRTB Graphics — déclinaisons liées et export natif':'SRTB Graphics — interface et export natif mesuré'],accountEnv);
  }});
}else console.log(`Contrôle local ${options.profile.name} terminé. Les migrations de récupération, chaînes, attributions et habitudes seront contrôlées avant publication.`+(options.profile.derivations?' Le contrôle des déclinaisons reste obligatoire.':'')+' Aucune base distante consultée. Aucune publication effectuée.');
