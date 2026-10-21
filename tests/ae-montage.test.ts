import test from 'node:test';
import assert from 'node:assert/strict';
import {aeMontagePlans,aeMontageURL,prepareAEMontage} from '../src/studio/ae-montage';
import {installAEMediaTrim} from '../src/studio/ae-media-trim';
import {broadcastTemplates,getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import {selectedMediaData} from '../src/studio/media-selection';
import type {CropClip} from '../src/studio/sequence-crop';
import type {Clip,LegacyGraphic} from '../src/studio/video/engine';

const specs:CropClip[]=[{url:'lib/media/a.mp4',start:3,end:5},{url:'lib/media/b.mp4',start:7,end:10},{url:'lib/media/c.mp4',start:1,end:3},{url:'lib/media/d.mp4',start:0,end:2}];
function opened(spec:CropClip):Clip{
  const node={src:spec.url,paused:true,releases:0,pause(){this.paused=true;},removeAttribute(){this.releases++;},load(){}};
  return {type:'video',source:String(spec.url),url:String(spec.url),node:node as unknown as HTMLVideoElement,start:0,end:20,length:20};
}

test('AE video tracks expose persistent montage and framing fields without altering old empty defaults',()=>{
  for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier']){
    const template=getTemplate(id),defaults=templateDefaults(template),keys=Object.keys(template.fields).filter(key=>/^_media_.+_url$/.test(key));
    assert.ok(keys.length);
    for(const key of keys){
      const sequence=key.replace(/_url$/,'_sequence'),kind=key.slice(7,-4);
      assert.equal(defaults[sequence],'[]');assert.equal(defaults[`_studio_${kind}_sequence_crops`],'[]');
      const saved=validateProjectData(template,{...defaults,[sequence]:JSON.stringify(specs)});
      assert.deepEqual(JSON.parse(String(saved[sequence])),specs);
      assert.equal(selectedMediaData(template,saved)[key],'');
    }
  }
  assert.ok(broadcastTemplates.every(template=>Object.keys(template.fields).filter(key=>key.endsWith('_sequence')).every(key=>templateDefaults(template)[key]==='[]')));
});

test('AE plan rejects malformed drafts and foreign sources before their media can be loaded',()=>{
  assert.deepEqual([...aeMontagePlans({_media_intro_sequence:'[]'})],[]);
  assert.deepEqual(aeMontagePlans({_media_intro_sequence:JSON.stringify(specs)}).get('intro'),specs);
  assert.throws(()=>aeMontagePlans({_media_intro_sequence:'{'}),/illisible/);
  assert.throws(()=>aeMontagePlans({_media_intro_sequence:JSON.stringify([{...specs[0],end:2}])}),/fin après/);
  const base='https://studio.test/folder/SRTB-PROJET.html';
  assert.equal(aeMontageURL('lib/a.mp4',base),'https://studio.test/folder/lib/a.mp4');
  assert.equal(aeMontageURL('blob:https://studio.test/123',base),'blob:https://studio.test/123');
  for(const url of ['https://foreign.test/a.mp4','blob:https://foreign.test/123','javascript:alert(1)','file:///C:/secret'])assert.throws(()=>aeMontageURL(url,base),/externe/);
});

test('AE montage preserves cut timing, bounds live decoders, supports backward seeks and releases all media',async()=>{
  const loaded:{full:boolean;clip:Clip}[]=[],active:number[]=[],controller=new AbortController(),first=opened(specs[0]);
  const montage=await prepareAEMontage(specs,first,controller.signal,(_clip,index)=>active.push(index),async(spec,_signal,full=true)=>{const clip=opened(spec);loaded.push({full,clip});return clip;});
  assert.equal(montage.length,9);assert.deepEqual(montage.clips.map(clip=>clip.length),[2,3,2,2]);
  assert.equal(montage.clips.filter(clip=>clip.node).length,2);
  assert.deepEqual(loaded.map(item=>item.full),[true,false,false]);
  assert.deepEqual(await montage.select(0),{index:0,seconds:3,ended:false});
  assert.deepEqual(await montage.select(2),{index:1,seconds:7,ended:false});
  assert.deepEqual(await montage.select(5),{index:2,seconds:1,ended:false});
  const held=await montage.select(99);assert.equal(held?.index,3);assert.equal(held?.ended,true);assert.ok(Math.abs(held!.seconds-1.96)<1e-9);
  assert.deepEqual(await montage.select(0),{index:0,seconds:3,ended:false});
  assert.deepEqual(active,[0,1,2,3,0]);assert.ok(montage.clips.filter(clip=>clip.node).length<=2);
  controller.abort();assert.ok(montage.clips.every(clip=>clip.node===null));
  await assert.rejects(()=>montage.select(1));montage.dispose();
});

test('late media completion after disposal is released and cannot switch the selected picture',async()=>{
  const controller=new AbortController(),active:number[]=[],first=opened(specs[0]);
  let resolve!: (clip:Clip)=>void,slow=false;
  const montage=await prepareAEMontage(specs.slice(0,3),first,controller.signal,(_clip,index)=>active.push(index),async spec=>slow?new Promise<Clip>(done=>{resolve=done;}):opened(spec));
  slow=true;const selection=montage.select(5);controller.abort();const late=opened(specs[2]),node=late.node as unknown as {releases:number};resolve(late);
  await assert.rejects(selection);assert.ok(node.releases>0);assert.deepEqual(active,[]);
});

test('an image may remain on screen longer than the native placeholder without a false source-duration error',async()=>{
  const spec={url:{url:'lib/images/photo.jpg',name:'Photo',mimeType:'image/jpeg'},start:0,end:60},first={...opened(spec),type:'image',end:10,length:10},controller=new AbortController();
  const montage=await prepareAEMontage([spec],first,controller.signal,()=>{});
  assert.equal(montage.length,60);assert.equal(montage.clips[0].end,60);montage.dispose();
});

test('single-excerpt AE adapter uses the sequence source, restores primary data and resets to the old path',async()=>{
  for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier']){
    const template=getTemplate(id),key=id==='BTV_Renvoi'?'renvoi':'intro',method=id==='BTV_Renvoi'?'prepareMedia':'prepareTracks',field=`_media_${key}_url`,sequence=`_media_${key}_sequence`;
    const calls:unknown[][]=[],sources:unknown[]=[],data={...templateDefaults(template),[field]:'',[sequence]:JSON.stringify([specs[0]])};
    const g={data,tracks:{},mediaItems:new Map(),teardown(){},[method]:async function(this:LegacyGraphic){
      sources.push(this.data[field]);const clip=opened(specs[0]);this.tracks={[key]:{clips:[clip],loop:true,length:20}};this.media=clip.node;this.mediaItems.set(key,{node:clip.node,video:true});
    },renderMedia:(...args:unknown[])=>calls.push(args)} as unknown as LegacyGraphic;
    installAEMediaTrim(g,template);await g[method]();
    assert.equal(sources[0],specs[0].url);assert.equal(g.data[field],'');assert.equal(g.tracks[key].length,2);
    if(id==='BTV_Renvoi')await g.renderMedia(1,false);else await g.renderMedia(key,1,false);
    assert.deepEqual(calls[0],id==='BTV_Renvoi'?[4,false]:[key,4,false]);
    g.data[sequence]='[]';await g[method]();assert.equal(g.tracks[key].loop,true);g.teardown();
  }
});
