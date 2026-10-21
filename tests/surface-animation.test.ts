import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {scheduleSurfaceAnimation} from '../src/studio/ui/surface-animation';

const originals={requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
afterEach(()=>Object.assign(globalThis,originals));
function fixture(){
  let callback:FrameRequestCallback=()=>{},rendered=false,connected=true,starts=0,cancels=0,frameCancels=0;
  Object.assign(globalThis,{requestAnimationFrame:(cb:FrameRequestCallback)=>{callback=cb;return 1;},cancelAnimationFrame:()=>frameCancels++});
  const node={get isConnected(){return connected;},getClientRects:()=>rendered?[{}]:[]} as unknown as HTMLElement;
  const cleanup=scheduleSurfaceAnimation(node,()=>{starts++;return {cancel:()=>cancels++,stop:()=>{throw new DOMException('Target element is not rendered','InvalidStateError');}};});
  return {cleanup,frame:()=>callback(0),show:()=>rendered=true,hide:()=>rendered=false,detach:()=>connected=false,counts:()=>({starts,cancels,frameCancels})};
}
test('surface starts only after its parent dialog becomes rendered',()=>{
  const f=fixture();assert.equal(f.counts().starts,0);f.show();f.frame();assert.equal(f.counts().starts,1);
  f.hide();assert.doesNotThrow(f.cleanup);assert.deepEqual(f.counts(),{starts:1,cancels:1,frameCancels:1});
});
test('hidden and detached surfaces never start an animation',()=>{
  const hidden=fixture();hidden.frame();assert.equal(hidden.counts().starts,0);hidden.cleanup();
  const detached=fixture();detached.show();detached.detach();detached.frame();assert.equal(detached.counts().starts,0);detached.cleanup();
});
test('strict-effect cleanup before a queued frame prevents late starts',()=>{
  const f=fixture();f.show();f.cleanup();f.frame();assert.deepEqual(f.counts(),{starts:0,cancels:0,frameCancels:1});
});
