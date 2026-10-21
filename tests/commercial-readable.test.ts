import test from 'node:test';
import assert from 'node:assert/strict';
import {wrapReadableText,paginateReadableText} from '../src/studio/commercial/text-pagination';
import {readablePageLayout,readableTextIssues,splitCommercialPages,READABLE_AREA_CENTER_Y} from '../src/studio/commercial/readable-layout';
import {readableSequenceMotion} from '../src/studio/commercial/sequence-motion';
import {DEFAULT_COMMERCIAL_DATA,normalizeCommercialData,commercialPageStyle} from '../src/studio/commercial/model';
import type {CommercialData,CommercialSequence} from '../src/studio/commercial/model';

function measuredContext():CanvasRenderingContext2D {
  const context={font:'48px Test',letterSpacing:'0px',measureText(text:string){const size=Number(this.font.match(/([\d.]+)px/)?.[1]??48),spacing=Number.parseFloat(this.letterSpacing)||0,glyphs=[...text];return {width:glyphs.reduce((sum,c)=>sum+size*(c==='W'?.9:/\s/u.test(c)?.25:.47),0)+Math.max(0,glyphs.length-1)*spacing,actualBoundingBoxAscent:size*.72,actualBoundingBoxDescent:size*.18};}};
  return context as unknown as CanvasRenderingContext2D;
}
const context=measuredContext();
const originalDocument=globalThis.document,originalFontFace=globalThis.FontFace;
Object.assign(globalThis,{document:{fonts:{add(){}},createElement(){return {width:0,height:0,getContext(){return measuredContext();}};}},FontFace:class {async load(){return this;}}});
test.after(()=>{Object.assign(globalThis,{document:originalDocument,FontFace:originalFontFace});});
function fixture():CommercialData {
  return {...normalizeCommercialData(DEFAULT_COMMERCIAL_DATA),textMode:'full',sequenceTiming:'auto',sequences:[{id:'original',layout:'central',duration:8,pages:[{title:'COMMUNIQUÉ',body:'Le rendez-vous est fixé à Cotonou.'}]}]};
}
const prose='À Cotonou, l’équipe accueille les familles pour une réunion publique. Les renseignements pratiques seront disponibles auprès du secrétariat. ';

test('pagination preserves exact CRLF, accents, spaces, tabs and complete graphemes',()=>{
  for(const text of [prose.repeat(20),'  Première phrase.\r\n\r\nDeuxième\tphrase !\n'+prose.repeat(5)+'   ',('É👨‍👩‍👦é '.repeat(30)),'mot'.repeat(80),'Avant\n\n\n\n\n\n\n\nAprès']){
    const measure=(s:string)=>[...new Intl.Segmenter('fr',{granularity:'grapheme'}).segment(s)].length;
    const pages=paginateReadableText(text,35,4,measure);
    assert.equal(pages.join(''),text);assert.ok(pages.every(page=>page.trim().length>0));
    for(const page of pages){const lines=wrapReadableText(page,35,measure);assert.ok(lines.length<=4);assert.ok(lines.every(line=>measure(line.text)<=35));}
    const boundaries=new Set([0,...[...new Intl.Segmenter('fr',{granularity:'grapheme'}).segment(text)].map(s=>s.index+s.segment.length)]);let at=0;
    for(const page of pages){at+=page.length;assert.ok(boundaries.has(at));}
  }
});

test('all readable layouts retain large text and reserve the footer',()=>{
  for(const layout of ['central','columns','left','right','final'] as const)for(const slot of layout==='columns'?[0,1]:[0]){
    const page={title:'COMMUNIQUÉ',body:prose.slice(0,115)},result=readablePageLayout(context,page,layout,slot);
    const titleSize=layout==='central'?80:72;
    assert.equal(result.body.size,48);assert.equal(result.title.size,titleSize);assert.equal(result.maxBodyLines,3);
    assert.ok(result.panel.x>=96&&result.panel.x+result.panel.width<=1824);assert.ok(result.panel.y>=224&&result.panel.y+result.panel.height<=732.001);
    const small={...page,style:{...commercialPageStyle(page,0),titleScale:.6,bodyScale:.65}};
    assert.equal(readablePageLayout(context,small,layout,slot).body.size,42);assert.equal(readablePageLayout(context,small,layout,slot).title.size,titleSize*.6);
  }
});

