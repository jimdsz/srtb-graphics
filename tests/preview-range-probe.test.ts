import test from 'node:test';
import assert from 'node:assert/strict';
import {knownBAPreviewProxy,probePreviewRange} from '../src/studio/preview-range-probe';
const base='https://srtb-graphics.pages.dev/graphics',source='/preview-media/v1/ba-programme.mp4';
test('range probe never requests user media or another origin',async()=>{
  let calls=0;const fetcher=async()=>{calls++;throw Error('must not fetch');};
  for(const url of ['blob:private','/api/media/private',source+'?secret=x','https://other.test'+source,source+'#x']){
    assert.equal(knownBAPreviewProxy(url,base),null);assert.equal(await probePreviewRange(url,base,new AbortController().signal,fetcher),null);
  }assert.equal(calls,0);
});
test('range probe requests only two bytes and cancels the body without reading it',async()=>{
  let cancelled=false;
  const result=await probePreviewRange(source,base,new AbortController().signal,async(url,options)=>{
    assert.equal(url,'https://srtb-graphics.pages.dev'+source);assert.equal((options?.headers as any).Range,'bytes=0-1');assert.equal(options?.credentials,'same-origin');assert.equal(options?.redirect,'error');
    return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:206,headers:{'Content-Range':'bytes 0-1/1000','Content-Length':'2','Content-Type':'video/mp4','Accept-Ranges':'bytes'}});
  });
  assert.deepEqual(result,{status:206,partial:true,length:2,acceptsBytes:true,contentRange:'bytes 0-1/1000',contentType:'video/mp4'});assert.equal(cancelled,true);
});
test('a full or malformed response does not validate range support; failures stay unknown',async()=>{
  for(const status of [200,401,416])assert.equal((await probePreviewRange(source,base,new AbortController().signal,async()=>new Response(null,{status})))?.partial,false);
  assert.equal((await probePreviewRange(source,base,new AbortController().signal,async()=>new Response(null,{status:206,headers:{'Content-Range':'bytes 0-999/1000'}})))?.partial,false);
  assert.equal((await probePreviewRange(source,base,new AbortController().signal,async()=>{throw Error('offline');}))?.partial,null);
});
