import test from 'node:test';
import assert from 'node:assert/strict';
import {previewDisplayEdge} from '../src/studio/preview-resolution';

test('social raster follows displayed image size and density, not the logical export size',()=>{
  assert.equal(previewDisplayEdge(180,320,1080,1920,1,1280),320);
  assert.equal(previewDisplayEdge(180,320,1080,1920,2,1280),640);
  assert.equal(previewDisplayEdge(432,768,1080,1920,1,1280),768);
  assert.equal(previewDisplayEdge(432,768,1080,1920,1.25,1280),960);
  assert.equal(previewDisplayEdge(432,768,1080,1920,3,1280),1280);
  assert.equal(previewDisplayEdge(1080,1920,1080,1920,2,640),640);
});
test('contain sizing respects both axes and does not stretch or promote hidden panes to zero',()=>{
  assert.equal(previewDisplayEdge(1000,400,1080,1920,1,1280),448);
  assert.equal(previewDisplayEdge(200,1000,1080,1350,1,1280),320);
  for(const [width,height] of [[0,300],[300,0],[NaN,300],[300,Infinity]])assert.equal(previewDisplayEdge(width,height,1080,1920,1,960),960);
  for(const density of [0,NaN,Infinity])assert.equal(previewDisplayEdge(432,768,1080,1920,density,1280),768);
  assert.equal(previewDisplayEdge(432,767,1080,1920,1,1280),768);
});
