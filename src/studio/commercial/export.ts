import {ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, VideoSampleSource, Input, Mp4OutputFormat, Output, Quality, StreamTarget} from 'mediabunny';
import {commercialEncoding, commercialVideoFrames, COMMERCIAL_TARGET_BITRATE} from './encoding';
import {sampleProof} from '../video/frame-proof';
import type {SampleProof} from '../video/frame-proof';
import {measureVideoBitrates} from '../video/video-bitrate';
import {prepareCommercialAudio} from './audio';
import {prepareCommercialAac} from './aac';
import {repairCommercialAvc} from './avc-repair';
import {prepareCommercial} from './render';
import {COMMERCIAL_WIDTH, COMMERCIAL_HEIGHT, COMMERCIAL_FPS, commercialTimeline, validateCommercialData} from './model';
import type {CommercialData} from './model';

export interface CommercialProgress {percent: number; message: string}
export interface CommercialReport {
  width: number; height: number; fps: number; frames: number; duration: number;
  audio: boolean; audioPeak: number; bytes: number; checkedFrames: number[];
  videoBitrate: number; minimumOneSecondVideoBitrate?: number; bitrateWarning?: string;
  targetVideoBitrate: number; encoderCodec: string;
  encodingMode: 'quantizer' | 'bitrate'; quantizer?: number; qualityPsnr?: number;
  audioSampleRate?: number; audioChannels?: number; audioWindowRmsError?: number;
  audioEncoder?: 'native' | 'software';
}

interface FrameProof extends SampleProof {pixels: Uint8ClampedArray<ArrayBuffer>}

/** Same disk-first destination and bounded memory fallback as Graphics. */
async function destination(signal: AbortSignal) {
  let directory: FileSystemDirectoryHandle | undefined, key: string | undefined;
  let handle: FileSystemFileHandle | undefined, stream: FileSystemWritableFileStream | undefined;
  try {
    directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('srtb-commercial-exports', {create: true});
    key = `${crypto.randomUUID()}.partial`; handle = await directory.getFileHandle(key, {create: true}); stream = await handle.createWritable();
  } catch {
    if (directory && key) await directory.removeEntry(key).catch(() => {});
    directory = undefined; key = undefined; handle = undefined; stream = undefined;
  }
  if (directory && key && handle && stream) {
    const dir = directory, name = key, file = handle, writer = stream; let closed = false;
    const target = new StreamTarget(new WritableStream({async write({position, data}) {signal.throwIfAborted(); await writer.write({type: 'write', position, data});}}), {chunked: true, chunkSize: 1024 ** 2});
    return {target, async finish() {await writer.close(); closed = true; return new Blob([await file.getFile()], {type: 'video/mp4'});}, async dispose() {if (!closed) await writer.abort().catch(() => {}); await dir.removeEntry(name).catch(() => {});}};
  }
  const target = new BufferTarget();
  target.on('write', ({end}) => {signal.throwIfAborted(); if (end > 256 * 1024 ** 2) throw Error('Le stockage disque local est indisponible et l’export dépasse la limite de mémoire. Autorisez le stockage local dans votre navigateur (Chrome, Edge ou Firefox récent), puis relancez l’export.');});
  return {target, async finish() {if (!target.buffer) throw Error('Fichier vidéo non finalisé.'); return new Blob([target.buffer], {type: 'video/mp4'});}, async dispose() {target.buffer = null;}};
}

