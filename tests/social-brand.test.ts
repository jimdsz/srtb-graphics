import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SOCIAL_BRAND_ASSET,SOCIAL_BRAND_SOURCE_SIZE,socialBrandGeometry,socialBrandLabelBox} from '../src/studio/social-brand';

const anchors=['top-left','top-right','top-center','bottom-left','bottom-right'];
const close=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} ≠ ${expected}`);

test('social artwork is the exact supplied horizontal white PNG with its original dimensions',()=>{
  const source=readFileSync(new URL(`../public${SOCIAL_BRAND_ASSET}`,import.meta.url));
  assert.equal(source.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(source.readUInt32BE(16),SOCIAL_BRAND_SOURCE_SIZE.width);
  assert.equal(source.readUInt32BE(20),SOCIAL_BRAND_SOURCE_SIZE.height);
  assert.equal(createHash('sha256').update(source).digest('hex'),'ba4d67f7fc9d8477917791be468f0e4cadb41959a3915903fd08bd9852105aa3');
  const renderer=readFileSync(new URL('../src/studio/social-renderer.ts',import.meta.url),'utf8');
  assert.match(renderer,/logo:await image\(SOCIAL_BRAND_ASSET,signal\)/);
  assert.ok(!renderer.includes('/social/v1/btv-logo.svg'));
});

test('normal and signature logos preserve the source ratio within the safe margins of both social formats',()=>{
  for(const format of ['portrait','vertical'])for(const signature of [false,true])for(const anchor of anchors){
    const data={_studio_format:format,_studio_logo_anchor:anchor},height=format==='vertical'?1920:1350;
    const box=socialBrandGeometry(data,1080,height,signature),right=format==='vertical'?150:80,bottom=format==='vertical'?220:65;
    close(box.w/box.h,3050/688);
    assert.ok(box.x>=80&&box.x+box.w<=1080-right+1e-7);
    assert.ok(box.y>0&&box.y+box.h<=height-bottom+1e-7);
    if(anchor.endsWith('right'))close(box.x+box.w,1080-right);
    if(anchor.endsWith('left'))close(box.x,80);
    if(anchor.endsWith('center'))close(box.x+box.w/2,540);
    if(anchor.startsWith('bottom'))close(box.y+box.h,height-bottom);
    else close(box.y,format==='vertical'?150:48);
    assert.deepEqual(socialBrandGeometry({...data,_studio_block_anchor:'center',_studio_block_scale:70,_studio_block_x:60,_studio_block_y:-40,_studio_portrait_card_scale:50,_studio_vertical_card_scale:50},1080,height,signature),box);
  }
});

test('missing anchors select the right and INÉDIT uses a non-overlapping header area for every manual anchor',()=>{
  for(const format of ['portrait','vertical'])for(const signature of [false,true]){
    const height=format==='vertical'?1920:1350;
    assert.deepEqual(socialBrandGeometry({_studio_format:format},1080,height,signature),socialBrandGeometry({_studio_format:format,_studio_logo_anchor:'top-right'},1080,height,signature));
    for(const anchor of anchors){
      const data={_studio_format:format,_studio_logo_anchor:anchor},box=socialBrandGeometry(data,1080,height,signature),label=socialBrandLabelBox(data,1080,height,signature);
      assert.ok(label.w>=200&&label.x>=80&&label.x+label.w<=1080-(format==='vertical'?150:80));
      assert.ok(label.x+label.w<=box.x||label.x>=box.x+box.w||label.y+label.h<=box.y||label.y>=box.y+box.h,`${format}/${signature}/${anchor}`);
    }
  }
});
