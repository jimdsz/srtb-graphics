import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedLocalLogo,logoImageMime,MAX_LOGO_BYTES,readSharedLogo} from '../src/studio/planner-logo-selection';
import type {MediaAsset} from '../src/studio/domain';

const id='11111111-1111-4111-8111-111111111111',url=`/api/graphics/media/${id}/content`;
const media:MediaAsset={id,name:'Émission.webp',mime_type:'image/webp',bytes:120,created_at:'2026-09-29T00:00:00Z',created_by:'fixture@example.test',status:'ready'};
const signal=()=>new AbortController().signal;
test('shared logo keeps actual MIME/name and reads exactly its ID',async()=>{
 const calls:string[]=[];const result=await readSharedLogo(url,async requested=>{calls.push(requested);return media;},signal());
 assert.deepEqual(result,{url,name:media.name,mimeType:'image/webp'});assert.deepEqual(calls,[id]);
});
test('only three supported image MIME types are accepted',()=>{
 for(const mime of ['image/png','image/jpeg','image/webp'])assert.equal(logoImageMime(mime),true);
 for(const mime of ['image/svg+xml','video/mp4','image/gif','IMAGE/PNG','text/html'])assert.equal(logoImageMime(mime),false);
});
test('external, local and malformed shared proposal URLs make no metadata call',async()=>{
 let calls=0;for(const reference of ['https://example.test/logo.png','local-media:abc:12','/api/graphics/media/secret/content',url+'?download=1'])await assert.rejects(readSharedLogo(reference,async()=>{calls++;return media;},signal()));
 assert.equal(calls,0);
});
test('shared metadata must match identity, readiness, supported type and valid portable name',async()=>{
 for(const patch of [{id:'22222222-2222-4222-8222-222222222222'},{status:'uploading' as const},{status:'failed' as const},{mime_type:'video/mp4'},{mime_type:'image/svg+xml'},{bytes:0},{name:'../../logo.png'}])await assert.rejects(readSharedLogo(url,async()=>({...media,...patch}),signal()));
});
test('aborted and late shared reads do not yield an asset',async()=>{
 const c=new AbortController();let release!:(value:MediaAsset)=>void;
 const request=readSharedLogo(url,()=>new Promise(resolve=>release=resolve),c.signal);
 await Promise.resolve();c.abort();await assert.rejects(request);release(media);
 const stopped=new AbortController();stopped.abort();await assert.rejects(readSharedLogo(url,async()=>media,stopped.signal));
});
test('local actual signatures establish MIME even when the browser supplies a wrong hint',async()=>{
 for(const [bytes,mime] of [[new Uint8Array([137,80,78,71,13,10,26,10,0]),'image/png'],[new Uint8Array([255,216,255,224,0]),'image/jpeg'],[new TextEncoder().encode('RIFF1234WEBPVP8 '),'image/webp']] as const){
  const file=new File([bytes],'logo.bin',{type:'application/octet-stream',lastModified:123});const checked=await checkedLocalLogo(file,signal());
  assert.equal(checked.type,mime);assert.equal(checked.name,'logo.bin');assert.equal(checked.lastModified,123);assert.deepEqual(new Uint8Array(await checked.arrayBuffer()),bytes);
 }
});
test('local SVG disguised as PNG, empty and oversized selections are rejected',async()=>{
 for(const file of [new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'],'logo.png',{type:'image/png'}),new File([],'empty.png',{type:'image/png'}),new File([new Uint8Array(MAX_LOGO_BYTES+1)],'large.png',{type:'image/png'})])await assert.rejects(checkedLocalLogo(file,signal()));
});
test('local logo validation obeys cancellation before any file read',async()=>{
 const c=new AbortController();c.abort();await assert.rejects(checkedLocalLogo(new File([new Uint8Array([137,80,78,71,13,10,26,10])],'logo.png'),c.signal));
});
