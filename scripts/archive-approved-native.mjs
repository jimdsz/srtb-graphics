import {resolve} from 'node:path';
import {archiveApprovedNativeGraph} from './verified-native-history.mjs';
if(process.argv.length!==3)throw Error('Indiquez un déploiement immuable déjà approuvé.');
console.log(JSON.stringify(await archiveApprovedNativeGraph(resolve(import.meta.dirname,'..'),process.argv[2])));
