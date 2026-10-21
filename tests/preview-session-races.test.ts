import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionState} from '../src/studio/session-state';
import {installPreviewTransport} from '../src/studio/preview-transport';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {LegacyGraphic} from '../src/studio/video/engine';

const ok={statusCode:200};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
function fixture(){
  const session=createSessionState(),template=getTemplate('BTV_Relais_Antenne'),data=templateDefaults(template);
  const g=Object.assign(new EventTarget(),{elapsed:0,phase:'ready',_chain:Promise.resolve(),playCalls:0,pauseCalls:0,clearWait:Promise.resolve(),playWait:Promise.resolve(),
    _time(){return this.elapsed;},
    async stopAction(){await this.clearWait;this.phase='stopped';return ok;},
    playAction(){this.playCalls++;this.phase='in';this._chain=this.playWait;return Promise.resolve(ok);},
    async pauseAction(){this.pauseCalls++;this.phase='paused';return ok;},
  });
  const transport=installPreviewTransport(g as unknown as LegacyGraphic,template,()=>data,()=>{},session.permission);
  function suspendAndConfirm(){session.onDeadline(()=>{});session.lifetime(0,session.snapshot().epoch);session.lifetime(1000,session.snapshot().epoch);}
  return {g,session,transport,suspendAndConfirm,dispose(){transport.dispose();session.end('logout');}};
}

test('a queued IN never starts after its session was suspended and then confirmed again',async()=>{
  const f=fixture(),clear=deferred();f.g.clearWait=clear.promise;
  const pending=f.transport.start();f.suspendAndConfirm();clear.resolve();
  await assert.rejects(pending,/connexion/);assert.equal(f.g.playCalls,0);assert.equal(f.transport.snapshot().playing,false);f.dispose();
});

test('IN accepted late is paused rather than resumed after a session suspension',async()=>{
  const f=fixture(),accepted=deferred();f.g.playWait=accepted.promise;
  const pending=f.transport.start();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.g.playCalls,1);
  f.suspendAndConfirm();accepted.resolve();
  await assert.rejects(pending,/connexion/);assert.equal(f.transport.snapshot().playing,false);assert.equal(f.transport.snapshot().phase,'paused');assert.equal(f.g.pauseCalls,1);f.dispose();
});

test('an explicit resume accepted late cannot reactivate playback after suspension',async()=>{
  const f=fixture();await f.transport.start();await f.transport.pause();
  const accepted=deferred();f.g.playWait=accepted.promise;
  const pending=f.transport.resume();f.suspendAndConfirm();accepted.resolve();
  await assert.rejects(pending,/connexion/);assert.equal(f.transport.snapshot().playing,false);assert.equal(f.transport.snapshot().phase,'paused');assert.equal(f.g.pauseCalls,2);f.dispose();
});

test('a normal temporary service error without suspension does not interrupt the current transport',async()=>{
  const f=fixture();await f.transport.start();assert.equal(f.transport.snapshot().playing,true);
  await f.transport.pause();assert.equal(f.transport.snapshot().phase,'paused');await f.transport.resume();assert.equal(f.transport.snapshot().playing,true);f.dispose();
});
