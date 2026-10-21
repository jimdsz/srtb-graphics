import test from 'node:test';
import assert from 'node:assert/strict';
import {announcementVoicePinsKey,loadAnnouncementVoicePins} from '../src/studio/announcement-voice-pins';
import type {AnnouncementVoicePinClient,AnnouncementVoiceProfile} from '../src/studio/announcement-voice-pins';
import {announcementVoiceSources,announcementVoicesReady} from '../src/studio/announcement-local-voices';
import type {DerivationAnnouncement} from '../src/studio/derivation-announcements';
import type {PreparationProfile,PreparationProfileRevision} from '../src/studio/preparation-profile-model';
import {baVoicePlacement} from '../src/studio/ba-voice-placement';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {PinnedAnnouncementVoiceOption} from '../src/studio/DerivationAnnouncements';

const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const asset=(digit:string)=>({url:`local-media:${digit.repeat(64)}:691244`,name:'Recette.wav',mimeType:'audio/wav'});
function profile(revision=1,profileId=id):AnnouncementVoiceProfile{return {id:profileId,revision,kind:'voice',name:`Voix r${revision}`,favorite:false,archived:false,template_id:null,template_version:null,library_version:null,created_by:'recipe@example.invalid',updated_by:'recipe@example.invalid',created_at:'2026-09-23T12:00:00.000Z',updated_at:'2026-09-23T12:00:00.000Z',validated_by:'recipe@example.invalid',validated_at:'2026-09-23T12:00:00.000Z',data:{source:asset(revision===1?'a':'b'),start:0,end:revision===1?3.6:1,label:revision===1?'Aujourd’hui':'Demain',cue:{kind:'announcement',value:revision===1?'Aujourd’hui':'Demain'},humanValidated:true}};}
const history=(p=profile()):PreparationProfileRevision=>({revision:p.revision,name:p.name,data:p.data,favorite:p.favorite,archived:p.archived,actor:p.updated_by,created_at:p.updated_at,validated_by:p.validated_by,validated_at:p.validated_at});
const selected=(profileId=id,revision=1):DerivationAnnouncement=>({key:'today',formats:['tv'],time:'',voice:{mode:'profile',profileId,revision,placement:'fit-complete'}});
const pins=(values=[selected()])=>JSON.parse(announcementVoicePinsKey(values));
function client(current:PreparationProfile=profile(2),exact=history()){const calls:string[]=[];return {calls,api:{get:async(requested:string)=>{calls.push(`get:${requested}`);return current;},revision:async(requested:string,revision:number)=>{calls.push(`revision:${requested}:${revision}`);return exact;}}} satisfies {calls:string[];api:AnnouncementVoicePinClient};}
const signal=()=>new AbortController().signal;

test('reopening r1 with catalogue r2 resolves the exact source, full range, cue and placement',async()=>{
  const values=[selected()],current=profile(2),before=structuredClone(values),c=client(current);
  // Reproduces the old modal boundary even when the correct file is connected.
  assert.equal(announcementVoicesReady(values,announcementVoiceSources(values,[current]),()=>true),false);
  const result=await loadAnnouncementVoicePins(pins(values),[current],c.api,signal());
  assert.ok(result[0].profile,'The selected r1 must be resolved independently of current catalogue r2.');
  const resolved=result[0].profile;
  assert.equal(resolved.revision,1);assert.equal(resolved.name,'Voix r1');assert.deepEqual(resolved.data,profile().data);
  assert.equal(baVoicePlacement(resolved.data.end-resolved.data.start,'fit-complete').duration,3.6);
  assert.equal(announcementVoicesReady(values,announcementVoiceSources(values,[resolved]),()=>true),true);
  assert.deepEqual(c.calls.sort(),[`get:${id}`,`revision:${id}:1`]);assert.deepEqual(values,before);
});

test('a pin beyond the first 100 catalogue entries resolves directly without pagination or latest fallback',async()=>{
  const catalogue=Array.from({length:100},(_,i)=>profile(2,`00000000-0000-4000-8001-${String(i).padStart(12,'0')}`)),c=client();
  const result=await loadAnnouncementVoicePins(pins(),catalogue,c.api,signal());
  assert.equal(result[0].profile?.revision,1);assert.equal(c.calls.length,2);
  assert.deepEqual(c.calls.sort(),[`get:${id}`,`revision:${id}:1`]);
});

