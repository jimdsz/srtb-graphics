import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {completeAEOutConfig,aeOutFinished} from '../src/studio/ae-out-timing.ts';
import {seekSignatureMedia} from '../src/studio/video/signature-media.ts';

const root=new URL('../public/library/v1.7.0/',import.meta.url);
const derived=new URL('../public/studio-engines/ae-out-v1/ae-engine.mjs',import.meta.url);
const generated=await import(new URL('./complete-out.mjs',derived).href);
// Only resolve browser-root module specifiers to their real local files. The
// generated engine and its endpoint helper execute without logic replacements.
const derivedSource=(await readFile(derived,'utf8')).replace(/from '([^']+)'/g,(_match,path:string)=>{
  if(path.startsWith('/library/'))return `from '${new URL('../public'+path,import.meta.url).href}'`;
  if(path==='./complete-out.mjs')return `from '${new URL(path,derived).href}'`;
  throw Error('Unexpected derived-engine import: '+path);
});
const {createAETemplate}=await import('data:text/javascript;base64,'+Buffer.from(derivedSource).toString('base64'));
const contracts=[
  {id:'BTV_Evenement',start:443,hold:442,last:525,length:83,seconds:3.32,early:4.4,oldHold:450,oldOpacity:12.5,names:['TITRE 2 LIGNES HAUT','JOUR','LOGO BENIN TV']},
  {id:'BTV_Semainier',start:581,hold:580,last:657,length:77,seconds:3.08,early:3,oldHold:582,oldOpacity:80,names:['7 JOURS','7 GENRES','BTV_to_BENINTV_Gauche']},
] as const;
const configs=Object.fromEntries(await Promise.all(contracts.map(async({id})=>[id,(await import(new URL(`${id}/config.mjs`,root).href)).CONFIG])));

function replaceGlobal(name:string,value:unknown){
  const original=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  return ()=>{if(original)Object.defineProperty(globalThis,name,original);else Reflect.deleteProperty(globalThis,name);};
}

function fixture(id:string,mode:'duration'|'manual'='duration',outAt=28){
  const config=generated.completeAEOutConfig(configs[id],id),restore=replaceGlobal('HTMLElement',class {});
  let Native:any;
  try{Native=createAETemplate({},config,new URL(`${id}/graphic-v2.mjs`,root).href);}finally{restore();}
  const clock={seconds:0},frames:number[]=[],events:any[]=[],calls:{kind:string;time:number}[]=[];
  const graphic=Object.create(Native.prototype);
  Object.assign(graphic,{
    _chain:Promise.resolve(),data:{...config.defaults,_out_mode:mode,_out_duration_seconds:outAt},
    playing:true,phase:'onair',elapsed:0,lastTickFrame:-1,frame:0,stage:{style:{visibility:'visible'}},
    muted:true,errors:[],warnings:[],audio:[],mediaItems:new Map(),tracks:{},
    animation:{goToAndStop(frame:number,isFrame:boolean){assert.equal(isFrame,true);frames.push(frame);}},
    _time:()=>clock.seconds,dispatchEvent:(event:any)=>{events.push(event.detail);return true;},
  });
  for(const spec of config.media)graphic.tracks[spec.key]={activeStart:spec.activeStart,activeEnd:spec.activeEnd,clips:[],seek:async(time:number)=>{calls.push({kind:spec.key,time});}};
  return {graphic,clock,frames,events,calls,config};
}

async function withoutAnimationLoop(operation:()=>Promise<void>){
  const restoreRAF=replaceGlobal('requestAnimationFrame',()=>1),restoreCancel=replaceGlobal('cancelAnimationFrame',()=>{});
  try{await operation();}finally{restoreCancel();restoreRAF();}
}

function close(actual:number,expected:number,message:string){assert.ok(Math.abs(actual-expected)<1e-10,`${message}: ${actual} versus ${expected}`);}

