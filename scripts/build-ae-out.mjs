import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const pins={'lottie-ae-engine-v2.mjs':'b803a66298ee26cdd7ffbabef68776fea03294d9df1ce8f740de53c6667504e4','lottie-ae-engine.mjs':'e5fd18d9f4345064fb111b4f9d0da58295f09448970f485ed4fc01bcdfdcc0c5'};
export function deriveAEOutEngine(raw,filename,portable=false){
  if(createHash('sha256').update(raw).digest('hex')!==pins[filename])throw Error('Frozen AE OUT source changed: '+filename);
  const before='this.elapsed - this.outAt >= config.timing.outDuration',source=raw.toString().replaceAll('\r\n','\n');
  if(source.split(before).length!==2)throw Error('AE OUT completion anchor changed.');
  let code=source.replace(before,'aeOutFinished(this.elapsed, this.outAt, config.timing.outDuration)');
  if(!portable)code=code.replace(/from '([^']+)'/g,(_,path)=>`from '${new URL(path,'https://library.invalid/library/v1.7.0/_shared/'+filename).pathname}'`);
  return `// Derived only for the exact floating-point OUT endpoint; native render methods are unchanged.\nimport {aeOutFinished} from './${portable?'studio-ae-out':'complete-out'}.mjs';\n`+code;
}
export async function aeOutArtifacts(){
  const runtime=(await transform(await readFile(resolve(root,'src/studio/ae-out-timing.ts'),'utf8'),{loader:'ts',format:'esm',target:'es2022'})).code;
  const files=new Map([['complete-out.mjs',runtime]]);
  files.set('ae-engine.mjs',deriveAEOutEngine(await readFile(resolve(root,'public/library/v1.7.0/_shared/lottie-ae-engine-v2.mjs')),'lottie-ae-engine-v2.mjs'));
  const portableEngine=deriveAEOutEngine(await readFile(resolve(root,'public/library/v1.7.0/_shared/lottie-ae-engine.mjs')),'lottie-ae-engine.mjs',true);
  for(const id of ['BTV_Evenement','BTV_Semainier'])files.set(id+'.mjs',`// Instance configuration only; frozen source frames and geometry are unchanged.
import lottie from '/library/v1.7.0/${id}/lib/lottie-web.esm.mjs';
import {createAETemplate} from './ae-engine.mjs';
import {CONFIG,DEFAULTS,VERSION} from '/library/v1.7.0/${id}/config.mjs';
import {completeAEOutConfig} from './complete-out.mjs';
const adapted=completeAEOutConfig(CONFIG,'${id}');
export {DEFAULTS,VERSION};export const TIMING=adapted.timing;
export default createAETemplate(lottie,adapted,new URL('/library/v1.7.0/${id}/graphic-v2.mjs',import.meta.url).href);
`);
  return {runtime,portableEngine,files};
}
export async function buildAEOut(){
  const {runtime,portableEngine,files}=await aeOutArtifacts(),directory=resolve(root,'public/studio-engines/ae-out-v1');await mkdir(directory,{recursive:true});
  for(const [name,code]of files)await writeFile(resolve(directory,name),code);
  await writeFile(resolve(root,'src/studio/ae-out-runtime.generated.json'),JSON.stringify({code:runtime,engine:portableEngine}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){await buildAEOut();console.log('Complete AE OUT configuration built; frozen library unchanged.');}
