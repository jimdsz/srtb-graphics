import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patchPlannerRow,plannerRowSchema} from '../src/studio/day-planner-model';
import type {Plan,PlannerRow} from '../src/studio/day-planner-model';
import {plannerProject} from '../src/studio/day-planner-project';
import {aeClipWindow,aeSourceTime,installAEMediaTrim} from '../src/studio/ae-media-trim';
import {getTemplate,templateDefaults,validateProjectData} from '../src/studio/domain';
import type {LegacyGraphic,Track} from '../src/studio/video/engine';
import {packageDocuments} from '../src/studio/delivery-runtime';
import type {DeliveryPlan} from '../src/studio/delivery-plan';

function row(i=0):PlannerRow{
 const media={url:`local-media:${String(i+1).repeat(64)}:100`,name:`programme-${i+1}.mp4`,mimeType:'video/mp4'};
 return {id:String(i),sheet:'RECETTE',cell:'A1',raw:'',title:`Programme ${i+1}`,subtitle:'Épisode 31',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media,location:null,excerpt:{source:media.url,start:10+i,end:20+i,duration:1800}};
}
const plan=():Plan=>({kind:'plan',name:'Lundi',source:'test.xlsx',sourceHash:'a'.repeat(64),rows:Array.from({length:7},(_,i)=>row(i))});
test('reviewed excerpts bind to a verified video and survive shared JSON; old lists remain valid',()=>{
 const valid=row();assert.deepEqual(plannerRowSchema.parse(JSON.parse(JSON.stringify(valid))),valid);
 const old={...valid};delete old.excerpt;assert.deepEqual(plannerRowSchema.parse(old),old);
 for(const excerpt of [{...valid.excerpt!,start:-1},{...valid.excerpt!,start:20},{...valid.excerpt!,end:1801},{...valid.excerpt!,end:10.02},{...valid.excerpt!,source:row(1).media!.url},{...valid.excerpt!,duration:Infinity}])assert.equal(plannerRowSchema.safeParse({...valid,excerpt}).success,false);
 assert.equal(plannerRowSchema.safeParse({...valid,media:{...valid.media!,mimeType:'image/png'}}).success,false);
 assert.equal(plannerRowSchema.safeParse({...valid,media:null}).success,false);
});
test('changing or unlinking a media clears the previous cut, exact reconnection and editorial edits preserve it',()=>{
 const r=row();for(const patch of [{title:'Nouveau titre'},{media:{...r.media!}},{location:null}])assert.deepEqual(patchPlannerRow(r,patch).excerpt,r.excerpt);
 for(const media of [null,row(1).media,{...r.media!,mimeType:'image/png'}])assert.equal(patchPlannerRow(r,{media}).excerpt,null);
});
test('all 18 planner template-format combinations carry the chosen cut to their real media fields',()=>{
 const p=plan();
 for(const kind of ['ba','popup','tds','renvoi','event','weekly'] as const)for(const format of ['tv','portrait','vertical'] as const){
  const result=plannerProject(p,{kind,format,rowIds:kind==='weekly'?p.rows.map(r=>r.id):['0']});
  const cuts=kind==='weekly'?{intro:0,final:6,...Object.fromEntries(p.rows.map((_,i)=>['programme_'+(i+1),i]))}:Object.fromEntries(({ba:['intro','body','pack'],popup:['popup'],tds:['background'],renvoi:['renvoi'],event:['intro','event']}[kind]).map(k=>[k,0]));
  for(const [key,i]of Object.entries(cuts)){const expected=p.rows[i].excerpt!;assert.equal(result.data[`_media_${key}_start_seconds`],expected.start,`${kind}/${format}/${key} IN`);assert.equal(result.data[`_media_${key}_end_seconds`],expected.end);assert.deepEqual(result.data[`_media_${key}_url`],p.rows[i].media);if(`_media_${key}_loop` in result.data)assert.equal(result.data[`_media_${key}_loop`],false);}
  assert.equal(result.data._studio_format,format);
 }
 const invalid=plan();invalid.rows[0].excerpt!.source=row(1).media!.url;assert.throws(()=>plannerProject(invalid,{kind:'ba',format:'tv',rowIds:['0']}),/passages/);
});
test('AE explicit window clamps at the last selected image and rejects impossible cuts',()=>{
 assert.deepEqual(aeClipWindow(100,10,20),{start:10,end:20,length:10});assert.deepEqual(aeClipWindow(100,10),{start:10,end:100,length:90});
 for(const args of [[0,0,0],[100,-1,20],[100,10,101],[100,20,10],[100,20,20.02],[100,NaN,0]])assert.throws(()=>aeClipWindow(...args as [number,number,number]));
 const track={clips:[{...aeClipWindow(100,10,20),type:'video'}],loop:false} as Track;
 assert.deepEqual(aeSourceTime(track,2),{seconds:12,ended:false});assert.deepEqual(aeSourceTime(track,100),{seconds:19.96,ended:true});
});
test('AE adapter maps native preview/seek without changing old projects and resets on source updates',async()=>{
 for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier']){
  const t=getTemplate(id),key=id==='BTV_Renvoi'?'renvoi':'intro',method=id==='BTV_Renvoi'?'prepareMedia':'prepareTracks',calls:unknown[][]=[];
  const g={data:{...templateDefaults(t),[`_media_${key}_start_seconds`]:10,[`_media_${key}_end_seconds`]:20},tracks:{},[method]:async function(this:LegacyGraphic){this.tracks={[key]:{clips:[{type:'video',start:0,end:100,length:100}],loop:true,length:100}};},renderMedia:(...args:unknown[])=>calls.push(args)} as unknown as LegacyGraphic;
  installAEMediaTrim(g,t);installAEMediaTrim(g,t);await g[method]();
  const seek=(n:number)=>id==='BTV_Renvoi'?g.renderMedia(n,false):g.renderMedia(key,n,false);
  seek(2);seek(99);assert.deepEqual(calls,[...(id==='BTV_Renvoi'?[[12,false],[19.96,true]]:[[key,12,false],[key,19.96,true]])]);
  assert.equal(g.tracks[key].loop,false);assert.equal(g.tracks[key].length,10);
  g.data[`_media_${key}_start_seconds`]=0;g.data[`_media_${key}_end_seconds`]=0;await g[method]();seek(2);assert.deepEqual(calls.at(-1),id==='BTV_Renvoi'?[2,false]:[key,2,false]);assert.equal(g.tracks[key].loop,true);
  g.data[`_media_${key}_end_seconds`]=101;await assert.rejects(()=>g[method](),/dépasse/);
  assert.equal(validateProjectData(t,{[`_media_${key}_start_seconds`]:10})[`_media_${key}_start_seconds`],10);
 }
});

test('portable HTML installs the same AE cut adapter before loading all three native templates',()=>{
 for(const id of ['BTV_Renvoi','BTV_Evenement','BTV_Semainier']){
  const template=getTemplate(id),data={...templateDefaults(template),_media_intro_start_seconds:10,_media_intro_end_seconds:20};
  const docs=packageDocuments({data,project:{id:'test',revision:1,title:'Extrait'},format:'html',version:1} as unknown as DeliveryPlan,template);
  const entry=docs['srtb-project.mjs'];assert.ok(docs['studio-supplemental-voice-v1.mjs'].includes('installAEMediaTrim'));
  assert.ok(entry.indexOf('installAEMediaTrim(graphic,')<entry.indexOf('await graphic.load('));
  assert.equal(JSON.parse(docs['PROJET.json']).data._media_intro_start_seconds,10);
 }
});