// Execute the source engine's real scalar interpolation. Source JSON is parsed
// within that realm because Lottie checks Array.constructor when easing keys.
// Nothing here rebuilds or approximates opacity interpolation.
async function nativeOpacity(id:string,name:string,frame:number){
  const [runtime,json]=await Promise.all([
    readFile(new URL(`${id}/lib/lottie-web.esm.mjs`,root),'utf8'),
    readFile(new URL(`${id}/source/animation.json`,root),'utf8'),
  ]);
  const section=(start:string,end:string)=>{const from=runtime.indexOf(start),to=runtime.indexOf(end,from+start.length);assert.ok(from>=0&&to>from,`Frozen Lottie boundary ${start}`);return runtime.slice(from,to);};
  return runInNewContext([
    'var initialDefaultFrame=-999999,degToRads=Math.PI/180,bmPow=Math.pow,bmSqrt=Math.sqrt,bmFloor=Math.floor,bmMax=Math.max,bmMin=Math.min;var getDefaultCurveSegments=()=>150;',
    'var '+section('createTypedArray=','function _typeof$6('),
    'var '+section('BezierFactory=function','function bezFunction('),
    section('function bezFunction(','var pointPool='),
    `(function(){const animation=JSON.parse(json),layer=animation.layers.find(layer=>layer.nm===name);
      if(!layer||layer.sr!==1)throw Error('Source opacity fixture contract changed');
      const element={data:layer,comp:{renderedFrame:frame},globalData:{frameId:1}};
      const property=PropertyFactory.getProp(element,layer.ks.o,0,1,{addDynamicProperty(){}});
      property.getValue();return property.v;})()`,
  ].join('\n'),{json,name,frame},{timeout:1000}) as number;
}

