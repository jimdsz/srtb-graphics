import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

export const qualifiedCoreHashes=Object.freeze({
  js:'67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3',
  wasm:'9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7',
});
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Read-only, bounded verification of the actual bytes, including an existing
 * vendor gzip. A manifest must never claim a raw hash that was not measured. */
export function verifyQualifiedCore(js,gzip){
  const jsSha256=sha256(js);
  if(jsSha256!==qualifiedCoreHashes.js)throw Error('ffmpeg-core.js modifié ou inattendu.');
  if(!gzip.byteLength||gzip.byteLength>=25_000_000)throw Error('Le WASM FFmpeg compressé dépasse la limite de publication ou est vide.');
  let wasm;
  try{wasm=gunzipSync(gzip,{maxOutputLength:64*1024*1024});}
  catch{throw Error('Le gzip WASM FFmpeg est corrompu ou dépasse la taille décompressée autorisée.');}
  const wasmSha256=sha256(wasm);
  if(wasmSha256!==qualifiedCoreHashes.wasm)throw Error('Le WASM FFmpeg décompressé ne correspond pas au binaire qualifié.');
  return {jsSha256,wasmSha256,compressedWasmSha256:sha256(gzip),compressedWasmBytes:gzip.byteLength,wasmBytes:wasm.byteLength};
}
