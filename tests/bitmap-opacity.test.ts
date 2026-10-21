import test from 'node:test';
import assert from 'node:assert/strict';
import {bitmapOpacity} from '../src/studio/video/bitmap-opacity';

function reader(alphas:number[],width:number,height:number){
  const pixels=new Uint8ClampedArray(alphas.flatMap(alpha=>[38,94,171,alpha])),reads:number[][]=[];
  const context={getImageData(x:number,y:number,w:number,h:number){
    reads.push([x,y,w,h]);
    if(!w||!h)throw new DOMException('Empty canvas','IndexSizeError');
    assert.equal(x,0);assert.equal(y,0);
    assert.ok((w===1&&h===1)||(w===width&&h===height));
    return {data:w===1&&h===1?pixels.slice(0,4):pixels} as ImageData;
  }};
  return {context,reads};
}

test('a transparent or partially transparent corner avoids a full read without changing the PNG decision',()=>{
  for(const alpha of [0,1,26,127,254]){
    const {context,reads}=reader([alpha,255,255,255],2,2);
    assert.deepEqual(bitmapOpacity(context,2,2),{opaque:false,pixelsRead:1,fullScan:false});
    assert.deepEqual(reads,[[0,0,1,1]]);
  }
});

test('an opaque corner still requires all remaining alpha values to be checked',()=>{
  const {context,reads}=reader([255,255,254,255],2,2);
  assert.deepEqual(bitmapOpacity(context,2,2),{opaque:false,pixelsRead:5,fullScan:true});
  assert.deepEqual(reads,[[0,0,1,1],[0,0,2,2]]);
  assert.equal(bitmapOpacity(reader([255,255,255,255],2,2).context,2,2).opaque,true);
});

test('single pixel canvases need only one read and changes are not cached',()=>{
  const {context,reads}=reader([255],1,1);
  assert.deepEqual(bitmapOpacity(context,1,1),{opaque:true,pixelsRead:1,fullScan:false});
  assert.deepEqual(reads,[[0,0,1,1]]);
  let alpha=255;
  const mutable={getImageData(){return {data:new Uint8ClampedArray([0,0,0,alpha])} as ImageData;}};
  assert.equal(bitmapOpacity(mutable,1,1).opaque,true);alpha=0;
  assert.equal(bitmapOpacity(mutable,1,1).opaque,false);
});

test('the decision matches the original exhaustive scan for every alpha at every location',()=>{
  for(let index=0;index<6;index++)for(let alpha=0;alpha<=255;alpha++){
    const alphas=Array<number>(6).fill(255);alphas[index]=alpha;
    assert.equal(bitmapOpacity(reader(alphas,3,2).context,3,2).opaque,alphas.every(value=>value===255));
  }
});

test('empty and security-blocked canvases retain their native failures',()=>{
  for(const [width,height] of [[0,1],[1,0],[0,0]]){
    const {context,reads}=reader([],width,height);
    assert.throws(()=>bitmapOpacity(context,width,height),{name:'IndexSizeError'});
    assert.deepEqual(reads,[[0,0,width,height]]);
  }
  const failure=new DOMException('Tainted canvas','SecurityError');
  assert.throws(()=>bitmapOpacity({getImageData(){throw failure;}},1920,1080),error=>error===failure);
});
