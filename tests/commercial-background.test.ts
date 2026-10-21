import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialBackgroundTime} from '../src/studio/commercial/background';
import {commercialTimeline, DEFAULT_COMMERCIAL_DATA} from '../src/studio/commercial/model';

const sourceDuration = 89.9899;
const data = (duration: number) => ({...DEFAULT_COMMERCIAL_DATA, duration});

test('voice duration never changes background speed or the opening-to-reading motion', () => {
  for (let frame = 0; frame < 60 * 29.97; frame++) {
    const seconds = frame / 29.97;
    const short = commercialBackgroundTime(data(60), sourceDuration, seconds);
    for (const duration of [90, 180, 600]) {
      const long = commercialBackgroundTime(data(duration), sourceDuration, seconds);
      assert.equal(long.time, short.time);
      assert.equal(long.rate, 1);
    }
  }
});

test('closing a long announcement does not jump or accelerate its moving background', () => {
  for (const duration of [120, 180, 300, 600]) {
    const closing = commercialTimeline(duration).closingStart;
    const before = commercialBackgroundTime(data(duration), sourceDuration, closing - .01);
    const after = commercialBackgroundTime(data(duration), sourceDuration, closing + .01);
    assert.equal(before.index, after.index);
    assert.ok(Math.abs(after.time - before.time - .02) < 1e-9);
    assert.equal(after.rate, 1);
  }
});

test('long readings loop safely after the opening without freezing the terminal frame', () => {
  for (let frame = 0; frame < 600 * 29.97; frame++) {
    const seconds = frame / 29.97, point = commercialBackgroundTime(data(600), sourceDuration, seconds);
    assert.ok(point.time >= 0 && point.time < sourceDuration);
    assert.ok(point.nextTime >= 0 && point.nextTime < sourceDuration);
    assert.ok(point.blend >= 0 && point.blend <= 1);
    if (seconds >= sourceDuration) assert.ok(point.time >= 4);
    if (point.blend > 0) assert.ok(point.nextTime >= 4);
    assert.equal(point.rate, 1);
  }
});
