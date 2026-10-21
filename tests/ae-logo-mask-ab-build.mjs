// Explicit local test build; never an application/public entry.
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),imageFile=new URL('../../BroadcastTemplates/EXPORT/BTV_BA_1P/reference_aftereffects/frame_01780.png',import.meta.url);
const bytes=await readFile(imageFile),sha256=createHash('sha256').update(bytes).digest('hex');
if(sha256!=='ba7bfb02f507a2c9026ef6ade4cf6744cd6a9bfe568cad37021b0a3fbe54a76c')throw Error('Independent AE reference changed.');
if(bytes.readUInt32BE(16)!==1920||bytes.readUInt32BE(20)!==1080)throw Error('Native reference dimensions changed.');
const paths=['public/studio-engines/ba-text-v2/graphic.mjs','public/library/v1.7.0/BTV_BA_1P/logo-compositing.mjs','public/library/v1.7.0/BTV_BA_1P/lib/lottie-template.json','public/library/v1.7.0/BTV_BA_1P/lib/lottie-web.esm.mjs','public/library/v1.7.0/_shared/ae-live-media.mjs'];
const moduleHashes=Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(new URL(path,root))).digest('hex')])));
await build({absWorkingDir:fileURLToPath(root),entryPoints:['tests/ae-logo-mask-ab.ts'],outfile:'tests/ae-logo-mask-ab.bundle.js',bundle:true,format:'esm',target:'es2022',plugins:[{
  name:'local-mask-ab-reference',setup(builder){
    builder.onResolve({filter:/^local:ae-logo-mask-ab$/},()=>({path:'reference',namespace:'ae-logo-ab-local'}));
    builder.onLoad({filter:/.*/,namespace:'ae-logo-ab-local'},()=>({loader:'js',contents:`export default ${JSON.stringify({image:'data:image/png;base64,'+bytes.toString('base64'),sha256,moduleHashes})};`}));
  },
}]});
console.log('Local A/B test built: /tests/ae-logo-mask-ab.html (no production/public output).');
