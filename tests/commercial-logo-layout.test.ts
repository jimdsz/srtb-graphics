import test from 'node:test';
import assert from 'node:assert/strict';
import type {CommercialLogo} from '../src/studio/commercial/model';
import {canonicalCommercialLogo, commercialLogoBounds, commercialLogoPadding, editCommercialLogo,fitCommercialLogoToAsset} from '../src/studio/commercial/logo-layout';
import type {CommercialLogoSize} from '../src/studio/commercial/logo-layout';

const logo = (patch: Partial<CommercialLogo> = {}): CommercialLogo => ({url: 'local-media:logo', name: 'Annonceur.png', mode: 'original', position: 'bottom-right', scale: 1, offsetX: 0, offsetY: 0, ...patch});
const landscape = {width: 1920, height: 1080};
const square = {width: 200, height: 200};
const near = (a: number, b: number, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
const bounds = (value: CommercialLogo, size = landscape) => commercialLogoBounds(value, size.width, size.height);

test('a decoded wide logo is refitted before export without mutating its saved source settings', () => {
  const source=logo({presentation:'adaptive',position:'top-right',scale:4,plate:'showcase',removeBackground:true});
  const before=structuredClone(source),size={width:480,height:100},fitted=fitCommercialLogoToAsset(source,size);
  near(fitted.scale,3.4);assert.equal(fitted.position,'top-right');assert.deepEqual(source,before);
  const box=bounds(fitted,size),pad=commercialLogoPadding(fitted);
  near(box.x+box.width/2+pad,1824);near(box.y-box.height/2-pad,96);
  assert.deepEqual(fitCommercialLogoToAsset(fitted,size),fitted);
  const legacy=logo({position:'top-right',scale:4});
  assert.equal(fitCommercialLogoToAsset(legacy,size),legacy);
});

function safe(value: CommercialLogo, size: CommercialLogoSize) {
  const b = bounds(value, size), pad = value.plate && value.plate !== 'none' ? 12 : 0;
  assert.ok(b.x - b.width / 2 - pad >= 96 - 1e-7);
  assert.ok(b.x + b.width / 2 + pad <= 1824 + 1e-7);
  assert.ok(b.y - b.height / 2 - pad >= 96 - 1e-7);
  assert.ok(b.y + b.height / 2 + pad <= 984 + 1e-7);
  assert.ok(b.x - b.width / 2 - pad >= 960 - 1e-7 || b.y - b.height / 2 - pad >= 540 - 1e-7, 'The whole image and plate must avoid the reserved upper-left quadrant');
  assert.ok(Math.abs(value.offsetX!) <= 600 && Math.abs(value.offsetY!) <= 400);
  const originX = value.position === 'bottom-center' ? 960 : 1704, originY = value.position === 'top-right' ? 136 : 944;
  near(b.x, originX + value.offsetX!); near(b.y, originY + value.offsetY!);
}

test('legacy geometry keeps the original frame and quadrant clamps', () => {
  assert.deepEqual(bounds(logo()), {x: 1704, y: 944, width: 142.22222222222223, height: 80});
  assert.deepEqual(bounds(logo({position: 'bottom-center'})), {x: 960, y: 944, width: 142.22222222222223, height: 80});
  assert.deepEqual(bounds(logo({position: 'top-right'})), {x: 1704, y: 136, width: 142.22222222222223, height: 80});
  assert.deepEqual(bounds(logo({position: 'bottom-center', offsetX: -60, offsetY: -384}), square), {x: 1000, y: 560, width: 80, height: 80});
  assert.deepEqual(bounds(logo({position: 'top-right', scale: 4}), {width: 400, height: 100}), {x: 1344, y: 660, width: 960, height: 240});
  assert.deepEqual(bounds(logo({position: 'top-right', scale: 4, plate: 'white'}), {width: 400, height: 100}), {x: 1332, y: 672, width: 960, height: 240});
});

test('the reported 370 percent logo immediately responds to a one-pixel edit', () => {
  const original = logo({scale: 3.7, offsetX: 348, offsetY: 334, opacity: .8, motion: 'slide', delay: 1.2});
  const snapshot = {...original}, effective = canonicalCommercialLogo(original, landscape), before = bounds(original);
  near(before.x, 1560.888888888889); near(before.y, 836);
  near(effective.offsetX!, -143.1111111111111); near(effective.offsetY!, -108);
  assert.deepEqual(bounds(effective), before); assert.deepEqual(original, snapshot);
  assert.equal(effective.opacity, .8); assert.equal(effective.motion, 'slide'); assert.equal(effective.delay, 1.2);
  const left = editCommercialLogo(original, {offsetX: effective.offsetX! - 1}, landscape);
  const up = editCommercialLogo(original, {offsetY: effective.offsetY! - 1}, landscape);
  near(bounds(left).x, before.x - 1); near(bounds(up).y, before.y - 1);
  assert.equal(left.scale, 3.7); assert.equal(left.url, original.url);
});

test('canonicalization preserves the visible image and only reanchors an unrepresentable legacy point', () => {
  const wide = {width: 400, height: 100};
  const original = logo({position: 'top-right', scale: 4});
  const effective = canonicalCommercialLogo(original, wide);
  assert.equal(effective.position, 'bottom-right');
  assert.deepEqual(bounds(effective, wide), bounds(original, wide));
  assert.deepEqual(canonicalCommercialLogo(effective, wide), effective);
  safe(effective, wide);
  for (const position of ['bottom-right', 'bottom-center', 'top-right'] as const) {
    const normal = logo({position, scale: 2, offsetX: -100});
    assert.equal(canonicalCommercialLogo(normal, landscape).position, position);
  }
});

test('editing uses the nearest permitted boundary instead of always jumping right', () => {
  const base = logo({position: 'bottom-center'});
  const bottom = editCommercialLogo(base, {offsetX: -60, offsetY: -384}, square);
  near(bounds(bottom, square).x, 900); near(bounds(bottom, square).y, 580);
  const right = editCommercialLogo(base, {offsetX: 20, offsetY: -400}, square);
  near(bounds(right, square).x, 1000); near(bounds(right, square).y, 544);
  const plate = editCommercialLogo(base, {offsetX: -60, offsetY: -384, plate: 'white'}, square);
  near(bounds(plate, square).x, 900); near(bounds(plate, square).y, 592);
  safe(bottom, square); safe(right, square); safe(plate, square);
});

test('preset changes keep the requested anchor whenever a safe point is representable', () => {
  const base = logo({scale: 4, offsetX: 100, offsetY: 100});
  for (const position of ['bottom-right', 'bottom-center', 'top-right'] as const) {
    const result = editCommercialLogo(base, {position, offsetX: 0, offsetY: 0}, landscape);
    assert.equal(result.position, position); safe(result, landscape);
  }
  const centered = editCommercialLogo(logo(), {position: 'bottom-center', offsetX: 0, offsetY: 0}, landscape);
  near(bounds(centered).x, 960); near(bounds(centered).y, 944);
  const impossible = editCommercialLogo(base, {position: 'top-right', offsetX: 0, offsetY: 0}, {width: 400, height: 100});
  assert.notEqual(impossible.position, 'top-right'); safe(impossible, {width: 400, height: 100});
  const exactFit = editCommercialLogo(base, {position: 'top-right', scale: 3.6, offsetX: 0, offsetY: 0}, {width: 400, height: 100});
  assert.equal(exactFit.position, 'top-right'); near(bounds(exactFit, {width: 400, height: 100}).x, 1392);
});

test('an ultra-wide legacy image in the anchor gap is preserved until the first edit', () => {
  const size = {width: 10000, height: 1};
  const original = logo({position: 'top-right', scale: 3.7, offsetX: -600, offsetY: -400});
  const before = bounds(original, size), canonical = canonicalCommercialLogo(original, size);
  near(before.y, 540.0444);
  assert.deepEqual(bounds(canonical, size), before);
  assert.deepEqual(canonicalCommercialLogo(JSON.parse(JSON.stringify(canonical)), size), canonical);
  assert.equal(canonical.offsetX, -324); assert.equal(canonical.offsetY, 400);
  const edited = editCommercialLogo(original, {offsetX: canonical.offsetX! - 1}, size);
  near(bounds(edited, size).x, before.x - 1);
  near(bounds(edited, size).y, 544);
  assert.ok(Math.abs(bounds(edited, size).y - before.y) <= 4);
  assert.equal(edited.position, 'bottom-right'); safe(edited, size);
  const next = editCommercialLogo(edited, {offsetX: edited.offsetX! - 1, offsetY: edited.offsetY! + 1}, size);
  near(bounds(next, size).x, bounds(edited, size).x - 1);
  near(bounds(next, size).y, bounds(edited, size).y + 1);
});

test('resizing and repeated edits store attainable coordinates without accumulating dead offsets', () => {
  let current = logo({scale: 3.7, offsetX: 348, offsetY: 334});
  current = editCommercialLogo(current, {scale: 4}, landscape);
  safe(current, landscape);
  for (let i = 0; i < 10; i++) current = editCommercialLogo(current, {offsetX: current.offsetX! + 50}, landscape);
  const edge = bounds(current);
  const reversed = editCommercialLogo(current, {offsetX: current.offsetX! - 1}, landscape);
  near(bounds(reversed).x, edge.x - 1);
  const smaller = editCommercialLogo(reversed, {scale: 1}, landscape);
  near(bounds(smaller).x, bounds(reversed).x); near(bounds(smaller).y, bounds(reversed).y);
  assert.deepEqual(editCommercialLogo(smaller, {}, landscape), smaller);
});

test('adaptive top-right resizing preserves top and right margins rather than the old center', () => {
  const frame = (value: CommercialLogo, size: CommercialLogoSize) => {
    const box = bounds(value, size), pad = commercialLogoPadding(value);
    return {right: box.x + box.width / 2 + pad, top: box.y - box.height / 2 - pad};
  };
  for (const size of [{width: 480, height: 100}, square, {width: 240, height: 800}]) {
    for (const offsets of [{offsetX: 0, offsetY: 0}, {offsetX: -80, offsetY: 70}]) {
      const original = logo({presentation: 'adaptive', position: 'top-right', plate: 'showcase', ...offsets});
      const before = frame(original, size);
      const smaller = editCommercialLogo(original, {scale: .5}, size);
      const larger = editCommercialLogo(smaller, {scale: 1.7}, size);
      for (const resized of [smaller, larger]) {
        assert.equal(resized.position, 'top-right');
        near(frame(resized, size).right, before.right); near(frame(resized, size).top, before.top);
        near(resized.offsetX!, offsets.offsetX); near(resized.offsetY!, offsets.offsetY);
      }
      const moved = editCommercialLogo(smaller, {offsetX: smaller.offsetX! - 10, offsetY: smaller.offsetY! + 12}, size);
      near(frame(moved, size).right, before.right - 10); near(frame(moved, size).top, before.top + 12);
    }
  }
});

test('an oversized adaptive top-right choice or resize keeps the requested corner at its attainable scale', () => {
  const size = {width: 480, height: 100};
  for (const plate of ['none', 'showcase'] as const) {
    const maximum = plate === 'none' ? 3.6 : 3.4;
    const original = logo({presentation: 'adaptive', scale: 4, plate});
    const chosen = editCommercialLogo(original, {position: 'top-right', offsetX: 0, offsetY: 0}, size);
    const grown = editCommercialLogo(logo({presentation: 'adaptive', position: 'top-right', plate}), {scale: 4}, size);
    for (const result of [chosen, grown]) {
      const box = bounds(result, size), pad = commercialLogoPadding(result);
      assert.equal(result.position, 'top-right'); near(result.scale, maximum);
      near(box.x + box.width / 2 + pad, 1824);
      near(box.y - box.height / 2 - pad, 96);
      near(box.x - box.width / 2 - pad, 960);
      near(box.width / box.height, size.width / size.height);
      assert.ok(box.y + box.height / 2 + pad <= 984);
      assert.equal(result.alignment, undefined);
    }
  }
});

test('adding an adaptive support fits a very wide top-right logo without switching its placement', () => {
  const size = {width: 480, height: 100};
  const original = logo({presentation: 'adaptive', position: 'top-right', scale: 3.6, plate: 'none'});
  for (const plate of ['showcase', 'auto', 'white', 'black'] as const) {
    const result = editCommercialLogo(original, {plate}, size), box = bounds(result, size), pad = commercialLogoPadding(result);
    assert.equal(result.position, 'top-right'); near(result.scale, 3.4);
    near(box.x - box.width / 2 - pad, 960);
    near(box.x + box.width / 2 + pad, 1824);
    assert.ok(box.y - box.height / 2 - pad >= 96 - 1e-7);
    assert.ok(box.y + box.height / 2 + pad <= 984 + 1e-7);
  }
});

test('every aspect, anchor, size, plate and offset extreme stays inside the frame and canonical', () => {
  const sizes = [landscape, square, {width: 400, height: 100}, {width: 100, height: 400}, {width: 1237, height: 333}, {width: 1, height: 10000}, {width: 10000, height: 1}];
  for (const size of sizes) for (const position of ['bottom-right', 'bottom-center', 'top-right'] as const) {
    for (const scale of [.25, 1, 3.7, 4]) for (const plate of ['none', 'white'] as const) {
      for (const offsetX of [-600, -100, 0, 348, 600]) for (const offsetY of [-400, -100, 0, 334, 400]) {
        const original = logo({position, scale, plate, offsetX, offsetY});
        let canonical: CommercialLogo;
        try { canonical = canonicalCommercialLogo(original, size); }
        catch (error) { throw new Error(JSON.stringify({size, original, bounds: bounds(original, size)}), {cause: error}); }
        const before = bounds(original, size), after = bounds(canonical, size);
        near(after.x, before.x); near(after.y, before.y);
        assert.deepEqual(canonicalCommercialLogo(canonical, size), canonical);
        const edited = editCommercialLogo(canonical, {offsetX, offsetY}, size);
        safe(edited, size);
        assert.deepEqual(canonicalCommercialLogo(edited, size), edited);
        assert.deepEqual(editCommercialLogo(edited, {}, size), edited);
      }
    }
  }
});

test('invalid dimensions fail explicitly and numeric edits remain within model limits', () => {
  for (const size of [{width: 0, height: 1}, {width: 1, height: NaN}, {width: Infinity, height: 1}]) {
    assert.throws(() => canonicalCommercialLogo(logo(), size), RangeError);
    assert.throws(() => editCommercialLogo(logo(), {}, size), RangeError);
  }
  const result = editCommercialLogo(logo(), {offsetX: Infinity, offsetY: NaN, scale: 99}, landscape);
  assert.equal(result.scale, 4); safe(result, landscape);
});

test('seeded continuous cases survive JSON save/reload and remain stable after repeated edits', () => {
  let seed = 0x70C0FFEE;
  const random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000;};
  const positions = ['bottom-right', 'bottom-center', 'top-right'] as const;
  for (let i = 0; i < 10000; i++) {
    const size = {width: 10 ** (random() * 5), height: 10 ** (random() * 5)};
    const original = logo({position: positions[Math.floor(random() * 3)], scale: .25 + random() * 3.75, offsetX: random() * 1200 - 600, offsetY: random() * 800 - 400, plate: random() < .5 ? 'none' : 'white'});
    const canonical = canonicalCommercialLogo(original, size);
    near(bounds(canonical, size).x, bounds(original, size).x);
    near(bounds(canonical, size).y, bounds(original, size).y);
    assert.deepEqual(canonicalCommercialLogo(JSON.parse(JSON.stringify(canonical)), size), canonical);
    const position = positions[Math.floor(random() * 3)];
    const edited = editCommercialLogo(canonical, {position, scale: .25 + random() * 3.75, offsetX: random() * 1200 - 600, offsetY: random() * 800 - 400}, size);
    const reloaded: CommercialLogo = JSON.parse(JSON.stringify(edited));
    safe(reloaded, size);
    assert.deepEqual(canonicalCommercialLogo(reloaded, size), edited);
    assert.deepEqual(editCommercialLogo(reloaded, {}, size), edited);
    const pad = edited.plate === 'none' ? 0 : 12;
    if (position !== 'top-right' || bounds(edited, size).width + pad * 2 <= 864) assert.equal(edited.position, position);
  }
});
