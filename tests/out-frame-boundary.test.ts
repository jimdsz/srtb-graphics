import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {broadcastTemplates,templateDefaults,validateProjectData} from '../src/studio/domain';
import {ceilFrameSeconds} from '../src/studio/frame-time';
import {engineData} from '../src/studio/presentation';
import {previewTimeline} from '../src/studio/preview-timeline';
import {makeTimeline,TIMINGS} from '../src/studio/video/timeline';
import {packageDocuments} from '../src/studio/delivery-runtime';
import {nativeOutDuration} from './native-out-fixture';

for(const id of ['BTV_BA_1P','BTV_PopUp','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'])test(`${id}: native, inspection and export agree at exact, sub-frame and schema boundary durations`,async()=>{
  const template=broadcastTemplates.find(t=>t.id===id)!,field=template.fields._out_duration_seconds;
  const minimum=Number(field.minimum),maximum=Number(field.maximum);
  const values=[minimum,minimum+.001,minimum+1,minimum+1.01,minimum+1.021,minimum+1.04,maximum-.001,maximum];
  for(const requested of values){
    const project=validateProjectData(template,{...templateDefaults(template),_out_mode:'duration',_out_duration_seconds:requested});
    const before=JSON.stringify(project),expected=ceilFrameSeconds(requested);
    for(const format of ['tv','portrait','vertical'])for(const edited of [false,true]){
      const settings=engineData({...project,_studio_format:format},edited);
      assert.equal(settings._out_duration_seconds,expected);
      assert.equal(await nativeOutDuration(id,settings),expected);
    }
    const preview=previewTimeline({} as any,template,project),exported=makeTimeline(id,project,{},requested,false);
    assert.deepEqual(preview,exported);assert.equal(exported.outAt,expected);
    assert.equal(exported.timing.out,TIMINGS[id].out,'Native OUT animation is never shortened or stretched.');
    assert.equal(exported.frames,Math.round((expected+TIMINGS[id].out)*25)+exported.terminalHoldFrames);
    assert.ok(expected>=requested-1e-9&&expected-requested<.04+1e-9);
    assert.equal(JSON.stringify(project),before,'Requested/persisted data stays untouched.');
  }
});

test('frame ceiling is idempotent and does not advance exact frame boundaries due to floating-point noise',()=>{
  for(const seconds of [0,.04,3.2,7.6,16.28,24.28,599.96,600,3600]){
    assert.equal(ceilFrameSeconds(seconds),seconds);
    assert.equal(ceilFrameSeconds(seconds+Number.EPSILON),seconds);
    assert.equal(ceilFrameSeconds(ceilFrameSeconds(seconds+.01)),ceilFrameSeconds(seconds+.01));
  }
  for(const value of [-1,NaN,Infinity,'invalid',''])assert.equal(engineData({_out_duration_seconds:value})._out_duration_seconds,value);
});

test('portable HTML load/update uses the same frame ceiling without rewriting its project snapshot',()=>{
  const template=broadcastTemplates.find(t=>t.id==='BTV_PopUp')!,data={...templateDefaults(template),_out_mode:'duration',_out_duration_seconds:4.21};
  const plan={data,format:'tv',version:1,project:{id:'qualification',title:'Qualification locale',revision:1}} as any;
  const documents=packageDocuments(plan,template),script=documents['srtb-project.mjs'];
  const start=script.indexOf('const ceilFrameSeconds='),end=script.indexOf('\nawait graphic.load',start);
  assert.ok(start>=0&&end>start);
  const convert=runInNewContext(script.slice(start,end)+';tvData',{project:{data}});
  // XML and playout text fields enter as strings; keep their clock identical.
  for(const duration of [4.21,4.24,4.240000000000001,'4.21','4.24']){
    const raw={_out_duration_seconds:duration},before=JSON.stringify(raw);
    assert.equal(convert(raw)._out_duration_seconds,ceilFrameSeconds(Number(duration)));assert.equal(JSON.stringify(raw),before);
  }
  for(const duration of ['','invalid',-1,Infinity])assert.equal(convert({_out_duration_seconds:duration})._out_duration_seconds,duration);
  assert.equal(JSON.parse(documents['PROJET.json']).data._out_duration_seconds,4.21);
  assert.equal(data._out_duration_seconds,4.21);
});

test('active preview/export and social updates cross engineData while applied signatures use the untouched snapshot',async()=>{
  const read=(path:string)=>readFile(new URL('../src/studio/'+path,import.meta.url),'utf8');
  const preview=await read('Preview.tsx'),exported=await read('video/engine.ts'),social=await read('social-preview.ts');
  assert.match(preview,/element\.load\([^\n]*engineData\(resolved,true\)/);
  assert.match(preview,/g\.updateAction\([^\n]*engineData\(candidate,true\)/);
  assert.match(preview,/applied\.current=previewSignature\(template,snapshot\)/);
  assert.match(exported,/graphic\.load\([^\n]*engineData\(settings,true\)/);
  assert.match(social,/native\.update\(engineData\(next,!!g\.__typography\)\)/);
});
