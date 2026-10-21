import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {previewNetworkPins,derivePreviewEngine,replaceExact,previewNetworkArtifacts} from '../scripts/build-preview-network.mjs';
import {previewEngineModule} from '../src/studio/preview-engine-module';
import {studioEngineModule} from '../src/studio/text-editing';
import {getTemplate} from '../src/studio/domain';

test('frozen native loaders retain a transient rejected promise; the preview adapter is necessary',async()=>{
  for(const filename of ['BTV_Renvoi/graphic-v2.mjs','BTV_Ce_Soir/graphic.mjs','BTV_Relais_Antenne/graphic.mjs','BTV_Passerelle_Replay/graphic.mjs']){
    const raw=await readFile('public/library/v1.7.0/'+filename,'utf8'),renvoi=filename.startsWith('BTV_Renvoi/'),start=renvoi?'let fontsReady;':'let resources;',end=renvoi?'function localURL':'export default',name=renvoi?'loadFonts':'loadResources';let calls=0;
    const load=runInNewContext(raw.slice(raw.indexOf(start),raw.indexOf(end))+`;${name}`,{URL,BASE:'https://fixture.invalid/graphic.mjs',fetch:async()=>{calls++;throw Error('controlled transient request failure');},FontFace:class{async load(){return this;}},document:{fonts:{add(){}}}});
    await assert.rejects(load(),/controlled transient/);const afterFirst=calls;await assert.rejects(load(),/controlled transient/);assert.equal(calls,afterFirst,filename+' never retries its rejected promise');
  }
});

test('derived loaders reproduce checked-in artifacts from exact frozen SHA-256 sources',async()=>{
  for(const [name,content]of await previewNetworkArtifacts())assert.equal(await readFile('public/studio-engines/preview-network-v1/'+name,'utf8'),content,name);
  for(const [name,content]of await previewNetworkArtifacts(true))assert.equal(await readFile('public/studio-engines/preview-network-v2/'+name,'utf8'),content,name);
  for(const path of Object.keys(previewNetworkPins)){
    const raw=await readFile('public/library/v1.7.0/'+path);assert.throws(()=>derivePreviewEngine(path,Buffer.concat([raw,Buffer.from('\n')])) ,/Frozen preview source changed/);
  }
  assert.throws(()=>replaceExact('same same','same','new'),/anchor changed/);
});
test('network loader stays preview-only while preview/export share the complete AE OUT contract',async()=>{
  for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay']){
    const template=getTemplate(id),ae=['BTV_Evenement','BTV_Semainier'].includes(id);assert.equal(previewEngineModule(template),'/studio-engines/preview-network-'+(id==='BTV_Passerelle_Replay'?'v3':ae?'v2':'v1')+'/'+id+'.mjs');assert.equal(studioEngineModule(template),ae?'/studio-engines/ae-out-v1/'+id+'.mjs':template.module);
    if(ae)for(const path of [previewEngineModule(template),studioEngineModule(template)])assert.match(await readFile('public'+path,'utf8'),new RegExp(`completeAEOutConfig\\(CONFIG,'${id}'\\)`));
    for(const changed of [{version:'9.0.0'},{libraryVersion:'9.0.0'},{module:'/unknown.mjs'}]){const unknown={...template,...changed};assert.equal(previewEngineModule(unknown),studioEngineModule(unknown));}
  }
  const ba=getTemplate('BTV_BA_1P');assert.equal(previewEngineModule(ba),studioEngineModule(ba));
});
test('derived loaders preserve render/audio bodies and change only the explicit exact OUT endpoint predicate',async()=>{
  const nativeShared=await readFile('public/library/v1.7.0/_shared/lottie-ae-engine-v2.mjs','utf8'),nativeRenvoi=await readFile('public/library/v1.7.0/BTV_Renvoi/graphic-v2.mjs','utf8');
  for(const [raw,name]of [[nativeShared,'ae-engine.mjs'],[nativeRenvoi,'BTV_Renvoi.mjs']]){
    const original=raw.replaceAll('\r\n','\n'),adapted=await readFile('public/studio-engines/preview-network-v1/'+name,'utf8');
    const start=original.indexOf('    syncAudio(')>=0?'    syncAudio(':'  syncAudio(',end=name==='ae-engine.mjs'?'    teardown()':'  teardown()';
    assert.equal(adapted.slice(adapted.indexOf(start),adapted.indexOf(end)),original.slice(original.indexOf(start),original.indexOf(end)));
    if(name==='ae-engine.mjs'){
      const current=await readFile('public/studio-engines/preview-network-v2/'+name,'utf8'),expected=original.replace('this.elapsed - this.outAt >= config.timing.outDuration','aeOutFinished(this.elapsed, this.outAt, config.timing.outDuration)');
      assert.equal(current.slice(current.indexOf(start),current.indexOf(end)),expected.slice(expected.indexOf(start),expected.indexOf(end)));
    }
  }
});
