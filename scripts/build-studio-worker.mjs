import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import {createHash} from 'node:crypto';
import {studioWorkerOptionsFor} from './studio-worker-options.mjs';
import {nativeBuildProfile,assertWorkerDerivationProfile} from './studio-release-profile.mjs';

const args=process.argv.slice(2),nativeOnly=args[0]==='--native-only';
if(!nativeOnly&&args.length)throw Error('Les déclinaisons de production exigent le profil natif explicite.');
const profile=nativeBuildProfile(nativeOnly?args.slice(1):[]);
const outfile=nativeOnly?'dist-studio-native/_worker.js':'dist-studio/_worker.js';
// The range responder must describe the exact bytes shipped in this deployment.
const previewAssets=JSON.parse(await readFile('server/preview-assets.json','utf8'));
for(const [path,asset] of Object.entries(previewAssets)){
  if(!/^\/preview-media\/v\d+\/[\w-]+\.mp4$/.test(path)||asset.bytes>25*1024**2)throw Error('Unexpected preview range asset.');
  const bytes=await readFile((nativeOnly?'dist-studio-native':'dist-studio')+path);
  if(bytes.byteLength!==asset.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('Preview range manifest does not match the deployed media: '+path);
}
// Explicit bundling avoids Pages Functions' browser XML parser (Workers has no DOMParser).
const built=await build({
  ...studioWorkerOptionsFor(profile.name),entryPoints: ['server/pages-worker.ts'], outfile,
  metafile:true,
});
const inputs=Object.keys(built.metafile.inputs);
if(!inputs.some(path=>path.endsWith('@aws-sdk/client-s3/dist-es/runtimeConfig.browser.js'))||inputs.some(path=>path.endsWith('@aws-sdk/client-s3/dist-es/runtimeConfig.js')))throw Error('Worker contains an incompatible S3 runtime.');
const code = await readFile(outfile, 'utf8');
if (/new DOMParser\s*\(/.test(code)) throw Error('Worker build contains a browser-only XML parser.');
assertWorkerDerivationProfile(inputs,code,profile);
if (gzipSync(code).byteLength > 3 * 1024 ** 2) throw Error('Worker exceeds the free-plan bundle safety limit.');
console.log(`Private Pages Worker built (${profile.name}): ${gzipSync(code).byteLength} bytes gzip; no browser XML parser.`);
