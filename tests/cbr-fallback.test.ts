import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ffmpegCbrArguments,minimumCompleteWindowBitrate,shouldStartCbrSegment,CBR_SEGMENT_LIMIT_SECONDS,CBR_SEGMENT_TARGET_SECONDS} from '../src/studio/video/cbr-fallback.ts';

test('FFmpeg fallback requests x264 HRD CBR at the 50Mbps target',()=>{
  const args=[...ffmpegCbrArguments()];
  for(const pair of [['-b:v','50M'],['-minrate','50M'],['-maxrate','50M'],['-bufsize','50M'],['-preset','ultrafast']] as const){const index=args.indexOf(pair[0]);assert.notEqual(index,-1);assert.equal(args[index+1],pair[1]);}
  assert.equal(args[args.indexOf('-x264-params')+1],'nal-hrd=cbr:filler=1');
  assert.equal(args.includes('pad' as never),false,'container padding is not a bitrate substitute');
});

test('segments begin on keyframes near five seconds and remain memory bounded',()=>{
  assert.equal(CBR_SEGMENT_TARGET_SECONDS,5);assert.equal(CBR_SEGMENT_LIMIT_SECONDS,6.25);
  assert.equal(shouldStartCbrSegment(4.99,true),false);assert.equal(shouldStartCbrSegment(5,true),true);assert.equal(shouldStartCbrSegment(5.5,false),false);
});

test('one-second floor ignores only an incomplete tail interval',()=>{
  const packets=[
    {timestamp:0,duration:1,byteLength:4_000_000},
    {timestamp:1,duration:1,byteLength:3_750_000},
    {timestamp:2,duration:.4,byteLength:1},
  ];
  assert.deepEqual(minimumCompleteWindowBitrate(packets,2.4),{minimumOneSecondBitrate:30_000_000,oneSecondWindowCount:2});
  assert.deepEqual(minimumCompleteWindowBitrate(packets,.4),{minimumOneSecondBitrate:undefined,oneSecondWindowCount:0});
});

test('production worker is local-only and prepared WASM stays below the Pages file limit',async()=>{
  const [worker,manifest,wasm,license]=await Promise.all([
    readFile(resolve('src/studio/video/cbr-fallback.worker.ts'),'utf8'),
    readFile(resolve('public/ffmpeg/manifest.json'),'utf8'),
    stat(resolve('public/ffmpeg/ffmpeg-core.wasm.gz')),
    readFile(resolve('public/licenses/ffmpeg-core-0.12.10-GPL-2.0-or-later.txt'),'utf8'),
  ]);
  assert.match(worker,/\/ffmpeg\/ffmpeg-core\.wasm\.gz/);assert.match(worker,/vendor\/ffmpeg-core-0\.12\.10\/ffmpeg-core\.js/);assert.doesNotMatch(worker,/import\(\/\* @vite-ignore \*\/CORE_SCRIPT/);assert.doesNotMatch(worker,/https?:\/\//);assert.doesNotMatch(worker,/\.tools/);
  assert.match(worker,/if\(isWasm\)wasmBinary=received/,'accepts a browser-decoded WASM response');assert.match(worker,/new DecompressionStream\('gzip'\)/,'also accepts raw gzip');
  assert.ok(wasm.size<25_000_000);assert.equal(JSON.parse(manifest).version,'0.12.10');assert.equal(JSON.parse(manifest).license,'GPL-2.0-or-later');
  assert.match(license,/GNU GENERAL PUBLIC LICENSE[\s\S]+Version 2/i);
});

test('production publishing remains explicitly blocked pending the GPL decision and exact source',async()=>{
  const [release,block]=await Promise.all([
    readFile(resolve('scripts/check-studio-release.mjs'),'utf8'),
    readFile(resolve('vendor/ffmpeg-core-0.12.10/RELEASE_BLOCKED.md'),'utf8'),
  ]);
  assert.match(release,/ffmpeg-core-0\.12\.10.+RELEASE_BLOCKED\.md/s);
  assert.match(release,/--production.+existsSync\(ffmpegReleaseBlock\)/s);
  assert.match(block,/Corresponding Source/);
});

test('MP4 export measures native output before fallback and verifies the selected final file',async()=>{
  const source=await readFile(resolve('src/studio/video/export.ts'),'utf8');
  const measure=source.indexOf('measureVideoBitrates(blob,signal)'),fallback=source.indexOf('enforceOpaqueCbr(blob,signal'),verify=source.lastIndexOf('await verify(blob,report');
  assert.ok(measure>=0&&fallback>measure&&verify>fallback);assert.match(source,/bitrateFallback='ffmpeg-x264-cbr'/);assert.match(source,/fallbackDispose/);
});

test('bounded audio qualification hashes native/final packets and checks both cancellation cleanup phases',async()=>{
  const [source,harness]=await Promise.all([readFile(resolve('src/studio/video/export.ts'),'utf8'),readFile(resolve('tests/cbr-audio-contracts.ts'),'utf8')]);
  const native=source.indexOf('inspectNative(blob)'),fallback=source.indexOf('enforceOpaqueCbr(blob,signal');assert.ok(native>=0&&fallback>native);
  assert.match(harness,/packetChainSha256/);assert.match(harness,/bitstreamIdentical:true/);assert.match(harness,/mode:'loading'\|'segment'/);assert.match(harness,/event\.segment===2/);assert.match(harness,/temporaryEntries/);
});
