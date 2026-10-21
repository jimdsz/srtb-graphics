import {ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, Input, Mp4OutputFormat, Output, Quality, VideoSample, VideoSampleSource, canEncodeVideo} from 'mediabunny';
import type {VideoEncodingConfig} from 'mediabunny';
import {COMMERCIAL_WIDTH, COMMERCIAL_HEIGHT, COMMERCIAL_FPS} from './model';
import {prepareCommercialAac} from './aac';

export const COMMERCIAL_TARGET_BITRATE = 50_000_000;
export const COMMERCIAL_QUANTIZER = 4;

export interface CommercialEncoding {
  mode: 'quantizer' | 'bitrate';
  quantizer?: number;
  options: VideoEncodingConfig;
}

/** Encode the canvas directly. Independent frames preserve fine type and motion;
 * no padded stream or second lossy encode is used to manufacture a bitrate. */
let encodingPromise: Promise<CommercialEncoding> | undefined;
export function commercialEncoding(): Promise<CommercialEncoding> {
  encodingPromise ??= selectEncoding().catch(error => {encodingPromise = undefined; throw error;});
  return encodingPromise;
}

async function encodeProbe(choice: CommercialEncoding) {
  const target = new BufferTarget(), output = new Output({format: new Mp4OutputFormat(), target});
  const source = new VideoSampleSource(choice.options); output.addVideoTrack(source, {frameRate: COMMERCIAL_FPS});
  const pixels = COMMERCIAL_WIDTH * COMMERCIAL_HEIGHT, bytes = new Uint8Array(pixels * 3 / 2).fill(128);
  // A grey frame only proves that an encoder exists. A subtle texture exposes
  // drivers which claim QP/bitrate support but quantise every frame heavily.
  let random = 0x39b21487;
  for (let at = 0; at < pixels; at++) {
    random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
    bytes[at] = 32 + Math.round((at % COMMERCIAL_WIDTH) / COMMERCIAL_WIDTH * 176) + (random >>> 0) % 17 - 8;
  }
  let input: Input | undefined;
  const timer = setTimeout(() => {input?.dispose(); if (output.state !== 'finalized') void output.cancel().catch(() => {});}, 8000);
  try {
    await output.start();
    const frames = 15;
    for (let i = 0; i < frames; i++) {
      const sample = new VideoSample(new VideoFrame(bytes, {format: 'I420', codedWidth: COMMERCIAL_WIDTH, codedHeight: COMMERCIAL_HEIGHT, timestamp: Math.round(i * 1e6 / COMMERCIAL_FPS), duration: Math.round(1e6 / COMMERCIAL_FPS), colorSpace: {primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: false}}));
      try {await source.add(sample);} finally {sample.close();}
    }
    source.close(); await output.finalize();
    if (!target.buffer?.byteLength) return false;
    input = new Input({formats: ALL_FORMATS, source: new BlobSource(new Blob([target.buffer]))});
    const track = await input.getPrimaryVideoTrack(); if (!track || !await track.canDecode()) return false;
    const canvas = await new CanvasSink(track).getCanvas(await track.getFirstTimestamp() + (frames - .75) / COMMERCIAL_FPS);
    if (!canvas) return false;
    const context = canvas.canvas.getContext('2d') as CanvasRenderingContext2D;
    const rgba = context.getImageData(0, 0, COMMERCIAL_WIDTH, COMMERCIAL_HEIGHT).data; let error = 0;
    for (let i = 0; i < pixels; i++) {
      const expected = Math.round((bytes[i] - 16) * 255 / 219), actual = .299 * rgba[i * 4] + .587 * rgba[i * 4 + 1] + .114 * rgba[i * 4 + 2];
      error += (actual - expected) ** 2;
    }
    return error / pixels <= 255 ** 2 / 10 ** 4;
  }
  catch {return false;}
  finally {clearTimeout(timer); input?.dispose(); source.close(); if (output.state !== 'finalized') await output.cancel().catch(() => {});}
}

async function selectEncoding(): Promise<CommercialEncoding> {
  if (typeof VideoEncoder === 'undefined') throw Error('Ce navigateur ne fournit pas d’encodeur vidéo pour ce MP4. Ouvrez le projet dans une version récente de Chrome, Edge ou Firefox sur ordinateur.');
  // Request enough profile capacity for independent QP4 frames. Drivers can
  // still choose another level; the final report reads the actual file codec.
  const common = {codec: 'avc' as const, fullCodecString: 'avc1.640033', alpha: 'discard' as const, latencyMode: 'quality' as const, keyFrameInterval: 0};
  const choices: CommercialEncoding[] = [
    {mode: 'quantizer', quantizer: COMMERCIAL_QUANTIZER, options: {...common, quality: new Quality({quantizer: COMMERCIAL_QUANTIZER})}},
    {mode: 'bitrate', options: {...common, quality: new Quality({bitrate: COMMERCIAL_TARGET_BITRATE, bitrateMode: 'constant'})}},
  ];
  for (const choice of choices) if (await canEncodeVideo('avc', {...choice.options, width: COMMERCIAL_WIDTH, height: COMMERCIAL_HEIGHT, frameRate: COMMERCIAL_FPS}).catch(() => false) && await encodeProbe(choice)) return choice;
  throw Error('Cet appareil ne fournit pas un encodage H.264 Full HD assez fidèle. Sauvegardez le projet et reprenez son export dans Chrome ou Edge récent sur ordinateur.');
}

/** No browser-name allowlist: qualify the encoders provided by this device. */
export async function probeCommercialExportCapabilities() {
  let video = false, encodingMode: CommercialEncoding['mode'] | undefined, reason: string | undefined;
  try {encodingMode = (await commercialEncoding()).mode; video = true;} catch (error) {reason = error instanceof Error ? error.message : String(error);}
  let audio = false, audioMode: 'native' | 'software' | undefined;
  try {audioMode = await prepareCommercialAac(); audio = true;} catch (error) {if (video) reason = error instanceof Error ? error.message : String(error);}
  return {supported: video && audio, video, audio, encodingMode, audioMode, reason};
}

/** Explicit Rec.709 limited-range planes avoid driver-dependent RGB→YUV
 * conversion. Some Windows encoders otherwise apply Rec.601 coefficients while
 * declaring Rec.709, visibly changing the green background and skin tones. */
export function commercialVideoFrames(canvas: HTMLCanvasElement) {
  const width = canvas.width, height = canvas.height, lumaSize = width * height;
  const bytes = new Uint8Array(lumaSize * 3 / 2), context = canvas.getContext('2d')!;
  const bounded = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (timestamp: number, duration: number) => {
    const rgba = context.getImageData(0, 0, width, height).data;
    for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
      let red = 0, green = 0, blue = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const at = (y + dy) * width + x + dx, p = at * 4, r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
        bytes[at] = bounded(16 + .1825858824 * r + .6142305882 * g + .0620070588 * b);
        red += r; green += g; blue += b;
      }
      const chroma = y / 2 * (width / 2) + x / 2;
      bytes[lumaSize + chroma] = bounded(128 + (-.1006437314 * red - .3385719539 * green + .4392156863 * blue) / 4);
      bytes[lumaSize * 5 / 4 + chroma] = bounded(128 + (.4392156863 * red - .3989421626 * green - .0402735237 * blue) / 4);
    }
    const frame = new VideoFrame(bytes, {format: 'I420', codedWidth: width, codedHeight: height, timestamp: Math.round(timestamp * 1e6), duration: Math.round(duration * 1e6), colorSpace: {primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: false}});
    // VideoSample owns this VideoFrame and releases it from sample.close().
    return new VideoSample(frame);
  };
}
