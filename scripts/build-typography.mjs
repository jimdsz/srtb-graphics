import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
const result=await build({entryPoints:['src/studio/typography-engine.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true});
await writeFile('src/studio/typography-runtime.generated.json',JSON.stringify({code:result.outputFiles[0].text}));
console.log('Portable text editor built from the same preview/export source.');
