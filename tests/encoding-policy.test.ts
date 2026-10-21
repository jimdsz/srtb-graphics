import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOpaqueConfig,assertOpaqueMeasuredBitrate,needsOpaqueCbrFallback,opaqueEncoding,opaqueMeasuredFloor,OPAQUE_BITRATE,OPAQUE_MINIMUM_MEASURED_BITRATE} from '../src/studio/video/encoding-policy.ts';
test('every opaque video requests H264 at 50Mbps constant without dropping frames',()=>{
  const config=opaqueEncoding();assert.equal(config.codec,'avc');assert.equal(config.alpha,'discard');assert.equal(config.latencyMode,'quality');
  assert.equal(OPAQUE_BITRATE,50_000_000);
  assert.equal(OPAQUE_MINIMUM_MEASURED_BITRATE,30_000_000);
  assert.doesNotThrow(()=>assertOpaqueConfig({codec:'avc1.640033',width:1920,height:1080,bitrate:50_000_000,bitrateMode:'constant'}));
  for(const [bitrate,bitrateMode]of [[20_000_000,'constant'],[50_000_000,'variable']] as const)assert.throws(()=>assertOpaqueConfig({codec:'avc1.640033',width:1920,height:1080,bitrate,bitrateMode}));
});
test('the measured bitrate floor triggers only below 30Mbps',()=>{
  assert.equal(needsOpaqueCbrFallback(29_999_999),true);assert.equal(needsOpaqueCbrFallback(30_000_000),false);assert.equal(needsOpaqueCbrFallback(50_000_000),false);
  assert.throws(()=>assertOpaqueMeasuredBitrate(29_999_999));assert.doesNotThrow(()=>assertOpaqueMeasuredBitrate(30_000_000));assert.throws(()=>needsOpaqueCbrFallback(Number.NaN));
});
test('sub-second clips use their global average and partial tails do not invent a window floor',()=>{
  assert.equal(opaqueMeasuredFloor(31_000_000),31_000_000);assert.equal(needsOpaqueCbrFallback(opaqueMeasuredFloor(31_000_000)),false);
  assert.equal(needsOpaqueCbrFallback(opaqueMeasuredFloor(29_999_999)),true);assert.equal(opaqueMeasuredFloor(49_000_000,30_000_000),30_000_000);
});
