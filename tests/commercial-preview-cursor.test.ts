import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_COMMERCIAL_DATA,commercialSequenceTimeline,commercialTimeline,normalizeCommercialData,updateCommercialTextPage} from '../src/studio/commercial/model';
import type {CommercialData,CommercialSequence} from '../src/studio/commercial/model';
import {commercialPreviewIdentity,commercialPreviewMoment,commercialPreviewPageAt,rebaseCommercialPreview} from '../src/studio/commercial/preview-cursor';

const sequence=(id:string,layout:CommercialSequence['layout'],duration=3):CommercialSequence=>({id,layout,duration,pages:Array.from({length:layout==='columns'?2:1},(_,slot)=>({title:`${id} ${slot}`,body:'Un communiqué.'}))});
function fixture():CommercialData {
  return {...normalizeCommercialData(DEFAULT_COMMERCIAL_DATA),duration:90,sequenceTiming:'manual',sequences:[sequence('one','central'),sequence('two','columns'),sequence('three','final'),sequence('four','left')]};
}
function inSelectedInterval(data:CommercialData,result:{page:number;time:number}) {
  const identity=commercialPreviewIdentity(data,result.page)!,span=commercialSequenceTimeline(data).find(item=>item.id===identity.sequenceId)!;
  assert.ok(result.time>span.start&&result.time<span.end,`time ${result.time} outside ${span.start}–${span.end}`);
}

test('changing manual timing to automatic keeps the selected ID and shows its own contents',()=>{
  const before=fixture(),time=commercialPreviewMoment(before,4),after={...before,sequenceTiming:'auto' as const};
  assert.equal(commercialPreviewPageAt(after,time),0,'old seconds incorrectly show the first sequence');
  const rebased=rebaseCommercialPreview(before,after,4,time);
  assert.equal(rebased.page,4);assert.equal(rebased.identity?.sequenceId,'four');assert.equal(rebased.timingChanged,true);inSelectedInterval(after,rebased);
});

test('reordering follows the ID and chosen column instead of the previous flat index',()=>{
  const before=fixture(),after={...before,sequences:[before.sequences![3],before.sequences![1],before.sequences![0],before.sequences![2]]};
  const fourth=rebaseCommercialPreview(before,after,4,commercialPreviewMoment(before,4));
  assert.equal(fourth.page,0);assert.equal(fourth.identity?.sequenceId,'four');inSelectedInterval(after,fourth);
  const right=rebaseCommercialPreview(before,after,2,commercialPreviewMoment(before,2));
  assert.deepEqual(right.identity,{sequenceId:'two',slot:1});assert.equal(right.page,2);inSelectedInterval(after,right);
});

test('adding and duplication select the explicit new page rather than retaining the prior identity',()=>{
  const before=fixture(),after={...before,sequences:[before.sequences![0],sequence('new','columns'),...before.sequences!.slice(1)]};
  const selected=rebaseCommercialPreview(before,after,0,commercialPreviewMoment(before,0),2);
  assert.deepEqual(selected.identity,{sequenceId:'new',slot:1});assert.equal(selected.page,2);inSelectedInterval(after,selected);
});

test('deletion clamps a removed page to a remaining sequence and layout changes keep a valid slot',()=>{
  const before=fixture(),deleted={...before,sequences:before.sequences!.slice(0,-1)};
  const removed=rebaseCommercialPreview(before,deleted,4,commercialPreviewMoment(before,4));
  assert.equal(removed.page,3);assert.equal(removed.identity?.sequenceId,'three');inSelectedInterval(deleted,removed);
  const single={...before,sequences:before.sequences!.map(item=>item.id==='two'?{...item,layout:'left' as const,pages:[item.pages[0]]}:item)};
  const collapsed=rebaseCommercialPreview(before,single,2,commercialPreviewMoment(before,2));
  assert.deepEqual(collapsed.identity,{sequenceId:'two',slot:0});assert.equal(collapsed.page,1);inSelectedInterval(single,collapsed);
});

test('durations and voice edits move the cursor inside the selected updated interval',()=>{
  const before=fixture(),after={...before,sequences:before.sequences!.map((item,i)=>i===0?{...item,duration:28}:item)};
  const moved=rebaseCommercialPreview(before,after,4,commercialPreviewMoment(before,4));inSelectedInterval(after,moved);assert.ok(moved.time>30);
  const voiced={...before,voice:{url:'local-media:voice:100',name:'Voix',duration:120,start:0,end:0,delay:0,volume:1,loop:false,fadeIn:0,fadeOut:0}};
  const extended=rebaseCommercialPreview(before,voiced,4,commercialPreviewMoment(before,4));inSelectedInterval(voiced,extended);assert.equal(extended.identity?.sequenceId,'four');
});

test('text edits preserve the exact paused frame and do not trigger an automatic seek',()=>{
  const before=fixture(),seconds=commercialPreviewMoment(before,2)+.18;
  const after=updateCommercialTextPage(before,2,{title:'MODIFIÉ',body:'Un nouveau texte.'});
  const result=rebaseCommercialPreview(before,after,2,seconds);
  assert.equal(result.time,seconds);assert.equal(result.timingChanged,false);assert.deepEqual(result.identity,{sequenceId:'two',slot:1});
});

test('seek and playback select the active sequence but retain the selected side of columns',()=>{
  const data=fixture(),spans=commercialSequenceTimeline(data);
  assert.equal(commercialPreviewPageAt(data,spans[0].start+.5,4),0);
  assert.equal(commercialPreviewPageAt(data,spans[1].start,0),1);
  assert.equal(commercialPreviewPageAt(data,spans[1].start+.5,2),2);
  assert.equal(commercialPreviewPageAt(data,spans[1].end,2),3);
  assert.equal(commercialPreviewPageAt(data,0,4),0);
  assert.equal(commercialPreviewPageAt(data,commercialTimeline(data).duration,0),4);
});

test('legacy projects also seek to the matching native scene and preserve the right column',()=>{
  const before=normalizeCommercialData(DEFAULT_COMMERCIAL_DATA),after={...before,duration:90};
  for(const page of [0,1,2,3]) {
    const result=rebaseCommercialPreview(before,after,page,commercialPreviewMoment(before,page));
    assert.equal(result.page,page);inSelectedInterval(after,result);
    assert.equal(commercialPreviewPageAt(after,result.time,page),page);
  }
  assert.equal(Object.hasOwn(after,'sequences'),false);
});
