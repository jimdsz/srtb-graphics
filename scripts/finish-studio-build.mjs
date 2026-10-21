import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises';
import {restoreStudioAssets} from './studio-asset-history.mjs';
import {resolve} from 'node:path';
if(process.argv.length>3||process.argv[2]&&process.argv[2]!=='--native-only')throw Error('Profil de build inconnu.');
const nativeOnly=process.argv[2]==='--native-only',directory=nativeOnly?'dist-studio-native':'dist-studio',at=path=>resolve(directory,path);
// Generated build artifacts only. The legacy public release is kept unchanged.
const html=await readFile(at('studio.html'),'utf8');
if(!html.includes('/assets/'))throw Error('Studio build is missing its bundled entry.');
await writeFile(at('index.html'),html);
await writeFile(at('_routes.json'),JSON.stringify({version:1,include:['/*'],exclude:[]},null,2));
await writeFile(at('_headers'),'/*\n  Cache-Control: private, no-store\n  X-Robots-Tag: noindex, nofollow\n');
await mkdir(at('licenses'),{recursive:true});
await copyFile('node_modules/@soundtouchjs/core/LICENSE',at('licenses/SoundTouchJS-MPL-2.0.txt'));
for(const [source,destination] of [
  ['prores-wasm-encoder/LICENSE','ProRes-encoder-LGPL-2.1.txt'],
  ['prores-wasm-encoder/README.md','ProRes-encoder-upstream-notices.md'],
  ['@mediabunny/prores/LICENSE','Mediabunny-ProRes-MPL-2.0.txt'],
  ['turbores/LICENSE','TurboRes-MPL-2.0.txt'],
  ['motion/LICENSE.md','Motion-MIT.txt'],
  ['thinking-orbs/LICENSE','Thinking-Orbs-MIT.txt'],
  ['lucide-react/LICENSE','Lucide-ISC.txt'],
])await copyFile('node_modules/'+source,at('licenses/'+destination));
await copyFile('src/studio/ui/THIRD-PARTY-NOTICES.md',at('licenses/UI-third-party-notices.md'));
await writeFile(at('licenses/NOTICE.txt'),`SRTB Graphics — third-party components (unmodified upstream libraries)

@soundtouchjs/core 2.1.1 and @soundtouchjs/lanczos-interpolator 2.1.1: MPL-2.0.
License: SoundTouchJS-MPL-2.0.txt
Source: https://github.com/cutterbl/SoundTouchJS
Exact published source modules: https://www.npmjs.com/package/@soundtouchjs/core/v/2.1.1 and https://www.npmjs.com/package/@soundtouchjs/lanczos-interpolator/v/2.1.1

prores-wasm-encoder 0.3.1: LGPL-2.1-or-later.
License: ProRes-encoder-LGPL-2.1.txt; notices: ProRes-encoder-upstream-notices.md
Corresponding source including build scripts: prores-wasm-encoder-0.3.1-source.tar.gz
Source: https://github.com/OlivierEstevez/ProRes-WASM-encoder/tree/b34363772f97f8b808ba7c1f177647a5d4efb444
Encoder derived from FFmpeg proresenc_kostya.c (Anatoliy Wasserman, Konstantin Shishkov); integer DCT derived from libjpeg jfdctint.c (IJG License). Original notices are preserved in the source archive.
Independent, unofficial implementation; not affiliated with, endorsed by or certified by Apple Inc. ProRes is an Apple Inc. trademark.

@mediabunny/prores 1.58.1: MPL-2.0.
License: Mediabunny-ProRes-MPL-2.0.txt
Corresponding source: mediabunny-prores-1.58.1-source.tar.gz (packages/prores, extracted without modification from the upstream archive)
Source: https://github.com/Vanilagy/mediabunny/tree/f953be9828cfe9e11d4eb51e11ba26121badfed0

turbores 1.2.2: MPL-2.0.
License: TurboRes-MPL-2.0.txt
Corresponding source: turbores-1.2.2-source.tar.gz
Source: https://github.com/Vanilagy/turbores/tree/a7bba977d9f524dd7663ae04e178f41395ee6063

UI components: Motion (MIT), Thinking Orbs (MIT) and Lucide React (ISC).
Licenses: Motion-MIT.txt, Thinking-Orbs-MIT.txt and Lucide-ISC.txt.
Component notes and source links: UI-third-party-notices.md

Archives and notices are available beside this file. These libraries run locally in the browser. The libraries' license rights, including modification, replacement and reverse engineering for debugging modifications where granted, are not restricted by SRTB Graphics.
`);
console.log('Studio build: all routes require the authentication middleware. No public asset exclusions.');
if(!nativeOnly)console.log('Previous hashed modules retained for open sessions:',await restoreStudioAssets(resolve(import.meta.dirname,'..')));
