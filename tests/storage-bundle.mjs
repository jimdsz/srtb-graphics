import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import assert from 'node:assert/strict';
import {studioWorkerOptions} from '../scripts/studio-worker-options.mjs';
const result=await build({...studioWorkerOptions,entryPoints:['tests/storage-bundle-worker.ts'],write:false});
const bench=new Miniflare(convertV4MiniflareOptions({script:result.outputFiles[0].text,modules:true,compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],outboundService:async request=>{
  assert.equal(new URL(request.url).origin,'https://s3.eu-central-003.backblazeb2.com');
  if(new URL(request.url).searchParams.has('acl'))return new Response('<AccessControlPolicy xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>owner</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>',{headers:{'Content-Type':'application/xml'}});
  if(request.method==='HEAD')return new Response(null,{headers:{'Content-Length':'100',ETag:'"etag-test"','Content-Type':'video/mp4'}});
  assert.equal(request.headers.get('range'),'bytes=4-7');
  return new Response(new Uint8Array([1,2,3,4]),{status:206,headers:{'Content-Length':'4','Content-Range':'bytes 4-7/100'}});
}}));
try{const response=await bench.dispatchFetch('https://studio.example/media',{headers:{Range:'bytes=4-7'}});if(response.status!==206)throw Error(await response.text());assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3,4]);console.log('PASS production bundling, private bucket check, signed B2 range and streaming');}finally{await bench.dispose();}
