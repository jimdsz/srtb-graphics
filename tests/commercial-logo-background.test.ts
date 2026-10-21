import test from 'node:test';
import assert from 'node:assert/strict';
import {removeCommercialLogoBackground} from '../src/studio/commercial/logo-background';

type RGB = [number, number, number];
function image(width = 32, height = 24, background: RGB = [255, 255, 255]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set([...background, 255], i * 4);
  return pixels;
}
function rectangle(pixels: Uint8ClampedArray, width: number, x: number, y: number,
  w: number, h: number, rgb: RGB, alpha = 255) {
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    pixels.set([...rgb, alpha], (py * width + px) * 4);
  }
}
const rgba = (pixels: Uint8ClampedArray, width: number, x: number, y: number) =>
  [...pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

test('white, black and coloured solid mattes are removed without changing artwork or source', () => {
  for (const bg of [[255, 255, 255], [0, 0, 0], [15, 115, 180]] as RGB[]) {
    const pixels = image(32, 24, bg);
    rectangle(pixels, 32, 10, 8, 12, 8, [190, 55, 45]);
    const original = pixels.slice(), result = removeCommercialLogoBackground(pixels, 32, 24);
    assert.equal(result.status, 'removed'); assert.deepEqual(result.background, bg);
    assert.equal(result.removedPixels, 32 * 24 - 12 * 8);
    assert.deepEqual(rgba(result.pixels, 32, 14, 10), [190, 55, 45, 255]);
    assert.equal(rgba(result.pixels, 32, 0, 0)[3], 0);
    assert.deepEqual(pixels, original); assert.notEqual(result.pixels, pixels);
  }
});

test('enclosed internal white and multicolour artwork stay byte-exact', () => {
  const pixels = image();
  rectangle(pixels, 32, 6, 4, 20, 16, [20, 30, 80]);
  rectangle(pixels, 32, 10, 8, 12, 8, [255, 255, 255]);
  rectangle(pixels, 32, 14, 10, 4, 4, [230, 60, 20]);
  const result = removeCommercialLogoBackground(pixels, 32, 24);
  assert.equal(result.status, 'removed');
  for (let y = 4; y < 20; y++) for (let x = 6; x < 26; x++) {
    assert.deepEqual(rgba(result.pixels, 32, x, y), rgba(pixels, 32, x, y));
  }
});

test('a border-connected gap is removed while diagonal enclosed pixels stay opaque', () => {
  const pixels = image();
  rectangle(pixels, 32, 6, 4, 20, 16, [0, 0, 0]);
  rectangle(pixels, 32, 14, 4, 4, 8, [255, 255, 255]);
  pixels.set([255, 255, 255, 255], (12 * 32 + 13) * 4);
  const result = removeCommercialLogoBackground(pixels, 32, 24);
  assert.equal(rgba(result.pixels, 32, 15, 9)[3], 0);
  assert.equal(rgba(result.pixels, 32, 13, 12)[3], 255);
});

test('any existing alpha is authoritative, including transparent canvases and faint shadows', () => {
  for (const alpha of [0, 1, 128, 254]) {
    const pixels = image();
    rectangle(pixels, 32, 10, 8, 12, 8, [20, 30, 80]);
    pixels[3] = alpha;
    const result = removeCommercialLogoBackground(pixels, 32, 24);
    assert.equal(result.status, 'transparent'); assert.deepEqual(result.pixels, pixels);
    assert.notEqual(result.pixels, pixels); assert.equal(result.removedPixels, 0);
  }
});

test('gradient, multicolour and inconsistent corner borders retain the original', () => {
  for (const mode of ['gradient', 'sides', 'corner']) {
    const pixels = image();
    rectangle(pixels, 32, 10, 8, 12, 8, [20, 30, 80]);
    if (mode === 'gradient') {
      for (let x = 0; x < 32; x++) for (const y of [0, 23]) pixels.set([x * 8, 100, 170, 255], (y * 32 + x) * 4);
    } else if (mode === 'sides') rectangle(pixels, 32, 0, 0, 1, 24, [40, 130, 20]);
    else pixels.set([0, 0, 0, 255], 0);
    const result = removeCommercialLogoBackground(pixels, 32, 24);
    assert.equal(result.status, 'complex'); assert.equal(result.reason, 'non-uniform-border');
    assert.deepEqual(result.pixels, pixels);
  }
});

test('low contrast, blank and nearly empty images never become invisible', () => {
  for (const colour of [[255, 255, 255], [240, 240, 240], [220, 220, 220]] as RGB[]) {
    const pixels = image(); rectangle(pixels, 32, 10, 8, 12, 8, colour);
    const result = removeCommercialLogoBackground(pixels, 32, 24);
    assert.equal(result.status, 'complex'); assert.deepEqual(result.pixels, pixels);
  }
  const speck = image(100, 100); speck.set([0, 0, 0, 255], 5000 * 4);
  assert.equal(removeCommercialLogoBackground(speck, 100, 100).status, 'complex');
});

test('slight JPEG noise is removed and a matte fringe becomes a clean partial-alpha edge', () => {
  const pixels = image();
  for (let index = 0; index < 32 * 24; index++) {
    const value = 252 + index % 4; pixels.set([value, value, value, 255], index * 4);
  }
  rectangle(pixels, 32, 8, 6, 16, 12, [190, 190, 190]); // 25% black / 75% white.
  rectangle(pixels, 32, 9, 7, 14, 10, [0, 0, 0]);
  const original = pixels.slice(), result = removeCommercialLogoBackground(pixels, 32, 24);
  assert.equal(result.status, 'removed'); assert.ok(result.featheredPixels > 0);
  const edge = rgba(result.pixels, 32, 8, 10);
  assert.deepEqual(edge.slice(0, 3), [0, 0, 0]); assert.ok(edge[3] >= 60 && edge[3] <= 70);
  assert.deepEqual(rgba(result.pixels, 32, 14, 10), [0, 0, 0, 255]);
  assert.deepEqual(pixels, original);
  // Compositing on the original white matte still approximates its input edge.
  assert.ok(Math.abs((1 - edge[3] / 255) * result.background![0] - 190) <= 1);
});

test('a distinct coloured outline is retained rather than treated as a white fringe', () => {
  const pixels = image();
  rectangle(pixels, 32, 8, 6, 16, 12, [0, 170, 80]);
  rectangle(pixels, 32, 9, 7, 14, 10, [0, 0, 0]);
  const result = removeCommercialLogoBackground(pixels, 32, 24);
  assert.equal(result.status, 'removed');
  assert.deepEqual(rgba(result.pixels, 32, 8, 10), [0, 170, 80, 255]);
});

test('real JPEG chroma-ringing samples do not leave pale flecks outside the mark', () => {
  const pixels = image();
  rectangle(pixels, 32, 8, 6, 16, 12, [20, 70, 100]);
  // Decoded channel values from an actual quality-85 JPEG edge on white.
  const samples: RGB[] = [[232, 247, 254], [239, 243, 246], [244, 243, 238], [241, 255, 255]];
  samples.forEach((rgb, x) => pixels.set([...rgb, 255], (4 * 32 + 10 + x) * 4));
  const result = removeCommercialLogoBackground(pixels, 32, 24);
  assert.equal(result.status, 'removed');
  samples.forEach((_rgb, x) => assert.equal(rgba(result.pixels, 32, 10 + x, 4)[3], 0));
  assert.deepEqual(rgba(result.pixels, 32, 15, 10), [20, 70, 100, 255]);
});

test('repeated processing is stable and malformed dimensions are rejected', () => {
  const pixels = image(); rectangle(pixels, 32, 8, 6, 16, 12, [20, 30, 80]);
  const first = removeCommercialLogoBackground(pixels, 32, 24);
  const second = removeCommercialLogoBackground(first.pixels, 32, 24);
  assert.equal(second.status, 'transparent'); assert.deepEqual(second.pixels, first.pixels);
  assert.throws(() => removeCommercialLogoBackground(pixels, 1.5, 24), RangeError);
  assert.throws(() => removeCommercialLogoBackground(pixels, 0, 24), RangeError);
  assert.throws(() => removeCommercialLogoBackground(pixels.slice(1), 32, 24), RangeError);
});

test('pathological one-pixel strips retain their original without a large perimeter allocation', () => {
  for (const [width, height] of [[1, 32768], [65536, 1], [2, 16384]]) {
    const pixels = image(width, height), result = removeCommercialLogoBackground(pixels, width, height);
    assert.equal(result.status, 'complex'); assert.deepEqual(result.pixels, pixels);
  }
});
