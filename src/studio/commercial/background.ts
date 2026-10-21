import {ALL_FORMATS, CanvasSink, Input} from 'mediabunny';
import {browserSource} from '../video/source';
import {COMMERCIAL_FPS} from './model';
import type {CommercialData} from './model';

const previewAssets = new Map<string, Promise<Blob>>();
async function loadPreviewAsset(url:string) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
  try {
    for(let attempt=0;attempt<2;attempt++){
      try {
        const response=await fetch(url,{credentials:'same-origin',signal:controller.signal});
        if(response.status===401)throw Error('Votre session ne permet plus de charger le fond animé. Reconnectez-vous au service, puis réessayez.');
        if(response.status===403)throw Error('Votre compte n’a pas accès au fond animé. Vérifiez votre connexion au service.');
        if(!response.ok)throw Error('Le fond animé du modèle est indisponible. Réessayez son chargement.');
        const type=response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        if(type&&!type.startsWith('video/')&&type!=='application/octet-stream')throw Error('Le fond animé reçu est invalide. Réessayez son chargement.');
        const blob=await response.blob();
        if(!blob.size)throw Error('Le fond animé reçu est vide. Réessayez son chargement.');
        return blob;
      }
      catch(error){
        // Retry one interrupted network request, never an HTTP denial or an
        // invalid video. The same deadline bounds both attempts.
        if(attempt>0||!(error instanceof TypeError)||controller.signal.aborted)throw error;
        await new Promise(resolve=>setTimeout(resolve,250));
        controller.signal.throwIfAborted();
      }
    }
    throw Error('Le fond animé du modèle est indisponible. Réessayez son chargement.');
  } catch(error) {
    if(controller.signal.aborted)throw Error('Le téléchargement du fond animé prend trop de temps. Vérifiez votre connexion, puis réessayez.');
    if(error instanceof TypeError)throw Error('Le téléchargement du fond animé a été interrompu. Vérifiez votre connexion, puis réessayez.');
    throw error;
  } finally {clearTimeout(timer);}
}
const LOOP_START = 4, LOOP_BLEND = .8, PREROLL = .4;
const ease = (x: number) => x * x * (3 - 2 * x);
/** All announcements use the same 1× motion, regardless of their voice length.
 * The native bubble has left the picture by the tail. Blend that empty tail
 * into the reading background, then continue from there without the opening.
 */
export function commercialBackgroundTime(_data: CommercialData, sourceDuration: number, seconds: number) {
  const end = sourceDuration - 1 / COMMERCIAL_FPS, start = Math.min(LOOP_START, end / 4);
  const blendDuration = Math.min(LOOP_BLEND, (end - start) / 4), seam = end - blendDuration;
  const period = seam - start, t = Math.max(0, seconds);
  if (t < seam) return {time: t, rate: 1, index: 0, nextIndex: 1, nextTime: Math.max(0, start - (seam - t)), blend: 0, warming: seam - t < PREROLL};
  const cycle = Math.floor((t - seam) / period), phase = t - seam - cycle * period;
  const oldIndex = cycle % 2, newIndex = 1 - oldIndex;
  if (phase < blendDuration) return {time: seam + phase, rate: 1, index: oldIndex, nextIndex: newIndex, nextTime: start + phase, blend: ease(phase / blendDuration), warming: true};
  return {time: start + phase, rate: 1, index: newIndex, nextIndex: oldIndex, nextTime: Math.max(0, start - (period - phase)), blend: 0, warming: period - phase < PREROLL};
}

function compositor() {
  const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
  const context = canvas.getContext('2d', {alpha: false})!;
  return {canvas, draw(first: CanvasImageSource, second: CanvasImageSource, blend: number): CanvasImageSource {
    if (blend <= 0) return first;
    context.globalAlpha = 1; context.drawImage(first, 0, 0, canvas.width, canvas.height);
    context.globalAlpha = blend; context.drawImage(second, 0, 0, canvas.width, canvas.height); context.globalAlpha = 1;
    return canvas;
  }};
}

