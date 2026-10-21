import test from 'node:test';
import assert from 'node:assert/strict';
import type {CommercialLogo} from '../src/studio/commercial/model';
import {DEFAULT_COMMERCIAL_DATA, normalizeCommercialData, validateCommercialData} from '../src/studio/commercial/model';
import {editCommercialElement} from '../src/studio/commercial/editing';
import {analyzeCommercialLogoPixels, commercialLogoQuality, paintCommercialLogo} from '../src/studio/commercial/logo-presentation';
import type {CommercialLogoAsset} from '../src/studio/commercial/logo-presentation';
import {commercialLogoBounds, commercialLogoDimensions, commercialLogoPadding, canonicalCommercialLogo, editCommercialLogo, COMMERCIAL_FOOTER_BASELINE} from '../src/studio/commercial/logo-layout';

const logo = (patch: Partial<CommercialLogo> = {}): CommercialLogo => ({url: 'test:logo', name: 'Annonceur.png', mode: 'original', position: 'bottom-right', scale: 1, presentation: 'adaptive', plate: 'auto', ...patch});
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} differs from ${b}`);
function fixture(width: number, height: number, rectangle: {x: number; y: number; width: number; height: number}, color = [20, 80, 100, 255]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = rectangle.y; y < rectangle.y + rectangle.height; y++) for (let x = rectangle.x; x < rectangle.x + rectangle.width; x++) pixels.set(color, (y * width + x) * 4);
  return pixels;
}

test('large transparent margins crop to the exact artwork without changing RGBA', () => {
  const rectangle = {x: 500, y: 411, width: 416, height: 118};
  const pixels = fixture(1600, 1000, rectangle), before = pixels.slice();
  assert.deepEqual(analyzeCommercialLogoPixels(pixels, 1600, 1000).crop, rectangle);
  assert.deepEqual(pixels, before);
});

test('even one alpha-level of shadow is retained; fully transparent RGB is ignored', () => {
  const pixels = fixture(40, 20, {x: 10, y: 5, width: 20, height: 10});
  pixels.set([255, 255, 255, 0], 0);
  pixels.set([0, 0, 0, 1], (2 * 40 + 3) * 4);
  assert.deepEqual(analyzeCommercialLogoPixels(pixels, 40, 20).crop, {x: 3, y: 2, width: 27, height: 13});
});

test('white and opaque backgrounds remain intact and blend with a neutral support', () => {
  const white = fixture(100, 80, {x: 0, y: 0, width: 100, height: 80}, [255, 255, 255, 255]);
  white.set([10, 40, 100, 255], (40 * 100 + 50) * 4);
  const result = analyzeCommercialLogoPixels(white, 100, 80);
  assert.deepEqual(result.crop, {x: 0, y: 0, width: 100, height: 80});
  assert.equal(result.autoPlate, 'white'); assert.equal(result.hasTransparency, false);
  const black = fixture(20, 20, {x: 0, y: 0, width: 20, height: 20}, [0, 0, 0, 255]);
  assert.equal(analyzeCommercialLogoPixels(black, 20, 20).autoPlate, 'black');
});

test('white transparent artwork chooses black and dark artwork chooses white', () => {
  const rectangle = {x: 2, y: 2, width: 16, height: 16};
  const white = fixture(20, 20, rectangle, [255, 255, 255, 255]), dark = fixture(20, 20, rectangle, [10, 10, 10, 255]);
  assert.equal(analyzeCommercialLogoPixels(white, 20, 20).autoPlate, 'black');
  assert.equal(analyzeCommercialLogoPixels(dark, 20, 20).autoPlate, 'white');
  // A transparent source border around a solid opaque box is not a cut-out logo.
  assert.equal(analyzeCommercialLogoPixels(white, 20, 20).hasTransparency, false);
  white[(10 * 20 + 10) * 4 + 3] = 0;
  assert.equal(analyzeCommercialLogoPixels(white, 20, 20).hasTransparency, true);
});

test('empty artwork and malformed RGBA buffers are detected explicitly', () => {
  assert.equal(analyzeCommercialLogoPixels(new Uint8ClampedArray(16), 2, 2).crop, null);
  assert.throws(() => analyzeCommercialLogoPixels(new Uint8ClampedArray(12), 2, 2), RangeError);
  assert.throws(() => analyzeCommercialLogoPixels(new Uint8ClampedArray(), 0, 0), RangeError);
});

test('horizontal, square and vertical logos retain aspect ratio and fit the reserved footer', () => {
  for (const size of [{width: 555, height: 156}, {width: 428, height: 428}, {width: 240, height: 800}, {width: 10000, height: 1}]) {
    const bounds = commercialLogoBounds(logo(), size.width, size.height), pad = commercialLogoPadding(logo());
    near(bounds.width / bounds.height, size.width / size.height);
    assert.ok(bounds.width <= 240 && bounds.height <= 180); assert.equal(pad, 24);
    assert.ok(bounds.y - bounds.height / 2 - pad >= 756);
    near(bounds.y + bounds.height / 2 + pad, 984);
    near(bounds.x + bounds.width / 2 + pad, 1824);
  }
  const square = commercialLogoDimensions(logo(), 428, 428);
  near(square.width, 120); near(square.height, 120);
  const portrait = commercialLogoDimensions(logo(), 240, 800);
  near(portrait.width, 54); near(portrait.height, 180);
  const horizontal = commercialLogoDimensions(logo(), 555, 156);
  near(horizontal.width * horizontal.height, 12000);
});

test('visible logo baseline stays aligned across shapes and supports, including old vertical offsets', () => {
  for (const size of [{width:555,height:156},{width:428,height:428},{width:240,height:800}]) {
    for (const position of ['bottom-right','bottom-center'] as const) {
      for (const plate of ['auto','none','white','black'] as const) {
        const setting=logo({position,plate}),bounds=commercialLogoBounds(setting,size.width,size.height);
        near(bounds.y+bounds.height/2,COMMERCIAL_FOOTER_BASELINE);
        assert.ok(bounds.y+bounds.height/2+commercialLogoPadding(setting)<=984);
        const moved=commercialLogoBounds({...setting,offsetY:-20},size.width,size.height);
        near(moved.y+moved.height/2,COMMERCIAL_FOOTER_BASELINE);
        const free=commercialLogoBounds({...setting,alignment:'free',offsetY:-20},size.width,size.height);
        near(free.y+free.height/2,COMMERCIAL_FOOTER_BASELINE-20);
      }
    }
    const top=logo({position:'top-right'}),bounds=commercialLogoBounds(top,size.width,size.height);
    near(bounds.y-bounds.height/2-commercialLogoPadding(top),96);
  }
});

test('free adaptive dragging stays canonical at all edges, and reverses immediately', () => {
  for (const size of [{width: 555, height: 156}, {width: 428, height: 428}, {width: 240, height: 800}, {width: 10000, height: 1}, {width: 1, height: 10000}]) {
    for (const position of ['bottom-right', 'bottom-center', 'top-right'] as const) for (const scale of [.25, 1, 3.7, 4]) {
      for (const plate of ['auto', 'none', 'white'] as const) for (const offsetX of [-600, 0, 600]) for (const offsetY of [-400, 0, 400]) {
        const next = editCommercialLogo(logo({position, scale, plate, alignment:'free'}), {offsetX, offsetY}, size);
        const b = commercialLogoBounds(next, size.width, size.height), pad = commercialLogoPadding(next);
        assert.ok(b.x - b.width / 2 - pad >= 96 - 1e-7); assert.ok(b.x + b.width / 2 + pad <= 1824 + 1e-7);
        assert.ok(b.y - b.height / 2 - pad >= 96 - 1e-7); assert.ok(b.y + b.height / 2 + pad <= 984 + 1e-7);
        assert.ok(b.x - b.width / 2 - pad >= 960 - 1e-7 || b.y - b.height / 2 - pad >= 540 - 1e-7);
        assert.deepEqual(canonicalCommercialLogo(next, size), next);
        assert.deepEqual(editCommercialLogo(next, {}, size), next);
      }
    }
    const edge = editCommercialLogo(logo({scale: 3.7, offsetX: 348, offsetY: 334}), {offsetX: 600, offsetY: 400}, size);
    const reverse = editCommercialLogo(edge, {offsetX: edge.offsetX! - 1}, size);
    near(commercialLogoBounds(reverse, size.width, size.height).x, commercialLogoBounds(edge, size.width, size.height).x - 1);
  }
});

test('quality checks use cropped pixels, not the original transparent canvas', () => {
  const low = commercialLogoQuality(logo(), {width: 96, height: 32, originalWidth: 1920, originalHeight: 1080, cropped: true});
  assert.equal(low.enlarged, true); assert.match(low.message!, /96 × 32/);
  assert.equal(commercialLogoQuality(logo(), {width: 428, height: 428}).message, null);
  assert.equal(commercialLogoQuality(logo({scale: 4}), {width: 200, height: 200}).enlarged, true);
});

test('automatic resizing grows upward from the footer and preserves the right margin', () => {
  const size = {width: 428, height: 428}, value = logo({scale: 4});
  const reset = editCommercialLogo(value, {scale: 1, offsetX: 0, offsetY: 0}, size);
  assert.equal(reset.offsetX, 0); assert.equal(reset.offsetY, 0);
  assert.deepEqual(commercialLogoBounds(reset, size.width, size.height), commercialLogoBounds(logo(), size.width, size.height));
  const smaller = editCommercialLogo(value, {scale: 1}, size), before = commercialLogoBounds(value, size.width, size.height), after = commercialLogoBounds(smaller, size.width, size.height);
  near(after.x + after.width / 2, before.x + before.width / 2);
  near(after.y + after.height / 2, before.y + before.height / 2);
  near(after.y + after.height / 2, COMMERCIAL_FOOTER_BASELINE);
});

test('all resize controls, repeated support changes and JSON reloads share the same baseline', () => {
  for (const size of [{width:555,height:156},{width:428,height:428},{width:240,height:800}]) {
    for (const position of ['bottom-right','bottom-center'] as const) {
      let setting = logo({position,offsetX:-45,offsetY:-120});
      for (const scale of [4,.25,1.75,1,3.7,.5,1]) for (const plate of ['none','auto'] as const) {
        const panel = editCommercialLogo(setting,{scale,plate},size);
        const canvas = editCommercialElement({...DEFAULT_COMMERCIAL_DATA,logo:{...setting,plate}},{kind:'logo',page:-1},{scale},size).logo!;
        const b = commercialLogoBounds(panel,size.width,size.height), c = commercialLogoBounds(canvas,size.width,size.height);
        near(b.y+b.height/2,COMMERCIAL_FOOTER_BASELINE); near(c.y+c.height/2,COMMERCIAL_FOOTER_BASELINE);
        near(b.x,c.x); near(b.y,c.y); assert.equal(panel.offsetY,0);
        const padded = commercialLogoPadding(panel);
        assert.ok(b.x-b.width/2-padded>=96-1e-7 && b.x+b.width/2+padded<=1824+1e-7);
        assert.ok(b.x-b.width/2-padded>=960-1e-7 || b.y-b.height/2-padded>=540-1e-7);
        setting = normalizeCommercialData(JSON.parse(JSON.stringify({...DEFAULT_COMMERCIAL_DATA,logo:panel}))).logo!;
        assert.deepEqual(commercialLogoBounds(setting,size.width,size.height),b);
      }
    }
  }
});

test('automatic dragging is horizontal and never accumulates a hidden vertical offset', () => {
  const size={width:555,height:156},before=logo({offsetX:-50,offsetY:-120});
  const edited=editCommercialLogo(before,{offsetX:-75,offsetY:-300},size);
  near(edited.offsetX!,-75); assert.equal(edited.offsetY,0);
  const bounds=commercialLogoBounds(edited,size.width,size.height);
  near(bounds.y+bounds.height/2,COMMERCIAL_FOOTER_BASELINE);
  assert.deepEqual(canonicalCommercialLogo(edited,size),edited);
  const free=editCommercialLogo(edited,{alignment:'free',offsetY:0},size);
  assert.deepEqual(commercialLogoBounds(free,size.width,size.height),bounds);
  const moved=editCommercialLogo(free,{offsetY:-50},size);
  near(commercialLogoBounds(moved,size.width,size.height).y,bounds.y-50);
  const aligned=editCommercialLogo(moved,{alignment:undefined},size);
  assert.equal(aligned.offsetY,0);
  assert.deepEqual(commercialLogoBounds(aligned,size.width,size.height),bounds);
});

test('free placement survives the project contract; invalid alignment is rejected', () => {
  const data={...DEFAULT_COMMERCIAL_DATA,logo:logo({alignment:'free',offsetY:-120})};
  const normalized=normalizeCommercialData(JSON.parse(JSON.stringify(data)));
  assert.equal(normalized.logo?.alignment,'free'); assert.equal(normalized.logo?.offsetY,-120);
  assert.deepEqual(validateCommercialData(normalized,{draft:true}),[]);
  assert.ok(validateCommercialData({...data,logo:{...data.logo,alignment:'arbitrary'}},{draft:true}).some(error=>error.includes('alignement')));
});

test('a wide top-right logo reanchors without opting into automatic footer alignment', () => {
  const size={width:480,height:100},value=logo({position:'top-right',scale:4});
  const before=commercialLogoBounds(value,size.width,size.height);
  const canonical=canonicalCommercialLogo(value,size),edited=editCommercialLogo(value,{},size);
  assert.equal(canonical.position,'bottom-right'); assert.equal(canonical.alignment,'free');
  assert.deepEqual(commercialLogoBounds(canonical,size.width,size.height),before);
  const afterEdit=commercialLogoBounds(edited,size.width,size.height);
  near(afterEdit.x,before.x); near(afterEdit.y,before.y);
  near(afterEdit.width,before.width); near(afterEdit.height,before.height);
  assert.deepEqual(canonicalCommercialLogo(canonical,size),canonical);
  const reset=editCommercialLogo(edited,{alignment:undefined,position:'bottom-right',offsetY:0},size);
  const aligned=commercialLogoBounds(reset,size.width,size.height);
  near(aligned.y+aligned.height/2,COMMERCIAL_FOOTER_BASELINE);
});

test('direct rendering of a large centered portrait stays aligned at fractional sizes', () => {
  for (const scale of [2.55,3.05,3.7,4]) for (const plate of ['none','auto'] as const) {
    const setting=logo({position:'bottom-center',scale,plate,offsetX:-600,offsetY:-120});
    const bounds=commercialLogoBounds(setting,240,800),pad=commercialLogoPadding(setting);
    near(bounds.y+bounds.height/2,COMMERCIAL_FOOTER_BASELINE);
    assert.ok(bounds.x-bounds.width/2-pad>=960);
    assert.ok(bounds.y+bounds.height/2+pad<=984);
    const canonical=canonicalCommercialLogo(setting,{width:240,height:800});
    assert.deepEqual(commercialLogoBounds(canonical,240,800),bounds);
  }
});

test('paint uses exact artwork geometry and full adaptive opacity, while legacy retains .92', () => {
  let alphaAtDraw = 0, fill = '', rect: number[] = [], drawn: unknown[] = [];
  const context = {globalAlpha: 1, fillStyle: '', save() {}, restore() {}, beginPath() {}, roundRect(...args: number[]) {rect = args;}, fill() {fill = this.fillStyle;}, drawImage(...args: unknown[]) {alphaAtDraw = this.globalAlpha; drawn = args;}} as unknown as CanvasRenderingContext2D;
  const asset = {image: {} as ImageBitmap, width: 428, height: 428, originalWidth: 512, originalHeight: 512, cropped: true, hasTransparency: true, autoPlate: 'white', dispose() {}} satisfies CommercialLogoAsset;
  const value = logo(), result = paintCommercialLogo(context, asset, value);
  assert.equal(alphaAtDraw, 1); assert.equal(fill, '#ffffff');
  near(rect[2], result.width + 48); near(rect[3], result.height + 48); assert.equal(rect[4], 10);
  assert.deepEqual(drawn, [asset.image, result.x - result.width / 2, result.y - result.height / 2, result.width, result.height]);
  const legacy = logo({presentation: undefined, plate: 'none'}); context.globalAlpha = 1;
  paintCommercialLogo(context, asset, legacy); assert.equal(alphaAtDraw, .92);
  context.globalAlpha = 1; paintCommercialLogo(context, asset, value, {alpha: .5}); assert.equal(alphaAtDraw, .5);
});
