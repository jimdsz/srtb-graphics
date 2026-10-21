import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ensureMediaEngine,ENGINE,digestFile} from './media-engine.mjs';
test('verified pinned archive installs executable digests and repairs a tampered test copy',async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'graphics-engine-test-')),base=path.join(data,'video-engine-'+ENGINE.version);await fs.mkdir(base);
 const upstream=path.resolve('.tools/media-preparation/ffmpeg-9.0.2-essentials_build.zip');assert.equal(await digestFile(upstream),ENGINE.sha256);
 await fs.copyFile(upstream,path.join(base,'engine.zip'));const signal=new AbortController().signal;
 const engine=await ensureMediaEngine(data,signal,()=>{});assert.equal(await digestFile(engine.ffmpeg),ENGINE.ffmpeg);assert.equal(await digestFile(engine.ffprobe),ENGINE.ffprobe);
 // Only this newly generated qualification copy is changed; never a user binary.
 await fs.appendFile(engine.ffmpeg,'tampered-test-copy');await fs.writeFile(path.join(base,'integrity.json'),JSON.stringify({archive:ENGINE.sha256,ffmpeg:await digestFile(engine.ffmpeg),ffprobe:ENGINE.ffprobe}));
 const repaired=await ensureMediaEngine(data,signal,()=>{});assert.equal(await digestFile(repaired.ffmpeg),ENGINE.ffmpeg);
});
