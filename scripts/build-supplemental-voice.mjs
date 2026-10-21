import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
const result=await build({entryPoints:['src/studio/supplemental-voice-portable.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true});
await writeFile('src/studio/supplemental-voice-runtime.generated.json',JSON.stringify({version:1,code:result.outputFiles[0].text}));
console.log('Supplemental voice v1 built from the same preview/export source; no frozen engine changed.');
