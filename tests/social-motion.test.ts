import test from 'node:test';
import assert from 'node:assert/strict';
import {socialSignature,socialSignatureOpacity,socialSignatureLift,socialEndOpacity,SOCIAL_SETTLE_SECONDS} from '../src/studio/social-motion';
import {makeTimeline,TIMINGS} from '../src/studio/video/timeline';
import {readFileSync} from 'node:fs';
import {TDS_SOCIAL_MOTION,tdsSocialCardMotion} from '../src/studio/social-motion';

test('BA social excerpts never manufacture opening or closing signatures',()=>{
  for(const outAt of [7.6,12,64.8,120]){
    const line=makeTimeline('BTV_BA_1P',{_studio_format:'portrait',_out_mode:'manual'},{},outAt);
    for(const at of [0,.04,3,4.32])assert.equal(socialSignature('BTV_BA_1P',at,line),undefined);
    for(const at of [4.36,5.56,outAt-.04])assert.equal(socialSignature('BTV_BA_1P',at,line),undefined);
    for(const at of [outAt,outAt+1.36,outAt+6.44,line.duration-.04])assert.equal(socialSignature('BTV_BA_1P',at,line),undefined);
    assert.equal(socialSignature('BTV_BA_1P',line.duration,line),undefined);
    assert.equal(line.frames,Math.round(outAt*25),'only the selected excerpts are retained');
  }
});

test('manual preview holds never manufacture a closing signature or depend on playback order',()=>{
  const manual={outAt:Infinity,duration:Infinity};
  for(const id of ['BTV_BA_1P','BTV_Evenement','BTV_Ce_Soir','BTV_Renvoi'])for(const at of [150,8,60,4.36])assert.equal(socialSignature(id,at,manual),undefined);
  const line={outAt:73.28,duration:81.4};
  assert.equal(socialSignature('BTV_BA_1P',75,line),undefined);
  assert.equal(socialSignature('BTV_BA_1P',4,line),undefined);
  assert.equal(socialSignature('BTV_BA_1P',9,line),undefined);
});

test('AE, weekly final and TDS output phases remain on their own output clock',()=>{
  for(const [id,entry]of [['BTV_Evenement',4.08],['BTV_Semainier',2.96],['BTV_Ce_Soir',1.6],['BTV_Renvoi',2.8]] as const){
    const line=makeTimeline(id,{_out_mode:'duration',_out_duration_seconds:TIMINGS[id].stop},{},0);
    assert.equal(socialSignature(id,entry-.04,line)?.phase,'intro');assert.equal(socialSignature(id,entry,line),undefined);
    assert.equal(socialSignature(id,line.outAt,line)?.phase,'outro');
  }
  assert.equal(socialSignature('BTV_Semainier',19.8,{outAt:Infinity,duration:Infinity})?.phase,'outro');
  assert.equal(socialSignature('BTV_Semainier',9,{outAt:8,duration:11.08})?.start,8);
  for(const id of ['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE']){const line={outAt:30,duration:30.72};assert.equal(socialSignature(id,0,line)?.phase,'intro');assert.equal(socialSignature(id,4.32,line)?.phase,'intro');assert.equal(socialSignature(id,4.36,line),undefined);assert.equal(socialSignature(id,30,line)?.phase,'outro');}
  assert.equal(socialSignature('BTV_PopUp',12.2,{outAt:12,duration:12.84}),undefined,'overlay compositions keep transparency');
});

test('TDS signature coverage retains the native media windows while social text starts immediately',()=>{
  for(const id of ['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE']){
    const source=JSON.parse(readFileSync(new URL(`../public/library/v1.7.0/${id}/lib/lottie-template.json`,import.meta.url),'utf8'));
    const prefix=id==='BTV_BA_TDS'?'':'_p1';
    const titles=source.layers.filter((layer:any)=>layer.nm===`${prefix}_titre_ligne_1`&&layer.ip===89);
    assert.ok(titles.length);assert.ok(titles.every((layer:any)=>layer.ks.p.k.at(-1).t/source.fr===TDS_SOCIAL_MOTION.introEnd));
    assert.equal(TDS_SOCIAL_MOTION.introTitleStart,0,'social titles do not wait behind the native AE reveal');
    if(id==='BTV_BA_TDS_SUIVI_DE'){
      const second=source.layers.filter((layer:any)=>layer.nm==='_p2_titre_ligne_1'&&layer.ip===395);
      assert.ok(second.length);assert.ok(second.every((layer:any)=>layer.ks.p.k.at(-1).t/source.fr===TDS_SOCIAL_MOTION.followupEnd));
      assert.equal(TDS_SOCIAL_MOTION.followupTitleStart,TDS_SOCIAL_MOTION.followupStart);
      const engine=readFileSync(new URL('../public/library/v1.7.0/BTV_BA_TDS_SUIVI_DE/dynamic-graphic.mjs',import.meta.url),'utf8');
      assert.match(engine,/CROSS_START = 345/);assert.equal(TDS_SOCIAL_MOTION.followupStart,345/source.fr);
    }
  }
  const line={outAt:24.28,duration:25};
  assert.equal(socialSignature('BTV_BA_TDS_SUIVI_DE',13.76,line),undefined);
  assert.equal(socialSignature('BTV_BA_TDS_SUIVI_DE',13.8,line)?.phase,'transition');
  assert.equal(socialSignature('BTV_BA_TDS_SUIVI_DE',16.56,line)?.phase,'transition');
  assert.equal(socialSignature('BTV_BA_TDS_SUIVI_DE',16.6,line),undefined);
  assert.equal(socialSignature('BTV_BA_TDS_SUIVI_DE',14.2,{outAt:14,duration:14.72})?.phase,'outro','manual OUT supersedes the programme transition');
});

