import {nativeReleaseProfile} from './studio-release-profile.mjs';

// Cloudflare uses web fetch/streams, not the Node.js S3 runtime. `neutral`
// ignores package.json browser remapping and mixes incompatible SDK variants.
// Share these exact settings with the bundled-storage regression test.
export function studioWorkerOptionsFor(profileName='native-only'){
 const profile=nativeReleaseProfile(profileName);
 return {
  bundle:true,format:'esm',platform:'browser',target:'es2022',conditions:['workerd','worker','browser'],
  mainFields:['browser','module','main'],external:['node:*','cloudflare:*'],
  // OFF remains the default. Only the explicit native-derivations release
  // includes routes and provenance tables, with its migration publication gate.
  define:{__SRTB_DERIVATIONS__:String(profile.derivations)},
  // Workers has no DOMParser; use the streaming-independent XML implementation.
  alias:{'@aws-sdk/xml-builder':'@aws-sdk/xml-builder/dist-cjs/index.js'},
 };
}
export const studioWorkerOptions=studioWorkerOptionsFor();
