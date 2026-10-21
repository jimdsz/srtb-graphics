import test from 'node:test';
import assert from 'node:assert/strict';
import {cropMotionKey,parseCropMotion,patchCropMotion,placeCropPoint,motionCrop,cropMotionMatches,currentCropMotion,interpolateCrop} from '../src/studio/crop-motion';
import type {CropMotion} from '../src/studio/crop-motion';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {engineData} from '../src/studio/presentation';
import {replaceMedia} from '../src/studio/media-trim';
import {liveTextEdit} from '../src/studio/live-preview';
import {proposePreset,applyPreparation} from '../src/studio/preparation-proposal';

const motion:CropMotion={start:2,end:12,duration:10,points:[{at:0,x:0,y:25,transition:'smooth'},{at:8,x:100,y:75,transition:'linear'}]};
const template=getTemplate('BTV_BA_1P');
const data={...templateDefaults(template),_studio_format:'vertical',_media_body_start_seconds:2,_media_body_end_seconds:12,_media_body_loop:false,_media_body_rate:1};
const moving={...data,...patchCropMotion(data,'body',motion)};

test('old projects remain static; all models validate and retain their defaults',()=>{
  for(const template of broadcastTemplates){const defaults=templateDefaults(template);assert.doesNotThrow(()=>validateProjectData(template,defaults));for(const key of Object.keys(defaults).filter(k=>k.endsWith('_crop_motion')))assert.equal(defaults[key],'{}');}
  assert.deepEqual(motionCrop(data,'body',4),{x:50,y:50});assert.equal(currentCropMotion({...moving,_studio_format:'tv'},'body'),undefined);
  assert.equal(engineData(moving)[cropMotionKey('body')],undefined);
});
test('linear, smooth and cut transitions are deterministic and clamp to end points',()=>{
  assert.deepEqual(motionCrop(moving,'body',4),{x:50,y:50});assert.deepEqual(motionCrop(moving,'body',100),{x:100,y:75});
  const smooth={...motion,points:motion.points.map(p=>({...p,transition:'smooth' as const}))};
  assert.deepEqual(interpolateCrop(smooth.points,2,{x:50,y:50}),{x:15.625,y:32.8125});
  const cut={...motion,points:motion.points.map(p=>({...p,transition:'cut' as const}))};
  assert.deepEqual(interpolateCrop(cut.points,7.96,{x:50,y:50}),{x:0,y:25});assert.deepEqual(interpolateCrop(cut.points,8,{x:50,y:50}),{x:100,y:75});
  assert.deepEqual(interpolateCrop([],-1,{x:3,y:5}),{x:3,y:5});assert.deepEqual(motionCrop(moving,'body',-2),{x:0,y:25});
});
test('source-relative clock observes clip playback speed and loops without moving IN',()=>{
  assert.deepEqual(motionCrop({...moving,_media_body_rate:.5},'body',8),{x:50,y:50});
  assert.deepEqual(motionCrop({...moving,_media_body_rate:2},'body',2),{x:50,y:50});
  assert.deepEqual(motionCrop({...moving,_media_body_loop:true},'body',14),{x:50,y:50});
  assert.equal(motion.start,2);assert.equal(motion.end,12);
});
test('trim changes and sequences suspend old points without blocking or editing the media',()=>{
  for(const patch of [{_media_body_start_seconds:3},{_media_body_end_seconds:11},{_media_body_sequence:'[{"url":"lib/media/test.mp4","start":0,"end":5}]'}]){
    const next={...moving,...patch};assert.equal(cropMotionMatches(next,'body',motion),false);assert.deepEqual(motionCrop(next,'body',1),{x:50,y:50});assert.deepEqual(currentCropMotion(next,'body'),motion);
  }
});
test('formats are isolated; removing one motion keeps the other and does not mutate the original',()=>{
  const original=JSON.stringify(moving),other={...moving,_studio_format:'portrait'},both={...other,...patchCropMotion(other,'body',{...motion,points:[{at:0,x:99,y:3,transition:'smooth'}]})};
  assert.deepEqual(motionCrop(both,'body',1),{x:99,y:3});assert.deepEqual(currentCropMotion({...both,_studio_format:'vertical'},'body'),motion);
  const cleared={...both,...patchCropMotion(both,'body',undefined)};assert.equal(currentCropMotion(cleared,'body'),undefined);assert.deepEqual(currentCropMotion({...cleared,_studio_format:'vertical'},'body'),motion);assert.equal(JSON.stringify(moving),original);
});
test('media picker invalidates points; a favorite carries its own settings, not those of the old source',()=>{
  const patch=replaceMedia('_media_body_url',{url:'lib/media/new.mp4',name:'new.mp4',mimeType:'video/mp4'},template.fields);
  assert.equal(patch[cropMotionKey('body')],'{}');
  const profile={kind:'preset',archived:0,template_id:template.id,template_version:template.version,library_version:template.libraryVersion,name:'Autre fichier',data:{...data,_media_body_url:'lib/media/other.mp4'}} as Parameters<typeof proposePreset>[2];
  const next=applyPreparation(moving,proposePreset(template,moving,profile),'draft',false);assert.equal(next[cropMotionKey('body')],'{}');
});
test('point edits replace near-time keyframes, order points and enforce the 120-point cap',()=>{
  const changed=placeCropPoint(motion,{at:8,x:80,y:60,transition:'cut'});assert.equal(changed.points.length,2);assert.equal(motion.points[1].x,100);
  assert.deepEqual(placeCropPoint(changed,{at:4,x:40,y:40,transition:'smooth'}).points.map(p=>p.at),[0,4,8]);
  const full={...motion,duration:200,points:Array.from({length:120},(_,at)=>({at,x:50,y:50,transition:'linear' as const}))};assert.throws(()=>placeCropPoint(full,{at:120,x:50,y:50,transition:'linear'}),/120/);
});
test('invalid, oversized and foreign motion payloads are rejected by project validation',()=>{
  for(const value of ['null','[]','not JSON',JSON.stringify({tv:motion}),JSON.stringify({vertical:{...motion,secret:true}}),JSON.stringify({vertical:{...motion,points:[motion.points[1],motion.points[0]]}}),JSON.stringify({vertical:{...motion,points:[motion.points[0],motion.points[0]]}}),JSON.stringify({vertical:{...motion,points:[{at:11,x:5,y:5,transition:'linear'}]}}),JSON.stringify({vertical:{...motion,points:[{at:1,x:101,y:5,transition:'linear'}]}}),' '.repeat(24001)]){
    assert.throws(()=>parseCropMotion(value));assert.throws(()=>validateProjectData(template,{...data,[cropMotionKey('body')]:value}));
  }
});
test('social-only live point edits do not rebuild media; mixed media changes still validate fully',()=>{
  assert.equal(liveTextEdit(template,data,moving,true),true);assert.equal(liveTextEdit(template,data,moving,false),false);
  assert.equal(liveTextEdit(template,data,{...moving,_media_body_url:'lib/media/changed.mp4'},true),false);
  assert.equal(liveTextEdit(template,data,{...moving,[cropMotionKey('body')]:'invalid'},true),false);
  assert.equal(liveTextEdit(template,data,{...data,_studio_unknown_crop_motion:'{}'},true),false);
});
