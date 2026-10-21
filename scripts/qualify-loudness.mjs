// Local research only. This is not imported by the Studio or its release build.
// Independently synthesized requirements, not redistributed EBU sound files.
// Reference: EBU Tech 3341 (2023), Table 1.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {analyzeLoudness,encodeWav} from '../.tools/audio-study/package/dist/index.js';

const sampleRateHz=48000;
function tones(segments,{frequency=1000,phase=0,amplitude,taper=false}={}){
  const count=segments.reduce((sum,[seconds])=>sum+Math.round(seconds*sampleRateHz),0);
  const pcm=new Float32Array(count);let position=0;
  for(const [seconds,db]of segments){const frames=Math.round(seconds*sampleRateHz),level=db===null?0:amplitude??10**(db/20);
    for(let n=0;n<frames;n++,position++){const envelope=taper?Math.min(1,position/480,(count-1-position)/480):1;pcm[position]=level*envelope*Math.sin(2*Math.PI*frequency*position/sampleRateHz+phase);}}
  return [pcm,pcm.slice()];
}
const cases=[
  {id:'3341-1',segments:[[20,-23]],expected:{integratedLufs:-23,momentaryMaxLufs:-23,shortTermMaxLufs:-23}},
  {id:'3341-2',segments:[[20,-33]],expected:{integratedLufs:-33,momentaryMaxLufs:-33,shortTermMaxLufs:-33}},
  {id:'3341-3',segments:[[10,-36],[60,-23],[10,-36]],expected:{integratedLufs:-23}},
  {id:'3341-4',segments:[[10,-72],[10,-36],[60,-23],[10,-36],[10,-72]],expected:{integratedLufs:-23}},
  {id:'3341-5',segments:[[20,-26],[20.1,-20],[20,-26]],expected:{integratedLufs:-23}},
  {id:'3341-9',segments:Array.from({length:5},()=>[[1.34,-20],[1.66,-30]]).flat(),expected:{shortTermMaxLufs:-23}},
  {id:'3341-12',segments:Array.from({length:25},()=>[[.18,-20],[.22,-30]]).flat(),expected:{momentaryMaxLufs:-23}},
  ...Array.from({length:20},(_,i)=>({id:'3341-10-'+i,segments:[[i*.15,null],[3,-23],[1,null]],expected:{shortTermMaxLufs:-23}})),
  ...Array.from({length:20},(_,i)=>({id:'3341-13-'+i,segments:[[i*.02,null],[.4,-23],[1,null]],expected:{momentaryMaxLufs:-23}})),
  ...[[15,4,0,.5,-6],[16,4,45,.5,-6],[17,6,60,.5,-6],[18,8,67.5,.5,-6],[19,4,45,1.41,3]].map(([id,divisor,phase,amplitude,target])=>({id:'3341-'+id,segments:[[2,0]],tone:{frequency:sampleRateHz/divisor,phase:phase*Math.PI/180,amplitude,taper:true},expected:{truePeakDbtp:target}})),
  {id:'silence',segments:[[4,null]],expected:{integratedLufs:-Infinity,truePeakDbtp:-Infinity}},
];
const records=[];const started=performance.now();
for(const test of cases){const channels=tones(test.segments,test.tone),begin=performance.now(),actual=analyzeLoudness(channels,{sampleRateHz});
  const checks=Object.entries(test.expected).map(([key,value])=>({metric:key,expected:value,actual:actual[key],pass:Number.isFinite(value)?actual[key]>=value-(key==='truePeakDbtp'?.4:.1)&&actual[key]<=value+(key==='truePeakDbtp'?.2:.1):actual[key]===value}));
  const record={id:test.id,milliseconds:performance.now()-begin,checks,pass:checks.every(check=>check.pass)};records.push(record);console.log(record.pass?'PASS':'FAIL',test.id,checks.map(c=>`${c.metric}=${c.actual.toFixed(4)}`).join(', '));
}

const references=[];
if(process.argv.includes('--reference')){
 try{
  // The upstream UMD build targets a worker. Only provide its URL shim in this
  // local Node research process; wasmBinary below avoids network/file loaders.
  globalThis.self={location:{href:new URL('../.tools/ffmpeg-study/package/dist/umd/ffmpeg-core.js',import.meta.url).href}};
  const require=createRequire(import.meta.url),createFFmpegCore=require('../.tools/ffmpeg-study/package/dist/umd/ffmpeg-core.js');
  const core=await createFFmpegCore({wasmBinary:new Uint8Array(await readFile(new URL('../.tools/ffmpeg-study/package/dist/umd/ffmpeg-core.wasm',import.meta.url)))});
  for(const id of ['3341-1','3341-5','3341-16','3341-13-2']){
    const test=cases.find(test=>test.id===id),channels=tones(test.segments,test.tone),lines=[];core.setLogger(({message})=>lines.push(message));
    core.FS.writeFile('reference.wav',encodeWav(channels,sampleRateHz,{format:'float32'}));
    const code=core.exec('-hide_banner','-nostats','-i','reference.wav','-af','ebur128=peak=true','-f','null','-');
    const text=lines.join('\n'),summary=text.slice(text.lastIndexOf('Summary:'));
    references.push({id,code,summary});core.FS.unlink('reference.wav');core.reset();console.log('REFERENCE',id,code,summary);
  }
 }catch(error){
  const message=error instanceof Error?error.message:String(error);
  references.push({id:'reference-runtime',code:-1,error:message});
  console.error('REFERENCE FAILED:',message);
 }
}
const report={createdAt:new Date().toISOString(),component:'bravoh-loudness@0.1.0',standard:'https://tech.ebu.ch/docs/tech/tech3341.pdf',scope:'Independent synthesized subset. Not full conformance certification; no original EBU recordings downloaded.',milliseconds:performance.now()-started,records,references};
await mkdir('reports/audio-qualification',{recursive:true});const path=`reports/audio-qualification/loudness-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});console.log(path);
if(records.some(record=>!record.pass)||references.some(reference=>reference.code!==0))process.exitCode=1;
