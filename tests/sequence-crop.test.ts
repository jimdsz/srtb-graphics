import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {engineData} from '../src/studio/presentation';
import {clipCropData,clipSourceKey,editCropSequence,matchedSequenceCrops,parseSequenceCrops,patchClipCrop,rebindSequenceCrops,sequenceCropAt,sequenceCropKey} from '../src/studio/sequence-crop';
import type {CropClip} from '../src/studio/sequence-crop';
import {liveTextEdit} from '../src/studio/live-preview';
import {replaceMedia} from '../src/studio/media-trim';
import {previewSources} from '../src/studio/preview-resources';

const t=getTemplate('BTV_BA_TDS'),key=sequenceCropKey('background');
const a:CropClip={url:'lib/media/a.mp4',start:3,end:8},b:CropClip={url:'lib/media/b.mp4',start:10,end:0};
function fixture(){let data={...templateDefaults(t),_studio_format:'vertical',_media_background_sequence:JSON.stringify([a,b])};
  data={...data,...patchClipCrop(data,'background',a,0,{_studio_background_x:10,_studio_background_y:20,_studio_background_crop_motion:JSON.stringify({vertical:{start:3,end:8,duration:5,points:[{at:0,x:0,y:0,transition:'linear'},{at:4,x:100,y:80,transition:'linear'}]}})})};
  return {...data,...patchClipCrop(data,'background',b,1,{_studio_background_x:90,_studio_background_y:70,_studio_background_fit:'contain'})};
}
test('all native playlists have optional bounded crops; absent settings preserve old projects and never reach TV engines',()=>{
  for(const template of broadcastTemplates){const data=validateProjectData(template,{});for(const name of Object.keys(template.fields).filter(key=>/^_media_.+_sequence$/.test(key))){
    assert.equal(data[sequenceCropKey(name.slice(7,-9))],'[]');
  }assert.ok(!Object.keys(engineData(data,true)).some(key=>key.endsWith('_sequence_crops')));}
  assert.deepEqual(validateProjectData(t,fixture())[key],fixture()[key]);
});
test('each passage and each social format retains independent framing',()=>{
  const data=fixture(),settings=clipCropData(data,'background',a,0);
  assert.equal(settings._studio_background_x,10);assert.equal(settings._studio_background_fit,'cover');assert.equal(settings._media_background_sequence,'[]');
  const portrait={...data,_studio_format:'portrait'},updated={...portrait,...patchClipCrop(portrait,'background',a,0,{_studio_background_x:35})};
  assert.equal(clipCropData(updated,'background',a,0)._studio_background_x,35);
  assert.equal(clipCropData({...updated,_studio_format:'vertical'},'background',a,0)._studio_background_x,10);
  assert.equal(clipCropData(data,'background',b,1)._studio_background_fit,'contain');
  assert.equal(clipCropData(data,'background',{...a,url:'lib/media/new.mp4'},0)._studio_background_x,50);
});
test('native source clock applies IN, speed, looping, end=0 and exact passage boundaries once',()=>{
  const values=matchedSequenceCrops(fixture(),'background'),track={clips:[{start:3,end:8,length:5},{start:10,end:16,length:6}],loop:false,rate:2};
  assert.deepEqual(sequenceCropAt(values,1,track),{x:50,y:40,fit:'cover'});
  assert.deepEqual(sequenceCropAt(values,2.5,track),{x:90,y:70,fit:'contain'});
  assert.deepEqual(sequenceCropAt(values,999,track),{x:90,y:70,fit:'contain'});
  assert.deepEqual(sequenceCropAt(values,6.5,{...track,loop:true}),{x:50,y:40,fit:'cover'});
  assert.equal(sequenceCropAt(values,0,{...track,clips:[]}),undefined);
});
test('reorder, remove and duplicate carry exact settings including repeated identical source clips',()=>{
  let data=fixture();data={...data,...editCropSequence(data,'background',[a,b,a],[0,1,0])};
  data={...data,...patchClipCrop(data,'background',a,2,{_studio_background_x:65,_studio_background_crop_motion:'{}'})};
  data={...data,...editCropSequence(data,'background',[a,a,b],[2,0,1])};
  assert.equal(clipCropData(data,'background',a,0)._studio_background_x,65);
  assert.equal(clipCropData(data,'background',a,1)._studio_background_x,10);
  data={...data,...editCropSequence(data,'background',[a,b],[1,2])};
  assert.equal(clipCropData(data,'background',a,0)._studio_background_x,10);
  const replaced={...a,url:'lib/media/new.mp4'};data={...data,...editCropSequence(data,'background',[replaced,b],[0,1])};
  assert.equal(matchedSequenceCrops(data,'background')[0],undefined);
  assert.deepEqual(editCropSequence(data,'background',[],[]),{_media_background_sequence:'[]',[key]:'[]'});
});
test('changed IN/OUT disable old motion rather than silently apply it to another passage',()=>{
  const data=fixture(),changed={...data,_media_background_sequence:JSON.stringify([{...a,end:0},b])};
  assert.equal(matchedSequenceCrops(changed,'background')[0]?.motion,undefined);
  assert.equal(matchedSequenceCrops(data,'background')[0]?.motion?.points.length,2);
  assert.equal(replaceMedia('_media_background_url','lib/media/new.mp4',t.fields)[key],'[]');
});

