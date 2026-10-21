// Read-only upstream provenance inventory. Does not build, publish, or remove release guards.
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const components = [
  ['ffmpeg.wasm', 'ffmpegwasm/ffmpeg.wasm', '71aa99d37c02a7b4c435275ca9ef50e612f6efa1'],
  ['FFmpeg', 'FFmpeg/FFmpeg', 'n5.1.4'],
  ['x264', 'ffmpegwasm/x264', '4-cores'],
  ['x265', 'ffmpegwasm/x265', '3.4'],
  ['libvpx', 'ffmpegwasm/libvpx', 'v1.13.1'],
  ['LAME', 'ffmpegwasm/lame', 'master'],
  ['Ogg', 'ffmpegwasm/Ogg', 'v1.3.4'],
  ['Theora', 'ffmpegwasm/theora', 'v1.1.1'],
  ['Opus', 'ffmpegwasm/opus', 'v1.3.1'],
  ['Vorbis', 'ffmpegwasm/vorbis', 'v1.3.3'],
  ['zlib', 'ffmpegwasm/zlib', 'v1.2.11'],
  ['WebP', 'ffmpegwasm/libwebp', 'v1.3.2'],
  ['FreeType', 'ffmpegwasm/freetype2', 'VER-2-10-4'],
  ['FriBidi', 'fribidi/fribidi', 'v1.0.9'],
  ['HarfBuzz', 'harfbuzz/harfbuzz', '5.2.0'],
  ['libass', 'libass/libass', '0.15.0'],
  ['zimg', 'sekrit-twc/zimg', 'release-3.0.5'],
  ['SDL2', 'libsdl-org/SDL', 'release-2.24.2'],
  ['Emscripten', 'emscripten-core/emscripten', '3.1.40'],
];
const results = [];
async function inventory([name, repository, ref]) {
  const url = `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`;
  const response = await fetch(url, {headers: {'User-Agent': 'SRTB-source-audit'}, signal: AbortSignal.timeout(30_000)});
  if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
  const commit = await response.json();
  if (!/^[0-9a-f]{40}$/.test(commit.sha)) throw Error(`${name}: invalid commit`);
  const result = {name, repository, ref, sha: commit.sha, committedAt: commit.commit.committer.date, message: commit.commit.message, evidence: url, archive: `https://github.com/${repository}/archive/${commit.sha}.tar.gz`};
  results.push(result);
  console.log(`${name}: ${result.sha} (${result.committedAt})`);
}
// Bounded public metadata requests; no media, credentials, or project data transmitted.
for (let start = 0; start < components.length; start += 3) {
  await Promise.all(components.slice(start, start + 3).map(inventory));
}
results.sort((a, b) => components.findIndex(x => x[0] === a.name) - components.findIndex(x => x[0] === b.name));
const directory = join(import.meta.dirname, '..', 'reports', 'encoder-source-audit');
await mkdir(directory, {recursive: true});
await writeFile(join(directory, 'upstream-refs-2026-09-23.json'), JSON.stringify({
  observedAt: new Date().toISOString(),
  status: 'candidate-source-inventory-not-build-attestation',
  notes: [
    'Resolved upstream recipes to commits as observed today. Not a claim of bit-for-bit reproducibility or proof of historical branch state.',
    'SDL2 version follows tools/ports/sdl2.py in Emscripten 3.1.40.',
    'Submodules, source archives, patches, integration sources and redistribution documentation still require verification.',
    'No release guard or application license changed by this script.',
  ], components: results,
}, null, 2) + '\n');
