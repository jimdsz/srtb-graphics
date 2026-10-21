import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IMAGE_SIZES,imageScale,imageSizePatch,isResizableImage,parseImageSizes,reorderImageSizes,resizedImageGeometry} from '../src/studio/image-sizing-model';
import {broadcastTemplates,templateDefaults,validateProjectData} from '../src/studio/domain';
test('image resizing is opt-in, bounded, and preserves aspect ratio',()=>{
  assert.equal(imageScale({},'_media_popup_url'),100);
  assert.deepEqual(resizedImageGeometry(800,400,50),{width:800,height:400,x:200,y:100,w:400,h:200});
  assert.deepEqual(resizedImageGeometry(800,400,200),{width:800,height:400,x:-400,y:-200,w:1600,h:800});
  assert.equal(resizedImageGeometry(10000,5000,50).width,3840);
  for(const value of [0,9,301,Infinity])assert.throws(()=>imageSizePatch({},'_media_popup_url',value));
  for(const value of ['[]','null','{"tv:__proto__":50}','{"tv:_audio_url":50}'])assert.throws(()=>parseImageSizes(value));
});
test('each format and sequence passage keeps its own size',()=>{
  let data={...imageSizePatch({},'_media_popup_url',50)};
  data={...data,...imageSizePatch({...data,_studio_format:'vertical'},'_media_popup_url',75)};
  assert.equal(imageScale(data,'_media_popup_url'),50);assert.equal(imageScale({...data,_studio_format:'vertical'},'_media_popup_url'),75);
  const reset={...data,...imageSizePatch(data,'_media_popup_url',100)};assert.equal(imageScale(reset,'_media_popup_url'),100);
  const list={...imageSizePatch({},'_media_popup_sequence:0',40),_studio_format:'tv'};
  const next={...list,...imageSizePatch(list,'_media_popup_sequence:1',80)};
  const moved={...next,...reorderImageSizes(next,'_media_popup_sequence',[1,0])};
  assert.equal(imageScale(moved,'_media_popup_sequence:0'),80);assert.equal(imageScale(moved,'_media_popup_sequence:1'),40);
  assert.equal(imageScale({...moved,...reorderImageSizes(moved,'_media_popup_sequence',[-1])},'_media_popup_sequence:0'),100);
});
test('video/audio are never rasterized; shared descriptors and model images are detected',()=>{
  assert.equal(isResizableImage({url:'/api/graphics/media/abc/content',name:'photo',mimeType:'image/jpeg'}),true);
  assert.equal(isResizableImage('lib/photo.PNG'),true);
  assert.equal(isResizableImage({url:'blob:test',name:'clip',mimeType:'video/mp4'}),false);
  assert.equal(isResizableImage('lib/music.wav'),false);
});
test('all template schemas persist resize settings and reject corrupt metadata',()=>{
  for(const template of broadcastTemplates){
    const input={...templateDefaults(template),...imageSizePatch({},'_media_popup_url',75)};
    assert.equal(validateProjectData(template,input)[IMAGE_SIZES],input[IMAGE_SIZES]);
    assert.throws(()=>validateProjectData(template,{...input,[IMAGE_SIZES]:'{"tv:_media_popup_url":5000}'}));
  }
});
