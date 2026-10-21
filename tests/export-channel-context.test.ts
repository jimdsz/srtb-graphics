import {test,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {request} from '../src/studio/api';
import {activeChannelId,selectChannel} from '../src/studio/channel-context';
import {sessionState} from '../src/studio/session-state';
Object.assign(globalThis,{window:new EventTarget()});
afterEach(()=>{mock.restoreAll();selectChannel('benin-tv');sessionState.end('logout');});
test('queued read pins original channel even after navigation; ordinary UI still rejects stale responses',async()=>{
 sessionState.open();let resolve!:(r:Response)=>void,header='';
 mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{header=new Headers(init.headers).get('X-SRTB-Channel')!;return new Promise<Response>(r=>resolve=r);});
 const normal=request('/projects/a');selectChannel('benin-tv-kids');resolve(Response.json({id:'a'}));await assert.rejects(normal,{status:409});
 const queued=request('/projects/a',{}, {channelId:'benin-tv'});assert.equal(header,'benin-tv');selectChannel('benin-tv-alafia');resolve(Response.json({id:'a'}));assert.deepEqual(await queued,{id:'a'});assert.equal(activeChannelId(),'benin-tv-alafia');
 const expired=request('/projects/a',{}, {channelId:'benin-tv'});sessionState.end('logout');resolve(Response.json({id:'a'}));await assert.rejects(expired,{status:401});
});
