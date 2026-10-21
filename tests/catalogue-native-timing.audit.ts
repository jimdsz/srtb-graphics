// Explicit local audit, not the default *.test.ts suite. Failing assertions are
// qualification findings; do not change product code or tolerances to hide them.
// Run: node --import tsx --test tests/catalogue-native-timing.audit.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {broadcastTemplates,templateDefaults,validateProjectData} from '../src/studio/domain';
import {engineData} from '../src/studio/presentation';
import {studioEngineModule} from '../src/studio/text-editing';
import {TIMINGS,makeTimeline} from '../src/studio/video/timeline';
import {ceilFrameSeconds} from '../src/studio/frame-time';

const root=new URL('../',import.meta.url);
const read=(path:string)=>readFile(new URL(path,root),'utf8');
const native=(id:string,file:string)=>new URL(`public/library/v1.7.0/${id}/${file}`,root);
const signatureIds=['BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay'];
const aeIds=['BTV_Renvoi','BTV_Evenement','BTV_Semainier'];
const frame=(seconds:number)=>Math.round(seconds*25);

for(const template of broadcastTemplates)test(`${template.id}: Studio entry/OUT agrees with independently read active native source`,async t=>{
  const timing=TIMINGS[template.id];assert.ok(timing,`${template.id}: missing timing`);
  const modulePath=studioEngineModule(template);await read('public'+modulePath);
  let sourceEntry:number,sourceStop:number,sourceOut:number,evidence:unknown;
  if(signatureIds.includes(template.id)){
    const {TEMPLATE}=await import(native(template.id,'definition.mjs').href);
    sourceEntry=frame(TEMPLATE.inSeconds);sourceStop=frame(TEMPLATE.duration);sourceOut=frame(TEMPLATE.outSeconds);evidence=TEMPLATE;
  }else if(aeIds.includes(template.id)){
    const original=await import(native(template.id,'config.mjs').href),TIMING=original.TIMING;
    sourceEntry=frame(TIMING.entry??TIMING.inEnd);sourceStop=frame(TIMING.outStart);sourceOut=frame(TIMING.outDuration);
    assert.equal(sourceStop+sourceOut,TIMING.frames);evidence=TIMING;
    if(template.id!=='BTV_Renvoi'){
      // Independent source oracle: do not import the new timing helper to
      // assert the values the Studio imported from that same helper.
      const animation=JSON.parse(await readFile(native(template.id,'source/animation.json'),'utf8'));
      const name=template.id==='BTV_Evenement'?'LOGO BENIN TV':'BTV_to_BENINTV_Gauche';
      const layer=animation.layers.find((item:any)=>item.nm===name&&item.ks?.o?.a===1);
      assert.equal(animation.fr,25);assert.equal(layer.sr,1);
      const fade=layer.ks.o.k.find((key:any,index:number,keys:any[])=>key.s?.[0]===100&&keys[index+1]?.s?.[0]===0);
      assert.ok(fade,'Native logo final fade missing');sourceStop=fade.t;sourceOut=animation.op-sourceStop;
      evidence={originalTiming:TIMING,completeNativeTail:{layer:name,opacityKeys:layer.ks.o.k,sourceEnd:animation.op}};
    }
  }else{
    const source=JSON.parse(await read(`public/library/v1.7.0/${template.id}/lib/lottie-template.json`));
    const start=source.markers.find((m:any)=>m.cm==='start'),stop=source.markers.find((m:any)=>m.cm==='stop');
    assert.equal(source.fr,25);assert.ok(start&&stop);sourceEntry=start.tm+start.dr;sourceStop=stop.tm;sourceOut=stop.dr;
    if(template.id==='BTV_BA_1P'){
      const current=await read('public/studio-engines/ba-text-v2/config.mjs'),match=current.match(/export const TIMING=Object\.freeze\((\{[^\n]+\})\);/);
      assert.ok(match,'Current BA timing declaration missing.');const active=runInNewContext('('+match[1]+')');
      sourceEntry=frame(active.inEnd);assert.equal(frame(active.outStart),stop.tm);assert.equal(frame(active.outEnd),stop.tm+stop.dr);
      evidence={sourceStartMarker:start,sourceStopMarker:stop,active};
    }else evidence={sourceStartMarker:start,sourceStopMarker:stop,sourceRootEnd:source.op};
  }
  assert.deepEqual([frame(timing.entry),frame(timing.stop),frame(timing.out)],[sourceEntry,sourceStop,sourceOut]);
  const defaultData=templateDefaults(template),line=makeTimeline(template.id,defaultData,{},Number(defaultData._out_duration_seconds),false);
  assert.equal(line.frames-frame(line.outAt)-line.terminalHoldFrames,sourceOut);
  t.diagnostic(JSON.stringify({modulePath,nativeFrames:{entry:sourceEntry,stop:sourceStop,out:sourceOut},defaultOutAt:line.outAt,totalFrames:line.frames,evidence}));
});