function mediaEvent(video: HTMLVideoElement, event: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const done = (error?: unknown) => {clearTimeout(timer); video.removeEventListener(event, success); video.removeEventListener('error', failed); signal.removeEventListener('abort', aborted); error ? reject(error) : resolve();};
    const success = () => done(), failed = () => done(Error('Le fond animé ne peut pas être lu. Réessayez après son chargement.')), aborted = () => done(signal.reason ?? new DOMException('Aperçu annulé.', 'AbortError'));
    const timer = setTimeout(() => done(Error('Le chargement du fond animé a pris trop de temps. Réessayez.')), 30000);
    video.addEventListener(event, success, {once: true}); video.addEventListener('error', failed, {once: true}); signal.addEventListener('abort', aborted, {once: true});
    if (signal.aborted) aborted();
  });
}

/** Native video decoding runs independently from canvas animation and the audio clock. */
export async function preparePreviewBackground(data: CommercialData, signal: AbortSignal) {
  const url = `/commercial-assets/background-${data.theme}.mp4`;
  let asset = previewAssets.get(url);
  if (!asset) {
    asset = loadPreviewAsset(url).catch(error => {if(previewAssets.get(url)===asset)previewAssets.delete(url);throw error;});
    previewAssets.set(url, asset);
  }
  const blob = await asset; signal.throwIfAborted();
  const objectURL = URL.createObjectURL(blob), videos = [document.createElement('video'), document.createElement('video')];
  for (const video of videos) {video.muted = true; video.playsInline = true; video.preload = 'auto';}
  const composite = compositor();
  let disposed = false, playing = false, activeIndex = 0, failed = false;
  const invalidate=()=>{if(!signal.aborted&&previewAssets.get(url)===asset)previewAssets.delete(url);};
  const broken=()=>{failed=true;invalidate();};
  for(const video of videos)video.addEventListener('error',broken);
  const dispose = () => {if (disposed) return; disposed = true; playing = false; signal.removeEventListener('abort', dispose); for (const video of videos) {video.removeEventListener('error',broken);video.pause(); video.removeAttribute('src'); video.load();} composite.canvas.width = composite.canvas.height = 0; URL.revokeObjectURL(objectURL);};
  signal.addEventListener('abort', dispose, {once: true});
  try {
    await Promise.all(videos.map(async video => {const loaded = mediaEvent(video, 'loadeddata', signal); video.src = objectURL; video.load(); await loaded;}));
    const render = (point: ReturnType<typeof commercialBackgroundTime>) => {activeIndex = point.index; return composite.draw(videos[point.index], videos[point.nextIndex], point.blend);};
    const position = async (video: HTMLVideoElement, time: number) => {
      if (Math.abs(video.currentTime - time) > .001 || video.readyState < 2) {const sought = mediaEvent(video, 'seeked', signal); video.currentTime = time; await sought;}
    };
    const seek = async (seconds: number) => {
      try {
        signal.throwIfAborted(); if (disposed) throw new DOMException('Aperçu fermé.', 'AbortError');
        if(failed)throw Error('Le fond animé ne peut plus être lu. Réessayez son chargement.');
        const point = commercialBackgroundTime(data, videos[0].duration, seconds);
        await position(videos[point.index], point.time);
        await position(videos[point.nextIndex], point.warming ? point.nextTime : LOOP_START - PREROLL);
        signal.throwIfAborted(); return render(point);
      } catch(error) {
        if(!(error instanceof DOMException&&['AbortError','NotAllowedError'].includes(error.name)))invalidate();
        throw error;
      }
    };
    const start = (video: HTMLVideoElement) => {if (video.paused) void video.play().catch(() => {});};
    return {
      video: videos[0],
      update(next: CommercialData) {data = next;},
      frame: seek,
      async play(seconds: number) {videos.forEach(video => video.pause()); await seek(seconds); signal.throwIfAborted(); const point = commercialBackgroundTime(data, videos[0].duration, seconds); await videos[point.index].play(); if (point.warming) await videos[point.nextIndex].play(); playing = true;},
      pause() {playing = false; videos.forEach(video => video.pause());},
      sample(seconds: number) {
        if (disposed) throw new DOMException('Aperçu fermé.', 'AbortError');
        if(failed)throw Error('Le fond animé ne peut plus être lu. Réessayez son chargement.');
        const point = commercialBackgroundTime(data, videos[0].duration, seconds), primary = videos[point.index], secondary = videos[point.nextIndex];
        // Both readers stay at 1×. The second reader starts before its first
        // visible frame, and roles swap without seeking the visible reader.
        if (playing) {
          if (!primary.seeking && Math.abs(primary.currentTime - point.time) > .3) primary.currentTime = point.time;
          start(primary);
          if (point.warming) {if (!secondary.seeking && Math.abs(secondary.currentTime - point.nextTime) > .15) secondary.currentTime = point.nextTime; start(secondary);}
          else {secondary.pause(); if (!secondary.seeking && Math.abs(secondary.currentTime - (LOOP_START - PREROLL)) > .1) secondary.currentTime = LOOP_START - PREROLL;}
        }
        return render(point);
      },
      statistics() {const quality = videos.map(video => video.getVideoPlaybackQuality()); return {decodedFrames: quality.reduce((n,q)=>n+q.totalVideoFrames,0), droppedFrames: quality.reduce((n,q)=>n+q.droppedVideoFrames,0), currentTime: videos[activeIndex].currentTime, readyState: videos[activeIndex].readyState};},
      dispose,
    };
  } catch (error) {
    // A successful HTTP response can still contain an incomplete/invalid video.
    // Do not keep that blob across retries, or clear a newer shared request.
    if(!(error instanceof DOMException&&['AbortError','NotAllowedError'].includes(error.name)))invalidate();
    dispose(); throw error;
  }
}

