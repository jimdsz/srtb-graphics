import {ALL_FORMATS, BlobSource, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output} from 'mediabunny';
import type {Target} from 'mediabunny';

/** Mozilla bug 2031056 duplicates the SPS/PPS NAL header and clears reserved
 * AVCC bits. Match that exact defect; never rewrite an unfamiliar bitstream.
 * https://bugzilla.mozilla.org/show_bug.cgi?id=2031056 */
export function normaliseCommercialAvcc(description: AllowSharedBufferSource): Uint8Array<ArrayBuffer> | undefined {
  const input = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description);
  if (input.length < 10 || input[0] !== 1) return;
  let cursor = 6, changed = (input[4] & 0xfc) !== 0xfc || (input[5] & 0xe0) !== 0xe0, duplicatedSps = false;
  const result = [...input.slice(0, 6)]; result[4] |= 0xfc; result[5] |= 0xe0;
  const copyNal = (kind: number) => {
    if (cursor + 2 > input.length) throw Error('En-tête H.264 incomplet.');
    const length = input[cursor] * 256 + input[cursor + 1]; cursor += 2;
    if (!length || cursor + length > input.length) throw Error('En-tête H.264 invalide.');
    let start = cursor;
    const duplicate = input[start] === kind && input[start + 1] === kind && (kind === 0x67 ? input[start + 2] === input[1] : duplicatedSps);
    if (duplicate) {start++; changed = true; if (kind === 0x67) duplicatedSps = true;}
    const size = cursor + length - start;
    result.push(size >> 8, size & 255, ...input.subarray(start, cursor + length)); cursor += length;
  };
  for (let s = 0; s < (input[5] & 31); s++) copyNal(0x67);
  if (cursor >= input.length) throw Error('En-tête H.264 sans PPS.');
  const pps = input[cursor++]; result.push(pps);
  for (let p = 0; p < pps; p++) copyNal(0x68);
  result.push(...input.subarray(cursor));
  return changed ? new Uint8Array(result) : undefined;
}

interface Destination {target: Target; finish(): Promise<Blob>; dispose(): Promise<void>}

/** Copy compressed packets without decoding/re-encoding. Some native encoders
 * shift every independent frame by one frame. Only correct a constant offset
 * on the complete, ordered all-intra stream, then run the ordinary final QA. */
export async function repairCommercialAvc(blob: Blob, fps: number, frames: number, signal: AbortSignal, makeDestination: () => Promise<Destination>) {
  const input = new Input({formats: ALL_FORMATS, source: new BlobSource(blob)});
  let dest: Destination | undefined, output: Output | undefined, handedOff = false;
  const abort = () => {input.dispose(); if (output?.state === 'started') void output.cancel().catch(() => {});};
  signal.addEventListener('abort', abort, {once: true});
  try {
    const track = await input.getPrimaryVideoTrack(), config = await track?.getDecoderConfig();
    if (!track || !config) throw Error('Piste H.264 absente.');
    const description = config.description ? normaliseCommercialAvcc(config.description) : undefined;
    const offset = await track.getFirstTimestamp();
    if (!description && Math.abs(offset) < .000002) return;
    if (Math.abs(offset) > 2 / fps) throw Error('L’encodeur vidéo a décalé les images de façon inattendue.');
    const decoderConfig = {...config, ...(description ? {description} : {})};
    const source = new EncodedVideoPacketSource('avc');
    dest = await makeDestination(); output = new Output({target: dest.target, format: new Mp4OutputFormat({fastStart: false})});
    output.addVideoTrack(source, {frameRate: fps});
    const audioTrack = await input.getPrimaryAudioTrack(), audio = audioTrack ? new EncodedAudioPacketSource('aac') : undefined;
    if (audio) output.addAudioTrack(audio);
    await output.start();
    if (audio && audioTrack) {
      const audioConfig = await audioTrack.getDecoderConfig();
      if (!audioConfig) throw Error('En-tête AAC absent.');
      for await (const packet of new EncodedPacketSink(audioTrack).packets()) {signal.throwIfAborted(); await audio.add(packet, {decoderConfig: audioConfig});}
      audio.close();
    }
    let index = 0;
    for await (const packet of new EncodedPacketSink(track).packets()) {
      signal.throwIfAborted();
      if (packet.type !== 'key' || Math.abs(packet.timestamp - offset - index / fps) > .00001) throw Error('L’encodeur vidéo a changé l’ordre ou la cadence des images.');
      await source.add(packet.clone({timestamp: index / fps, duration: 1 / fps}), {decoderConfig}); index++;
    }
    if (index !== frames) throw Error('L’encodeur vidéo a perdu des images.');
    source.close(); await output.finalize();
    const result = {blob: await dest.finish(), dispose: dest.dispose}; handedOff = true; return result;
  } finally {
    signal.removeEventListener('abort', abort); input.dispose();
    if (output && output.state !== 'finalized') await output.cancel().catch(() => {});
    if (!handedOff) await dest?.dispose();
  }
}
