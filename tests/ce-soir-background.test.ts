import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {engineData} from '../src/studio/presentation';
import {CE_SOIR_BACKGROUND,CE_SOIR_COLORS,ceSoirBackground,ceSoirBackgroundPatch} from '../src/studio/ce-soir-background';
import {installCeSoirBackground} from '../src/studio/ce-soir-background-engine';
import {selectedMediaData,mediaFieldInactive} from '../src/studio/media-selection';
import {inspectorSearchPanels} from '../src/studio/inspector-search';
import {CE_SOIR_SIGNATURE_URL,ceSoirSignatureData} from '../src/studio/ce-soir-audio';
import {modelSignature} from '../src/studio/signature-sound';
import {stripSupplementalVoice,supplementalVoicePlan} from '../src/studio/supplemental-voice';
import {soundTracks} from '../src/studio/sound-level-model';
import {audioEvents} from '../src/studio/video/audio';
import {makeTimeline} from '../src/studio/video/timeline';
import {buildDeliveryPlan} from '../src/studio/delivery-plan';
import inventory from '../reports/library-intake.json';
const template=getTemplate('BTV_Ce_Soir');

test('old projects keep their background and silence, new projects have opening signature and music loop ready',()=>{
  const old=validateProjectData(template,{}),fresh=templateDefaults(template);
  assert.equal(old[CE_SOIR_BACKGROUND],'original');assert.equal(ceSoirBackground(old),undefined);
  assert.equal(old._audio_signature_enabled,false);assert.equal(old._audio_loop,false);
  assert.equal(fresh._audio_signature_enabled,true);assert.equal(fresh._audio_voice_enabled,false);
  assert.equal(fresh[CE_SOIR_BACKGROUND],'vert');
  assert.equal(fresh._audio_enabled,false);assert.equal(fresh._audio_loop,true);assert.equal(fresh._audio_voice_delay_seconds,1.92);
  assert.throws(()=>validateProjectData(template,{[CE_SOIR_BACKGROUND]:'blue'}));
  assert.throws(()=>validateProjectData(getTemplate('BTV_Renvoi'),{[CE_SOIR_BACKGROUND]:'vert'}));
});
for(const [name,hex]of Object.entries(CE_SOIR_COLORS))test(`${name}: persisted choice, adapter boundary, no hidden background fetch, three media retained`,()=>{
  const data=validateProjectData(template,{...templateDefaults(template),[CE_SOIR_BACKGROUND]:name,_media_background_url:'lib/background.jpg',_media_background_sequence:'[{"url":"lib/hidden.jpg","start":0,"end":3}]'}),before=structuredClone(data);
  assert.equal(ceSoirBackground(data),hex);assert.equal(engineData(data,true)[CE_SOIR_BACKGROUND],name);assert.equal(engineData(data)[CE_SOIR_BACKGROUND],undefined);
  const active=selectedMediaData(template,data);assert.equal(active._media_background_url,'');assert.equal(active._media_background_sequence,'[]');
  for(const n of [1,2,3])assert.equal(active[`_media_${n}_url`],data[`_media_${n}_url`]);
  assert.deepEqual(data,before);
  assert.equal(inspectorSearchPanels(template,data,name).ceSoirBackground,true);
});
test('solid fill never depends on the hidden background for OUT',()=>{
  const data={...templateDefaults(template),_out_mode:'media_end',_out_media_track:'background'};
  assert.deepEqual(ceSoirBackgroundPatch(data,'rouge'),{[CE_SOIR_BACKGROUND]:'rouge',_out_mode:'duration'});
  assert.equal(selectedMediaData(template,{...data,[CE_SOIR_BACKGROUND]:'or'})._out_mode,'duration');
  assert.deepEqual(ceSoirBackgroundPatch(data,'original'),{[CE_SOIR_BACKGROUND]:'original'});
});
test('native adapter changes only background/header contrast; restore and failed update preserve state',async()=>{
  const nodes=Object.fromEntries(['.background','.heading','.station'].map(key=>[key,{style:{display:'',color:''}}]));
  const root={style:{background:'',opacity:'.7'},querySelector:(selector:string)=>nodes[selector]};let code=200,last:any;
  const underlay={style:{background:'',display:''},setAttribute:()=>{}},children:any[]=[];
  const g:any={scene:{root},ownerDocument:{createElement:()=>underlay},shadowRoot:{prepend:(node:any)=>children.unshift(node)},load:async(p:any)=>{last=p.data;return {statusCode:200};},updateAction:async(p:any)=>{last=p;return {statusCode:code};}};
  installCeSoirBackground(g,template,{[CE_SOIR_BACKGROUND]:'vert'});
  await g.load({data:{[CE_SOIR_BACKGROUND]:'or'}});assert.equal(root.style.background,CE_SOIR_COLORS.or);assert.equal(nodes['.heading'].style.color,'#000');assert.equal(last[CE_SOIR_BACKGROUND],undefined);assert.equal(root.style.opacity,'.7');
  assert.equal(children[0],underlay);assert.equal(underlay.style.background,CE_SOIR_COLORS.or);assert.equal(underlay.style.display,'block');
  root.style.opacity='0';assert.equal(underlay.style.display,'block','native IN/OUT opacity must not hide the full-frame solid');
  code=400;await g.updateAction({[CE_SOIR_BACKGROUND]:'rouge'});assert.equal(root.style.background,CE_SOIR_COLORS.or);
  code=200;await g.updateAction({[CE_SOIR_BACKGROUND]:'original'});assert.equal(root.style.background,'');assert.equal(nodes['.background'].style.display,'');assert.equal(nodes['.heading'].style.color,'');
  assert.equal(underlay.style.display,'none');assert.equal(children.length,1);
});
test('signature is independent of music and voice, stripped only at frozen boundary',()=>{
  const data={...templateDefaults(template),_audio_enabled:false,_audio_voice_enabled:false},selected=selectedMediaData(template,data);
  assert.equal(selected._audio_signature_url,CE_SOIR_SIGNATURE_URL);assert.equal(mediaFieldInactive(data,'_audio_signature_url'),false);
  assert.equal(mediaFieldInactive({...data,_audio_signature_enabled:false},'_audio_signature_url'),true);
  const patch=modelSignature(template)!;assert.ok(Object.keys(patch).every(key=>key.startsWith('_audio_signature_')));
  const clean=stripSupplementalVoice(template,selected);assert.equal(clean._audio_signature_url,undefined);assert.equal(clean._audio_enabled,false);
  assert.equal(soundTracks(template).filter(track=>['_audio_enabled','_audio_voice_enabled','_audio_signature_enabled'].includes(track.key)).length,3);
});
test('offline mix schedules opening once, voice independently and loops music throughout',()=>{
  const data={...templateDefaults(template),_audio_enabled:true,_audio_voice_enabled:true,_audio_voice_url:'lib/voice.wav',_audio_voice_delay_seconds:2};
  const buffer={duration:30,sampleRate:48000} as AudioBuffer;
  const signature={buffer,plan:supplementalVoicePlan(template,ceSoirSignatureData(data),buffer)!};
  const voice={buffer,plan:{url:'lib/voice.wav',start:0,end:1,duration:1,delay:2,volume:.6}};
  const timeline=makeTimeline(template.id,data,{},13.8);
  const events=audioEvents({data,graphic:{},timeline,supplementalVoice:voice,supplementalSignature:signature,tracks:{audio:{clips:[{type:'audio',source:'music.wav',start:0,end:4,length:4}],loop:true}}} as any,template.id,false);
  const opening=events.filter(event=>event.buffer===buffer&&event.at===0);assert.equal(opening.length,1);assert.equal(opening[0].duration,9.68);
  assert.ok(events.some(event=>event.at===2&&event.duration===1&&event.gain(2)===.6));
  const music=events.filter(event=>event.url==='music.wav');assert.ok(music.length>=3);assert.equal(music[0].at,0);assert.ok(music.at(-1)!.at+music.at(-1)!.duration>=13.8);
});

test('portable packages include only the authorized stock opening from the BA library',()=>{
  const project:any={id:'00000000-0000-4000-8000-000000000001',title:'Ce soir',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,revision:1,data:templateDefaults(template)};
  const plan=buildDeliveryPlan(project,template,inventory.assets,[]);
  const opening=plan.files.filter(file=>file.url===CE_SOIR_SIGNATURE_URL);
  assert.equal(opening.length,1);assert.equal(plan.data._audio_signature_url,opening[0].path);assert.match(opening[0].sha256!,/^[a-f0-9]{64}$/);
  assert.throws(()=>buildDeliveryPlan({...project,data:{...project.data,_audio_signature_url:'/library/v1.7.0/BTV_BA_1P/graphic.mjs'}},template,inventory.assets,[]),/autre modèle/);
  const disabled=buildDeliveryPlan({...project,data:{...project.data,_audio_signature_enabled:false}},template,inventory.assets,[]);
  assert.equal(disabled.files.some(file=>file.url===CE_SOIR_SIGNATURE_URL),false);
});