test('an exact catalogue pin is validated without extra reads, and keys ignore hour/format/placement',async()=>{
  const c=client(),values=[selected()],same=[{...selected(),time:'21:30',formats:['portrait' as const],voice:{mode:'profile' as const,profileId:id,revision:1,placement:'manual' as const}}];
  assert.equal(announcementVoicePinsKey(values),announcementVoicePinsKey(same));
  assert.equal(announcementVoicePinsKey([selected(),selected()]),announcementVoicePinsKey(values));
  const result=await loadAnnouncementVoicePins(pins(),[profile()],c.api,signal());
  assert.deepEqual(result[0].profile,profile());assert.deepEqual(c.calls,[]);
});

test('current archived profile and archived historical revision are refused, without discarding the pin',async()=>{
  for(const [current,exact]of [[{...profile(2),archived:true},history()],[profile(2),{...history(),archived:true}]] as const){
    const c=client(current,exact),values=[selected()],before=structuredClone(values),result=await loadAnnouncementVoicePins(pins(values),[],c.api,signal());
    assert.equal(result[0].profile,null);assert.match(result[0].error,/archivée/);assert.deepEqual(values,before);
    assert.equal(announcementVoicesReady(values,announcementVoiceSources(values,[]),()=>true),false);
  }
});

test('inaccessible revision stays blocked and can be retried explicitly without selecting catalogue r2',async()=>{
  const c=client();let unavailable=true;
  const api:AnnouncementVoicePinClient={...c.api,revision:async(...args)=>{if(unavailable)throw Error('Révision inaccessible (403).');return c.api.revision(...args);}};
  const failed=await loadAnnouncementVoicePins(pins(),[profile(2)],api,signal());
  assert.equal(failed[0].profile,null);assert.match(failed[0].error,/403/);
  unavailable=false;const retry=await loadAnnouncementVoicePins(pins(),[profile(2)],api,signal());
  assert.equal(retry[0].profile?.revision,1);assert.equal(retry[0].error,'');
});

test('wrong current identity/kind and wrong returned revision are refused',async()=>{
  const candidates=[client(profile(2,other)),client({...profile(2),kind:'programme',data:{title:'Programme',logo:null,palette:['#ffffff'],appointments:[],voice:null}}),client(profile(2),history(profile(2)))];
  for(const c of candidates){const result=await loadAnnouncementVoicePins(pins(),[],c.api,signal());assert.equal(result[0].profile,null);assert.ok(result[0].error);}
});

test('historical attestation, range, MIME and announcement cue are checked before exposing audio',async()=>{
  const invalid:PreparationProfileRevision[]=[
    {...history(),validated_by:null},{...history(),validated_by:' '},{...history(),validated_at:null},{...history(),validated_at:'invalid'},
    {...history(),data:{...profile().data,humanValidated:false}},
    {...history(),data:{...profile().data,end:0}},
    {...history(),data:{...profile().data,source:{...asset('a'),mimeType:'image/png'}}},
    {...history(),data:{...profile().data,cue:{kind:'announcement',value:'Demain'}}},
    {...history(),data:{...profile().data,cue:{kind:'time',value:'20:30'}}},
  ];
  for(const exact of invalid){const c=client(profile(2),exact),result=await loadAnnouncementVoicePins(pins(),[],c.api,signal());assert.equal(result[0].profile,null);assert.ok(result[0].error);}
  const invalidCatalogue={...profile(),validated_by:null};
  assert.equal((await loadAnnouncementVoicePins(pins(),[invalidCatalogue],client().api,signal()))[0].profile,null);
});

test('normalized semantic cues match, but reusing one pin for conflicting announcements cannot pass',async()=>{
  const exact={...history(),data:{...profile().data,cue:{kind:'announcement',value:" AUJOURD'HUI "}}},c=client(profile(2),exact);
  assert.equal((await loadAnnouncementVoicePins(pins(),[],c.api,signal()))[0].profile?.data.cue.value,'Aujourd’hui');
  const conflict=[selected(),{...selected(),key:'tomorrow' as const}];
  assert.notEqual(announcementVoicePinsKey(conflict),announcementVoicePinsKey([selected()]));
  const failed=await loadAnnouncementVoicePins(pins(conflict),[],c.api,signal());
  assert.equal(failed[0].profile,null);assert.match(failed[0].error,/libellé attesté/);
  const day={...selected(),key:'day-time' as const,day:'Mardi' as const};
  assert.notEqual(announcementVoicePinsKey([day]),announcementVoicePinsKey([{...day,day:'Mercredi'}]));
});

