import test from 'node:test';
import assert from 'node:assert/strict';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {montageClipDuration,montageClipIssue,montageDuration,montageEdit,montageLabel,parseMontage,seedMontageClip} from '../src/studio/montage-model';
import {clipCropData,editCropSequence,patchClipCrop} from '../src/studio/sequence-crop';
import type {CropClip} from '../src/studio/sequence-crop';
import {imageScale,imageSizePatch,reorderImageSizes} from '../src/studio/image-sizing-model';
import {locateClip} from '../src/studio/media-position';
import {playlistEvents} from '../src/studio/video/audio';

const a:CropClip={url:{url:'lib/media/reportage.mp4',name:'Reportage.mp4',mimeType:'video/mp4'},start:3,end:8};
const b:CropClip={url:'lib/media/plateau.mp4',start:10,end:12};
const image:CropClip={url:{url:'lib/images/photo.jpg',name:'Photo.jpg',mimeType:'image/jpeg'},start:0,end:4};

test('legacy native playlists round-trip without changed source references or clip properties',()=>{
  assert.deepEqual(parseMontage(undefined),[]);assert.deepEqual(parseMontage(''),[]);
  assert.deepEqual(parseMontage(JSON.stringify([a,b])),[a,b]);
  for(const value of ['{','{}','null','[{"url":true,"start":0,"end":3}]',JSON.stringify([{...a,unknown:true}]),JSON.stringify(Array(21).fill(a))])assert.equal(parseMontage(value),null);
  const saved=validateProjectData(getTemplate('BTV_BA_1P'),{_media_body_sequence:JSON.stringify([a,b])});
  assert.deepEqual(parseMontage(saved._media_body_sequence),[a,b]);
});

test('unknown source endings and invalid ranges never produce a misleading complete duration',()=>{
  assert.deepEqual(montageDuration([a,b,image]),{seconds:11,unknown:0});
  assert.deepEqual(montageDuration([a,{...b,end:0}],2),{seconds:2.5,unknown:1});
  assert.equal(montageClipDuration({...a,start:3.001,end:3.039}),.04);
  assert.equal(montageClipDuration({...a,start:3,end:3.001}),null);
  assert.equal(montageClipIssue({...image,start:1}), 'Pour une image, indiquez un début à 0 et une durée d’affichage positive.');
  assert.ok(montageClipIssue({...a,start:NaN}));assert.ok(montageClipIssue({...a,url:''}));assert.ok(montageClipIssue({...a,end:-1}));
  assert.equal(montageClipIssue({...b,end:0}),null);
});

test('seeding preserves the selected primary excerpt and gives new images a usable duration',()=>{
  assert.deepEqual(seedMontageClip(a.url,3,8),a);
  assert.deepEqual(seedMontageClip(image.url),{...image,end:5});
  assert.deepEqual(seedMontageClip(),{url:'',start:0,end:0});
  assert.equal(montageLabel(a.url),'Reportage.mp4');
  assert.equal(montageLabel('lib/media/Le%20journal.mp4'),'Le journal.mp4');
  assert.equal(montageLabel('lib/media/%oops.mp4'),'%oops.mp4');
  assert.equal(montageLabel(''),'Choisir un média');
});

test('structural edits preserve the exact crop and image scale of repeated files through duplicate, move and remove',()=>{
  const template=getTemplate('BTV_BA_TDS'),key='_media_background_sequence',original=[image,image];
  let data={...templateDefaults(template),_studio_format:'vertical',[key]:JSON.stringify(original)};
  data={...data,...patchClipCrop(data,'background',image,0,{_studio_background_x:10}),...imageSizePatch(data,`${key}:0`,125)};
  data={...data,...patchClipCrop(data,'background',image,1,{_studio_background_x:90}),...imageSizePatch(data,`${key}:1`,75)};
  let clips=original;
  for(const action of [{type:'duplicate',index:0},{type:'move',from:2,to:0},{type:'remove',index:1}] as const){
    const edit=montageEdit(clips,action);
    data={...data,...editCropSequence(data,'background',edit.clips,edit.origins),...reorderImageSizes(data,key,edit.origins)};clips=edit.clips;
  }
  assert.equal(clips.length,2);
  assert.equal(clipCropData(data,'background',clips[0],0)._studio_background_x,90);
  assert.equal(clipCropData(data,'background',clips[1],1)._studio_background_x,10);
  assert.equal(imageScale(data,`${key}:0`),75);assert.equal(imageScale(data,`${key}:1`),125);
  assert.doesNotThrow(()=>validateProjectData(template,data));
});

test('adding an independent source has no inherited occurrence, and copying never aliases descriptors',()=>{
  const original=structuredClone([a,b]),added=montageEdit(original,{type:'append',clip:image});
  assert.deepEqual(added.origins,[0,1,-1]);assert.deepEqual(original,[a,b]);
  const duplicate=montageEdit(original,{type:'duplicate',index:0});
  assert.deepEqual(duplicate.origins,[0,0,1]);
  assert.notEqual(duplicate.clips[0],duplicate.clips[1]);assert.notEqual(duplicate.clips[0].url,duplicate.clips[1].url);
  assert.throws(()=>montageEdit(original,{type:'remove',index:7}));
  assert.throws(()=>montageEdit(original,{type:'move',from:0,to:-1}));
});

test('edited sequence drives the same cut boundaries and source offsets in picture and exported audio',()=>{
  const edited=montageEdit([a,image,b],{type:'move',from:2,to:0}),clips=edited.clips.map(clip=>({...clip,url:typeof clip.url==='object'?clip.url.url:clip.url,type:clip===image?'image':typeof clip.url==='object'&&clip.url.mimeType.startsWith('image/')?'image':'video',length:montageClipDuration(clip)!}));
  assert.deepEqual(locateClip(clips,0,false),{index:0,time:10});
  assert.deepEqual(locateClip(clips,2,false),{index:1,time:3});
  assert.deepEqual(locateClip(clips,7,false),{index:2,time:0});
  const events=playlistEvents({clips,loop:false},0,11,()=>1);
  assert.deepEqual(events.map(({url,at,start,duration})=>({url,at,start,duration})),[
    {url:'lib/media/plateau.mp4',at:0,start:10,duration:2},
    {url:'lib/media/reportage.mp4',at:2,start:3,duration:5},
  ]);
});
