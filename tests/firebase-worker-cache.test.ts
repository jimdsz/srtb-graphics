import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';

const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));

// Exercise actual request contexts, not Promise.all calls inside one test Worker.
// The fake provider deliberately returns 503 before cryptography/account lookup.
// Every outbound request is intercepted locally: this test never calls Google.
const bundle=await build({bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',stdin:{
  resolveDir:repositoryRoot,sourcefile:'firebase-worker-cache-fixture.ts',loader:'ts',contents:`
    import {verifyFirebaseToken} from './server/firebase-auth';
    const config={FIREBASE_PROJECT_ID:'srtb-test-auth',FIREBASE_API_KEY:'AIza'+'x'.repeat(35)};
    const token=btoa(JSON.stringify({alg:'RS256',kid:'test'}))+'.e30.c2lnbmF0dXJl';
    export default {async fetch(request){
      const result=verifyFirebaseToken(token,config).then(()=>new Response('verified'),error=>new Response(error.message,{status:error.status||500}));
      if(new URL(request.url).pathname==='/finish-owner'){
        await fetch('https://test-control.invalid/finish');
        return new Response('owner finished');
      }
      return result;
    }};
  `,
}});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
async function bench(){
  const entered=deferred(),release=deferred(),finish=deferred();let certificates=0;
  const runtime=new Miniflare(convertV4MiniflareOptions({script:bundle.outputFiles[0].text,modules:true,compatibilityDate:'2026-09-21',compatibilityFlags:['nodejs_compat'],outboundService:async request=>{
    const url=new URL(request.url);
    if(url.origin==='https://test-control.invalid'){await finish.promise;return new Response('finish');}
    assert.equal(url.href,'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    certificates++;entered.resolve();await release.promise;return new Response('Unavailable',{status:503});
  }}));
  return {runtime,entered,release,finish,calls:()=>certificates};
}

test('separate active Worker requests own their pending certificate fetches at the deployed compatibility date',{timeout:15000},async()=>{
  const fixture=await bench();
  try{
    const first=fixture.runtime.dispatchFetch('https://studio.example/verify');await fixture.entered.promise;
    const others=Array.from({length:3},()=>fixture.runtime.dispatchFetch('https://studio.example/verify'));
    await delay(50);fixture.release.resolve();
    const responses=await Promise.all([first,...others]);assert.deepEqual(responses.map(response=>response.status),[503,503,503,503]);
    assert.equal(fixture.calls(),4);
    const retry=await fixture.runtime.dispatchFetch('https://studio.example/verify');assert.equal(retry.status,503);assert.equal(fixture.calls(),5);
  }finally{fixture.finish.resolve();fixture.release.resolve();await fixture.runtime.dispose();}
});

test('aborting the initiating HTTP request cannot strand another Worker request',{timeout:15000},async()=>{
  const fixture=await bench();
  try{
    const url=await fixture.runtime.ready,controller=new AbortController();
    const first=fetch(new URL('/verify',url),{signal:controller.signal}).catch(error=>error);
    await fixture.entered.promise;
    const other=fixture.runtime.dispatchFetch('https://studio.example/verify');await delay(50);
    controller.abort();assert.equal((await first).name,'AbortError');fixture.release.resolve();
    const result=await Promise.race([other.then(response=>response.status),delay(1500,'stranded')]);
    assert.equal(result,503);assert.equal(fixture.calls(),2);
    const later=await fixture.runtime.dispatchFetch('https://studio.example/verify');assert.equal(later.status,503);assert.equal(fixture.calls(),3);
  }finally{fixture.finish.resolve();fixture.release.resolve();await fixture.runtime.dispose();}
});

test('finishing the initiating Worker request must not strand later certificate requests',{timeout:15000},async()=>{
  const fixture=await bench();
  try{
    const first=fixture.runtime.dispatchFetch('https://studio.example/finish-owner');await fixture.entered.promise;
    const other=fixture.runtime.dispatchFetch('https://studio.example/verify');await delay(50);
    fixture.finish.resolve();assert.equal(await (await first).text(),'owner finished');fixture.release.resolve();
    const result=await Promise.race([other.then(response=>response.status),delay(1500,'stranded')]);
    assert.equal(result,503,'an ended request must not leave a global pending certificate promise');
    const later=await Promise.race([fixture.runtime.dispatchFetch('https://studio.example/verify').then(response=>response.status),delay(1500,'stranded')]);
    assert.equal(later,503,'later requests must remain independently retryable');
  }finally{fixture.finish.resolve();fixture.release.resolve();await fixture.runtime.dispose();}
});