test('two-line titles keep their chosen size and pagination preserves every character beneath them',async()=>{
  for(const layout of ['central','columns','final'] as const){
    const title=layout==='columns'?'Une rencontre pour les familles':'Une rencontre culturelle pour les familles et les visiteurs';
    const page={title,body:'Un message clair et lisible.'},result=readablePageLayout(context,page,layout);
    assert.equal(result.title.lines.length,2);
    assert.equal(result.title.size,layout==='central'?80:72);
    assert.deepEqual(result.issues,[]);
    assert.ok(result.title.rect.y+result.title.height<result.body.rect.y);
    assert.ok(result.maxBodyLines>=1&&result.maxBodyLines<=3);
    const data=fixture(),body='  '+prose.repeat(10)+'\r\nDernière précision.  ';
    data.sequences=[{id:'two-line-title',layout,duration:8,pages:layout==='columns'?[{title,body},{title:'Autre information',body:'Un rendez-vous à retenir.'}]:[{title,body}]}];
    const before=JSON.stringify(data),split=await splitCommercialPages(data);
    assert.equal(JSON.stringify(data),before);
    assert.equal(split.sequences!.map(sequence=>sequence.pages[0].body).join(''),body);
    assert.ok(split.sequences!.every(sequence=>sequence.pages[0].title===title));
    assert.deepEqual(readableTextIssues(context,split),[]);
  }
});

test('central and final panels keep an explicit reading-area center at every content height',()=>{
  for(const layout of ['central','final'] as const)for(const body of ['Court.','Une première ligne.\nUne deuxième ligne.','Un\nDeux\nTrois\nQuatre\nCinq']){
    const result=readablePageLayout(context,{title:'COMMUNIQUÉ',body},layout);
    assert.equal(result.panel.x+result.panel.width/2,960);
    assert.equal(result.panel.y+result.panel.height/2,READABLE_AREA_CENTER_Y);
    assert.equal(result.title.pivot.x,960);assert.equal(result.body.pivot.x,960);
  }
  const left=readablePageLayout(context,{title:'GAUCHE',body:'Information.'},'left');
  const right=readablePageLayout(context,{title:'DROITE',body:'Information.'},'right');
  assert.equal(left.panel.x+left.panel.width/2,792);
  assert.equal(right.panel.x+right.panel.width/2,1128);
});

test('accents and descenders do not shift column headers, body starts or text baselines',()=>{
  const accentedContext=measuredContext(),measure=accentedContext.measureText;
  accentedContext.measureText=function(text:string){
    const metrics=measure.call(this,text),size=Number(this.font.match(/([\d.]+)px/)?.[1]??48);
    return {...metrics,actualBoundingBoxAscent:size*(/[ÉÀÂ]/u.test(text)?.88:.72),actualBoundingBoxDescent:size*(/[gpq]/u.test(text)?.18:.02)} as TextMetrics;
  };
  const a=readablePageLayout(accentedContext,{title:'LE MESSAGE',body:'Un message essentiel.\nDes mots clairs.'},'columns',0);
  const b=readablePageLayout(accentedContext,{title:'VOTRE IDENTITÉ',body:'Écoutez le message.\nUne présentation soignée.'},'columns',1);
  assert.equal(a.title.height,b.title.height);
  assert.equal(a.title.rect.y+a.title.rect.height,b.title.rect.y+b.title.rect.height);
  assert.equal(a.body.rect.y,b.body.rect.y);
  assert.equal(a.title.rect.y+a.title.ascent,b.title.rect.y+b.title.ascent);
  assert.equal(a.body.rect.y+a.body.ascent,b.body.rect.y+b.body.ascent);
  assert.equal(a.body.height,b.body.height);
  assert.equal(a.panel.height,b.panel.height);
  assert.equal(a.maxBodyLines,b.maxBodyLines);
});

test('density and oversized titles report actionable errors without shrinking the font',()=>{
  const data=fixture();data.sequences![0].pages[0].body=prose.repeat(20);
  const result=readablePageLayout(context,data.sequences![0].pages[0],'central');
  assert.equal(result.body.size,48);assert.ok(result.issues.some(issue=>issue.includes('Résumez')));
  assert.ok(readableTextIssues(context,data).every(issue=>!issue.includes('déplacement')));
  const title={title:'W'.repeat(34),body:'Un texte court.'};
  assert.ok(readablePageLayout(context,title,'columns').issues.some(issue=>issue.includes('titre')));
});

