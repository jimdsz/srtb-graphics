import test from 'node:test';
import assert from 'node:assert/strict';
import {fitSocialText,fitSocialTextForDisplay} from '../src/studio/social-text-fit';

const measure=(text:string,size:number)=>({width:[...text].reduce((sum,char)=>sum+(char===' '?.25:.65),0)*size});
const content=(lines:string[])=>lines.join(' ').replace(/\s+/g,' ').trim();

test('display retains the exact charter fit for ordinary titles',()=>{
  for(const text of ['LE GRAND ENTRETIEN','LE GRAND\nENTRETIEN','UNE ÉMISSION AU CŒUR DU BÉNIN']){
    assert.deepEqual(fitSocialTextForDisplay(text,600,200,70,38,3,measure),fitSocialText(text,600,200,70,38,3,measure));
  }
});

test('a fourth entered line and blank lines stay intact at charter size when the area allows them',()=>{
  for(const text of ['ALPHA\nBÊTA\nGAMMA\nDELTA','ALPHA\n\nBÊTA\n\nGAMMA']){
    const fit=fitSocialTextForDisplay(text,900,500,70,38,3,measure);
    assert.deepEqual(fit.lines,text.split('\n'));assert.equal(fit.size,70);assert.equal(fit.adjustment,'lines');assert.equal(fit.scale,undefined);
  }
});

test('dense paragraphs and unbroken words use measured uniform scaling without clipping or truncation',()=>{
  for(const text of ['WW'.repeat(1024),'ALPHA\n'.repeat(300)+'OMEGA','Une émission au cœur du Bénin. '.repeat(60)]){
    const fit=fitSocialTextForDisplay(text,600,132,56,34,3,measure),scale=fit.scale??1;
    assert.equal(fit.adjustment,'size');assert.equal(content(fit.lines),content([text]));
    assert.ok(fit.size*scale>0);assert.ok(fit.size*scale<34);
    assert.ok(fit.lines.length*fit.size*1.14*scale<=132+1e-8);
    assert.ok(fit.lines.every(line=>measure(line,fit.size).width*scale<=600+1e-8));
  }
});

test('glyph overhang counts in the fallback, and renderer failures are not converted into editorial advice',()=>{
  const fit=fitSocialTextForDisplay('abc',100,100,30,30,1,()=>({width:90,actualBoundingBoxLeft:8,actualBoundingBoxRight:194}));
  assert.equal(fit.adjustment,'size');assert.ok(202*(fit.scale??1)<=100);
  const broken=new Error('Canvas measurement unavailable');
  assert.throws(()=>fitSocialTextForDisplay('ALPHA',100,100,30,30,1,()=>{throw broken;}),error=>error===broken);
  assert.throws(()=>fitSocialTextForDisplay('ALPHA',0,100,30,30,1,measure),/Zone de texte social invalide/);
});
