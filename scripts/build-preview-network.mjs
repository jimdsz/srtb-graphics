import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';
import {buildAEOut} from './build-ae-out.mjs';

export const previewNetworkPins={
  'BTV_Renvoi/graphic-v2.mjs':'7b7a3266ba7acb4e86c6ceaa710b28f3b5fe0925d6b75adb760bfb7b63454bb9',
  '_shared/lottie-ae-engine-v2.mjs':'b803a66298ee26cdd7ffbabef68776fea03294d9df1ce8f740de53c6667504e4',
  'BTV_Ce_Soir/graphic.mjs':'b72c62cd735ea0a790899fb8a0acf96fa131a6c2a52914547337c4090ee6ba92',
  'BTV_Relais_Antenne/graphic.mjs':'b72c62cd735ea0a790899fb8a0acf96fa131a6c2a52914547337c4090ee6ba92',
  'BTV_Passerelle_Replay/graphic.mjs':'b72c62cd735ea0a790899fb8a0acf96fa131a6c2a52914547337c4090ee6ba92',
  'BTV_Evenement/graphic-v2.mjs':'699cfdb37662d47e219605c9513984ccb9fbdc1c4a0bf07ec2efbba85512107f',
  'BTV_Semainier/graphic-v2.mjs':'699cfdb37662d47e219605c9513984ccb9fbdc1c4a0bf07ec2efbba85512107f',
};
const root=resolve(import.meta.dirname,'..'),library='/library/v1.7.0/';
const header="// Generated preview-only loader adapter. Library, layout, timing and export are unchanged.\nimport {previewResource,previewFont,previewMediaReady,previewAnimationReady,assertPreviewMedia} from './network.mjs';\n";
const completeHeader="// Generated cancellable AE preview loader with the shared complete-OUT configuration. Frozen artwork is unchanged.\nimport {previewResource,previewFont,previewMediaReady,previewAnimationReady,assertPreviewMedia} from './network.mjs';\n";
export function replaceExact(source,before,after,count=1){
  if(source.split(before).length-1!==count)throw Error('Preview loader anchor changed: '+before);
  return source.replaceAll(before,after);
}
function replaceBlock(source,begin,end,replacement){
  if(source.split(begin).length!==2||source.split(end).length!==2)throw Error('Preview loader block changed: '+begin);
  const start=source.indexOf(begin),finish=source.indexOf(end,start);if(finish<start)throw Error('Invalid preview loader block.');
  return source.slice(0,start)+replacement+'\n'+source.slice(finish);
}
function absoluteImports(source,filename){
  return source.replace(/from '([^']+)'/g,(_,path)=>{
    if(!path.startsWith('.'))throw Error('Unexpected original engine import: '+path);
    return `from '${new URL(path,'https://library.invalid'+library+filename).pathname}'`;
  });
}
export function derivePreviewEngine(filename,raw,completeOut=false,replayDraft=false){
  if(createHash('sha256').update(raw).digest('hex')!==previewNetworkPins[filename])throw Error('Frozen preview source changed; requalify: '+filename);
  let code=absoluteImports(raw.toString().replaceAll('\r\n','\n'),filename);
  if(filename==='_shared/lottie-ae-engine-v2.mjs'){
    if(completeOut){code=replaceExact(code,'this.elapsed - this.outAt >= config.timing.outDuration','aeOutFinished(this.elapsed, this.outAt, config.timing.outDuration)');code="import {aeOutFinished} from '/studio-engines/ae-out-v1/complete-out.mjs';\n"+code;}
    code=replaceExact(code,'{cachedResource,clearRasterAssets','{clearRasterAssets');
    code=replaceBlock(code,'const fontFaces = new Map();','function elementsForLayer',`async function installFonts(base,animation,signal){
  const requested=new Map([['BeninSemiBold-Regular',['Benin Semi Bold','BeninSemiBold-Regular.otf']],['SuisseIntl',['SuisseIntl','SuisseIntl.otf']]]),loaded=[];
  for(const font of animation.fonts?.list||[]){const spec=requested.get(font.fName);if(!spec)continue;const [family,file]=spec;const face=await previewFont(family,new URL('lib/fonts/'+file,base),signal);signal.throwIfAborted();font.fFamily=family;loaded.push(face);}return loaded;
}`);
    code=replaceExact(code,'this._chain = Promise.resolve();','this._chain = Promise.resolve(); this._abort = new AbortController();');
    code=replaceExact(code,"await cachedResource(new URL('source/animation.json', BASE).href)","await previewResource(new URL('source/animation.json', BASE),'json',this._abort.signal)");
    code=replaceExact(code,'await installFonts(BASE, animationData);','await installFonts(BASE, animationData,this._abort.signal); this._abort.signal.throwIfAborted();');
    code=replaceBlock(code,'      await new Promise((resolve, reject) => {','      this.state = { animation:',`      await previewAnimationReady(this.animation,this._abort.signal);this._abort.signal.throwIfAborted();`);
    code=replaceExact(code,"onceReady(node, video ? 'loadeddata' : 'load', 30000)","previewMediaReady(node,video?'loadeddata':'load',this._abort.signal)");
    code=replaceExact(code,"onceReady(node, 'loadedmetadata', 20000)","previewMediaReady(node,'loadedmetadata',this._abort.signal)");
    code=replaceExact(code,'node.src = url; await ready;','node.src = url; await ready; assertPreviewMedia(node,this._abort.signal);',2);
    code=replaceExact(code,'const item = await this.makeMedia(spec); if (!item) return;','const item = await this.makeMedia(spec); if(item)assertPreviewMedia(item.node,this._abort.signal); this._abort.signal.throwIfAborted(); if (!item) return;');
    code=replaceExact(code,'await Promise.all([this.prepareTracks(), this.prepareAudio()]);','await Promise.all([this.prepareTracks(), this.prepareAudio()]); this._abort.signal.throwIfAborted();');
    code=replaceExact(code,'this.disposed = true; this.pause();','this.disposed = true; this._abort.abort(); this.pause();');
  }else if(filename==='BTV_Renvoi/graphic-v2.mjs'){
    code=replaceExact(code,'{cachedResource,clearRasterAssets','{clearRasterAssets');
    code=replaceExact(code,"const BASE = new URL('./', import.meta.url)","const BASE = new URL('/library/v1.7.0/BTV_Renvoi/', import.meta.url)");
    code=replaceExact(code,'const json = async url => structuredClone(await cachedResource(url.href));',"const json=(url,signal)=>previewResource(url,'json',signal);");
    code=replaceBlock(code,'let fontsReady;','function localURL',`async function loadFonts(signal){return Promise.all([['Benin Semi Bold','BeninSemiBold-Regular.otf'],['SuisseIntl','SuisseIntl.otf']].map(async([family,file])=>{const {bytes}=await previewFont(family,new URL('lib/fonts/'+file,BASE),signal);const url=await dataURL(new Blob([bytes],{type:'font/otf'}));signal.throwIfAborted();return {family,url};}));}`);
    code=replaceExact(code,'await loadFonts()','await loadFonts(this._abort.signal)',2);
    code=replaceExact(code,"json(new URL('lib/benin-outlines.json', BASE))","json(new URL('lib/benin-outlines.json', BASE),this._abort.signal)",2);
    code=replaceExact(code,'json(new URL(`source/${this.data.variant}/animation.json`, BASE))','json(new URL(`source/${this.data.variant}/animation.json`, BASE),this._abort.signal)');
    code=replaceExact(code,'const result = await this.validateData(raw); if (!result.valid)', 'const result = await this.validateData(raw); this._abort.signal.throwIfAborted(); if (!result.valid)');
    code=replaceBlock(code,'    await new Promise((resolve, reject) => {','    this.layout = installTextLayout',`    await previewAnimationReady(this.animation,this._abort.signal);this._abort.signal.throwIfAborted();`);
    code=replaceExact(code,"readyMedia(this.media, video ? 'loadeddata' : 'load')","previewMediaReady(this.media,video?'loadeddata':'load',this._abort.signal)");
    code=replaceExact(code,"readyMedia(image, 'load')","previewMediaReady(image,'load',this._abort.signal)");
    code=replaceExact(code,"readyMedia(element, 'loadedmetadata')","previewMediaReady(element,'loadedmetadata',this._abort.signal)");
    for(const node of ['this.media','image','element'])code=replaceExact(code,`${node}.src = url; await ready;`,`${node}.src = url; await ready; assertPreviewMedia(${node},this._abort.signal);`);
    code=replaceExact(code,'await this.prepareMedia(); await this.prepareLogo(); await this.prepareAudio();','await this.prepareMedia(); await this.prepareLogo(); await this.prepareAudio(); this._abort.signal.throwIfAborted();');
  }else if(filename.endsWith('/graphic.mjs')){
    code=replaceExact(code,'const BASE=import.meta.url,',`const BASE=new URL('${library+filename}',import.meta.url).href,`);
    code=replaceBlock(code,'let resources;','export default',`function loadResources(signal){return Promise.all([previewResource(new URL('layout.css',BASE),'text',signal),...[['BTVBenin','BeninSemiBold-Regular.otf'],['BTVSuisse','SuisseIntl.otf']].map(([family,file])=>previewFont(family,new URL('lib/fonts/'+file,BASE),signal))]);}`);
    code=replaceExact(code,'await loadResources();','await loadResources(this._abort.signal);');
    if(replayDraft&&filename==='BTV_Passerelle_Replay/graphic.mjs'){
      // A draft without a destination may be inspected/played. Delivery and
      // submission still require a real URL; the placeholder never encodes one.
      code=replaceExact(code,"if(TEMPLATE.kind==='replay'&&!data._replay_url&&['in','onair','out','paused'].includes(this.phase))throw Error('Impossible de retirer l’adresse du replay pendant sa diffusion.');",'');
      code=replaceExact(code,"if(TEMPLATE.kind==='replay'&&!this.data._replay_url)throw Error('Renseigner l’adresse officielle du replay avant IN.');",'');
    }
  }else{
    code=replaceExact(code,`from '${library}_shared/lottie-ae-engine-v2.mjs'`,"from './ae-engine.mjs'");
    const id=filename.split('/')[0];
    code=replaceExact(code,'createAETemplate(lottie,CONFIG,import.meta.url)',`createAETemplate(lottie,${completeOut?`completeAEOutConfig(CONFIG,'${id}')`:'CONFIG'},new URL('${library+filename}',import.meta.url).href)`);
    if(completeOut)code="import {completeAEOutConfig} from '/studio-engines/ae-out-v1/complete-out.mjs';\n"+code;
  }
  // Static imports are exact, local network helpers or the immutable sources.
  for(const [,path]of code.matchAll(/from '([^']+)'/g))if(!path.startsWith(library)&&path!=='./ae-engine.mjs'&&path!=='/studio-engines/ae-out-v1/complete-out.mjs')throw Error('Unexpected derived import: '+path);
  return (completeOut?completeHeader:header)+code;
}
export async function previewNetworkArtifacts(completeOut=false){
  const outputs=new Map();
  for(const filename of Object.keys(previewNetworkPins)){
    const raw=await readFile(resolve(root,'public/library/v1.7.0',filename));
    if(completeOut&&!['_shared/lottie-ae-engine-v2.mjs','BTV_Evenement/graphic-v2.mjs','BTV_Semainier/graphic-v2.mjs'].includes(filename))continue;
    outputs.set(filename.startsWith('_shared/')?'ae-engine.mjs':filename.split('/')[0]+'.mjs',derivePreviewEngine(filename,raw,completeOut));
  }
  const runtime=(await transform(await readFile(resolve(root,'src/studio/preview-network.ts'),'utf8'),{loader:'ts',format:'esm',target:'es2022'})).code;
  outputs.set('network.mjs',runtime);return outputs;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await buildAEOut();
  const directory=resolve(root,'public/studio-engines/preview-network-v1');await mkdir(directory,{recursive:true});
  for(const [name,source]of await previewNetworkArtifacts())await writeFile(resolve(directory,name),source);
  const completeDirectory=resolve(root,'public/studio-engines/preview-network-v2');await mkdir(completeDirectory,{recursive:true});
  for(const [name,source]of await previewNetworkArtifacts(true))await writeFile(resolve(completeDirectory,name),source);
  const replayDirectory=resolve(root,'public/studio-engines/preview-network-v3');await mkdir(replayDirectory,{recursive:true});
  const replayFile='BTV_Passerelle_Replay/graphic.mjs';
  await writeFile(resolve(replayDirectory,'BTV_Passerelle_Replay.mjs'),derivePreviewEngine(replayFile,await readFile(resolve(root,'public/library/v1.7.0',replayFile)),false,true));
  await writeFile(resolve(replayDirectory,'network.mjs'),(await previewNetworkArtifacts()).get('network.mjs'));
  console.log('Preview network v1 preserved and v2 generated from SHA-256 pinned sources; complete AE OUT shared with export, frozen library unchanged.');
}