test('default footer is clear and a manually moved text cannot cover the advertiser logo unnoticed',()=>{
  const data=fixture(),page={title:'COMMUNIQUÉ',body:'WWWW '.repeat(16)};
  data.sequences=[{id:'right',layout:'right',duration:8,pages:[page]}];
  const footer={x:1680,y:756,width:144,height:228};
  assert.deepEqual(readableTextIssues(context,data,footer),[]);
  data.sequences[0].pages=[{...page,style:{...commercialPageStyle(page,2),bodyX:100,bodyY:200}}];
  assert.ok(readableTextIssues(context,data,footer).some(issue=>issue.includes('logo recouvre')));
});

test('explicit split preserves all content, source data, styles and stable first ID',async()=>{
  const data=fixture(),page=data.sequences![0].pages[0];page.body='  '+prose.repeat(14)+'\r\nDernière ligne.  ';
  page.style={...commercialPageStyle(page,0),bodyCase:'upper',bodyFont:'original'};const before=JSON.stringify(data);
  const split=await splitCommercialPages(data);
  assert.equal(JSON.stringify(data),before);assert.ok(split.sequences!.length>1);assert.equal(split.sequences![0].id,'original');
  assert.equal(new Set(split.sequences!.map(sequence=>sequence.id)).size,split.sequences!.length);
  assert.equal(split.sequences!.map(sequence=>sequence.pages[0].body).join(''),page.body);
  assert.ok(split.sequences!.every(sequence=>sequence.pages[0].title===page.title&&sequence.pages[0].style?.bodyCase==='upper'));
  assert.deepEqual(readableTextIssues(context,split),[]);
  const twice=await splitCommercialPages(split);assert.deepEqual(twice,split);
});

test('asymmetric columns continue on the correct side without duplicating the short column',async()=>{
  const data=fixture();data.sequences=[{id:'pair',layout:'columns',duration:8,pages:[{title:'GAUCHE',body:prose.repeat(5)},{title:'DROITE',body:'Une courte information.'}]}];
  const result=await splitCommercialPages(data,{index:1}),pages=result.sequences!.flatMap(sequence=>sequence.pages);
  assert.equal(pages.filter(page=>page.title==='GAUCHE').map(page=>page.body).join(''),data.sequences[0].pages[0].body);
  assert.equal(pages.filter(page=>page.title==='DROITE').map(page=>page.body).join(''),data.sequences[0].pages[1].body);
  assert.equal(result.sequences![0].layout,'columns');assert.ok(result.sequences!.slice(1).every(sequence=>sequence.layout==='left'));
  assert.deepEqual(readableTextIssues(context,result),[]);
});

test('splitting a selected sequence does not change or reject another unfinished long draft',async()=>{
  const data=fixture();data.sequences![0].pages[0].body=prose.repeat(6);
  const other:CommercialSequence={id:'other',layout:'central',duration:8,pages:[{title:'AUTRE',body:prose.repeat(8)}]};data.sequences!.push(other);
  const split=await splitCommercialPages(data,{index:0});assert.equal(split.sequences!.at(-1),other);assert.ok(split.sequences!.length>2);
});

test('pagination fails without mutation for cancellation, legacy and project size limits',async()=>{
  const data=fixture(),controller=new AbortController();controller.abort();await assert.rejects(splitCommercialPages(data,{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(splitCommercialPages(normalizeCommercialData(DEFAULT_COMMERCIAL_DATA)),/Choisissez/);
  data.sequences![0].pages[0].body=prose.repeat(200);const before=JSON.stringify(data);
  await assert.rejects(splitCommercialPages(data),/séquences|10 minutes/);assert.equal(JSON.stringify(data),before);
});

test('readable motion has a strictly immobile plateau and no overlap with next sequence',()=>{
  const start=3.4,end=11.4;
  assert.deepEqual(readableSequenceMotion(start+.5,start,end),{visible:true,alpha:1,dy:0});
  for(let t=start+.5;t<end-.35;t+=.031)assert.deepEqual(readableSequenceMotion(t,start,end),{visible:true,alpha:1,dy:0});
  assert.equal(readableSequenceMotion(start,start,end).alpha,0);assert.equal(readableSequenceMotion(end,start,end).visible,false);
  let prior=-1;for(let t=start;t<start+.5;t+=.01){const alpha=readableSequenceMotion(t,start,end).alpha;assert.ok(alpha>=prior);prior=alpha;}
});
