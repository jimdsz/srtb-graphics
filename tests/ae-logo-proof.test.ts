import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifiedLogoDifference,logoProofFrames} from './ae-logo-proof';
const exact={frame:20,max:0,offContourChanged:0,interiorChanged:0,alphaMax:0,premultipliedMax:0,premultipliedMean:0};
test('settled logo equality rejects even a single 1/255 RGBA delta',()=>{
  assert.equal(qualifiedLogoDifference(exact),true);
  const measured={...exact,composition:'Anim_TV_Roll',bounds:null};
  assert.equal(qualifiedLogoDifference(measured),true);
  for(const max of [1,8,255])assert.equal(qualifiedLogoDifference({...exact,max}),false);
});
test('early contour tolerance never extends to interiors, displaced edges or large alpha errors',()=>{
  const early={...exact,frame:11,max:255,alphaMax:41,premultipliedMax:41,premultipliedMean:.004};
  assert.equal(qualifiedLogoDifference(early),true);
  for(const invalid of [{interiorChanged:1},{offContourChanged:1},{alphaMax:65},{premultipliedMax:65},{premultipliedMean:.011},{max:NaN}])
    assert.equal(qualifiedLogoDifference({...early,...invalid}),false);
});
test('every integer pose and both sides of all native held changes are included',()=>{
  assert.deepEqual(logoProofFrames,Array.from({length:80},(_,i)=>i));
  for(const key of [1,4,11,12,16,20])for(const frame of [key-1,key,key+1])assert.ok(logoProofFrames.includes(frame));
});
