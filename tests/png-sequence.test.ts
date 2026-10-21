import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {frameFilename,pcm24Wav} from '../src/studio/video/sequence-format';
import {sequenceArchive} from '../src/studio/video/sequence-archive';

test('PNG sequence names are ordered, one-based and bounded',()=>{
  assert.equal(frameFilename(0),'images/image_000001.png');assert.equal(frameFilename(14999),'images/image_015000.png');
  for(const index of [-1,.5,15000,NaN])assert.throws(()=>frameFilename(index));
});
test('WAV PCM24 preserves stereo, signed samples and 48 kHz timing',()=>{
  const values=new Float32Array([-1,-.5,0,.5,1]);
  const chunks=[...pcm24Wav({length:5,sampleRate:48000,numberOfChannels:2,getChannelData:c=>c?new Float32Array(5):values})];
  const bytes=Buffer.concat(chunks),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(v.getUint32(4,true),bytes.length-8);
  assert.equal(v.getUint16(22,true),2);assert.equal(v.getUint32(24,true),48000);assert.equal(v.getUint16(34,true),24);assert.equal(v.getUint32(40,true),30);
  for(let i=0;i<5;i++){assert.equal(bytes.readIntLE(44+i*6,3),[-8388608,-4194304,0,4194304,8388607][i]);assert.equal(bytes.readIntLE(47+i*6,3),0);}
});
function setup(limit?:number,corrupt=false){
  const controller=new AbortController();let chunks:Uint8Array<ArrayBuffer>[]=[],disposed=false;
  const archive=sequenceArchive({async write(chunk){chunks.push(chunk);},async finish(){const bytes=Buffer.concat(chunks);if(corrupt)bytes[50]^=1;return new Blob([bytes]);},async dispose(){disposed=true;chunks=[];}},controller.signal,limit);
  return {archive,controller,disposed:()=>disposed};
}
test('streamed sequence ZIP can be opened and each file is verified',async()=>{
  const {archive}=setup();await archive.add(frameFilename(0),[new Uint8Array([1,2]),new Uint8Array([3])]);await archive.text('SEQUENCE.json','{"fps":25}');
  const progress:number[]=[],blob=await archive.finish(value=>progress.push(value)),files=unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual([...files[frameFilename(0)]],[1,2,3]);assert.equal(strFromU8(files['SEQUENCE.json']),'{"fps":25}');assert.equal(progress.at(-1),1);
  await assert.rejects(archive.text('late.txt','late'));await archive.dispose();
});
test('ZIP corruption, capacity limits, unsafe paths and cancellation fail closed',async()=>{
  const bad=setup(undefined,true);await bad.archive.add(frameFilename(0),[new Uint8Array(200)]);await assert.rejects(bad.archive.finish(()=>{}),/intégrité/);await bad.archive.dispose();
  const small=setup(20);await assert.rejects(small.archive.text('too-big.txt','x'),/limite/);await small.archive.dispose();assert.equal(small.disposed(),true);
  const cancelled=setup();await cancelled.archive.text('one.txt','test');cancelled.controller.abort();await assert.rejects(cancelled.archive.finish(()=>{}),{name:'AbortError'});await cancelled.archive.dispose();
  const names=setup();await assert.rejects(names.archive.text('../private.txt','x'));await names.archive.text('one.txt','test');await assert.rejects(names.archive.text('one.txt','duplicate'));await names.archive.dispose();
});
