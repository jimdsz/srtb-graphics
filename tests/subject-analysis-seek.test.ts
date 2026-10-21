import test from 'node:test';
import assert from 'node:assert/strict';
import {seekSubjectFrame} from '../src/studio/subject-analysis';

class Video extends EventTarget {
 currentTime=0;seeking=false;readyState=1;
 asVideo(){return this as unknown as HTMLVideoElement;}
}
test('analysis waits for an available frame, not merely a seeked event',async()=>{
 const video=new Video(),controller=new AbortController();let resolved=false;
 const work=seekSubjectFrame(video.asVideo(),2,controller.signal).then(()=>{resolved=true;});
 video.dispatchEvent(new Event('seeked'));await Promise.resolve();assert.equal(resolved,false);
 video.readyState=2;video.dispatchEvent(new Event('loadeddata'));await work;assert.equal(resolved,true);
});
test('stale seek events at a different time do not feed tracking with the wrong picture',async()=>{
 const video=new Video(),controller=new AbortController();let resolved=false;
 const work=seekSubjectFrame(video.asVideo(),2,controller.signal).then(()=>{resolved=true;});
 video.currentTime=1;video.readyState=2;video.dispatchEvent(new Event('seeked'));await Promise.resolve();assert.equal(resolved,false);
 video.currentTime=2;video.dispatchEvent(new Event('seeked'));await work;
});
test('abort releases an unavailable frame and a new analysis can start',async()=>{
 const video=new Video(),controller=new AbortController();
 const work=seekSubjectFrame(video.asVideo(),2,controller.signal);controller.abort();
 await assert.rejects(work,{name:'AbortError'});
 video.readyState=2;await seekSubjectFrame(video.asVideo(),2,new AbortController().signal);
});
