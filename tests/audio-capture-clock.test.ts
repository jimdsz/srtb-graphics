import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';

// Execute the actual qualification worklet with an explicit render-quantum
// clock. This tests evidence acquisition, not the production audio engine.
function harness(){
  const messages:any[]=[],scope:any={currentFrame:0};let Processor:any;
  scope.AudioWorkletProcessor=class{port={onmessage:null as any,postMessage:(message:any)=>messages.push(message)};};
  scope.registerProcessor=(_name:string,constructor:any)=>{Processor=constructor;};
  runInNewContext(readFileSync(new URL('./ba-audio-clock-capture.js',import.meta.url),'utf8'),scope);
  const processor=new Processor();
  const command=(type:string,id=1)=>processor.port.onmessage({data:{type,id}});
  const quantum=(at:number,value:number)=>{
    scope.currentFrame=at;const left=new Float32Array(128).fill(value),right=new Float32Array(128).fill(-value),output=[new Float32Array(128).fill(99),new Float32Array(128).fill(99)];
    assert.equal(processor.process([[left,right]], [output]),true);
    assert.ok(output.every(channel=>channel.every(sample=>sample===0)),'capture must stay silent');
  };
  command('arm');return {messages,command,quantum};
}

test('PCM capture preserves contiguous frame positions and both channels',()=>{
  const h=harness();for(let n=0;n<17;n++)h.quantum(4096+n*128,n+1);h.command('flush',2);
  const chunks=h.messages.filter(m=>m.type==='chunk');assert.equal(chunks.length,2);
  assert.equal(chunks[0].firstFrame,4096);assert.equal(chunks[0].channels[0].length,2048);
  assert.equal(chunks[1].firstFrame,6144);assert.equal(chunks[1].channels[0].length,128);
  assert.equal(chunks[0].channels[0][128],2);assert.equal(chunks[0].channels[1][128],-2);
  assert.equal(h.messages.filter(m=>m.type==='gap').length,0);
});

test('PCM capture flushes a partial block before a missing quantum, without inventing silence',()=>{
  const h=harness();h.quantum(0,1);h.quantum(256,2);h.command('flush',2);
  assert.deepEqual(h.messages.map(m=>m.type),['armed','chunk','gap','chunk','flushed']);
  const chunks=h.messages.filter(m=>m.type==='chunk'),gap=h.messages.find(m=>m.type==='gap');
  assert.equal(gap.expectedFrame,128);assert.equal(gap.receivedFrame,256);assert.equal(gap.delta,128);
  assert.deepEqual(chunks.map(m=>m.firstFrame),[0,256]);assert.deepEqual(chunks.map(m=>m.channels[0].length),[128,128]);
  assert.ok(chunks[1].channels[0].every((value:number)=>value===2));
});

test('PCM capture reports a backwards clock instead of joining overlapping blocks',()=>{
  const h=harness();h.quantum(1024,1);h.quantum(1024,2);h.command('flush',2);
  assert.equal(h.messages.find(m=>m.type==='gap').delta,-128);
  assert.deepEqual(h.messages.filter(m=>m.type==='chunk').map(m=>m.firstFrame),[1024,1024]);
});

test('rearming discards pre-arm PCM and establishes a fresh clock origin',()=>{
  const h=harness();h.quantum(0,1);h.command('arm',2);h.quantum(8192,2);h.command('flush',3);
  const chunks=h.messages.filter(m=>m.type==='chunk');assert.equal(chunks.length,1);assert.equal(chunks[0].firstFrame,8192);assert.equal(chunks[0].channels[0].length,128);
  assert.equal(h.messages.filter(m=>m.type==='gap').length,0);
});
