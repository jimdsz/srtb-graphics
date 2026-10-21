import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activateMedia,frameTime,markedRange,replaceMedia,timeLabel} from '../src/studio/media-trim';
import {broadcastTemplates,templateDefaults,validateProjectData} from '../src/studio/domain';
import {MAX_LOCAL_BYTES,localReference} from '../src/studio/local-reference';

test('marks stay on 25 fps frames and moving either mark cannot invert a clip',()=>{
  assert.equal(timeLabel(3723.48),'01:02:03.48');
  assert.equal(frameTime(30.039),30.04);
  assert.deepEqual(markedRange('start',15,3,10,20),{start:15,end:15.04});
  assert.deepEqual(markedRange('end',2,3,10,20),{start:1.96,end:2});
  assert.deepEqual(markedRange('start',20,0,0,20),{start:19.96,end:0});
  assert.deepEqual(markedRange('end',25,0,0,20),{start:0,end:20});
});
test('replacing a media resets stale offsets and playlists without activating a hidden track',()=>{
  for(const t of broadcastTemplates){for(const name of Object.keys(t.fields).filter(k=>k.endsWith('_url')&&k.startsWith('_media_'))){
    const key=name.replace(/_url$/,''),data=templateDefaults(t),replacement={url:`local-media:${'a'.repeat(64)}:120`,name:'Nouveau.mp4',mimeType:'video/mp4'};
    const patch=replaceMedia(name,replacement,t.fields);assert.deepEqual(patch[name],replacement);assert.ok(!('_background_visible'in patch));
    if(key+'_start_seconds'in t.fields)assert.equal(patch[key+'_start_seconds'],0);
    if(key+'_end_seconds'in t.fields)assert.equal(patch[key+'_end_seconds'],0);
    if(key+'_sequence'in t.fields)assert.equal(patch[key+'_sequence'],'[]');
    assert.doesNotThrow(()=>validateProjectData(t,{...data,...patch}));
  }}
});
test('local sources above 3 GiB retain full content hashes, within a separate 64 GiB bound',()=>{
  for(const bytes of [1,4*1024**3,MAX_LOCAL_BYTES])assert.equal(localReference(`local-media:${'a'.repeat(64)}:${bytes}`)?.bytes,bytes);
  assert.equal(localReference(`local-media:${'a'.repeat(64)}:${MAX_LOCAL_BYTES+1}`),null);
  assert.equal(localReference('local-media:fake:123'),null);
});
test('explicit activation does not replace the selected file or change unrelated settings',()=>{
  assert.deepEqual(activateMedia('_media_background_url'),{_background_visible:true});
  assert.deepEqual(activateMedia('_media_programme_2_url'),{_media_mode:'internal'});
  assert.deepEqual(activateMedia('_audio_voice_url'),{_audio_voice_enabled:true});
});
