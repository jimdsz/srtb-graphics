import test from 'node:test';
import assert from 'node:assert/strict';
import {unzlibSync} from 'fflate';
import {previewPNG} from '../src/studio/preview-png';

test('worker preview PNG round-trips every RGBA sample including transparent and partial alpha',()=>{
  for(const [w,h]of [[1,1],[13,7],[640,360],[960,540]]){
    const pixels=new Uint8ClampedArray(w*h*4);for(let i=0;i<pixels.length;i++)pixels[i]=(i*31+i%17)%256;
    const png=previewPNG(w,h,pixels),view=new DataView(png.buffer),chunks:Record<string,Uint8Array>={};
    assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    for(let i=8;i<png.length;){const length=view.getUint32(i),tag=new TextDecoder().decode(png.subarray(i+4,i+8));chunks[tag]=png.slice(i+8,i+8+length);
      let crc=0xffffffff;for(const b of png.subarray(i+4,i+8+length)){crc^=b;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
      assert.equal(view.getUint32(i+8+length),(crc^0xffffffff)>>>0);i+=12+length;
    }
    const ihdr=new DataView(chunks.IHDR.buffer);assert.equal(ihdr.getUint32(0),w);assert.equal(ihdr.getUint32(4),h);assert.equal(chunks.IHDR[9],6);
    const decoded=unzlibSync(chunks.IDAT);assert.equal(decoded.length,(w*4+1)*h);
    for(let y=0;y<h;y++){assert.equal(decoded[y*(w*4+1)],0);assert.deepEqual([...decoded.subarray(y*(w*4+1)+1,(y+1)*(w*4+1))],[...pixels.subarray(y*w*4,(y+1)*w*4)]);}
  }
});
test('preview transport rejects unbounded and mismatched rasters',()=>{
  for(const [w,h]of [[0,1],[1,0],[1921,1],[1,1921],[1.1,1]])assert.throws(()=>previewPNG(w,h,new Uint8ClampedArray()),/invalide/);
  assert.throws(()=>previewPNG(2,2,new Uint8ClampedArray(4)),/invalide/);
});
