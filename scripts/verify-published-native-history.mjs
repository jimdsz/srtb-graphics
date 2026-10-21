import {resolve} from 'node:path';
import {verifyPublishedNativeHistory} from './verified-native-history.mjs';
if(process.argv.length>3||process.argv[2]&&process.argv[2]!=='--current-native')throw Error('Aucune origine arbitraire : audit des déploiements immuables approuvés uniquement.');
const manifest=await verifyPublishedNativeHistory(resolve(import.meta.dirname,'..'),fetch,process.argv[2]==='--current-native');
console.log(JSON.stringify({origin:manifest.origin,candidates:manifest.candidates,verified:manifest.files.length,skipped:manifest.skipped.length,manifest:'.tools/native-release/published-history.json'}));
