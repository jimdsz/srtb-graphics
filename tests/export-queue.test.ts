import test from 'node:test';
import assert from 'node:assert/strict';
import {createExportQueue} from '../src/studio/export-queue';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {Project} from '../src/studio/domain';
import type {VideoOptions,VideoReport} from '../src/studio/video/export';
const template=getTemplate('BTV_BA_1P');
function project(title='a'):Project{return {id:'00000000-0000-4000-8000-000000000001',title,template_id:template.id,template_version:template.version,library_version:template.libraryVersion,data:{...templateDefaults(template),_title:title},revision:3,status:'draft',archived:0,created_at:'',updated_at:'',created_by:'test',updated_by:'test'};}
const options=():VideoOptions=>({format:'mp4',audio:false,manualOut:12,removeBackground:false,background:'#000000'});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function idle(queue:ReturnType<typeof createExportQueue>){for(let n=0;n<100&&queue.snapshot().running;n++)await tick();assert.equal(queue.snapshot().running,false);}
function result(dispose=async()=>{}){const blob=new Blob(['video']);const report:VideoReport={format:'mp4',width:1080,height:1920,frames:80,duration:3.2,fps:25,audio:false,audioPeak:0,alpha:false,bytes:5,checkedFrames:[0,79]};return {blob,report,dispose};}
function setup(extra:Parameters<typeof createExportQueue>[0]={}){
 const rendered:string[]=[],authorized:string[]=[],channels:string[]=[],revoked:string[]=[];let disposed=0;
 const queue=createExportQueue({permitted:()=>true,snapshot:async(p,_s,channel)=>{channels.push(channel);return {template,data:structuredClone(p.data),filename:p.title};},authorize:async p=>{authorized.push(p.title);},render:async(s)=>{rendered.push(String(s.data._title));return result(async()=>{disposed++;});},url:()=>`blob:test-${rendered.length}`,revoke:url=>revoked.push(url),...extra});
 return {queue,rendered,authorized,channels,revoked,disposed:()=>disposed};
}
test('FIFO frozen settings and channel survive view unmount and subsequent edits',async()=>{
 const gate=deferred(),seen:string[]=[],h=setup({render:async(s,o)=>{seen.push(String(s.data._title)+o.format);if(seen.length===1)await gate.promise;return result();}});
 const a=project(),o=options(),unsubscribe=h.queue.subscribe(()=>{});
 h.queue.enqueue(a,o,{channelId:'benin-tv',unsaved:true});h.queue.enqueue(project('b'),options(),{channelId:'benin-tv-kids'});
 a.data._title='later';a.title='later';o.format='png';unsubscribe();await tick();assert.deepEqual(seen,['amp4']);
 assert.equal(h.queue.snapshot().items[0].unsaved,true);gate.resolve();await idle(h.queue);assert.deepEqual(seen,['amp4','bmp4']);assert.deepEqual(h.channels,['benin-tv','benin-tv-kids']);assert.deepEqual(h.authorized,['a','b']);
 assert.equal(h.queue.snapshot().items[0].result?.filename,'a_tv.mp4');await h.queue.clear();
});
test('failed item does not strand following exports; retry is explicit',async()=>{
 let fail=true;const h=setup({render:async(s)=>{if(s.data._title==='a'&&fail)throw Error('media missing');return result();}});
 const id=h.queue.enqueue(project(),options());h.queue.enqueue(project('b'),options());await idle(h.queue);
 assert.deepEqual(h.queue.snapshot().items.map(i=>i.status),['failed','completed']);assert.match(h.queue.snapshot().items[0].error!,/media missing/);
 fail=false;h.queue.retry(id);await idle(h.queue);assert.equal(h.queue.snapshot().items[0].status,'completed');await h.queue.clear();
});
test('cancel active and waiting items, clean late completion, continue next',async()=>{
 const gate=deferred(),rendered:string[]=[];let cleaned=0;
 const h=setup({render:async(s)=>{rendered.push(String(s.data._title));if(s.data._title==='a')await gate.promise;return result(async()=>{cleaned++;});}});
 const a=h.queue.enqueue(project(),options()),b=h.queue.enqueue(project('b'),options());h.queue.enqueue(project('c'),options());await tick();h.queue.cancel(a);h.queue.cancel(b);gate.resolve();await idle(h.queue);
 assert.deepEqual(rendered,['a','c']);assert.deepEqual(h.queue.snapshot().items.map(i=>i.status),['cancelled','cancelled','completed']);assert.equal(cleaned,1);await h.queue.clear();assert.equal(cleaned,2);
});
test('closing the panel keeps results; removing and clearing dispose each result once',async()=>{
 const h=setup(),a=h.queue.enqueue(project(),options());await idle(h.queue);const stop=h.queue.subscribe(()=>{});stop();assert.ok(h.queue.snapshot().items[0].result);
 await h.queue.remove(a);await h.queue.remove(a);await h.queue.clear();assert.equal(h.disposed(),1);assert.equal(h.revoked.length,1);
});
test('clear during rendering aborts and disposes a late result without resurrection',async()=>{
 const gate=deferred();let disposed=0;const h=setup({render:async()=>{await gate.promise;return result(async()=>{disposed++;});}});
 h.queue.enqueue(project(),options());await tick();await h.queue.clear();gate.resolve();await tick();await tick();assert.deepEqual(h.queue.snapshot().items,[]);assert.equal(disposed,1);
});
test('permissions are rechecked before each render and local limit is bounded',async()=>{
 let denied=false;const gate=deferred();const h=setup({snapshot:async(p)=>{await gate.promise;return {template,data:p.data,filename:p.title};},authorize:async()=>{if(denied)throw Error('Access removed');}});
 for(let n=0;n<8;n++)h.queue.enqueue(project(String(n)),options());assert.throws(()=>h.queue.enqueue(project(),options()),/huit/);denied=true;gate.resolve();await idle(h.queue);assert.equal(h.rendered.length,0);assert.ok(h.queue.snapshot().items.every(i=>i.status==='failed'));await h.queue.clear();
 const no=setup({permitted:()=>false});assert.throws(()=>no.queue.enqueue(project(),options()),/connexion/);
});