for(const id of signatureIds)test(`${id}: every native text block belongs to an entry motion completed before IN ends`,async t=>{
  const {TEMPLATE,DEFAULTS,PALETTE}=await import(native(id,'config.mjs').href);
  class Node {children:Node[]=[];parent:Node|null=null;className='';textContent='';dataset={};style={setProperty:()=>{}};append(...nodes:Node[]){for(const node of nodes){node.parent=this;this.children.push(node);}}}
  // Execute the real layout builder. No browser painting, font fitting or
  // interpolation is claimed by this structural entry-completion assertion.
  const source=(await readFile(native(id,'layout.mjs'),'utf8')).replace(/^import[^\n]+\n/gm,'').replace(/export function /g,'function ');
  const build=runInNewContext(source+';buildLayout',{TEMPLATE,PALETTE,CHARACTERS:{},document:{createElement:()=>new Node()},URL});
  const layout=build({...DEFAULTS,_replay_url:''}),all:Node[]=[];const visit=(node:Node)=>{all.push(node);node.children.forEach(visit);};visit(layout.root);
  const texts=all.filter(node=>node.className.split(' ').includes('fit'));assert.ok(texts.length);
  for(const node of texts){let parent:Node|null=node;while(parent&&!layout.motions.some((m:any)=>m.node===parent))parent=parent.parent;assert.ok(parent,`${node.className}: no native motion parent`);}
  for(const motion of layout.motions)assert.ok(motion.delay+motion.enter<=TEMPLATE.inSeconds,`Native ${motion.node.className} still entering after IN completion.`);
  t.diagnostic(JSON.stringify({textBlocks:texts.length,motions:layout.motions.map((m:any)=>({node:m.node.className,start:m.delay,end:m.delay+m.enter})),declaredEntry:TEMPLATE.inSeconds,scope:'structure/time only, not pixel visibility'}));
});

// These four frozen engines canonicalize durations by nearest 25fps sample.
// A timeline built from the same accepted project must not choose another OUT.
for(const id of ['BTV_BA_1P','BTV_PopUp','BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'])test(`${id}: accepted sub-frame duration selects the SAME native and Studio OUT frame`,async t=>{
  const template=broadcastTemplates.find(item=>item.id===id)!;
  const requested=(frame(Number(template.fields._out_duration_seconds.minimum))+25)/25+.01;
  const project=validateProjectData(template,{...templateDefaults(template),_out_mode:'duration',_out_duration_seconds:requested});
  const settings=engineData(project);assert.equal(project._out_duration_seconds,requested,'Saved request must remain intact.');assert.equal(settings._out_duration_seconds,ceilFrameSeconds(requested));
  let nativeDuration:number;
  if(id==='BTV_BA_1P'){
    const current=await read('public/studio-engines/ba-text-v2/config.mjs');
    const body=(source:string)=>source.slice(source.indexOf('export function normalizeConfig('),source.indexOf('\nfunction setText('));
    assert.ok(body(current).length);
    // Execute the CURRENT function, whose appointment rules differ from the
    // frozen package; its untouched default/schema fixtures supply only data.
    const {DEFAULTS,SCHEMA}=await import(native(id,'config.mjs').href);
    const normalizeConfig=runInNewContext(body(current).replace('export ','')+';normalizeConfig',{DEFAULTS,SCHEMA,structuredClone});
    nativeDuration=normalizeConfig({_out_mode:'duration',_out_duration_seconds:settings._out_duration_seconds})._out_duration_seconds;
  }else if(id==='BTV_BA_TDS_SUIVI_DE'){
    const source=await readFile(native(id,'dynamic-graphic.mjs'),'utf8'),start=source.indexOf('    _configuration(raw) {'),end=source.indexOf('\n    _monitored(',start);
    assert.ok(start>=0&&end>start);const method=source.slice(start,end).trim().replace(/^_configuration\(raw\)/,'function(raw)');
    const normalize=runInNewContext('('+method+')',{FPS:25,START_END:607,KINDS:['programme_1','programme_2'],clonePayload:(raw:any)=>({...raw}),bool:(v:any)=>v===true||v===1||['true','1','oui','yes','on'].includes(String(v).toLowerCase())});
    nativeDuration=normalize.call({media:{data:{}}},settings)._out_duration_seconds;
  }else{
    const {validateOutConfiguration}=await import(native(id,'auto-out.mjs').href),config={...settings};validateOutConfiguration(config);nativeDuration=Number(config._out_duration_seconds);
  }
  const timeline=makeTimeline(id,project,{},requested,false);
  t.diagnostic(JSON.stringify({requested,nativeDuration,studioOutAt:timeline.outAt,nativeOutFrame:frame(nativeDuration),studioOutFrame:frame(timeline.outAt)}));
  assert.equal(frame(timeline.outAt),frame(nativeDuration),'Native normalized OUT and Studio inspection/export OUT differ by one frame.');
});
