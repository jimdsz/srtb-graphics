import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const base=process.env.LOCAL_MEDIA_TEST_URL||'http://127.0.0.1:5178';
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
try{
  const page=await browser.newPage(),writes=[],errors=[];
  page.on('request',request=>{if(!['GET','HEAD'].includes(request.method()))writes.push(`${request.method()} ${request.url()}`);});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/tests/local-media-fast-open.html`);
  // A short real PCM WAV proves the browser opened a decodable local source.
  const samples=8000,wav=Buffer.alloc(44+samples*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(samples,24);wav.writeUInt32LE(samples*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/samples)*3000),44+i*2);
  await page.locator('input[type=file]').setInputFiles({name:'source.wav',mimeType:'audio/wav',buffer:wav});
  await page.getByTestId('metadata').filter({hasText:'ready'}).waitFor();
  await page.getByTestId('verification').filter({hasText:'pending'}).waitFor();
  const before=await page.evaluate(()=>({url:window.fastLocalQA.data._audio_voice_url.url,duration:document.querySelector('audio').duration,blocked:(()=>{try{window.fastLocalQA.stable();return false;}catch{return true;}})()}));
  assert.match(before.url,/^blob:/);assert.equal(before.duration,1);assert.equal(before.blocked,true);
  await page.evaluate(()=>window.fastLocalQA.release());await page.getByTestId('verification').filter({hasText:'verified'}).waitFor();
  const after=await page.evaluate(()=>({url:window.fastLocalQA.data._audio_voice_url.url,source:document.querySelector('audio').src,stable:JSON.stringify(window.fastLocalQA.stable())}));
  assert.match(after.url,/^local-media:[a-f0-9]{64}:16044$/);assert.equal(after.source,before.url);assert.equal(after.stable.includes('blob:'),false);
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({metadataReadyBeforeDigest:true,persistenceBlockedUntilVerified:true,sourceURLUnchangedAfterVerification:true,noUploads:writes.length===0,duration:before.duration},null,2));
}finally{await browser.close();}
