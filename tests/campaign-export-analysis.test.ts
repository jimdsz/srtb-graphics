import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {FREQUENCIES,RATE,readSyntheticFixture,stereoFloat32,voiceWindow,analyzeVoice,parseFrameHashes,analyzeAlphaHashes} from './campaign-export-analysis.mjs';

test('fixture parser accepts each exact antiphase signal and rejects another frequency without disk prerequisites',()=>{
  for(const frequency of FREQUENCIES){
    const bytes=Buffer.alloc(44+172800*4);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(RATE,24);bytes.writeUInt32LE(RATE*4,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(172800*4,40);
    for(let n=0;n<172800;n++){const t=n/RATE,value=Math.round((t<.04||t>3.56?.4:.12)*Math.sin(2*Math.PI*frequency*t)*32767);bytes.writeInt16LE(value,44+n*4);bytes.writeInt16LE(-value,46+n*4);}
    assert.equal(readSyntheticFixture(bytes,frequency).length,172800);
    assert.throws(()=>readSyntheticFixture(bytes,frequency+100),/différente/);
  }
});

function signal(frequency:number){
  const length=Math.round(20.12*RATE),left=new Float64Array(length),right=new Float64Array(length),side=new Float64Array(length),mid=new Float64Array(length),fixture=new Float64Array(172800);
  for(let n=0;n<length;n++){const music=.08*Math.sin(2*Math.PI*317*n/RATE);left[n]=right[n]=mid[n]=music;}
  for(let n=0;n<fixture.length;n++){
    const t=n/RATE,envelope=t<.04||t>3.56?.4:.12,value=Math.round(envelope*Math.sin(2*Math.PI*frequency*t)*32767)/32768;fixture[n]=value;
    for(const start of [.76,15.68]){const index=Math.round(start*RATE)+n;left[index]+=value;right[index]-=value;side[index]=value;}
  }
  return {pcm:{left,right,side,mid},fixture};
}

test('complex projection distinguishes all five frequencies without fixed-phase or mono cancellation',()=>{
  for(const frequency of FREQUENCIES){
    const {pcm}=signal(frequency),window=voiceWindow(pcm,.84,1.04,frequency);
    assert.equal(window.winnerHz,frequency);assert.ok(window.expectedVsOtherDb>80);
    assert.ok(Math.abs(Math.abs(window.leftRightPhaseDegrees)-180)<1);
    assert.ok(window.sideVsMidDb>30);
    const wrong=voiceWindow(pcm,.84,1.04,frequency===400?500:400);
    assert.notEqual(wrong.winnerHz,frequency===400?500:400);assert.ok(wrong.expectedVsOtherDb< -80);
  }
});

test('head/tail bins and terminal marker reveal a truncated tail without claiming a global pass',()=>{
  const {pcm,fixture}=signal(600),complete=analyzeVoice(pcm,fixture,600);
  assert.equal(complete.insertions.length,2);
  for(const insertion of complete.insertions){
    assert.equal(insertion.wholePassage.bins10ms,360);assert.equal(insertion.wholePassage.expectedWins,360);
    assert.ok(Math.abs(insertion.terminalMarker.amplitudeIncreaseDb-20*Math.log10(.4/.12))<.001);
    assert.equal(insertion.head10ms.length,8);assert.equal(insertion.tail10ms.length,4);
  }
  pcm.side.fill(0,Math.round(19.24*RATE),Math.round(19.28*RATE));
  const clipped=analyzeVoice(pcm,fixture,600);
  assert.equal(clipped.insertions[1].terminalMarker.terminal.expectedAmplitude,0);
  assert.equal(clipped.insertions[1].wholePassage.expectedWins,356);
  assert.equal(clipped.insertions[0].wholePassage.expectedWins,360);
});

test('float PCM keeps both channels and refuses non-finite or incomplete samples',()=>{
  const bytes=Buffer.alloc(16);bytes.writeFloatLE(.4,0);bytes.writeFloatLE(-.4,4);bytes.writeFloatLE(.2,8);bytes.writeFloatLE(.2,12);
  const pcm=stereoFloat32(bytes);assert.ok(Math.abs(pcm.side[0]-.4)<1e-7);assert.equal(pcm.mid[0],0);assert.equal(pcm.side[1],0);
  assert.throws(()=>stereoFloat32(bytes.subarray(0,15)),/incomplet/);bytes.writeFloatLE(NaN,0);assert.throws(()=>stereoFloat32(bytes),/non fini/);
  const silence=new Float64Array(480);assert.equal(voiceWindow({left:silence,right:silence,side:silence,mid:silence},0,.01,400).winnerHz,null);
});

test('full-resolution alpha hashes distinguish zero alpha from even one nonzero sample',()=>{
  const zero=Buffer.alloc(16),one=Buffer.from(zero);one.writeUInt16LE(1,14);
  const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
  const frames=parseFrameHashes(`#format: frame checksums\n0,0,0,1,16,${hash(one)}\n0,1,1,1,16,${hash(zero)}\n`);
  const result=analyzeAlphaHashes(frames,4,2);assert.equal(result.lastFrameCompletelyTransparent,true);assert.equal(result.framesWithSomeAlpha,1);assert.equal(result.consecutiveTransparentTailFrames,1);
  assert.equal(analyzeAlphaHashes([...frames].reverse(),4,2).lastFrameCompletelyTransparent,false);
  assert.throws(()=>analyzeAlphaHashes(frames,4,3),/taille inattendue/);assert.throws(()=>parseFrameHashes('invalid'),/inattendue/);
});

test('CLI refuses implicit paths, URLs, wildcards, prototype keys and duplicate inputs before reading media',()=>{
  const script=fileURLToPath(new URL('./check-campaign-exports.mjs',import.meta.url));
  for(const args of [[],['mardi-tv=relative.mp4'],['mardi-tv=https://example.test/a.mp4'],['mardi-tv=C:\\Exports\\*.mp4'],['__proto__=C:\\Exports\\a.mp4'],['popup-alpha=C:\\Exports\\a.mp4'],['mardi-tv=C:\\Exports\\a.mp4','mardi-tv=C:\\Exports\\b.mp4']]){
    const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',windowsHide:true,timeout:5000});
    assert.equal(result.status,1);const report=JSON.parse(result.stdout);assert.equal(report.campaignQualified,false);assert.equal(report.results.length,0);assert.ok(report.error);
  }
});
