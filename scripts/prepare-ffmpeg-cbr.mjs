import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync} from 'node:fs';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {qualifiedCoreHashes as expected,verifyQualifiedCore} from './ffmpeg-cbr-integrity.mjs';

const root=join(import.meta.dirname,'..');
const study=join(root,'.tools','ffmpeg-study','package');
const vendor=join(root,'vendor','ffmpeg-core-0.12.10');
const output=join(root,'public','ffmpeg');
const licenses=join(root,'public','licenses');
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');

await Promise.all([mkdir(vendor,{recursive:true}),mkdir(output,{recursive:true}),mkdir(licenses,{recursive:true})]);
const vendorJs=join(vendor,'ffmpeg-core.js'),vendorWasmGzip=join(vendor,'ffmpeg-core.wasm.gz');
if(!existsSync(vendorJs)||!existsSync(vendorWasmGzip)){
  const studyJs=join(study,'dist','esm','ffmpeg-core.js'),studyWasm=join(study,'dist','esm','ffmpeg-core.wasm');
  if(!existsSync(studyJs)||!existsSync(studyWasm))throw Error('Sources binaires FFmpeg qualifiées absentes. Le build ne télécharge jamais de moteur à distance.');
  if(await hash(studyJs)!==expected.js||await hash(studyWasm)!==expected.wasm)throw Error('Le moteur FFmpeg local ne correspond pas à @ffmpeg/core 0.12.10 qualifié.');
  await copyFile(studyJs,vendorJs);await pipeline(createReadStream(studyWasm),createGzip({level:9}),createWriteStream(vendorWasmGzip));
}
const vendorLicense=join(vendor,'LICENSE.GPL-2.0-or-later.txt');
if(!existsSync(vendorLicense)){
  const packageLicense=join(study,'LICENSE');
  if(!existsSync(packageLicense))throw Error('Texte de licence FFmpeg qualifié absent.');
  const licenseText=await readFile(packageLicense,'utf8');
  if(!/GNU GENERAL PUBLIC LICENSE[\s\S]+Version 2/i.test(licenseText))throw Error('Texte de licence FFmpeg inattendu.');
  await copyFile(packageLicense,vendorLicense);
}
const [jsBytes,gzip]=await Promise.all([readFile(vendorJs),readFile(vendorWasmGzip)]);
const verified=verifyQualifiedCore(jsBytes,gzip),gzipBytes=verified.compressedWasmBytes;
await Promise.all([
  // Write the exact buffers verified above, never re-read mutable vendor paths.
  writeFile(join(output,'ffmpeg-core.js'),jsBytes),
  writeFile(join(output,'ffmpeg-core.wasm.gz'),gzip),
  copyFile(join(vendor,'NOTICE.md'),join(licenses,'ffmpeg-core-0.12.10-NOTICE.md')),
  copyFile(vendorLicense,join(licenses,'ffmpeg-core-0.12.10-GPL-2.0-or-later.txt')),
]);
await writeFile(join(output,'manifest.json'),`${JSON.stringify({package:'@ffmpeg/core',version:'0.12.10',license:'GPL-2.0-or-later',...verified},null,2)}\n`);
console.log(`FFmpeg CBR local préparé : ${gzipBytes} octets compressés.`);
