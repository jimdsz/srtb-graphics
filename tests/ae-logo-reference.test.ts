import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {AE_LOGO_REFERENCE,AE_LOGO_REGIONS,measureReferenceRegion,NativePlacementMismatchError,nativeLogoPlacement,verifyNativePlacement,verifyNativeSourcePose} from './ae-logo-reference-model';
const base=new URL('../public/library/v1.7.0/BTV_BA_1P/',import.meta.url);
const read=async(path:string)=>JSON.parse(await readFile(new URL(path,base),'utf8'));

test('native comparison pins the independent AE PNG and the historical complete-logo/TV regions',async()=>{
  const file=new URL('../../BroadcastTemplates/EXPORT/BTV_BA_1P/reference_aftereffects/frame_01780.png',import.meta.url),bytes=await readFile(file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),AE_LOGO_REFERENCE.sha256);
  assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),1920);assert.equal(bytes.readUInt32BE(20),1080);
  assert.deepEqual(AE_LOGO_REGIONS.map(({x,y,width,height})=>[x,y,width,height]),[[690,460,555,155],[1100,460,150,155]]);
});
test('pixel measurements distinguish transparent RGB differences, alpha differences and region boundaries',()=>{
  const a=Uint8ClampedArray.from([255,255,255,0,10,20,30,255]),b=Uint8ClampedArray.from([0,0,0,0,10,25,30,128]);
  const measured=measureReferenceRegion(a,b,2,1,{x:0,y:0,width:2,height:1});
  assert.equal(measured.changedPixels,2);assert.equal(measured.meanAbsoluteRgb,770/6);assert.equal(measured.maxAlpha,127);
  assert.equal(measured.meanAbsoluteAlpha,63.5);assert.equal(measured.maxPremultiplied,127);assert.equal(measured.pixelsRgbOver16,1);
  assert.deepEqual(measured.changedBounds,[0,0,1,0]);assert.equal(measured.maxRgbDeltaHistogram[255],1);assert.equal(measured.maxRgbDeltaHistogram[5],1);
  const onlyTransparent=measureReferenceRegion(a,b,2,1,{x:0,y:0,width:1,height:1});assert.equal(onlyTransparent.premultipliedRgbaMean,0);
  const onlyOpaque=measureReferenceRegion(a,b,2,1,{x:1,y:0,width:1,height:1});assert.equal(onlyOpaque.maxRgb,5);assert.equal(onlyOpaque.pixelsRgbOver16,0);
  const identical=measureReferenceRegion(a,a,2,1,{x:0,y:0,width:2,height:1});assert.equal(identical.exactPixels,2);assert.equal(identical.changedBounds,null);
});
test('comparison refuses mismatched image sizes or regions outside the native raster',()=>{
  const pixels=new Uint8ClampedArray(8),region={x:0,y:0,width:2,height:1};
  assert.throws(()=>measureReferenceRegion(pixels,new Uint8ClampedArray(4),2,1,region),/dimensions/);
  for(const changed of [{x:-1},{y:1},{width:3},{height:0},{x:.5}])assert.throws(()=>measureReferenceRegion(pixels,pixels,2,1,{...region,...changed}),/region/);
});
test('a correct UI counter cannot conceal a wrong root or nested source pose',()=>{
  const pose={seekFrame:1780,statusFrame:1780,animationFrame:1780,rendererFrame:1780,frameRate:25,outroFrame:38,beninFrame:10,tvFrame:10};
  assert.deepEqual(verifyNativeSourcePose(pose),pose);
  for(const key of Object.keys(pose) as (keyof typeof pose)[])assert.throws(()=>verifyNativeSourcePose({...pose,[key]:pose[key]+1}));
});
test('the actual BA source and configured scene retain the complete native logo placements and timing',async()=>{
  const [original,time]=await Promise.all([read('lib/lottie-template.json'),read('lib/native-time.json')]);
  const {configureGraphic,DEFAULTS}=await import(new URL('config.mjs',base).href);
  const snapshot=JSON.stringify(original),configured=configureGraphic(original,DEFAULTS,time).data;
  assert.deepEqual(verifyNativePlacement(original,configured),{placements:nativeLogoPlacement(original),rendererNormalizations:[]});assert.equal(JSON.stringify(original),snapshot);
  const native=nativeLogoPlacement(original);assert.equal(native.outro.st,1742);assert.equal(native.benin.st,28);
  assert.deepEqual(native.letters.map((layer:any)=>layer.nm),['Anim TV Roll HAUT 2','B','é','N','I','N']);
  const changed=structuredClone(configured),outro=changed.assets.find((comp:any)=>comp.nm==='Outro_vert');
  outro.layers.find((layer:any)=>layer.nm==='BENINTV_Roll').ks.s.k[0]=51;
  assert.throws(()=>verifyNativePlacement(original,changed),/placement differs/);
  const shifted=structuredClone(configured);shifted.layers.find((layer:any)=>layer.nm==='Outro_vert').st++;
  assert.throws(()=>verifyNativePlacement(original,shifted),/timing has changed/);
});
test('the actual frozen Lottie constructor normalizes precisely the six zero spatial handles without changing placement',async()=>{
  const original=await read('lib/lottie-template.json'),rendered=structuredClone(original),before=JSON.stringify(original);
  const runtime=await readFile(new URL('lib/lottie-web.esm.mjs',base),'utf8');
  const bezStart=runtime.indexOf('function bezFunction()'),bezEnd=runtime.indexOf('var bez=bezFunction()');
  const constructorStart=runtime.indexOf('function KeyframedMultidimensionalProperty('),constructorEnd=runtime.indexOf('var PropertyFactory=',constructorStart);
  assert.ok(bezStart>=0&&bezEnd>bezStart&&constructorStart>=0&&constructorEnd>constructorStart,'Frozen constructor must be explicitly located.');
  const unused=()=>{throw Error('Interpolation is outside this constructor-only reproduction.');};
  const Constructor=runInNewContext(runtime.slice(bezStart,bezEnd)+'; var bez=bezFunction(); '+runtime.slice(constructorStart,constructorEnd)+'; KeyframedMultidimensionalProperty',{
    createTypedArray:(type:string,length:number)=>{assert.equal(type,'float32');return new Float32Array(length);},
    getValueAtCurrentTime:unused,processEffectsSequence:unused,setVValue:unused,interpolateValue:unused,initFrame:-999999,addEffect:unused,
  });
  const comp=rendered.assets.find((item:any)=>item.nm==='Anim_TV_Roll');
  for(const layer of comp.layers.filter((item:any)=>[4,5,7].includes(item.ind)))new Constructor({data:{st:layer.st},comp:{}},layer.ks.p,1,{});
  const evidence=verifyNativePlacement(original,rendered);assert.equal(evidence.rendererNormalizations.length,6);assert.equal(JSON.stringify(original),before);
  for(const entry of evidence.rendererNormalizations){assert.deepEqual(entry.expected,[0,0,0]);assert.equal(entry.actual,null);assert.match(entry.path,/^tv\[\d+\]\.ks\.p\.k\[0\]\.(to|ti)$/);}
  assert.deepEqual(evidence.placements,nativeLogoPlacement(rendered));
});
test('normalization never hides non-zero tangents, missing handles, shifted anchors or changed key times, and errors describe exact paths',async()=>{
  const original=await read('lib/lottie-template.json');
  for(const [mutate,path] of [
    [(layer:any)=>{layer.ks.p.k[0].to=[0,1,0];},'ks.p.k[0].to[1]'],
    [(layer:any)=>{delete layer.ks.p.k[0].to;},'ks.p.k[0].to'],
    [(layer:any)=>{layer.ks.p.k[0].to=null;},'ks.p.k[0].to'],
    [(layer:any)=>{layer.ks.p.k[0].t=1;},'ks.p.k[0].t'],
    [(layer:any)=>{layer.ks.a.k[0]+=1;},'ks.a.k[0]'],
  ] as const){
    const changed=structuredClone(original),comp=changed.assets.find((item:any)=>item.nm==='Anim_TV_Roll'),index=comp.layers.findIndex((layer:any)=>layer.ind===4);mutate(comp.layers[index]);
    assert.throws(()=>verifyNativePlacement(original,changed),(error:unknown)=>error instanceof NativePlacementMismatchError&&error.differences.some(item=>item.path===`tv[${index}].${path}`)&&error.message.includes(`tv[${index}].${path}`));
  }
  const curved=structuredClone(original),curveComp=curved.assets.find((item:any)=>item.nm==='Anim_TV_Roll');curveComp.layers.find((layer:any)=>layer.ind===4).ks.p.k[0].to=[0,1,0];
  const incorrectlyFlattened=structuredClone(curved),flatComp=incorrectlyFlattened.assets.find((item:any)=>item.nm==='Anim_TV_Roll'),flat=flatComp.layers.find((layer:any)=>layer.ind===4).ks.p.k[0];flat.to=null;flat.ti=null;
  assert.throws(()=>verifyNativePlacement(curved,incorrectlyFlattened),NativePlacementMismatchError);
});