/** Consecutive export frames use one decoder iterator instead of repeated random seeks. */
export async function prepareExportBackground(data: CommercialData, signal: AbortSignal) {
  const input = new Input({formats: ALL_FORMATS, source: browserSource(`/commercial-assets/background-${data.theme}.mp4`)});
  const abort = () => input.dispose(); signal.addEventListener('abort', abort, {once: true});
  const composite = compositor();
  type DecodedFrame = Awaited<ReturnType<CanvasSink['getCanvas']>>;
  const readers: {sink: CanvasSink; iterator?: ReturnType<CanvasSink['canvases']>; current: DecodedFrame; next: DecodedFrame; previousTime: number}[] = [];
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw Error('Le fond animé du modèle est indisponible ou illisible.');
    const duration = await track.computeDuration();
    for (let i = 0; i < 2; i++) readers.push({sink: new CanvasSink(track, {poolSize: 3}), current: null, next: null, previousTime: -1});
    const decode = async (index: number, time: number) => {
      const reader = readers[index];
      if (!reader.iterator || time < reader.previousTime - 1e-6 || time - reader.previousTime > .5) {
        await reader.iterator?.return(); reader.iterator = reader.sink.canvases(time);
        const first = await reader.iterator.next(); reader.current = first.done ? null : first.value;
        const second = await reader.iterator.next(); reader.next = second.done ? null : second.value;
      }
      while (reader.next && reader.next.timestamp <= time + 1e-7) {reader.current = reader.next; const item = await reader.iterator!.next(); reader.next = item.done ? null : item.value;}
      reader.previousTime = time; signal.throwIfAborted();
      if (!reader.current) throw Error('Une image du fond animé est manquante.');
      return reader.current.canvas;
    };
    return {
      update(nextData: CommercialData) {data = nextData;},
      async frame(seconds: number) {
        signal.throwIfAborted(); const point = commercialBackgroundTime(data, duration, seconds);
        const first = await decode(point.index, point.time);
        return point.blend > 0 ? composite.draw(first, await decode(point.nextIndex, point.nextTime), point.blend) : first;
      },
      async dispose() {signal.removeEventListener('abort', abort); input.dispose(); for (const reader of readers) {await reader.iterator?.return().catch(() => {}); reader.current = reader.next = null;} composite.canvas.width = composite.canvas.height = 0;},
    };
  } catch (error) {signal.removeEventListener('abort', abort); input.dispose(); throw error;}
}