test('TDS cards are readable from the first signature frame and settle independently of AE title keys',()=>{
  for(const id of ['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE']){
    assert.equal(tdsSocialCardMotion(id,0,30)!.elapsed,0);
    const entered=tdsSocialCardMotion(id,SOCIAL_SETTLE_SECONDS,30)!;assert.equal(entered.elapsed,entered.duration);
  }
  const id='BTV_BA_TDS_SUIVI_DE';
  assert.equal(tdsSocialCardMotion(id,345/25,30)!.second,true);
  assert.equal(tdsSocialCardMotion(id,345/25,30)!.elapsed,0);
  assert.ok(tdsSocialCardMotion(id,14.8,30)!.elapsed>tdsSocialCardMotion(id,14.8,30)!.duration);
  assert.equal(tdsSocialCardMotion('BTV_BA_1P',0,12),undefined,'BA starts directly without an animation');
});

test('short exits hold a complete readable card before a single final fade',()=>{
  for(const duration of [.72,.84,1,1.2,2.6,8.12]){
    assert.equal(socialEndOpacity(10,10,10+duration),1);
    assert.equal(socialEndOpacity(10+duration/2,10,10+duration),1);
    assert.equal(socialEndOpacity(10+duration,10,10+duration),0);
    let last=1;for(let at=10;at<10+duration;at+=.04){const opacity=socialEndOpacity(at,10,10+duration);assert.ok(opacity<=last);last=opacity;}
  }
});

test('signature placement meets content geometry and early manual OUT continues the existing placement',()=>{
  for(const [id,entry] of [['BTV_BA_TDS',4.36],['BTV_Renvoi',2.8]] as const){
    const open={outAt:Infinity,duration:Infinity};
    assert.equal(socialSignatureLift(socialSignature(id,0,open),id),1);
    assert.equal(socialSignatureLift(socialSignature(id,entry,open),id),0);
    for(const outAt of [.12,entry-.24,8]){
      const before=socialSignatureLift(socialSignature(id,outAt,open),id),line={outAt,duration:outAt+(id==='BTV_BA_TDS'?.72:8.12)};
      assert.equal(socialSignatureLift(socialSignature(id,outAt,line),id),before);
    }
  }
});

test('TDS OUT never restarts the card entrance or changes programme after the OUT trigger',()=>{
  for(const id of ['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'])for(const outAt of [2,3.8,8,13.76,14,16,30]){
    const frozen=tdsSocialCardMotion(id,outAt,outAt);
    assert.deepEqual(tdsSocialCardMotion(id,outAt+.04,outAt),frozen);
    assert.deepEqual(tdsSocialCardMotion(id,outAt+.68,outAt),frozen);
  }
  assert.equal(tdsSocialCardMotion('BTV_BA_TDS_SUIVI_DE',14,13.76)!.second,false);
  assert.ok(tdsSocialCardMotion('BTV_BA_TDS',30,30)!.elapsed>1);
});

test('signature opacity is stable while held and clears fully only at the output end',()=>{
  const line={outAt:12,duration:20.12},intro=socialSignature('BTV_BA_TDS',0,line)!,outro=socialSignature('BTV_BA_TDS',12,line)!;
  assert.equal(socialSignatureOpacity(intro,0),1);assert.equal(socialSignatureOpacity(intro,4.32),1);
  assert.equal(socialSignatureOpacity(outro,12),1);assert.equal(socialSignatureOpacity(outro,19),1);
  assert.ok(socialSignatureOpacity(outro,20.08)>0);assert.equal(socialSignatureOpacity(outro,20.12),0);
  const held=socialSignature('BTV_Semainier',80,{outAt:Infinity,duration:Infinity})!;assert.equal(socialSignatureOpacity(held,80),1);
});