async function verify(blob: Blob, report: CommercialReport, proofs: FrameProof[], expectedAudio: AudioBuffer | undefined, signal: AbortSignal) {
  const input = new Input({formats: ALL_FORMATS, source: new BlobSource(blob)}), abort = () => input.dispose();
  signal.addEventListener('abort', abort, {once: true});
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video || !await video.canDecode()) throw Error('Contrôle final : piste vidéo absente ou indécodable.');
    report.encoderCodec = await video.getCodecParameterString() ?? report.encoderCodec;
    const [width, height, duration, stats] = await Promise.all([video.getDisplayWidth(), video.getDisplayHeight(), video.computeDuration(), video.computePacketStats()]);
    if (width !== report.width || height !== report.height || Math.abs(duration - report.duration) > .02 || stats.packetCount !== report.frames) throw Error(`Contrôle final : vidéo ${width} × ${height}, ${duration.toFixed(3)} s, ${stats.packetCount} images ; attendu ${report.width} × ${report.height}, ${report.duration.toFixed(3)} s, ${report.frames} images.`);
    const sink = new CanvasSink(video, {poolSize: 1});
    const check = document.createElement('canvas'); check.width = report.width; check.height = report.height;
    const context = check.getContext('2d', {willReadFrequently: true})!;
    let minimumPsnr = Infinity;
    for (const proof of proofs) {
      signal.throwIfAborted();
      // MP4 timestamps are rounded to their integer timescale. Query safely
      // inside the frame instead of just before a rounded frame boundary.
      const decoded = await sink.getCanvas((proof.frame + .25) / report.fps);
      if (!decoded) throw Error('Contrôle final : image manquante.');
      const actual = sampleProof(decoded.canvas, proof.frame).rgb;
      let error = 0;
      for (let i = 0; i < actual.length; i++) if (i % 4 !== 3) error += Math.abs(actual[i] - proof.rgb[i]);
      if (error / (actual.length / 4 * 3) > 22) throw Error(`Contrôle final : l’image ${proof.frame} diffère de l’aperçu.`);
      context.drawImage(decoded.canvas, 0, 0); const pixels = context.getImageData(0, 0, report.width, report.height).data;
      let squared = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const lumaError = .299 * (pixels[i] - proof.pixels[i]) + .587 * (pixels[i + 1] - proof.pixels[i + 1]) + .114 * (pixels[i + 2] - proof.pixels[i + 2]);
        squared += lumaError * lumaError;
      }
      const psnr = squared ? 10 * Math.log10(255 ** 2 / (squared / (pixels.length / 4))) : 100;
      minimumPsnr = Math.min(minimumPsnr, psnr);
      if (psnr < 40) throw Error(`Contrôle final : qualité d’image insuffisante à l’image ${proof.frame} (${psnr.toFixed(1)} dB). Essayez l’export sur un autre navigateur ou appareil.`);
    }
    report.qualityPsnr = minimumPsnr; check.width = check.height = 0;
    const audio = await input.getPrimaryAudioTrack();
    if (expectedAudio) {
      if (!audio || !await audio.canDecode()) throw Error('Contrôle final : piste sonore absente ou indécodable.');
      if (Math.abs(await audio.computeDuration() - report.duration) > .1) throw Error('Contrôle final : durée sonore désynchronisée.');
      let energy = 0, count = 0, expectedEnergy = 0;
      const windowSamples = 2400, windows = Math.ceil(expectedAudio.length / windowSamples);
      const decodedEnergy = [new Float64Array(windows), new Float64Array(windows)];
      for await (const {buffer, timestamp} of new AudioBufferSink(audio).buffers()) {
        signal.throwIfAborted();
        if (buffer.sampleRate !== 48000 || buffer.numberOfChannels !== 2) throw Error('Contrôle final : le son doit rester stéréo à 48 kHz.');
        report.audioSampleRate = buffer.sampleRate; report.audioChannels = buffer.numberOfChannels;
        for (let ch = 0; ch < 2; ch++) {
          const samples = buffer.getChannelData(ch), offset = Math.round(timestamp * buffer.sampleRate);
          for (let i = 0; i < samples.length; i++) {
            energy += samples[i] ** 2;
            const at = i + offset;
            if (at >= 0 && at < expectedAudio.length) decodedEnergy[ch][Math.floor(at / windowSamples)] += samples[i] ** 2;
          }
          count += samples.length;
        }
      }
      for (let ch = 0; ch < expectedAudio.numberOfChannels; ch++) for (const sample of expectedAudio.getChannelData(ch)) expectedEnergy += sample * sample;
      const expectedRms = Math.sqrt(expectedEnergy / (expectedAudio.length * expectedAudio.numberOfChannels));
      if (!count || Math.abs(Math.sqrt(energy / count) - expectedRms) > Math.max(.003, expectedRms * .2)) throw Error('Contrôle final : niveau sonore différent de l’aperçu.');
      let maximumError = 0;
      for (let ch = 0; ch < 2; ch++) {
        const samples = expectedAudio.getChannelData(ch);
        for (let w = 0; w < windows; w++) {
          const from = w * windowSamples, until = Math.min(samples.length, from + windowSamples); let sum = 0;
          for (let i = from; i < until; i++) sum += samples[i] ** 2;
          const expected = Math.sqrt(sum / (until - from)), actual = Math.sqrt(decodedEnergy[ch][w] / (until - from));
          maximumError = Math.max(maximumError, Math.abs(expected - actual));
          if (Math.abs(expected - actual) > Math.max(.006, expected * .35)) throw Error(`Contrôle final : le son diffère de l’aperçu vers ${(from / 48000).toFixed(2)} s. Relancez l’export.`);
        }
      }
      report.audioWindowRmsError = maximumError;
    } else if (audio) throw Error('Contrôle final : piste sonore inattendue.');
  } finally {signal.removeEventListener('abort', abort); input.dispose();}
}

