// Read-only audit: actual timeline/native clock methods, browser media mocked.
// Run explicitly: node tests/ae-inspection-out-media.audit.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {createAETemplate} from '../public/library/v1.7.0/_shared/lottie-ae-engine-v2.mjs';
import {CONFIG} from '../public/library/v1.7.0/BTV_Semainier/config.mjs';

const root=new URL('../',import.meta.url);
// No TypeScript loader or browser is needed. Only presentation is stubbed to
// select the TV branch; the source clock and inspection/export helpers are real.
let runtime='const presentation=()=>"tv";';
for(const path of ['src/studio/frame-time.ts','src/studio/ae-out-timing.ts','src/studio/media-tracks.ts','src/studio/video/timeline.ts','src/studio/preview-timeline.ts','src/studio/video/signature-media.ts']){
  const source=await readFile(new URL(path,root),'utf8');
  runtime+=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import .*?;$/gm,'');
}
const {inspectPreview,seekSignatureMedia,completeAEOutConfig}=await import('data:text/javascript;base64,'+Buffer.from(runtime).toString('base64'));
globalThis.HTMLElement=class {};
const Native=createAETemplate({},completeAEOutConfig(CONFIG,'BTV_Semainier'),new URL('../public/library/v1.7.0/BTV_Semainier/graphic-v2.mjs',import.meta.url).href);
function fixture(){
  const calls=[],graphic=Object.create(Native.prototype);
  Object.assign(graphic,{
    _queue:async operation=>operation(),pause(){this.playing=false;},
    elapsed:0,phase:'ready',stage:{style:{}},errors:[],warnings:[],muted:true,
    mediaItems:new Map(CONFIG.media.map(spec=>[spec.key,{spec}])),tracks:{},
    animation:{goToAndStop(){}},syncAudio(){},
    renderMedia:async(key,time)=>calls.push({key,time}),
  });
  for(const spec of CONFIG.media)graphic.tracks[spec.key]={
    activeStart:spec.activeStart,activeEnd:spec.activeEnd,clips:[],
    seek:async time=>calls.push({key:spec.key,time}),
  };
  return {graphic,calls};
}

const template={id:'BTV_Semainier'},data={_out_mode:'duration',_out_duration_seconds:3};
const preview=fixture(),returned=await inspectPreview(preview.graphic,template,data,3.04);
const output=fixture();
await seekSignatureMedia(output.graphic,output.graphic.tracks,3.04,3);
output.graphic._draw(3.04,false);
assert.equal(preview.graphic.frame,582);
assert.equal(output.graphic.frame,582);
assert.ok(output.calls.some(call=>call.key==='final'));
const report={
  template:template.id,outAt:3,inspectionSeconds:3.04,
  preview:{frame:preview.graphic.frame,returnedFrame:returned.frame,mediaCalls:preview.calls},
  export:{frame:output.graphic.frame,mediaCalls:output.calls},
  defects:{
    visibleFinalMediaNotPrepared:!preview.calls.some(call=>call.key==='final'),
    returnedFramePrecedesActualRemap:returned.frame!==preview.graphic.frame,
  },
  limits:'Call/clock audit only: no browser, pixels, files, network or deployment. Product fix is tested separately.',
};
console.log(JSON.stringify(report,null,2));
// Desired contracts: the pre-fix implementation fails the first assertion.
// Keep the clocks/calls visible; success is not a visual or platform verdict.
assert.equal(report.defects.visibleFinalMediaNotPrepared,false,'Inspection must prepare media visible in the remapped OUT scene.');
assert.equal(report.defects.returnedFramePrecedesActualRemap,false,'Inspection status must describe the frame that was actually drawn.');
// Combined regression: frame canonicalization must still prepare the remapped
// final, without subtracting the raw (off-grid) request from its media clock.
const fractional=fixture(),fractionalStatus=await inspectPreview(fractional.graphic,template,{...data,_out_duration_seconds:3.01},3.08);
assert.equal(fractional.graphic.outAt,3.04);assert.equal(fractionalStatus.frame,582);
assert.ok(fractional.calls.some(call=>call.key==='final'&&call.time===0));
