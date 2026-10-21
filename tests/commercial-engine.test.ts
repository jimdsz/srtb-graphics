import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMERCIAL_FPS, DEFAULT_COMMERCIAL_DATA, commercialTimeline, effectiveCommercialDuration, normalizeCommercialData, validateCommercialData} from '../src/studio/commercial/model';
import type {CommercialAudio} from '../src/studio/commercial/model';
import {commercialAudioEvents} from '../src/studio/commercial/audio';
import {wrapCommercialText, commercialLogoBounds} from '../src/studio/commercial/render';
import {commercialBackgroundTime} from '../src/studio/commercial/background';

function fixture() {
  const data = normalizeCommercialData(DEFAULT_COMMERCIAL_DATA); data.issuer = 'Annonceur';
  data.pages.forEach(page => {page.body = 'Une information destinée au public.';});
  return data;
}
const track = (url: string, changes: Partial<CommercialAudio> = {}): CommercialAudio => ({url, name: 'Voix.wav', duration: 8, start: 0, end: 0, delay: 3.4034034034, volume: 1, loop: false, fadeIn: 0, fadeOut: 0, ...changes});

test('commercial native cadence is preserved for all three durations and all reading transitions', () => {
  for (const duration of [60, 75, 90]) {
    const t = commercialTimeline(duration);
    assert.equal(t.fps, 29.97); assert.equal(t.frames, Math.floor(duration * COMMERCIAL_FPS));
    assert.ok(t.duration <= duration && duration - t.duration < 1 / COMMERCIAL_FPS);
    assert.ok(t.firstStart < t.dualStart && t.dualStart < t.finalStart && t.finalStart < t.closingStart);
    for (const point of [t.firstStart, t.dualStart, t.finalStart, t.closingStart]) assert.ok(Math.abs(point * COMMERCIAL_FPS - Math.round(point * COMMERCIAL_FPS)) < 1e-8);
  }
});

test('four independent text limits and reserved top-left logo placement are enforced', () => {
  const data = fixture(); assert.deepEqual(validateCommercialData(data), []);
  data.pages[2].body = 'x'.repeat(361); assert.ok(validateCommercialData(data).some(e => e.includes('Droite')));
  data.pages[2].body = 'Court'; data.pages[0].title = 'Deux\nlignes'; assert.ok(validateCommercialData(data).some(e => e.includes('Central')));
  data.pages[0].title = 'COMMUNIQUÉ';
  assert.ok(validateCommercialData({...data, logo: {url: '/logo.png', name: 'Logo', mode: 'original', position: 'top-left', scale: 1}}).some(e => e.includes('supérieur gauche')));
  assert.deepEqual(validateCommercialData(DEFAULT_COMMERCIAL_DATA, {draft: true}), []);
});

test('fresh announcements carry no voice, music, or advertiser logo from another announcement', () => {
  const first = normalizeCommercialData(DEFAULT_COMMERCIAL_DATA); first.voice = track('voice-one.wav'); first.pages[0].body = 'Annonce un';
  const second = normalizeCommercialData(DEFAULT_COMMERCIAL_DATA);
  assert.equal(second.voice, null); assert.equal(second.music, null); assert.equal(second.logo, null); assert.equal(second.pages[0].body, '');
});

test('voice selection preserves source trim and timing exactly, and never loops or silently cuts a long voice', () => {
  const data = fixture(); data.voice = track('voice.wav', {start: 2, end: 5.25, delay: 4.5, volume: .8});
  const [event] = commercialAudioEvents(data);
  assert.equal(event.start, 2); assert.equal(event.at, 4.5); assert.equal(event.duration, 3.25); assert.equal(event.gain(5), .8);
  data.voice = track('long.wav', {duration: 90});
  assert.deepEqual(validateCommercialData(data), []); assert.ok(effectiveCommercialDuration(data)>96);
  assert.equal(commercialAudioEvents(data)[0].duration,90);
  data.voice = track('voice.wav', {loop: true}); assert.throws(() => commercialAudioEvents(data), /boucler/);
});

test('music loops only the selected range while envelope and final cut follow the full announcement', () => {
  const data = fixture(); data.voice = track('voice.wav', {volume: .9});
  data.music = track('music.wav', {duration: 120, start: 10, end: 17, delay: 0, volume: .15, loop: true, fadeIn: 1, fadeOut: 2});
  const events = commercialAudioEvents(data), music = events.filter(event => event.url === 'music.wav'), tl = commercialTimeline(data);
  assert.equal(events[0].url, 'voice.wav'); assert.equal(events[0].gain(4), .9);
  assert.equal(music.length, Math.ceil(tl.duration/7)); assert.ok(music.every(event => event.start === 10));
  assert.equal(music[0].gain(0), 0); assert.equal(music[0].gain(.5), .075);
  assert.equal(music[1].gain(7), .15); assert.equal(music.at(-1)!.gain(tl.duration), 0);
  assert.ok(Math.abs(music.at(-1)!.at + music.at(-1)!.duration - tl.duration) < 1e-8);
});