export async function exportCommercialVideo(data: CommercialData, signal: AbortSignal, progress: (event: CommercialProgress) => void) {
  const errors = validateCommercialData(data);
  if (errors.length) throw Error(errors.join('\n'));
  signal.throwIfAborted();
  const encoding = await commercialEncoding();
  progress({percent: 0, message: 'Préparation du modèle, des polices et des médias…'});
  const prepared = await prepareCommercial(data, signal);
  let dest: Awaited<ReturnType<typeof destination>> | undefined, output: Output | undefined, video: VideoSampleSource | undefined, audio: AudioBufferSource | undefined;
  let handedOff = false;
  let repaired: Awaited<ReturnType<typeof repairCommercialAvc>>;
  const abort = () => {if (output?.state === 'started') void output.cancel().catch(() => {});};
  signal.addEventListener('abort', abort, {once: true});
  try {
    const timeline = commercialTimeline(data), mixed = await prepareCommercialAudio(data, signal, message => progress({percent: 2, message}));
    const audioEncoder = mixed ? await prepareCommercialAac() : undefined;
    dest = await destination(signal);
    output = new Output({target: dest.target, format: new Mp4OutputFormat({fastStart: false})});
    let encoderConfig: VideoEncoderConfig | undefined;
    video = new VideoSampleSource({...encoding.options, onEncoderConfig: config => {encoderConfig = config;}});
    const frameSample = commercialVideoFrames(prepared.canvas);
    output.addVideoTrack(video, {frameRate: timeline.fps});
    if (mixed) {audio = new AudioBufferSource({codec: 'aac', quality: new Quality({bitrate: 192_000})}); output.addAudioTrack(audio);}
    await output.start();
    if (audio && mixed) {progress({percent: 3, message: 'Encodage du son stéréo…'}); await audio.add(mixed.buffer); audio.close();}
    const checkedFrames = [...new Set([0, 1.5, timeline.firstStart + 2, timeline.dualStart + 2, timeline.finalStart + 2, timeline.closingStart + 1.5, timeline.duration - 1 / timeline.fps].map(t => Math.min(timeline.frames - 1, Math.round(t * timeline.fps))))];
    const proofs: FrameProof[] = [], started = performance.now();
    for (let frame = 0; frame < timeline.frames; frame++) {
      signal.throwIfAborted(); await prepared.frame(frame / timeline.fps);
      if (checkedFrames.includes(frame)) proofs.push({...sampleProof(prepared.canvas, frame), pixels: prepared.canvas.getContext('2d')!.getImageData(0, 0, COMMERCIAL_WIDTH, COMMERCIAL_HEIGHT).data});
      const sample = frameSample(frame / timeline.fps, 1 / timeline.fps);
      try {await video.add(sample);} finally {sample.close();}
      if (frame % 10 === 0) {
        const remaining = (performance.now() - started) / 1000 / (frame + 1) * (timeline.frames - frame - 1);
        progress({percent: Math.round(4 + 89 * frame / timeline.frames), message: `Image ${frame + 1} / ${timeline.frames}${frame >= 30 ? ` · environ ${Math.max(1, Math.ceil(remaining))} s restantes` : ''}`});
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    video.close(); await output.finalize(); signal.throwIfAborted();
    if (!encoderConfig) throw Error('Le profil d’encodage H.264 n’a pas pu être vérifié.');
    let blob = await dest.finish();
    repaired = await repairCommercialAvc(blob, timeline.fps, timeline.frames, signal, () => destination(signal));
    if (repaired) {await dest.dispose(); blob = repaired.blob;}
    progress({percent: 94, message: 'Contrôle du fichier MP4 : images, durée, son et débit…'});
    const bitrate = await measureVideoBitrates(blob, signal);
    const report: CommercialReport = {width: COMMERCIAL_WIDTH, height: COMMERCIAL_HEIGHT, fps: timeline.fps, frames: timeline.frames, duration: timeline.duration, audio: !!mixed, audioPeak: mixed?.peak ?? 0, bytes: blob.size, checkedFrames, videoBitrate: bitrate.averageBitrate, minimumOneSecondVideoBitrate: bitrate.minimumOneSecondBitrate, targetVideoBitrate: COMMERCIAL_TARGET_BITRATE, encoderCodec: encoderConfig.codec, encodingMode: encoding.mode, quantizer: encoding.quantizer, audioEncoder};
    if (bitrate.averageBitrate < 30_000_000) report.bitrateWarning = 'Le débit vidéo moyen mesuré reste inférieur à 30 Mb/s. La qualité des images a été contrôlée, mais ce fichier ne garantit pas un débit de diffusion de 30 Mb/s.';
    await verify(blob, report, proofs, mixed?.buffer, signal); signal.throwIfAborted();
    progress({percent: 100, message: 'Annonce MP4 calculée et contrôlée.'}); handedOff = true;
    return {blob, report, dispose: repaired?.dispose ?? dest.dispose};
  } catch (error) {
    if (output && output.state !== 'finalized') await output.cancel().catch(() => {});
    if (error instanceof DOMException && error.name === 'QuotaExceededError') throw Error('Espace disque insuffisant pour cet export. Libérez de l’espace et réessayez.');
    throw error;
  } finally {
    signal.removeEventListener('abort', abort); video?.close(); audio?.close();
    await prepared.dispose(); if (!handedOff) {await dest?.dispose(); await repaired?.dispose();}
  }
}