test('converting the primary clip to the first passage preserves both format movements only for the exact source and marks',()=>{
  const motion={start:3,end:8,duration:5,points:[{at:0,x:20,y:30,transition:'smooth'}]};
  const data={...templateDefaults(t),_media_background_url:a.url,_media_background_start_seconds:3,_media_background_end_seconds:8,_studio_background_x:40,_studio_background_crop_motion:JSON.stringify({vertical:motion,portrait:{...motion,points:[{at:0,x:80,y:70,transition:'cut'}]}})};
  const patch=editCropSequence(data,'background',[a],[-1]),saved=parseSequenceCrops(patch[key])[0];
  assert.equal(saved?.vertical?.motion?.points[0].x,20);assert.equal(saved?.portrait?.motion?.points[0].x,80);assert.equal(saved?.vertical?.x,40);
  assert.equal(editCropSequence(data,'background',[{...a,url:'lib/media/replaced.mp4'}],[-1])[key],'[]');
  assert.equal(editCropSequence(data,'background',[{...a,end:9}],[-1])[key],'[]');
});
test('trusted URL aliases preserve the guard, but cannot reconnect stale settings to a replacement',()=>{
  const data=fixture(),mapped=[{...a,url:'blob:trusted-alias'},b],patch=rebindSequenceCrops(data,'background',[a,b],mapped),next={...data,...patch,_media_background_sequence:JSON.stringify(mapped)};
  assert.equal(matchedSequenceCrops(next,'background')[0]?.x,10);
  assert.equal(parseSequenceCrops(patch[key])[0]?.source,clipSourceKey(mapped[0]));
  const replaced={...a,url:'lib/media/wrong.mp4'};
  assert.deepEqual(rebindSequenceCrops(data,'background',[replaced,b],mapped),{});
  assert.deepEqual(rebindSequenceCrops(data,'background',[a,b],[b]),{});
  assert.deepEqual(rebindSequenceCrops(data,'background',[a,b],[{...mapped[0],start:0},b]),{});
});
test('lightweight demonstration preview rebinds per-passage crops, leaving saved originals intact',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'location');Object.defineProperty(globalThis,'location',{configurable:true,value:new URL('https://srtb-graphics.pages.dev/graphics')});
  try{
    const template=getTemplate('BTV_BA_1P'),clip={url:'lib/media/programme.mp4',start:0,end:5};
    let data={...templateDefaults(template),_studio_format:'vertical',_media_body_sequence:JSON.stringify([clip])};data={...data,...patchClipCrop(data,'body',clip,0,{_studio_body_x:7})};
    const next=previewSources(template,data);assert.equal(JSON.parse(String(next._media_body_sequence))[0].url,'/preview-media/v1/ba-programme.mp4');assert.equal(matchedSequenceCrops(next,'body')[0]?.x,7);assert.equal(JSON.parse(String(data._media_body_sequence))[0].url,clip.url);
  }finally{if(previous)Object.defineProperty(globalThis,'location',previous);else Reflect.deleteProperty(globalThis,'location');}
});
test('live crop edits cannot reload media, bypass malformed data validation, or enter the TV fast path',()=>{
  const data=fixture(),next={...data,...patchClipCrop(data,'background',b,1,{_studio_background_x:45})};
  assert.equal(liveTextEdit(t,data,next,true),true);assert.equal(liveTextEdit(t,data,next,false),false);
  for(const invalid of ['{}','[{}]',JSON.stringify(Array(21).fill(null)),JSON.stringify([{source:'a'.repeat(64),vertical:{x:200,y:0,fit:'cover'}}]),' '.repeat(24001)]){
    assert.throws(()=>validateProjectData(t,{[key]:invalid}));assert.equal(liveTextEdit(t,data,{...data,[key]:invalid},true),false);
  }
  assert.equal(liveTextEdit(t,data,{...next,_media_background_sequence:'[]'},true),false);
});
