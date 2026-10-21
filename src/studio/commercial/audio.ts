import {ALL_FORMATS, Input} from 'mediabunny';
import {mixAudio} from '../video/audio';
import type {AudioEvent} from '../video/audio';
import {browserSource} from '../video/source';
import {commercialTimeline} from './model';
import type {CommercialAudio, CommercialData} from './model';

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** One event plan is used by the preview and by the rendered AAC track. */
export function commercialAudioEvents(data: CommercialData): AudioEvent[] {
  const timeline = commercialTimeline(data), events: AudioEvent[] = [];
  for (const kind of ['voice', 'music'] as const) {
    const track = data[kind];
    if (!track) continue;
    const end = track.end || track.duration, length = end - track.start, delay = kind === 'voice' ? Math.max(timeline.firstStart, track.delay) : track.delay;
    const until = kind === 'voice' ? timeline.closingStart : timeline.duration;
    if (!(length > 0) || track.start < 0 || end > track.duration + .001) throw Error(`${kind === 'voice' ? 'Voix off' : 'Musique'} : passage sélectionné hors du fichier.`);
    if (kind === 'voice' && (track.loop || delay + length > until + .001)) throw Error('La voix off ne peut pas boucler ni être tronquée. Vérifiez le passage sélectionné.');
    if (!Number.isFinite(track.volume) || track.volume < 0 || track.volume > 2 || track.delay < 0 || delay >= until) throw Error('Le volume ou le départ de la piste audio est invalide.');
    const stop = track.loop ? until : Math.min(until, delay + length);
    // Fades surround the complete timeline range, not each music repeat.
    const gain = (time: number) => track.volume * (track.fadeIn > 0 ? clamp((time - delay) / track.fadeIn) : 1) * (track.fadeOut > 0 ? clamp((stop - time) / track.fadeOut) : 1);
    for (let at = delay; at < stop - 1e-7; at += length) {
      events.push({url: track.url, at, start: track.start, duration: Math.min(length, stop - at), rate: 1, gain, required: true});
      if (!track.loop) break;
      if (events.length > 2000) throw Error('L’extrait musical est trop court pour cette boucle.');
    }
  }
  // Authenticated template sting, already faded and mixed by the native AEP.
  // It contains no announcement narration and is shared by every theme.
  if (data.signatureEnabled !== false) events.push({url: '/commercial-assets/opening.wav', at: 0, start: 0, duration: timeline.firstStart, rate: 1, gain: () => data.signatureVolume ?? 1, required: true});
  return events;
}

export async function inspectCommercialAudio(url: string, signal?: AbortSignal): Promise<{duration: number}> {
  signal?.throwIfAborted();
  const input = new Input({formats: ALL_FORMATS, source: browserSource(url)}), abort = () => input.dispose();
  signal?.addEventListener('abort', abort, {once: true});
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !await track.canDecode()) throw Error('Ce fichier ne contient pas de son décodable. Choisissez un WAV, MP3 ou AAC lisible.');
    const duration = await track.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) throw Error('La durée du fichier audio est illisible.');
    signal?.throwIfAborted();
    return {duration};
  } finally {signal?.removeEventListener('abort', abort); input.dispose();}
}

export async function prepareCommercialAudio(data: CommercialData, signal: AbortSignal, progress: (message: string) => void = () => {}) {
  const events = commercialAudioEvents(data);
  if (!events.length) return null;
  // Check actual media duration rather than trusting persisted upload metadata.
  for (const track of [data.voice, data.music].filter((v): v is CommercialAudio => !!v)) {
    const source = await inspectCommercialAudio(track.url, signal);
    if ((track.end || track.duration) > source.duration + .035) throw Error(`« ${track.name} » : le passage choisi dépasse la durée réelle du fichier.`);
  }
  return mixAudio(events, commercialTimeline(data).duration, signal, progress, {maxMemoryBytes:768*1024**2});
}

/** Playback clock anchored to Web Audio, including when resuming after a seek. */
export function primeCommercialAudioContext() {
  const context = new AudioContext({sampleRate: 48000});
  // Call before the first await in the user's click handler. Safari in
  // particular must receive resume() while the user activation is still live.
  const ready = context.resume();
  // The caller awaits the same rejection after preparing the media.
  void ready.catch(() => {});
  return {context, ready, async dispose() {if (context.state !== 'closed') await context.close();}};
}

export function createCommercialAudioPlayer(buffer: AudioBuffer, context = new AudioContext({sampleRate: 48000})) {
  let source: AudioBufferSourceNode | null = null, started = 0, offset = 0, playing = false, generation = 0;
  const stop = () => {generation++; if (source) {source.onended = null; try {source.stop();} catch { /* Already ended. */ } source.disconnect(); source = null;} playing = false;};
  return {
    resumeFromGesture() {const ready = context.resume(); void ready.catch(() => {}); return ready;},
    async play(time = 0) {
      stop(); const current = generation; offset = Math.max(0, Math.min(buffer.duration, time));
      await context.resume();
      if (current !== generation || context.state === 'closed' || offset >= buffer.duration) return;
      source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
      started = context.currentTime; playing = true;
      source.onended = () => {playing = false; offset = buffer.duration;};
      source.start(started, offset);
    },
    stop() {offset = playing ? Math.min(buffer.duration, offset + context.currentTime - started) : offset; stop();},
    get currentTime() {return playing ? Math.min(buffer.duration, offset + context.currentTime - started) : offset;},
    get playing() {return playing;},
    async dispose() {stop(); if (context.state !== 'closed') await context.close();},
  };
}
