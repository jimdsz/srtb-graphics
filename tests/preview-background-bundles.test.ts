import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';

test('deduplicated preview animation bundles reproduce every original PNG byte',()=>{
  for(const id of ['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE']){
    const root=`public/library/v1.7.0/${id}/`,data=JSON.parse(readFileSync(root+'lib/lottie-template.json','utf8'));
    const config=data.btvAutomation.backgroundSequence,bundle=readFileSync(`public/preview-media/v2/${id}.zip`),entries=unzipSync(bundle);
    const index=JSON.parse(new TextDecoder().decode(entries['index.json']));assert.equal(index.version,2);
    assert.equal(Object.keys(index.frames).length,config.lastFrame-config.firstFrame+1);
    assert.ok(bundle.length<4*1024*1024);
    for(let frame=config.firstFrame;frame<=config.lastFrame;frame++){
      const original=readFileSync(root+config.path.replace('{frame:04}',String(frame).padStart(4,'0')));
      assert.deepEqual(Buffer.from(entries[index.frames[String(frame)]]),original);
    }
  }
});