for(const contract of contracts){
  const {id,start,hold,last,length,seconds,names}=contract;
  test(`${id}: complete OUT adapts timing only and leaves the saved request/source immutable`,()=>{
    const source=configs[id],before=JSON.stringify(source),adapted=completeAEOutConfig(source,id);
    assert.deepEqual(generated.completeAEOutConfig(source,id),adapted,'Generated configuration must match the source helper');
    assert.notEqual(adapted,source);assert.notEqual(adapted.timing,source.timing);
    assert.equal(adapted.defaults,source.defaults);assert.equal(adapted.media,source.media);assert.equal(adapted.textField,source.textField);
    assert.equal(adapted.defaults._out_duration_seconds,source.defaults._out_duration_seconds);
    assert.equal(adapted.timing.outFrame,start);assert.equal(adapted.timing.outDuration,seconds);
    assert.equal(adapted.timing.frames-start,length);assert.equal(adapted.timing.frames-1,last);
    assert.equal(JSON.stringify(source),before);
  });

  test(`${id}: indefinite manual and delayed holds stay at an actually opaque native pose`,async()=>{
    for(const mode of ['duration','manual'] as const){
      const {graphic}=fixture(id,mode,28);
      for(const wallTime of [configurationsStop(id),28,60,600])assert.equal(graphic.sourceFrame(wallTime),hold);
    }
    for(const name of names){
      close(await nativeOpacity(id,name,hold),100,`${name} corrected hold opacity`);
      close(await nativeOpacity(id,name,contract.oldHold),contract.oldOpacity,`${name} old hold regression witness`);
    }
  });

  for(const mode of ['duration','manual'] as const)for(const requested of [contract.early,configurationsStop(id),28]){
    test(`${id}: ${mode} OUT at ${requested}s keeps every native tail frame and does not finish after 3s`,async()=>withoutAnimationLoop(async()=>{
      const {graphic,clock,frames,events}=fixture(id,mode,requested);
      clock.seconds=requested-.04;graphic._tick();assert.equal(graphic.phase,'onair');
      clock.seconds=requested;
      let completion:Promise<unknown>;
      if(mode==='manual'){
        graphic._tick();assert.equal(graphic.phase,'onair','Manual mode must not automatically enter OUT');
        completion=graphic.stopAction();await graphic._chain;
      }else{graphic._tick();completion=graphic._outDone.promise;}
      assert.equal(graphic.phase,'out');assert.equal(graphic.outAt,requested);
      assert.deepEqual(events,[{phase:'stopping',reason:mode}]);
      let finished=false;completion.then(()=>{finished=true;});
      frames.length=0;
      for(let index=0;index<length;index++)graphic._draw((Math.round(requested*25)+index)/25,false);
      assert.deepEqual(frames,Array.from({length},(_,index)=>start+index),'No missing, repeated or shortened native tail sample');
      assert.equal(graphic.frame,last);
      clock.seconds=requested+3;graphic._tick();await Promise.resolve();
      assert.equal(graphic.phase,'out');assert.equal(finished,false);assert.equal(graphic.stage.style.visibility,'visible');
      clock.seconds=(Math.round(requested*25)+length-1)/25;graphic._tick();
      assert.equal(graphic.phase,'out','Last native sample must remain visible until its 40ms interval ends');
      clock.seconds=(Math.round(requested*25)+length)/25-1e-9;graphic._tick();
      assert.equal(graphic.phase,'out','Numerical protection must not become an early-finish tolerance');
      clock.seconds=(Math.round(requested*25)+length)/25;graphic._tick();
      assert.equal(graphic.phase,'stopped','Terminal boundary must use the full native tail duration');
      await completion;
      assert.equal(graphic.frame,last);assert.equal(graphic.stage.style.visibility,'hidden');
      assert.deepEqual(events,[{phase:'stopping',reason:mode},{phase:'completed',reason:mode}]);
    }));
  }

  test(`${id}: source and generated endpoint helpers reject 1ns early but accept the exact endpoint`,()=>{
    for(const requested of [contract.early,configurationsStop(id),28,4.413]){
      const end=requested===4.413?requested+seconds:(Math.round(requested*25)+length)/25;
      for(const helper of [aeOutFinished,generated.aeOutFinished]){
        assert.equal(helper(end-1e-9,requested,seconds),false,`${requested}: 1ns before endpoint`);
        assert.equal(helper(end,requested,seconds),true,`${requested}: exact endpoint`);
      }
    }
  });

  test(`${id}: off-grid manual OUT keeps the exact 4.413s request and unrounded endpoint`,async()=>withoutAnimationLoop(async()=>{
    const requested=4.413,{graphic,clock}=fixture(id,'manual',requested);
    clock.seconds=requested;graphic._tick();assert.equal(graphic.phase,'onair');
    const completion=graphic.stopAction();await graphic._chain;
    assert.equal(graphic.outAt,requested);assert.equal(graphic.data._out_duration_seconds,requested);
    assert.notEqual(graphic.outAt,Math.round(requested*25)/25,'Do not quantize a manual request');
    graphic._draw(requested,false);assert.equal(graphic.frame,start);
    clock.seconds=requested+seconds-1e-9;graphic._tick();assert.equal(graphic.phase,'out');
    assert.equal(graphic.stage.style.visibility,'visible');
    clock.seconds=requested+seconds;graphic._tick();assert.equal(graphic.phase,'stopped');await completion;
    assert.equal(graphic.outAt,requested);assert.equal(graphic.frame,last);assert.equal(graphic.stage.style.visibility,'hidden');
  }));

  test(`${id}: early and late OUT select media from the native pose but keep clip-local elapsed time`,async()=>{
    for(const outAt of [contract.early,28])for(const offset of [0,.04]){
      const {graphic,calls}=fixture(id),wall=outAt+offset;
      await seekSignatureMedia(graphic,graphic.tracks,wall,outAt);graphic._draw(wall,false);
      assert.equal(graphic.phase,'out');assert.equal(graphic.frame,start+Math.round(offset*25));
      const expected=id==='BTV_Evenement'?[{kind:'event',time:wall},{kind:'event_logo',time:Math.max(0,wall-14.44)}]:[{kind:'final',time:Math.max(0,wall-19.8)}];
      assert.deepEqual(calls.map(call=>call.kind),expected.map(call=>call.kind));
      expected.forEach((item,index)=>close(calls[index].time,item.time,`${id}/${item.kind} at OUT ${outAt}`));
    }
    const {graphic,calls}=fixture(id),outAt=28;
    // The added pre-fade is still part of the native scene: the event logo
    // remains visible through450; the Semainier final remains active through624.
    const lastMediaFrame=id==='BTV_Evenement'?450:624;
    await seekSignatureMedia(graphic,graphic.tracks,outAt+(lastMediaFrame-start)/25,outAt);
    assert.ok(calls.some(call=>call.kind===(id==='BTV_Evenement'?'event_logo':'final')));
    calls.length=0;
    await seekSignatureMedia(graphic,graphic.tracks,outAt+(lastMediaFrame+1-start)/25,outAt);
    assert.ok(!calls.some(call=>call.kind===(id==='BTV_Evenement'?'event_logo':'final')));
  });
}

function configurationsStop(id:string){return configs[id].defaults._out_duration_seconds as number;}
