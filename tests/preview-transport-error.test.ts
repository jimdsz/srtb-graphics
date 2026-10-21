import test from 'node:test';
import assert from 'node:assert/strict';
import {installPreviewTransport} from '../src/studio/preview-transport';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {LegacyGraphic} from '../src/studio/video/engine';

for(const id of ['BTV_Semainier','BTV_Evenement','BTV_Renvoi'])test(id+' presentation failure pauses the clock, media and audio without erasing the scene',async()=>{
  const template=getTemplate(id),data=templateDefaults(template),errors:string[]=[];
  const g=Object.assign(new EventTarget(),{elapsed:0,phase:'ready',playing:false,paused:0,_chain:Promise.resolve(),
    _time(){return this.elapsed;},
    async stopAction(){this.playing=false;this.phase='stopped';return {statusCode:200};},
    async playAction(){this.playing=true;this.phase='in';return {statusCode:200};},
    async pauseAction(){this.paused++;this.playing=false;this.phase='paused';return {statusCode:200};},
  });
  const transport=installPreviewTransport(g as unknown as LegacyGraphic,template,()=>data,error=>errors.push(error.message));
  await transport.start();g.elapsed=6;
  g.dispatchEvent(new CustomEvent('broadcast-media-error',{detail:{message:'Image refusée'}}));
  await Promise.resolve();await Promise.resolve();
  assert.equal(g.paused,1);assert.equal(g.playing,false);
  assert.deepEqual(transport.snapshot(),{seconds:6,phase:'stopped',playing:false,outAt:undefined});
  g.elapsed=20;assert.equal(transport.snapshot().seconds,6);assert.deepEqual(errors,['Image refusée']);
  for(const action of [()=>transport.resume(),()=>transport.start(),()=>transport.seek(2),()=>transport.out()])await assert.rejects(action,/Image refusée/);
  await transport.clear();assert.equal(transport.snapshot().seconds,0);
  await assert.rejects(transport.start(),/Image refusée/);
  assert.equal(g.playing,false);
  transport.dispose();g.dispatchEvent(new CustomEvent('broadcast-media-error',{detail:{message:'Tardif'}}));
  assert.equal(g.paused,1);assert.deepEqual(errors,['Image refusée']);
});

test('BA media failure remains terminal after Clear; IN cannot reuse its failed publisher',async()=>{
  const template=getTemplate('BTV_BA_1P'),data=templateDefaults(template);
  const g=Object.assign(new EventTarget(),{state:{phase:'ready'},elapsed:0,_running:false,_chain:Promise.resolve(),
    _times(){return {main:this.elapsed,body:this.elapsed,elapsed:this.elapsed};},
    async stopAction(){this.state.phase='stopped';this._running=false;return {statusCode:200};},
    async playAction(){this.state.phase='in';this._running=true;return {statusCode:200};},
  });
  const transport=installPreviewTransport(g as unknown as LegacyGraphic,template,()=>data);
  await transport.start();g.elapsed=6;assert.equal(transport.snapshot().playing,true);
  g.dispatchEvent(new CustomEvent('broadcast-media-error',{detail:{message:'Panne BA'}}));
  g.state.phase='error';g._running=false;
  assert.deepEqual(transport.snapshot(),{seconds:6,phase:'stopped',playing:false,outAt:undefined});
  g.elapsed=20;assert.equal(transport.snapshot().seconds,6);
  for(const action of [()=>transport.resume(),()=>transport.start(),()=>transport.seek(2),()=>transport.out()])await assert.rejects(action,/Panne BA/);
  await transport.clear();assert.equal(g.state.phase,'stopped');
  await assert.rejects(transport.start(),/Panne BA/);assert.equal(transport.snapshot().playing,false);
  assert.equal(g._running,false);transport.dispose();
});

test('an error arriving during start acknowledgement cannot reenable the clock',async()=>{
  const template=getTemplate('BTV_Evenement'),data=templateDefaults(template);
  const g=Object.assign(new EventTarget(),{elapsed:0,phase:'ready',playing:false,pauses:0,_chain:Promise.resolve(),
    _time(){return this.elapsed;},async pauseAction(){this.pauses++;this.playing=false;return {statusCode:200};},
    async stopAction(){return {statusCode:200};},
    async playAction(){this.playing=true;this.dispatchEvent(new CustomEvent('broadcast-media-error',{detail:{message:'Échec pendant IN'}}));return {statusCode:200};},
  });
  const transport=installPreviewTransport(g as unknown as LegacyGraphic,template,()=>data);
  await assert.rejects(transport.start(),/Échec pendant IN/);
  assert.equal(transport.snapshot().playing,false);assert.equal(g.playing,false);assert.ok(g.pauses>=1);transport.dispose();
});

test('a queued native IN settling after a media failure is stopped again',async()=>{
  const template=getTemplate('BTV_Evenement'),data=templateDefaults(template);let finish!:()=>void,launched!:()=>void;
  const started=new Promise<void>(resolve=>{launched=resolve;});
  const g=Object.assign(new EventTarget(),{elapsed:0,playing:false,pauses:0,_chain:Promise.resolve(),
    _time(){return this.elapsed;},async pauseAction(){this.pauses++;this.playing=false;return {statusCode:200};},
    async stopAction(){return {statusCode:200};},
    async playAction(){this._chain=new Promise<void>(resolve=>{finish=()=>{this.playing=true;resolve();};});launched();await this._chain;return {statusCode:200};},
  });
  const transport=installPreviewTransport(g as unknown as LegacyGraphic,template,()=>data);
  const pending=transport.start();await started;
  g.dispatchEvent(new CustomEvent('broadcast-media-error',{detail:{message:'Panne avant activation'}}));
  assert.equal(g.pauses,1);finish();await assert.rejects(pending,/Panne avant activation/);
  assert.equal(g.playing,false);assert.equal(transport.snapshot().playing,false);assert.ok(g.pauses>=2);transport.dispose();
});
