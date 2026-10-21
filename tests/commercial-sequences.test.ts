import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMERCIAL_FPS, DEFAULT_COMMERCIAL_DATA, commercialPageStyle, commercialSequenceTimeline, commercialTextSlots, commercialTimeline, createCommercialSequences, effectiveCommercialDuration, normalizeCommercialData, updateCommercialTextPage, validateCommercialData} from '../src/studio/commercial/model';
import type {CommercialAudio, CommercialData, CommercialSequence} from '../src/studio/commercial/model';
import {commercialSequenceCardMotion} from '../src/studio/commercial/sequence-motion';
import {nativeCardMotion} from '../src/studio/commercial/native-motion';
import {commercialAudioEvents} from '../src/studio/commercial/audio';

function fixture():CommercialData {
  const data=normalizeCommercialData(DEFAULT_COMMERCIAL_DATA);
  data.pages.forEach(page=>page.body='Une information destinée au public.');
  return data;
}
const sequence=(layout:CommercialSequence['layout'],id:string=layout,duration=8):CommercialSequence=>({id,layout,duration,pages:Array.from({length:layout==='columns'?2:1},()=>({title:'COMMUNIQUÉ',body:'Une information destinée au public.'}))});
const voice=(duration:number,changes:Partial<CommercialAudio>={}):CommercialAudio=>({url:'voix.wav',name:'Voix',duration,start:0,end:0,delay:0,volume:1,loop:false,fadeIn:0,fadeOut:0,...changes});
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-7,`${a} ≠ ${b}`);

function assertSchedule(data:CommercialData) {
  const timeline=commercialTimeline(data),spans=commercialSequenceTimeline(data);
  assert.ok(spans.length>0);
  near(spans[0].start,timeline.firstStart); near(spans.at(-1)!.end,timeline.closingStart);
  for(let i=0;i<spans.length;i++) {
    const span=spans[i]; near(span.start*COMMERCIAL_FPS,Math.round(span.start*COMMERCIAL_FPS));near(span.end*COMMERCIAL_FPS,Math.round(span.end*COMMERCIAL_FPS));
    assert.ok(span.duration>=3); near(span.duration,span.end-span.start);
    if(i)near(spans[i-1].end,span.start);
    if(data.sequenceTiming==='manual')assert.ok(span.duration+1e-8>=data.sequences![i].duration);
  }
  if(data.voice) {
    const event=commercialAudioEvents(data).find(item=>item.url===data.voice!.url)!;
    near(event.duration,(data.voice.end||data.voice.duration)-data.voice.start);
    assert.ok(event.at+event.duration<=timeline.closingStart+1e-8);
  }
}

test('legacy saves do not acquire sequences or change their exact timeline',()=>{
  for(const duration of [15,60,75,90,123.456,600]) {
    const data={...fixture(),duration},loaded=normalizeCommercialData(JSON.parse(JSON.stringify(data)));
    assert.equal(Object.hasOwn(loaded,'sequences'),false);assert.equal(Object.hasOwn(loaded,'sequenceTiming'),false);
    assert.equal(effectiveCommercialDuration(loaded),duration);
    assert.deepEqual(commercialTimeline(loaded),commercialTimeline(duration));
    const spans=commercialSequenceTimeline(loaded),tl=commercialTimeline(duration);
    assert.deepEqual(spans.map(span=>span.pageIndices),[[0],[1,2],[3]]);
    assert.deepEqual(spans.map(span=>span.start),[tl.firstStart,tl.dualStart,tl.finalStart]);
  }
  const data={...fixture(),voice:voice(37.2)};
  const frames=Math.max(Math.ceil(15*COMMERCIAL_FPS),Math.ceil((Math.round(3.4*COMMERCIAL_FPS)/COMMERCIAL_FPS+37.2)*COMMERCIAL_FPS-1e-7)+Math.ceil(3.4666667*COMMERCIAL_FPS));
  assert.equal(effectiveCommercialDuration(data),frames/COMMERCIAL_FPS);
});

test('explicit conversion inherits all pages, native styles and frame boundaries',()=>{
  const original=fixture(),snapshot=JSON.stringify(original),oldSpans=commercialSequenceTimeline(original),converted=createCommercialSequences(original);
  assert.equal(JSON.stringify(original),snapshot);assert.equal(converted.sequenceTiming,'manual');
  assert.deepEqual(converted.sequences!.map(item=>item.layout),['central','columns','final']);
  assert.deepEqual(commercialTextSlots(converted).map(slot=>slot.page),original.pages);
  commercialSequenceTimeline(converted).forEach((span,i)=>{near(span.start,oldSpans[i].start);near(span.end,oldSpans[i].end);});
  converted.sequences![0].pages[0].title='MODIFIÉ';assert.notEqual(original.pages[0].title,'MODIFIÉ');
  assert.equal(createCommercialSequences(converted),converted);
});

test('flattened slots, geometry kinds and page updates follow reorder and duplication',()=>{
  const data={...fixture(),sequences:[sequence('right','right-1'),sequence('columns','columns-2'),sequence('central','central-3'),sequence('final','final-4'),sequence('left','left-5')],sequenceTiming:'auto' as const};
  const slots=commercialTextSlots(data);assert.deepEqual(slots.map(slot=>slot.kind),[2,1,2,0,3,1]);assert.deepEqual(slots.map(slot=>slot.index),[0,1,2,3,4,5]);
  assert.deepEqual(slots.map(slot=>[slot.sequenceIndex,slot.slot]),[[0,0],[1,0],[1,1],[2,0],[3,0],[4,0]]);
  const replacement={...slots[2].page,title:'DEUXIÈME COLONNE',style:{...commercialPageStyle(slots[2].page,slots[2].kind),titleX:80}};
  const edited=updateCommercialTextPage(data,2,replacement);
  assert.equal(edited.sequences![1].pages[1],replacement);assert.equal(data.sequences[1].pages[1].title,'COMMUNIQUÉ');
  assert.equal(edited.pages,data.pages);assert.equal(updateCommercialTextPage(data,99,replacement),data);
  const reordered={...edited,sequences:[edited.sequences![2],edited.sequences![0],edited.sequences![1],edited.sequences![3],edited.sequences![4]]};
  assert.equal(commercialTextSlots(reordered)[3].page.title,'DEUXIÈME COLONNE');
});

