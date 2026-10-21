import {AudioBufferSource, BufferTarget, Mp4OutputFormat, Output, Quality, canEncodeAudio} from 'mediabunny';

let prepared: Promise<'native' | 'software'> | undefined;
let softwareRegistered = false;

async function probeAacEncoder() {
  const target = new BufferTarget(), output = new Output({format: new Mp4OutputFormat(), target});
  const source = new AudioBufferSource({codec: 'aac', quality: new Quality({bitrate: 192_000})}); output.addAudioTrack(source);
  const buffer = new AudioBuffer({numberOfChannels: 2, sampleRate: 48000, length: 4800});
  for (let ch = 0; ch < 2; ch++) {const samples = buffer.getChannelData(ch); for (let i = 0; i < samples.length; i++) samples[i] = .05 * Math.sin(i * Math.PI * 880 / 48000);}
  const timer = setTimeout(() => {void output.cancel().catch(() => {});}, 10000);
  try {await output.start(); await source.add(buffer); source.close(); await output.finalize(); if (!target.buffer?.byteLength) throw Error('Piste AAC vide.');}
  finally {clearTimeout(timer); source.close(); if (output.state !== 'finalized') await output.cancel().catch(() => {});}
}

/** Dedicated AAC-only LGPL build; never loads the unrelated GPL video engine. */
export function prepareCommercialAac() {
  prepared ??= (async () => {
    if (!softwareRegistered && await canEncodeAudio('aac', {sampleRate: 48000, numberOfChannels: 2}).catch(() => false)) {
      try {await probeAacEncoder(); return 'native' as const;} catch { /* Try the independent AAC encoder. */ }
    }
    const {registerAacEncoder} = await import('../../../vendor/commercial-aac/mediabunny-aac-encoder.mjs');
    registerAacEncoder();
    softwareRegistered = true;
    if (!await canEncodeAudio('aac', {sampleRate: 48000, numberOfChannels: 2}).catch(() => false)) throw Error('L’encodeur sonore AAC ne peut pas démarrer sur cet appareil.');
    await probeAacEncoder();
    return 'software' as const;
  })().catch(error => {prepared = undefined; throw error;});
  return prepared;
}
