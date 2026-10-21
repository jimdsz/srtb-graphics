import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSourceTap} from './audio-source-tap';

function fixture(){
  const tap={},gain={},other={},links=new Set<unknown>(),calls:unknown[][]=[];
  const source={connect(destination:unknown,...args:unknown[]){links.add(destination);calls.push(['connect',destination,...args]);return destination;},disconnect(...args:unknown[]){calls.push(['disconnect',...args]);if(args.length)links.delete(args[0]);else links.clear();},start(){},stop(){},onended:null,buffer:{},playbackRate:{value:1}};
  return {tap,gain,other,links,calls,source,attach:()=>captureSourceTap(source as unknown as AudioBufferSourceNode,tap as AudioNode)};
}
test('pre-gain tap survives while every production destination really disconnects',()=>{
  const f=fixture(),start=f.source.start,stop=f.source.stop,buffer=f.source.buffer,rate=f.source.playbackRate,release=f.attach();
  assert.equal(f.source.connect(f.gain),f.gain);f.source.connect(f.other,0,0);f.source.disconnect();
  assert.deepEqual([...f.links],[f.tap]);assert.deepEqual(f.calls.slice(-2),[['disconnect',f.gain],['disconnect',f.other]]);
  assert.equal(f.source.start,start);assert.equal(f.source.stop,stop);assert.equal(f.source.buffer,buffer);assert.equal(f.source.playbackRate,rate);assert.equal(f.source.onended,null);
  release();assert.equal(f.links.size,0);
});
test('repeated production cleanup, reconnection and release preserve native methods',()=>{
  const f=fixture(),connect=f.source.connect,disconnect=f.source.disconnect,release=f.attach();
  f.source.connect(f.gain);f.source.connect(f.gain);f.source.disconnect();f.source.disconnect();
  f.source.connect(f.other);f.source.disconnect();assert.deepEqual([...f.links],[f.tap]);
  release();const count=f.calls.length;release();assert.equal(f.calls.length,count);assert.equal(f.source.connect,connect);assert.equal(f.source.disconnect,disconnect);
});
test('unexpected graph operations fail visibly rather than change their meaning',()=>{
  const f=fixture(),release=f.attach();f.source.connect(f.gain);
  assert.throws(()=>f.source.connect(f.tap),/point de mesure/);assert.throws(()=>f.source.disconnect(0),/non qualifiée/);
  assert.deepEqual([...f.links],[f.tap,f.gain]);release();assert.deepEqual([...f.links],[f.gain]);
});
