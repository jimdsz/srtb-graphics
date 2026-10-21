import test from 'node:test';
import assert from 'node:assert/strict';
import {previewHealthMessage} from '../src/studio/preview-health-summary';
const healthy={longGaps:0,frames:375,dropped:0,buffering:0,activeVideoSamples:30};
test('a responsive interface without video frame evidence never validates video fluency',()=>{
  assert.match(previewHealthMessage({...healthy,frames:0}),/n’est pas validée/);
  assert.match(previewHealthMessage({...healthy,frames:0,activeVideoSamples:0}),/aucune vidéo/);
});
test('measured issues take priority over unavailable frame counters',()=>{
  for(const change of [{longGaps:4,frames:0},{dropped:20},{buffering:3}])assert.match(previewHealthMessage({...healthy,...change}),/ralentissements ont été mesurés/);
});
test('successful passage measurement stays limited to the observed passage',()=>{
  assert.match(previewHealthMessage(healthy),/ne garantit pas les autres passages/);
});
test('a stalled copy cannot be called healthy even when all video frames decode',()=>{
 assert.match(previewHealthMessage({...healthy,copyStalled:true}),/copie dans l’aperçu n’a pas progressé/);
});
