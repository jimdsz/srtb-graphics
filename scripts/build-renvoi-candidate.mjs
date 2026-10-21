import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { REFERENCE_FRAMES, FORMATS, VERSION } from '../candidates/renvoi-2026-09-23/config.mjs';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const candidate = path.join(root, 'candidates/renvoi-2026-09-23');
export const broadcast = path.resolve(root, '../BroadcastTemplates');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = {
  '1L': 'f38a89954688ff4a37c0b2d50126ad935908e5c7a1a687b5b1a7a355b2aaf623',
  '2L': 'ecff617a2738264d8dc81c5166538c80b229a439a2134c8c1e82c5d28d7b717e',
  'BeninSemiBold-Regular.otf': '6c4be631feea1436eb499c6b07e4fdfe445239b7a23d357ccd913f451f2bed5c',
  'SuisseIntl.otf': 'f8b1154a3b3dd6036dca7506f0a8b4bc5a86a1be6b8a788e50e8627dfceb2699',
};
export async function buildCandidate() {
  const files = [], references = [];
  async function copy(source, relative, pinned) {
    const bytes = await readFile(source), sha256 = digest(bytes);
    if (pinned && sha256 !== pinned) throw Error(`Source hash changed: ${source}`);
    const target = path.resolve(candidate, relative);
    if (!target.startsWith(candidate + path.sep)) throw Error('Candidate target escapes scope');
    await mkdir(path.dirname(target), { recursive: true });
    // Preserve unexpected prior contents; never silently overwrite a locally edited resource.
    try { const old = await readFile(target); if (digest(old) !== sha256) throw Error(`Candidate target differs: ${target}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await copyFile(source, target); }
    files.push({ source: path.relative(root, source).replaceAll('\\', '/'), target: relative, bytes: bytes.length, sha256 });
  }
  const library = path.join(root, 'public/library/v1.7.0/BTV_BA_1P/lib');
  for (const name of ['lottie-web.esm.mjs', 'benin-outlines.json']) await copy(path.join(library, name), `lib/${name}`);
  for (const name of ['BeninSemiBold-Regular.otf', 'SuisseIntl.otf']) await copy(path.join(library, 'fonts', name), `lib/fonts/${name}`, expected[name]);
  for (const variant of ['1L', '2L']) {
    const sourceDir = path.join(broadcast, 'EXPORT/_NEW_TEMPLATES_20260923', `renvoi_${variant}`);
    await copy(path.join(sourceDir, 'animation.json'), `source/${variant}/animation.json`, expected[variant]);
    const animation = JSON.parse(await readFile(path.join(sourceDir, 'animation.json'), 'utf8'));
    for (const asset of animation.assets.filter(a => a.p)) {
      if (asset.u !== 'images/' || !/^img_\d+$/.test(asset.p)) throw Error('Unexpected source image path');
      const source = path.join(sourceDir, asset.u, asset.p);
      const header = await readFile(source);
      if (header.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('Expected synthetic PNG placeholder');
      await copy(source, `source/${variant}/images/${asset.p}`);
    }
    for (const frame of REFERENCE_FRAMES) {
      const source = path.join(broadcast, 'WORK/_NEW_TEMPLATES_20260923/renvoi', `BTV_RENVOI_Piqure_de_rappel_exemple_${variant}_font_verified_references`, `frame_${frame}.png`);
      const bytes = await readFile(source);
      references.push({ variant, frame, source: path.relative(root, source).replaceAll('\\', '/'), sha256: digest(bytes), bytes: bytes.length, url: `/reference/${variant}/${frame}.png` });
    }
  }
  for (const name of ['renvoi-geometry.json', 'renvoi-authoring.json', 'renvoi-preparation.json', 'renvoi_1L-bodymovin.json', 'renvoi_2L-bodymovin.json', 'font-verified-reference-frames.json']) {
    await copy(path.join(broadcast, 'REPORTS/new-templates-2026-09-23', name), `provenance/${name}`);
  }
  const manifest = {
    id: 'BTV_RENVOI_PIQURE_CANDIDATE', version: VERSION, candidateOnly: true, publishable: false,
    sourceAE: '../BroadcastTemplates/WORK/_INVENTORY/2026-09-23-new-templates/BTV_BA_RENVOI_Piqure_de_rappel.aep',
    comps: ['BTV_RENVOI_Piqure_de_rappel_exemple_1L', 'BTV_RENVOI_Piqure_de_rappel_exemple_2L'],
    dimensions: { width: 1920, height: 1080, fps: 25, frames: 250 }, formats: FORMATS,
    files, references,
    boundary: 'Local-only. No AE execution, network download, media source copy, catalogue registration, encoder or release changes.',
    media: 'Exported images are synthetic placeholders, not the original rushes. User media is an explicit local replacement; original edit decision list is not recreated.',
    audio: 'No source audio copied. Optional local music/voice is a preview control; broadcast mixing and loudness remain unqualified.',
    rendererCompatibility: 'In the runtime clone only, two black nested fills in BENINTV_Roll/é inherit the outer white fill visible in AE. Exact paths checked in config.mjs; source JSON, shapes and timing unchanged.',
    qualification: { report: '../../reports/renvoi-candidate/QUALIFICATION-2026-09-23.md', status: 'local-candidate-not-pixel-identical-not-release-qualified' },
  };
  await writeFile(path.join(candidate, 'manifest.candidate.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ candidate, files: files.length, references: references.length, publishable: false }, null, 2));
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildCandidate();
