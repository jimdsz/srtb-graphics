import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Execute the actual generated methods with controlled device readiness. These
// checks concern lifecycle/order, not a substitute for the browser PCM recipe.
const code=await readFile(new URL('../public/studio-engines/ba-text-v2/graphic.mjs',import.meta.url),'utf8');
const deferred=()=>{let resolve!:(value?:unknown)=>void;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const ok=(extra={})=>({statusCode:200,...extra});
const method=(start:string,end:string)=>Function('TIMING','OK','deferred',`return ({${code.slice(code.indexOf(start),code.indexOf(end))}})`)( {inEnd:10},ok,deferred);
const {playAction}=method('    async playAction(args={}){','    _tick(){');
const {stopAction}=method('    async stopAction(args={}){','    goToTime({seconds}={}){');
function fixture(){
  const ready=deferred(),requested=deferred(),calls:string[]=[];
  const g:any={state:{loaded:true,disposed:false,phase:'inspection'},muted:false,_running:false,_raf:0,_chain:Promise.resolve(),
    scene:{container:{style:{visibility:'hidden'}}},media:{pause(){calls.push('media.pause');},async position(){calls.push('position');}},
    audio:{generation:0,stop(){this.generation++;calls.push('audio.stop');},async unlock(){calls.push('unlock');requested.resolve();await ready.promise;},sync(){calls.push('sync');}},
    _queue(task:()=>Promise<unknown>){this._chain=task();return this._chain;},_tick(){calls.push('tick');this._inDone?.resolve(ok());},
    _beginOut(){calls.push('out');this._outAt=performance.now();this._running=true;this._outDone=deferred();this._outDone.resolve(ok());},
  };
  return {g,ready,requested,calls};
}
const withRaf=async(run:()=>Promise<void>)=>{const before=globalThis.cancelAnimationFrame;globalThis.cancelAnimationFrame=()=>{};try{await run();}finally{globalThis.cancelAnimationFrame=before;}};

test('native IN positions media, then waits for the audio device before setting graphics anchor or scheduling a source',()=>withRaf(async()=>{
  const {g,ready,requested,calls}=fixture(),playing=playAction.call(g);
  await requested.promise;
  assert.equal(calls.filter(c=>c==='position').length,3);assert.equal(g._inAt,undefined);assert.equal(g._running,false);assert.equal(calls.includes('sync'),false);assert.equal(calls.includes('tick'),false);
  ready.resolve();await playing;assert.ok(Number.isFinite(g._inAt));assert.equal(g._running,true);assert.deepEqual(calls.slice(-3),['unlock','sync','tick']);
}));

for(const reason of ['stop','dispose'])test(`native IN cannot restart after ${reason} during device startup`,()=>withRaf(async()=>{
  const {g,ready,requested,calls}=fixture(),playing=playAction.call(g);await requested.promise;
  if(reason==='stop')g.audio.stop();else g.state.disposed=true;
  ready.resolve();await assert.rejects(playing,{name:'AbortError'});assert.equal(g._inAt,undefined);assert.equal(g._running,false);assert.equal(calls.includes('sync'),false);assert.equal(calls.includes('tick'),false);
}));

test('portable manual OUT from inspection waits for the device before starting its phase',()=>withRaf(async()=>{
  const {g,ready,requested,calls}=fixture(),stopping=stopAction.call(g);await requested.promise;
  assert.equal(g._outAt,undefined);assert.equal(calls.includes('out'),false);ready.resolve();await stopping;
  assert.ok(Number.isFinite(g._outAt));assert.deepEqual(calls.slice(-3),['unlock','out','tick']);
}));

test('continuous OUT does not add a new startup wait or change the running clock',()=>withRaf(async()=>{
  const {g,calls}=fixture();g._running=true;await stopAction.call(g);assert.deepEqual(calls,['out']);
}));
