import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {copyNativePublicAssets} from './native-public-assets.mjs';
import {writeNativeInventory} from './native-release-audit.mjs';
import {restoreVerifiedNativeHistory} from './verified-native-history.mjs';
import {verifyPublishedBAEditor} from './preserve-ba-editor-v1.mjs';
import {nativeBuildProfile} from './studio-release-profile.mjs';

const root=resolve(import.meta.dirname,'..');
const profile=nativeBuildProfile(process.argv.slice(2));
function run(args){const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw Error('Construction native interrompue.');}
await verifyPublishedBAEditor(root);
run(['scripts/build-ba-editor.mjs']);
run(['scripts/build-preview-network.mjs']);
run(['scripts/prepare-preview-audio.mjs']);
run(['scripts/build-typography.mjs']);
run(['scripts/build-supplemental-voice.mjs']);
run(['node_modules/typescript/bin/tsc','-p','tsconfig.json']);
run(['node_modules/typescript/bin/tsc','-p','tsconfig.server.json']);
run(['node_modules/vite/bin/vite.js','build','--config','vite.studio-native.config.ts','--mode',profile.name]);
console.log('Ressources publiques explicitement autorisées :',await copyNativePublicAssets(root));
run(['scripts/finish-studio-build.mjs','--native-only']);
run(['scripts/build-studio-worker.mjs','--native-only',...(profile.derivations?['--derivations']:[])]);
const retained=await restoreVerifiedNativeHistory(root);console.log('Anciens modules dont la publication a été prouvée :',retained);
await writeNativeInventory(resolve(root,'dist-studio-native'),resolve(root,'.tools/native-release/graph.json'),resolve(root,'.tools/native-release/inventory.json'),profile.name);
console.log(`Paquet ${profile.name} construit et inventorié. Aucun déploiement effectué.`+(retained?' Les modules publiés et vérifiés sont conservés.':' Aucun historique publié prouvé n’est disponible.')+' La publication exige le contrôle du schéma cible, y compris les migrations 0007 à 0013.'+(profile.derivations?' Le contrôle des déclinaisons reste obligatoire.':''));
