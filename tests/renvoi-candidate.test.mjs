import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeData, prepareAnimation, applyRendererCompatibility, variantDefaults, FORMATS, TIMING } from '../candidates/renvoi-2026-09-23/config.mjs';
import { validateBenin } from '../candidates/renvoi-2026-09-23/text-layout.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'candidates/renvoi-2026-09-23');
const json = async relative => JSON.parse(await readFile(path.join(directory, relative), 'utf8'));
const manifest = await json('manifest.candidate.json');
const animations = Object.fromEntries(await Promise.all(['1L', '2L'].map(async v => [v, await json(`source/${v}/animation.json`)])));
const hash = b => createHash('sha256').update(b).digest('hex');
test('candidate is explicitly unpublished and all copied resources remain exact', async () => {
  assert.equal(manifest.publishable, false); assert.equal(manifest.candidateOnly, true);
  for (const file of manifest.files) {
    const copy = await readFile(path.join(directory, file.target)), source = await readFile(path.resolve(root, file.source));
    assert.equal(hash(copy), file.sha256, file.target); assert.equal(hash(copy), hash(source), file.source); assert.equal(copy.length, file.bytes);
  }
});
test('14 exact font-verified references are present and hashed, not copied as animation artwork', async () => {
  assert.equal(manifest.references.length, 14);
  for (const ref of manifest.references) {
    assert.match(ref.source, /font_verified_references\/frame_\d+\.png$/);
    assert.equal(hash(await readFile(path.resolve(root, ref.source))), ref.sha256);
  }
});
test('both variants retain original AE timeline and palette', () => {
  for (const animation of Object.values(animations)) {
    assert.equal(animation.w, 1920); assert.equal(animation.h, 1080); assert.equal(animation.fr, 25); assert.equal(animation.ip, 0); assert.equal(animation.op, 250);
    const colors = animation.layers.filter(l => l.ty === 1).map(l => l.sc);
    assert.ok(colors.includes('#007300')); assert.ok(colors.includes('#f0b900')); assert.ok(colors.includes('#eb1905'));
    assert.equal(animation.layers.find(l => l.nm === 'SOUSTEXTE').ip, 51);
    assert.equal(animation.layers.find(l => l.nm === 'TEXTE RENVOI').ip, 23);
  }
  assert.equal(TIMING.outStart, 7.4); assert.equal(TIMING.duration, 10);
});
test('1L preserves two complementary animated halves of the same editable title', () => {
  const original = animations['1L'], prepared = prepareAnimation(original, { variant: '1L', title: 'Une soirée au Bénin' });
  const top = prepared.layers.find(l => l.nm === 'TEXTE HAUT 1L'), bottom = prepared.layers.find(l => l.nm === 'TEXTE BAS 1L');
  assert.equal(top.t.d.k[0].s.t, 'UNE SOIRÉE AU BÉNIN'); assert.equal(bottom.t.d.k[0].s.t, top.t.d.k[0].s.t);
  assert.equal(top.tt, 1); assert.equal(bottom.tt, 2); assert.equal(top.tp, bottom.tp);
  assert.notDeepEqual(top.ks.p, bottom.ks.p); assert.equal(top.ip, 37); assert.equal(bottom.ip, 37);
  assert.ok(!prepared.layers.some(l => /TEXTE (HAUT|BAS) 2L/.test(l.nm)));
  assert.equal(original.layers.find(l => l.nm === top.nm).t.d.k[0].s.t, 'RASSEMBLANCE');
});
test('2L edits independent lines; every non-text value remains byte-structurally identical', () => {
  const original = animations['2L'], prepared = prepareAnimation(original, { variant: '2L', title: 'Bénin', title2: 'Culture vivante', subtitle: 'Édition spéciale', announcement: 'À suivre' });
  assert.equal(prepared.layers.find(l => l.nm === 'TEXTE HAUT 2L').t.d.k[0].s.t, 'BÉNIN');
  assert.equal(prepared.layers.find(l => l.nm === 'TEXTE BAS 2L').t.d.k[0].s.t, 'CULTURE VIVANTE');
  function withoutStrings(animation) { const copy = structuredClone(animation); for (const layer of copy.layers) for (const key of layer.t?.d?.k || []) key.s.t = ''; return copy; }
  assert.deepEqual(withoutStrings(prepared), withoutStrings(original));
  assert.deepEqual(prepared.assets, original.assets);
});
test('native default data changes no source strings or keyframes', () => {
  for (const variant of ['1L', '2L']) assert.deepEqual(prepareAnimation(animations[variant], variantDefaults(variant)), animations[variant]);
});
test('renderer correction is limited to the two nested fills of the logo É', () => {
  for (const original of Object.values(animations)) {
    const clone = structuredClone(original), adapted = applyRendererCompatibility(clone);
    const accent = adapted.assets.find(a => a.nm === 'BENINTV_Roll').layers.find(l => l.nm === 'é');
    for (const index of [0, 1]) { assert.deepEqual(accent.shapes[index].it[0].it[1].c.k, [1, 1, 1, 1]); accent.shapes[index].it[0].it[1].c.k = [0, 0, 0, 1]; }
    assert.deepEqual(adapted, original);
  }
});
test('font outline validation accepts accents and rejects unsupported glyphs', async () => {
  const font = await json('lib/benin-outlines.json');
  assert.doesNotThrow(() => validateBenin('À SUIVRE : BÉNIN', font));
  assert.throws(() => validateBenin('RENVOI 🎉', font), /Caractère/);
  assert.throws(() => validateBenin('E\u0301', font), /Caractère/);
});
test('invalid data fails explicitly; social sizes remain explicitly unqualified', () => {
  assert.throws(() => normalizeData({ variant: '3L' }), /Variante/);
  assert.throws(() => normalizeData({ title: 'a\nb' }), /seule ligne/);
  assert.throws(() => normalizeData({ variant: '1L', title2: 'not hidden' }), /deuxième/);
  assert.throws(() => normalizeData({ variant: '2L', title2: '' }), /renseignée/);
  assert.throws(() => normalizeData({ voiceOffset: -1 }), /hors plage/);
  assert.equal(normalizeData({ title: 'e\u0301mission' }).title, 'ÉMISSION');
  assert.equal(normalizeData({ title: 'A'.repeat(1000) }).title.length, 1000);
  assert.deepEqual([FORMATS['4:5'].width, FORMATS['4:5'].height], [1080, 1350]);
  assert.deepEqual([FORMATS['9:16'].width, FORMATS['9:16'].height], [1080, 1920]);
  for (const format of Object.values(FORMATS)) assert.equal(format.qualified, false);
});
