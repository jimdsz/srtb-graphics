import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseCommercialAvcc} from '../src/studio/commercial/avc-repair';

const bytes = (hex: string) => Uint8Array.from(hex.split(' ').map(n => parseInt(n, 16)));
test('repairs the documented Firefox AVCC header defect without touching NAL contents', () => {
  const bad = bytes('01 64 00 0d 03 01 00 1a 67 67 64 00 0d ac 2c ac 14 1f a1 00 00 03 00 01 00 00 03 00 3c 0d a0 88 45 38 01 00 05 68 68 ce 3c 30');
  const expected = bytes('01 64 00 0d ff e1 00 19 67 64 00 0d ac 2c ac 14 1f a1 00 00 03 00 01 00 00 03 00 3c 0d a0 88 45 38 01 00 04 68 ce 3c 30');
  assert.deepEqual(normaliseCommercialAvcc(bad), expected);
  assert.equal(normaliseCommercialAvcc(expected), undefined);
});
test('valid Chromium AVCC including high profile extension passes through untouched', () => {
  const valid = bytes('01 64 00 14 ff e1 00 16 67 64 00 14 ac 2b 40 a0 fd 80 88 00 00 1f 40 00 07 53 00 78 e1 15 01 00 04 68 ee 3c b0 fd f8 f8 00');
  assert.equal(normaliseCommercialAvcc(valid), undefined);
});
test('malformed NAL length fails explicitly without speculative repair', () => {
  assert.throws(() => normaliseCommercialAvcc(bytes('01 64 00 14 ff e1 7f ff 67 64 00 14')), /invalide/);
  assert.throws(() => normaliseCommercialAvcc(bytes('01 64 00 14 ff e1 00 04 67 64 00 14 01 00')), /incomplet/);
});
test('a valid PPS payload starting with 68 is not confused with the Firefox defect', () => {
  assert.equal(normaliseCommercialAvcc(bytes('01 64 00 14 ff e1 00 04 67 64 00 14 01 00 05 68 68 ce 3c 30')), undefined);
});
