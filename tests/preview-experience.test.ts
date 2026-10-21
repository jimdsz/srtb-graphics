import test from 'node:test';
import assert from 'node:assert/strict';
import {blockPlacement} from '../src/studio/placement';
import {previewData} from '../src/studio/preview-data';
import {previewSources} from '../src/studio/preview-resources';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';

test('single audio flag is muted initially and restored only by explicit listening',()=>{
  const data={_audio_enabled:true,_media_background_audio_enabled:true};
  assert.equal(previewData(data,true,false)._audio_enabled,false);
  assert.deepEqual(previewData(data,false,false),data);
});
test('all moved blocks fit the social safe rectangle without changing aspect ratio',()=>{
  for(const vertical of [true,false])for(const anchor of ['top','center','bottom'])for(const scale of [70,100])for(const offset of [-100,100]){
    const width=1080,height=vertical?1920:1350;
    for(const box of [{x:0,y:530,w:1080,h:820},{x:80,y:255,w:850,h:1315},{x:260,y:940,w:670,h:630}]){
      const p=blockPlacement(box,width,height,vertical,{_studio_block_anchor:anchor,_studio_block_scale:scale,_studio_block_x:offset,_studio_block_y:offset});
      assert.ok(p.x>=80&&p.y>=(vertical?300:190));
      assert.ok(p.x+box.w*p.scale<=width-(vertical?150:80)+1e-8);
      assert.ok(p.y+box.h*p.scale<=height-(vertical?350:100)+1e-8);
    }
  }
  assert.deepEqual(blockPlacement({x:0,y:530,w:1080,h:820},1080,1350,false,{}),{x:0,y:530,scale:1});
});
test('preview substitute is limited to the reference movie; project and user sources remain intact',()=>{
  Object.defineProperty(globalThis,'location',{value:new URL('https://srtb-graphics.pages.dev/graphics'),configurable:true});
  try{
    const t=getTemplate('BTV_BA_1P'),data={_media_body_url:'lib/media/programme.mp4',_media_intro_url:{url:'blob:https://srtb-graphics.pages.dev/local',type:'video' as const},_media_pack_sequence:JSON.stringify([{url:'https://other.test/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4',start:10,end:20}])};
    const next=previewSources(t,data);
    assert.equal(next._media_body_url,'/preview-media/v1/ba-programme.mp4');
    assert.deepEqual(next._media_intro_url,data._media_intro_url);assert.equal(next._media_pack_sequence,data._media_pack_sequence);
    assert.equal(data._media_body_url,'lib/media/programme.mp4');
  }finally{Reflect.deleteProperty(globalThis,'location');}
});
test('placement choices survive project validation and reject unsafe numbers',()=>{
  const t=getTemplate('BTV_BA_1P'),data={...templateDefaults(t),_studio_logo_anchor:'top-right',_studio_block_anchor:'center',_studio_block_scale:80};
  assert.equal(validateProjectData(t,data)._studio_logo_anchor,'top-right');
  assert.throws(()=>validateProjectData(t,{...data,_studio_block_scale:200}));
});

test('prepared BA slow-motion preview preserves cuts, rates and audio flags without altering export data',()=>{
  Object.defineProperty(globalThis,'location',{value:new URL('https://srtb-graphics.pages.dev/graphics'),configurable:true});
  try{
    const t=getTemplate('BTV_BA_1P'),original=templateDefaults(t),before=JSON.stringify(original),preview=previewSources(t,original);
    for(const track of ['intro','pack']){
      assert.equal(preview[`_media_${track}_url`],'/preview-media/v3/ba-prepared-slow-1280.mp4');
      for(const suffix of ['start_seconds','end_seconds','rate','audio_enabled','volume','fit','color_space'])assert.equal(preview[`_media_${track}_${suffix}`],original[`_media_${track}_${suffix}`]);
    }
    assert.equal(JSON.stringify(original),before);
    const path='/library/v1.7.0/BTV_BA_1P/lib/media/prepared/native-v102/slow-25b341c2aeb35dc28530.mp4';
    for(const url of ['https://other.test'+path,'blob:https://srtb-graphics.pages.dev/slow-25b341c2aeb35dc28530.mp4','/api/graphics/media/123/content','/library/v1.8.0/BTV_BA_1P/lib/media/prepared/native-v102/slow-25b341c2aeb35dc28530.mp4']){
      const data={_media_intro_url:{url,name:'Programme utilisateur',mimeType:'video/mp4'}};
      assert.deepEqual(previewSources(t,data),data);
    }
    const data={_media_pack_sequence:JSON.stringify([{url:path,start:1.04,end:5.2},{url:{url:path,name:'Exemple',mimeType:'video/mp4'},start:0,end:1}])};
    const clips=JSON.parse(String(previewSources(t,data)._media_pack_sequence));
    assert.deepEqual(clips,[{url:'/preview-media/v3/ba-prepared-slow-1280.mp4',start:1.04,end:5.2},{url:{url:'/preview-media/v3/ba-prepared-slow-1280.mp4',name:'Exemple',mimeType:'video/mp4'},start:0,end:1}]);
  }finally{Reflect.deleteProperty(globalThis,'location');}
});
