import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {NATIVE_ONLY_EXPORT} from '../src/studio/video/release-profile.ts';

const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));

test('native-only relaxation is opt-in at compile time; the ordinary build remains strict',async()=>{
  assert.equal(NATIVE_ONLY_EXPORT,false);
  for(const [define,expected] of [[{},false],[{__SRTB_NATIVE_ONLY__:'true'},true],[{__SRTB_NATIVE_ONLY__:'false'},false]] as const){
    const result=await build({stdin:{contents:"import {NATIVE_ONLY_EXPORT} from './src/studio/video/release-profile.ts';globalThis.nativeProfile=NATIVE_ONLY_EXPORT;",resolveDir:repositoryRoot},write:false,bundle:true,format:'cjs',platform:'node',define});
    const context:{nativeProfile?:boolean}={};runInNewContext(result.outputFiles[0].text,context);assert.equal(context.nativeProfile,expected);
  }
});

test('native report source states the undelivered floor and exposes measured bitrate warnings',()=>{
  // Keep this Node-only release test independent from the browser CSS loader.
  // Component rendering is covered by the Vite/Vitest studio suite.
  const source=readFileSync('src/studio/VideoExport.tsx','utf8');
  assert.ok(source.includes('le plancher de 30 Mb/s n’est pas garanti'));
  assert.match(source,/report\.bitrateWarning\?<p className="notice warning" role="alert">/);
  assert.ok(source.includes('Débit vidéo moyen mesuré'));
  assert.ok(source.includes('Minimum mesuré sur 1 s'));
  assert.ok(source.includes('Réencodage local FFmpeg / libx264'));
});

test('native release uses a distinct output, alias and public whitelist without weakening the blocked release',()=>{
  const config=readFileSync('vite.studio-native.config.ts','utf8'),release=readFileSync('scripts/check-studio-release.mjs','utf8'),native=readFileSync('scripts/check-studio-native-release.mjs','utf8'),source=readFileSync('src/studio/video/export.ts','utf8');
  assert.ok(config.includes('publicDir:false'));assert.ok(config.includes("outDir:'dist-studio-native'"));assert.ok(config.includes('opaque-native-adapter.ts'));
  assert.ok(!config.includes('preserveStudioAssets'));
  assert.match(release,/--production.+existsSync\(ffmpegReleaseBlock\)/s);
  assert.ok(native.includes('verifyNativeInventory'));assert.ok(native.includes('.pages-studio-native'));
  assert.ok(source.includes('if(!NATIVE_ONLY_EXPORT&&needsOpaqueCbrFallback(nativeFloor))'));
  assert.ok(source.includes('else assertOpaqueMeasuredBitrate(floor)'));
  assert.ok(source.includes('await verify(blob,report,proofs,signal,mixed?.buffer)'));
});
