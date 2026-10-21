import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTemplates,getTemplate,templateDefaults} from '../src/studio/domain';
import {textFields} from '../src/studio/typography-model';
import {socialSceneData,installSocialScene} from '../src/studio/social-scene';
import type {LegacyGraphic} from '../src/studio/video/engine';
import type {ProjectData} from '../src/studio/domain';

test('social engine placeholders preserve original values, optional emptiness and all non-editorial settings',()=>{
  for(const template of broadcastTemplates){
    const data=templateDefaults(template),fields=textFields(template).map(([key])=>key),protectedField=/^(?:_?(?:jour|heure|day|time)(?:_\d+)?|_next_time)$/;
    for(const field of fields)if(!protectedField.test(field))data[field]=field===fields[0]?'':'ALPHA\nBÊTA\nGAMMA\nDELTA';
    const before=structuredClone(data),native=socialSceneData(template,data);
    assert.deepEqual(data,before);assert.notEqual(native,data);
    for(const [key,value]of Object.entries(data))assert.deepEqual(native[key],fields.includes(key)&&!protectedField.test(key)?String(value??'').trim()?'A':'':value,template.id+' '+key);
  }
});

test('BA immediate appointments, times, voice and media keep their exact operational values',()=>{
  const template=getTemplate('BTV_BA_1P'),data={...templateDefaults(template),_titre_ligne_1:'A\nB\nC\nD',_jour_1:'Tout de suite',_heure_1:'',_jour_2:'Demain',_heure_2:'20h30',_studio_ba_voice_fit:'fit-complete',_audio_voice_enabled:true,_audio_voice_url:'local-media:voice',_media_body_url:'local-media:picture'};
  const native=socialSceneData(template,data);
  for(const key of ['_jour_1','_heure_1','_jour_2','_heure_2','_studio_ba_voice_fit','_audio_voice_enabled','_audio_voice_url','_media_body_url'])assert.equal(native[key],data[key as keyof typeof data]);
  assert.equal(native._titre_ligne_1,'A');assert.equal(data._titre_ligne_1,'A\nB\nC\nD');
});

test('the social-only adapter applies the same editorial boundary on load and update without mutating arguments',async()=>{
  const calls:unknown[]=[],template=getTemplate('BTV_BA_1P'),graphic={_update:async()=>{},_finishOut:()=>{},playAction:()=>{},load:async(params:unknown)=>{calls.push(params);return 'loaded';},updateAction:async(data:ProjectData)=>{calls.push(data);return 'updated';}} as unknown as LegacyGraphic;
  installSocialScene(graphic,template);
  const data={_titre_ligne_1:'A\nB\nC\nD',_jour_1:'Tout de suite',_heure_1:''},params={data,previewMuted:true};
  assert.equal(await graphic.load(params),'loaded');assert.equal(await graphic.updateAction(data),'updated');
  assert.deepEqual(calls,[{...params,data:{...data,_titre_ligne_1:'A'}},{...data,_titre_ligne_1:'A'}]);
  assert.equal(params.data,data);assert.equal(data._titre_ligne_1,'A\nB\nC\nD');
});

function aeStub(){
  const calls:string[]=[],g:any={data:{},load:async function(p:any){return this._update(p.data);},updateAction:async function(d:any){return this._update(d);},
    _update:async()=>{throw Error('TV scene must not be built');},validateData:(data:any)=>({valid:true,data,warnings:['native warning']}),
    pause:()=>calls.push('pause'),teardown:()=>calls.push('teardown'),
    prepareTracks:async function(){calls.push('tracks');assert.deepEqual(this.animation.renderer.elements,[]);this.tracks={event:{length:4,activeStart:3}};},
    prepareAudio:async function(){calls.push('audio');this.audio=[{offset:2}];},
    _draw:function(n:number){calls.push('draw:'+n);this.animation.goToAndStop(n);},resize:()=>calls.push('resize'),
    getStatus:function(){return {statusCode:200,phase:this.phase};},playAction(){},goToTime(){},stopAction(){},setMuted(){},dispose(){}};
  return {g:g as LegacyGraphic,calls};
}
test('AE social setup omits the TV scene but preserves native preparation, clocks, audio and source trims',async()=>{
  for(const id of ['BTV_Evenement','BTV_Semainier']){
    const {g,calls}=aeStub(),t=getTemplate(id),methods=Object.fromEntries(['prepareTracks','prepareAudio','playAction','goToTime','stopAction','setMuted','dispose'].map(key=>[key,g[key]]));
    installSocialScene(g,t);
    const input={...templateDefaults(t),_media_event_start_seconds:3,_audio_enabled:true,_audio_url:'blob:voice'};
    assert.deepEqual(await g.load({data:input}),{statusCode:200,phase:'ready'});
    assert.deepEqual(calls,['pause','teardown','tracks','audio','draw:0','resize']);
    for(const [key,method]of Object.entries(methods))assert.equal(g[key],method,key);
    assert.equal(g.data._media_event_start_seconds,3);assert.equal(g.data._audio_url,'blob:voice');
    assert.deepEqual(g.tracks.event,{length:4,activeStart:3});assert.deepEqual(g.audio,[{offset:2}]);
    assert.deepEqual(g.warnings,['native warning']);
    await g.updateAction({...input,_media_event_start_seconds:6});assert.equal(g.data._media_event_start_seconds,6);
  }
});
test('AE social setup is pinned to the qualified model versions and rejects invalid data before teardown',async()=>{
  for(const t of [getTemplate('BTV_Renvoi'),{...getTemplate('BTV_Evenement'),version:'2.0.0'},{...getTemplate('BTV_Semainier'),libraryVersion:'2.0.0'}]){
    const {g}=aeStub(),before=g._update;installSocialScene(g,t);assert.equal(g._update,before);
  }
  const {g,calls}=aeStub();installSocialScene(g,getTemplate('BTV_Evenement'));
  g.validateData=()=>({valid:false,errors:['source refusée']});
  await assert.rejects(g.load({data:{}}),/source refusée/);assert.deepEqual(calls,[]);
});
test('AE social setup cleans up late media when audio fails or the preview is closed while loading',async()=>{
  for(const disposed of [false,true]){
    const {g,calls}=aeStub();let finish!:()=>void;
    g.prepareTracks=()=>new Promise<void>(resolve=>{finish=()=>{calls.push('late track');resolve();};});
    g.prepareAudio=async()=>{if(!disposed)throw Error('audio inaccessible');};
    installSocialScene(g,getTemplate('BTV_Semainier'));
    const result=g.load({data:{}});if(disposed)g.disposed=true;finish();
    await assert.rejects(result,disposed?{name:'AbortError'}:/audio inaccessible/);
    assert.deepEqual(calls,['pause','teardown','late track','teardown']);
  }
});
