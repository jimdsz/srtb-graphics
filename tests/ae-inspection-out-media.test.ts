import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPreview} from '../src/studio/preview-timeline';
import {seekSignatureMedia} from '../src/studio/video/signature-media';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {LegacyGraphic} from '../src/studio/video/engine';
import {completeAEOutConfig} from '../src/studio/ae-out-timing';

const {createAETemplate}=await import(new URL('../public/library/v1.7.0/_shared/lottie-ae-engine-v2.mjs',import.meta.url).href);
const configs=Object.fromEntries(await Promise.all(['BTV_Semainier','BTV_Evenement'].map(async id=>[id,completeAEOutConfig((await import(new URL(`../public/library/v1.7.0/${id}/config.mjs`,import.meta.url).href)).CONFIG,id)])));
const initialHTMLElement=Object.getOwnPropertyDescriptor(globalThis,'HTMLElement');
function fixture(id:string){
  Object.defineProperty(globalThis,'HTMLElement',{configurable:true,value:class {}});
  let Native:any;try{Native=createAETemplate({},configs[id],new URL(`../public/library/v1.7.0/${id}/graphic-v2.mjs`,import.meta.url).href);}
  finally{if(initialHTMLElement)Object.defineProperty(globalThis,'HTMLElement',initialHTMLElement);else Reflect.deleteProperty(globalThis,'HTMLElement');}
  const calls:{kind:string;time:number;via:string}[]=[],frames:number[]=[],graphic=Object.create(Native.prototype),config=configs[id];
  Object.assign(graphic,{
    _queue:async(operation:()=>unknown)=>operation(),pause(){this.playing=false;},
    elapsed:0,playing:false,phase:'ready',stage:{style:{}},errors:[],warnings:[],muted:true,
    mediaItems:new Map(config.media.map((spec:any)=>[spec.key,{spec}])),tracks:{},
    animation:{goToAndStop(frame:number){frames.push(frame);}},syncAudio(){},
    renderMedia:async(kind:string,time:number)=>{calls.push({kind,time,via:'native inspection'});},
  });
  for(const spec of config.media)graphic.tracks[spec.key]={activeStart:spec.activeStart,activeEnd:spec.activeEnd,clips:[],seek:async(time:number)=>{calls.push({kind:spec.key,time,via:'remapped pose'});}};
  return {graphic:graphic as LegacyGraphic,calls,frames,config};
}

test('early Semainier OUT prepares its newly visible final and returns the actual drawn frame',async()=>{
  const preview=fixture('BTV_Semainier'),template=getTemplate('BTV_Semainier'),data={...templateDefaults(template),_out_duration_seconds:3};
  const first=await inspectPreview(preview.graphic,template,data,3);
  assert.equal(first.frame,581,'The complete native pre-fade must start before the old 583 boundary');
  assert.deepEqual(preview.calls.filter(call=>call.via==='remapped pose'),[{kind:'final',time:0,via:'remapped pose'}]);
  preview.calls.length=0;
  const result=await inspectPreview(preview.graphic,template,data,3.04);
  assert.equal(preview.graphic.frame,582);assert.equal(result.frame,582);assert.equal(result.phase,'out');
  assert.deepEqual(preview.calls.filter(call=>call.via==='remapped pose'),[{kind:'final',time:0,via:'remapped pose'}]);
  const output=fixture('BTV_Semainier');await seekSignatureMedia(output.graphic,output.graphic.tracks,3.04,3);output.graphic._draw(3.04,false);
  assert.deepEqual(preview.calls.filter(call=>call.via==='remapped pose'),output.calls);assert.equal(preview.graphic.frame,output.graphic.frame);
});

test('the remapped final is awaited before its frame is drawn or inspection is acknowledged',async()=>{
  const preview=fixture('BTV_Semainier'),template=getTemplate('BTV_Semainier');let release:()=>void=()=>{},started:()=>void=()=>{};
  const seeking=new Promise<void>(resolve=>{started=resolve;}),ready=new Promise<void>(resolve=>{release=resolve;});
  preview.graphic.tracks.final.seek=async()=>{started();await ready;};
  let finished=false;const pending=inspectPreview(preview.graphic,template,{...templateDefaults(template),_out_duration_seconds:3},3.04).then(result=>{finished=true;return result;});
  await seeking;assert.equal(finished,false);assert.ok(!preview.frames.includes(582));
  release();const result=await pending;assert.equal(result.frame,582);assert.equal(preview.frames.at(-1),582);
});

test('unaltered AE inspection frames do not add a second media preparation',async()=>{
  for(const id of ['BTV_Semainier','BTV_Evenement']){
    const preview=fixture(id),template=getTemplate(id),data=templateDefaults(template),result=await inspectPreview(preview.graphic,template,data,3.04);
    assert.equal(preview.calls.filter(call=>call.via==='remapped pose').length,0);assert.equal(result.frame,preview.graphic.frame);assert.equal(result.phase,'inspection');
  }
});

test('early/manual, native and delayed OUT inspections retain export source pose and active-media clock',async()=>{
  for(const id of ['BTV_Semainier','BTV_Evenement'])for(const outAt of [.4,configs[id].timing.outStart,28]){
    const seconds=outAt+.04,preview=fixture(id),output=fixture(id),template=getTemplate(id),data=templateDefaults(template);
    const result=await inspectPreview(preview.graphic,template,data,seconds,outAt);
    await seekSignatureMedia(output.graphic,output.graphic.tracks,seconds,outAt);output.graphic._draw(seconds,false);
    assert.equal(result.frame,output.graphic.frame,`${id}, OUT ${outAt}: returned source frame`);
    assert.equal(preview.graphic.phase,'out');assert.equal(preview.graphic.outAt,outAt);
    assert.deepEqual(preview.calls.filter(call=>call.via==='remapped pose'),output.calls,`${id}, OUT ${outAt}: media selected after remapping`);
  }
});

test('remapped media errors reject inspection instead of acknowledging an unprepared OUT',async()=>{
  const preview=fixture('BTV_Semainier'),template=getTemplate('BTV_Semainier');preview.graphic.tracks.final.seek=async()=>{throw Error('Final media unavailable');};
  await assert.rejects(inspectPreview(preview.graphic,template,{...templateDefaults(template),_out_duration_seconds:3},3.04),/Final media unavailable/);
  assert.ok(!preview.frames.includes(582));
});
