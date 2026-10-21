import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_COMMERCIAL_DATA,commercialBodyLimit,commercialPageStyle,commercialSequenceReadingDuration,commercialSequenceTimeline,commercialTimeline,normalizeCommercialData,validateCommercialData} from '../src/studio/commercial/model';
import type {CommercialData} from '../src/studio/commercial/model';

const fixture=():CommercialData=>({...structuredClone(DEFAULT_COMMERCIAL_DATA),textMode:'full',sequenceTiming:'auto',duration:15,sequences:[
  {id:'short',layout:'central',duration:8,pages:[{title:'RENDEZ-VOUS',body:'Vendredi à 18 h.'}]},
  {id:'long',layout:'final',duration:8,pages:[{title:'INFORMATIONS',body:'La bibliothèque accueille les familles pour une rencontre avec les auteurs. Les visiteurs pourront participer aux ateliers et découvrir les nouveaux ouvrages. Entrée libre, inscription conseillée auprès de l’accueil.'}]}
]});

test('saved pearl-header titles remain visible on open layouts without changing the legacy template or other colors',()=>{
  const page={title:'Votre identité',body:'Le logo de votre marque.'};
  for(const index of [1,2,3]){
    const stored={...page,style:commercialPageStyle(page,index)};
    const before=structuredClone(stored);
    assert.equal(stored.style.titleColor,'#08150e');
    assert.equal(commercialPageStyle(stored,index,true).titleColor,'#f9fbf4');
    assert.equal(commercialPageStyle(stored,index).titleColor,'#08150e');
    assert.deepEqual(stored,before);
    const colored={...stored,style:{...stored.style,titleColor:'#e4bd52'}};
    assert.equal(commercialPageStyle(colored,index,true).titleColor,'#e4bd52');
  }
});

test('readable modes and adaptive logo survive JSON normalization without changing their text',()=>{
  for(const textMode of ['summary','full'] as const){
    const data={...fixture(),textMode,logo:{url:'/api/commercial/media/example/content',name:'Marque',mode:'original' as const,position:'bottom-right' as const,scale:1,presentation:'adaptive' as const,crop:false,plate:'auto' as const}};
    const saved=normalizeCommercialData(JSON.parse(JSON.stringify(data)));
    assert.equal(saved.textMode,textMode);assert.deepEqual(saved.sequences!.map(s=>s.pages.map(p=>p.body)),data.sequences!.map(s=>s.pages.map(p=>p.body)));
    assert.equal(saved.logo!.presentation,'adaptive');assert.equal(saved.logo!.crop,false);assert.equal(saved.logo!.plate,'auto');
    assert.deepEqual(validateCommercialData(saved),[]);
  }
});
test('long editable source is retained while legacy projects retain their exact limits',()=>{
  const data=fixture();data.sequences![0].pages[0].body=('Assemblée générale. '.repeat(120)).trim();
  assert.deepEqual(validateCommercialData(data,{draft:true}),[]);
  assert.equal(normalizeCommercialData(data).sequences![0].pages[0].body,data.sequences![0].pages[0].body);
  assert.equal(commercialBodyLimit(data,0),12000);
  const legacy=normalizeCommercialData(DEFAULT_COMMERCIAL_DATA);
  assert.equal(legacy.textMode,undefined);assert.equal(commercialBodyLimit(legacy,0),420);
  assert.ok(validateCommercialData({...data,textMode:'invented'},{draft:true}).length);
  assert.ok(validateCommercialData({...data,logo:{url:'x',name:'x',mode:'original',position:'bottom-right',scale:1,presentation:'bad',crop:'yes'}},{draft:true}).length);
});
test('automatic readable timings give dense screens more time and preserve a delayed trimmed voice',()=>{
  const data=fixture();data.voice={url:'voice.wav',name:'Voix',duration:80,start:5,end:65,delay:7,volume:1,loop:false,fadeIn:0,fadeOut:0};
  const timeline=commercialSequenceTimeline(data),total=commercialTimeline(data);
  assert.ok(timeline[1].duration>timeline[0].duration);
  timeline.forEach((span,i)=>assert.ok(span.duration>=commercialSequenceReadingDuration(data.sequences![i])));
  assert.ok(total.closingStart>=67);assert.equal(timeline[0].end,timeline[1].start);assert.equal(timeline[1].end,total.closingStart);
  assert.deepEqual(validateCommercialData(data),[]);
});
test('manual duration remains an explicit choice and old automatic allocation stays unchanged',()=>{
  const manual={...fixture(),sequenceTiming:'manual' as const};
  assert.ok(Math.abs(commercialSequenceTimeline(manual)[0].duration-8)<.04);
  const legacy={...fixture(),textMode:undefined,duration:60};
  const spans=commercialSequenceTimeline(legacy);
  assert.ok(Math.abs(spans[0].duration-spans[1].duration)<.04);
});