test('voice duration follows the selected passage exactly with whole-frame room before the closing',()=>{
  const data=fixture();data.voice=track('voice.wav',{duration:37.2,end:37.2});
  assert.ok(Math.abs(effectiveCommercialDuration(data)-44.1)<.05);
  for(let length=.01;length<55;length+=.137){data.voice.end=length;data.voice.duration=60;const tl=commercialTimeline(data);const event=commercialAudioEvents(data)[0];assert.ok(event.at+event.duration<=tl.closingStart+.000001);}
  data.voice=track('voice.wav',{duration:180,start:12.5,end:140.2,delay:5.5});assert.ok(effectiveCommercialDuration(data)>136&&effectiveCommercialDuration(data)<137);
  data.voice=null;data.duration=123.456;assert.equal(effectiveCommercialDuration(data),123.456);assert.deepEqual(validateCommercialData(data),[]);
  data.voice=track('long.wav',{duration:600});assert.ok(validateCommercialData(data).some(message=>message.includes('10 minutes')));
});

test('long announcements keep the native background moving through reading and closing',()=>{
  const data=fixture();data.duration=180;const tl=commercialTimeline(data),source=89.9899;
  const a=commercialBackgroundTime(data,source,100),b=commercialBackgroundTime(data,source,130),closing=commercialBackgroundTime(data,source,tl.closingStart+1);
  assert.ok(b.time>a.time&&b.time<source);assert.equal(a.rate,1);assert.equal(b.rate,1);assert.equal(closing.rate,1);
  const beforeClosing=commercialBackgroundTime(data,source,tl.closingStart+1-1/COMMERCIAL_FPS);
  assert.ok(Math.abs(closing.time-beforeClosing.time-1/COMMERCIAL_FPS)<1e-6);
  assert.equal(commercialBackgroundTime(data,source,1).time,1);
});

test('large advertiser logos and extreme offsets preserve the canvas and reserved upper-left',()=>{
  for(const position of ['bottom-right','bottom-center','top-right'] as const)for(const offsetX of [-600,0,600])for(const offsetY of [-400,0,400]){
    const box=commercialLogoBounds({url:'logo',name:'Logo',position,mode:'original',scale:4,offsetX,offsetY,plate:'white'},600,200);
    assert.ok(box.x-box.width/2-12>=96&&box.x+box.width/2+12<=1824);
    assert.ok(box.y-box.height/2-12>=96&&box.y+box.height/2+12<=984);
    assert.ok(box.x-box.width/2-12>=960||box.y-box.height/2-12>=540);
  }
});

test('source range exceeding actual stored duration and malformed audio options are rejected', () => {
  const data = fixture(); data.music = track('bad.wav', {start: 9});
  assert.ok(validateCommercialData(data).some(e => e.includes('hors du fichier')));
  assert.throws(() => commercialAudioEvents(data), /hors du fichier/);
  data.music = track('bad.wav', {volume: 3}); assert.ok(validateCommercialData(data).some(e => e.includes('200')));
});

test('native opening sting is retained, without carrying a previous announcement voice', () => {
  const data = fixture(), events = commercialAudioEvents(data);
  assert.equal(events.length, 1); assert.equal(events[0].url, '/commercial-assets/opening.wav');
  assert.equal(events[0].duration, commercialTimeline(60).firstStart); assert.equal(events[0].gain(0), 1);
  data.signatureVolume = .5; assert.equal(commercialAudioEvents(data)[0].gain(0), .5);
  data.signatureEnabled = false; assert.deepEqual(commercialAudioEvents(data), []);
  assert.equal(normalizeCommercialData({}).signatureEnabled, true);
});

test('paragraph wrapping respects authored newlines and cannot overflow on an unbroken address', () => {
  const lines = wrapCommercialText('Premier paragraphe\n\nhttps://annonceur.example/treslongueadresse', 15, s => s.length);
  assert.equal(lines[2], ''); assert.ok(lines.every(line => line.length <= 15));
  assert.equal(lines.slice(3).join(''), 'https://annonceur.example/treslongueadresse');
});
