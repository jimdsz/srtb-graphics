import {Quality} from 'mediabunny';
import type {VideoEncodingConfig} from 'mediabunny';

/** A single export policy for every opaque composition (TV and social). */
export const OPAQUE_BITRATE=50_000_000;
/** Native WebCodecs is accepted only when the measured video stream reaches this floor. */
export const OPAQUE_MINIMUM_MEASURED_BITRATE=30_000_000;
export function opaqueEncoding(onEncoderConfig?:VideoEncodingConfig['onEncoderConfig']):VideoEncodingConfig{
  return {codec:'avc',quality:new Quality({bitrate:OPAQUE_BITRATE,bitrateMode:'constant'}),alpha:'discard',latencyMode:'quality',keyFrameInterval:1,onEncoderConfig};
}
export function assertOpaqueConfig(config:VideoEncoderConfig){
  if(config.bitrate!==OPAQUE_BITRATE||config.bitrateMode!=='constant')throw Error('Cet encodeur ne respecte pas le profil demandé : H.264 CBR 50 Mb/s. Aucun export de qualité réduite n’a été substitué.');
}
export function needsOpaqueCbrFallback(measuredBitrate:number){
  if(!Number.isFinite(measuredBitrate)||measuredBitrate<0)throw Error('Le débit vidéo mesuré est invalide.');
  return measuredBitrate<OPAQUE_MINIMUM_MEASURED_BITRATE;
}
/** The global average is the floor for clips without a complete one-second
 * interval. A measured complete window can only lower that effective floor. */
export function opaqueMeasuredFloor(averageBitrate:number,minimumOneSecondBitrate?:number){
  if(!Number.isFinite(averageBitrate)||averageBitrate<0)throw Error('Le débit vidéo moyen mesuré est invalide.');
  if(minimumOneSecondBitrate===undefined)return averageBitrate;
  if(!Number.isFinite(minimumOneSecondBitrate)||minimumOneSecondBitrate<0)throw Error('Le débit vidéo minimal mesuré est invalide.');
  return Math.min(averageBitrate,minimumOneSecondBitrate);
}
export function assertOpaqueMeasuredBitrate(measuredBitrate:number){
  if(needsOpaqueCbrFallback(measuredBitrate))throw Error(`Le débit vidéo final (${(measuredBitrate/1e6).toFixed(2)} Mb/s) reste sous le minimum de ${(OPAQUE_MINIMUM_MEASURED_BITRATE/1e6).toFixed(0)} Mb/s.`);
}