test('one failed pin does not erase another exact result',async()=>{
  const values=[selected(),selected(other)],c=client();
  const result=await loadAnnouncementVoicePins(pins(values),[profile()],{...c.api,get:async()=>{throw Error('Fiche inaccessible');}},signal());
  assert.equal(result.find(item=>item.id===id)?.profile?.revision,1);assert.equal(result.find(item=>item.id===other)?.profile,null);
  const refs=announcementVoiceSources(values,result.flatMap(item=>item.profile?[item.profile]:[]));
  assert.equal(refs.references.length,1);assert.equal(refs.unresolved,1);assert.equal(announcementVoicesReady(values,refs,()=>true),false);
});

test('a response arriving after changed choices or closing is ignored even when the client ignores abort',async()=>{
  for(const reason of ['selection-changed','closed']){
    let release!:()=>void;const delayed=new Promise<void>(resolve=>{release=resolve;}),task=new AbortController(),c=client();let accepted=0;
    const pending=loadAnnouncementVoicePins(pins(),[],{get:async()=>{await delayed;return profile(2);},revision:async()=>{await delayed;return history();}},task.signal).then(value=>{accepted++;return value;});
    task.abort(reason);release();await assert.rejects(pending,error=>error===reason);assert.equal(accepted,0);
    const next=await loadAnnouncementVoicePins(pins(),[],c.api,signal());assert.equal(next[0].profile?.revision,1);
  }
});

test('a late rejection after cancellation is not turned into a stale retry error',async()=>{
  let reject!:(reason:Error)=>void;const delayed=new Promise<PreparationProfileRevision>((_resolve,fail)=>{reject=fail;}),task=new AbortController();
  const pending=loadAnnouncementVoicePins(pins(),[],{get:async()=>profile(2),revision:()=>delayed},task.signal);
  task.abort();reject(Error('Old request failed'));await assert.rejects(pending,{name:'AbortError'});
});

test('a resolved old revision remains the visible selected option even though choices only contain r2',()=>{
  const voice=selected().voice,p=profile();
  const markup=renderToStaticMarkup(createElement('select',{value:`${id}:1`,onChange(){}},createElement(PinnedAnnouncementVoiceOption,{voice,profile:p,choices:[profile(2)]})));
  assert.match(markup,new RegExp(`value="${id}:1" selected=""`));assert.match(markup,/Voix r1 · r1 · révision épinglée/);assert.doesNotMatch(markup,/disabled/);
  assert.equal(renderToStaticMarkup(createElement(PinnedAnnouncementVoiceOption,{voice,profile:p,choices:[p]})),'');
});

test('React wiring uses resolved pins for sources, placement and audition; aborts on cleanup; retry stays outside locked choices',()=>{
  const source=readFileSync(new URL('../src/studio/DerivationAnnouncements.tsx',import.meta.url),'utf8');
  assert.match(source,/loadAnnouncementVoicePins\(pins,catalogue.profiles,preparationProfiles,task.signal\)/);
  assert.match(source,/return\(\)=>task.abort\(\)/);assert.match(source,/if\(!task.signal.aborted\)setPinResolution/);
  assert.match(source,/pinResolution.key===pinKey/);assert.match(source,/announcementVoiceSources\(value,pinnedProfiles\)/);
  assert.equal((source.match(/pinnedProfiles.find\(/g)||[]).length,2);
  assert.match(source,/VoiceAudition[^>]+source=\{profile.data.source\} start=\{profile.data.start\} end=\{profile.data.end\}/);
  assert.match(source,/\[pinKey,catalogue.profiles,voiceRetry\]/);
  const panel=readFileSync(new URL('../src/studio/DerivationPanel.tsx',import.meta.url),'utf8');
  assert.match(panel,/voiceRetry=\{voiceRetry\}/);
  assert.match(panel,/<\/fieldset>[\s\S]*currentVoiceSources\?\.unresolved\?<button type="button" disabled=\{busy\|\|disabled\}/);
});