test('automatic sequences share every reading frame and grow for short voices',()=>{
  for(const count of [1,2,3,7,32])for(const duration of [15,60,75,123.456,600]) {
    const data={...fixture(),duration,sequenceTiming:'auto' as const,sequences:Array.from({length:count},(_,i)=>sequence(i%2?'columns':'central',`scene-${i}`))};
    assertSchedule(data);
    const lengths=commercialSequenceTimeline(data).map(span=>Math.round(span.duration*COMMERCIAL_FPS));
    assert.ok(Math.max(...lengths)-Math.min(...lengths)<=1);
    const spoken={...data,voice:voice(.7)};assertSchedule(spoken);
    assert.ok(effectiveCommercialDuration(spoken)>=3*count+3.4+3.46);
  }
});

test('manual durations are minima and a longer trimmed voice extends the last sequence',()=>{
  for(const length of [.2,18.75,37.2,122.05,510]) {
    const data={...fixture(),sequenceTiming:'manual' as const,sequences:[sequence('left','one',3.004),sequence('right','two',4.777),sequence('final','three',5.01)],voice:voice(600,{start:11.2,end:11.2+length,delay:5.5})};
    assertSchedule(data);
    const spans=commercialSequenceTimeline(data);
    near(spans[0].duration,Math.ceil(3.004*COMMERCIAL_FPS)/COMMERCIAL_FPS);near(spans[1].duration,Math.ceil(4.777*COMMERCIAL_FPS)/COMMERCIAL_FPS);
    assert.deepEqual(validateCommercialData(data),[]);
  }
  const data={...fixture(),sequenceTiming:'manual' as const,sequences:[sequence('central','one',80),sequence('final','two',90)],voice:voice(10)};
  assertSchedule(data);assert.ok(effectiveCommercialDuration(data)>176);
});

test('sequence validation covers active text, identifiers, counts and total duration without requiring issuer',()=>{
  const data={...fixture(),issuer:'',sequenceTiming:'manual' as const,sequences:[sequence('central','one'),sequence('columns','two')]};
  data.pages[0].body='';assert.deepEqual(validateCommercialData(data),[]);
  const {issuer,...withoutIssuer}=data;assert.deepEqual(validateCommercialData(withoutIssuer),[]);
  for(const sequences of [[],Array.from({length:33},(_,i)=>sequence('central',`scene-${i}`)),[sequence('left','same'),sequence('right','same')],[{...sequence('central'),duration:2.9}],[{...sequence('columns'),pages:[sequence('left').pages[0]]}],[sequence('central','one',600)]]) {
    assert.ok(validateCommercialData({...data,sequences}).length>0);
  }
  const tooLong=structuredClone(data);tooLong.sequences[1].pages[1].body='a'.repeat(361);
  assert.ok(validateCommercialData(tooLong).some(error=>error.includes('Séquence 2 · Droite')));
  const blank=structuredClone(data);blank.sequences[0].pages[0].body='';assert.ok(validateCommercialData(blank).some(error=>error.includes('obligatoire')));assert.deepEqual(validateCommercialData(blank,{draft:true}),[]);
});

test('normalization and JSON persistence preserve every active sequence and its typography',()=>{
  const data=createCommercialSequences(fixture());data.sequences!.push(sequence('right','extra',8.123));
  data.sequences![3].pages[0].style={...commercialPageStyle(data.sequences![3].pages[0],2),bodyColor:'#ffe082',titleRotation:12};
  const saved=normalizeCommercialData(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(normalizeCommercialData(saved),saved);assert.equal(saved.sequences!.length,4);assert.equal(saved.sequences![3].duration,8.123);
  assert.equal(saved.sequences![3].pages[0].style!.titleRotation,12);assert.deepEqual(commercialSequenceTimeline(saved),commercialSequenceTimeline(data));
});

test('repeated standalone left cards never fade at the hidden legacy text-swap time',()=>{
  for(const length of [3.48,8.6,60.6,180.6]) {
    let middle=0;
    for(let t=0;t<length;t+=1/120) {
      const legacy=nativeCardMotion('left',t,0,length),motion=commercialSequenceCardMotion('left',t,0,length);
      if(legacy.sourceTime>=29.56&&legacy.sourceTime<=30.44) {
        middle++;assert.equal(motion.title.alpha,1);assert.equal(motion.body.alpha,1);
        assert.deepEqual(motion.panel,legacy.panel);assert.deepEqual(motion.header,legacy.header);assert.equal(motion.title.dy,legacy.title.dy);assert.equal(motion.body.dy,legacy.body.dy);
      }else assert.deepEqual(motion,legacy);
    }
    assert.ok(middle>0);
    assert.equal(commercialSequenceCardMotion('left',length,0,length).visible,false);
  }
  for(const kind of ['central','right'] as const)for(let t=0;t<10;t+=.05)assert.deepEqual(commercialSequenceCardMotion(kind,t,0,8),nativeCardMotion(kind,t,0,8));
});
