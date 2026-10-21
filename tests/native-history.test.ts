import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyPublishedNativeHistory,restoreVerifiedNativeHistory,archiveApprovedNativeGraph,PUBLISHED_DEPLOYMENT} from '../scripts/verified-native-history.mjs';

test('published module proof requires exact bytes and MIME, rejects fallback HTML and blocked code, and bounds requests to four',async()=>{
  const root=await mkdtemp(join(tmpdir(),'srtb-native-history-'));
  try{
    const source=join(root,'.studio-asset-history');await mkdir(source);
    for(const name of ['safe-Ab123_cd.js','old-Ab123_cd.js','mismatch-Ab123_cd.js','absent-Ab123_cd.js','extra-Ab123_cd.css','second-Ab123_cd.js','third-Ab123_cd.js'])await writeFile(join(source,name),name.endsWith('.css')?'body{}':'export const version=1;');
    await writeFile(join(source,'blocked-Ab123_cd.js'),'new Worker("/ffmpeg/ffmpeg-core.js")');
    let active=0,maximum=0,calls=0;
    const manifest=await verifyPublishedNativeHistory(root,async(url:string,options:RequestInit)=>{
      assert.ok(url.startsWith(PUBLISHED_DEPLOYMENT+'/assets/'));assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
      active++;maximum=Math.max(maximum,active);calls++;await new Promise(resolve=>setTimeout(resolve,5));active--;
      if(url.includes('old-'))return new Response('<!doctype html>',{headers:{'content-type':'text/html'}});
      if(url.includes('absent-'))return new Response('not found',{status:404});
      if(url.includes('mismatch-'))return new Response('export const version=2;',{headers:{'content-type':'application/javascript'}});
      return new Response(url.endsWith('.css')?'body{}':'export const version=1;',{headers:{'content-type':url.endsWith('.css')?'text/css':'application/javascript'}});
    });
    assert.equal(calls,7);assert.ok(maximum>=1&&maximum<=4,`Requests in flight: ${maximum}`);assert.equal(manifest.files.length,4);assert.equal(manifest.skipped.length,4);
    await writeFile(join(root,'.tools/native-release/published-assets','unproven-Ab123_cd.js'),'not attested');
    assert.equal(await restoreVerifiedNativeHistory(root),4);
    await assert.rejects(readFile(join(root,'dist-studio-native/assets/unproven-Ab123_cd.js')),/ENOENT/);
    await writeFile(join(root,'.tools/native-release/published-assets',manifest.files[0].name),'changed');
    await assert.rejects(restoreVerifiedNativeHistory(root),/différent/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('native history never silently trusts a different deployment origin',async()=>{
  const root=await mkdtemp(join(tmpdir(),'srtb-native-history-'));
  try{
    const folder=join(root,'.tools/native-release');await mkdir(folder,{recursive:true});
    await writeFile(join(folder,'published-history.json'),JSON.stringify({profile:'native-only-published-history',origin:'https://srtb-graphics.pages.dev',files:[]}));
    await assert.rejects(restoreVerifiedNativeHistory(root),/Inventaire publié natif invalide/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('archives only the public hashed graph, retaining proven older chunks and lazy dependencies',async()=>{
  const root=await mkdtemp(join(tmpdir(),'srtb-native-history-'));
  try{
    const source=join(root,'.studio-asset-history');await mkdir(source);
    await writeFile(join(source,'old-Ab123_cd.js'),'export const old=true;');
    await verifyPublishedNativeHistory(root,async()=>new Response('export const old=true;',{headers:{'content-type':'text/javascript'}}));
    const paths:string[]=[];
    const fixture:Record<string,[string,string]>={
      '/':['text/html','<script src="/assets/entry-Ab123_cd.js"></script><link href="/assets/style-Ab123_cd.css">'],
      '/assets/entry-Ab123_cd.js':['text/javascript','import("./lazy-Ab123_cd.js"); const privateUrl="/api/media/secret"; const outside="https://example.com/unrelated-Ab123_cd.js";'],
      '/assets/lazy-Ab123_cd.js':['text/javascript','import "./entry-Ab123_cd.js"; const wasm="/assets/decode-Ab123_cd.wasm"; const worker="/assets/pdf.worker.min-Ab123_cd.mjs"; const libraryEngine="studio-supplemental-voice-v1.mjs";'],
      '/assets/pdf.worker.min-Ab123_cd.mjs':['text/javascript','export const pdf=true;'],
      '/assets/style-Ab123_cd.css':['text/css','body{color:white}'],
      '/assets/decode-Ab123_cd.wasm':['application/wasm','fixture-binary'],
    };
    const origin='https://558e8b97.srtb-graphics.pages.dev';
    const result=await archiveApprovedNativeGraph(root,origin,async(url:string,options:RequestInit)=>{
      assert.ok(url.startsWith(origin+'/'));assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
      const path=url.slice(origin.length);paths.push(path);assert.ok(fixture[path],path);
      return new Response(fixture[path][1],{headers:{'content-type':fixture[path][0]}});
    });
    assert.equal(result.verified,5);assert.equal(result.retained,6);assert.equal(paths.length,6);
    assert.equal(await restoreVerifiedNativeHistory(root),6);
    assert.equal(await readFile(join(root,'dist-studio-native/assets/pdf.worker.min-Ab123_cd.mjs'),'utf8'),fixture['/assets/pdf.worker.min-Ab123_cd.mjs'][1]);
    assert.equal(await readFile(join(root,'dist-studio-native/assets/lazy-Ab123_cd.js'),'utf8'),fixture['/assets/lazy-Ab123_cd.js'][1]);
    const manifest=JSON.parse(await readFile(join(root,'.tools/native-release/published-history.json'),'utf8'));
    assert.equal(manifest.files.find((f:{name:string})=>f.name==='old-Ab123_cd.js').origin,PUBLISHED_DEPLOYMENT);
    await assert.rejects(archiveApprovedNativeGraph(root,'https://unapproved.example',async()=>{throw Error('Must not fetch');}),/non approuvé/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('graph archive refuses fallback HTML and forbidden code without replacing published evidence',async()=>{
  for(const mode of ['html','forbidden','collision']){
    const root=await mkdtemp(join(tmpdir(),'srtb-native-history-'));
    try{
      const source=join(root,'.studio-asset-history');await mkdir(source);
      await writeFile(join(source,'entry-Ab123_cd.js'),'export const version=1;');
      await verifyPublishedNativeHistory(root,async()=>new Response('export const version=1;',{headers:{'content-type':'text/javascript'}}));
      const manifest=join(root,'.tools/native-release/published-history.json'),before=await readFile(manifest,'utf8');
      await assert.rejects(archiveApprovedNativeGraph(root,'https://558e8b97.srtb-graphics.pages.dev',async(url:string)=>{
        if(url.endsWith('/'))return new Response('<script src="/assets/entry-Ab123_cd.js"></script>',{headers:{'content-type':'text/html'}});
        return new Response(mode==='forbidden'?'import("/ffmpeg/ffmpeg-core.js")':'export const version=2;',{headers:{'content-type':mode==='html'?'text/html':'text/javascript'}});
      }),/Type ou taille|incompatible|Collision/);
      assert.equal(await readFile(manifest,'utf8'),before);
      assert.equal(await restoreVerifiedNativeHistory(root),1);
    }finally{await rm(root,{recursive:true,force:true});}
  }
});
