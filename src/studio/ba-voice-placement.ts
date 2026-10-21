export type BAVoicePlacementMode='source'|'fit-complete'|'manual';
export interface BAVoicePlacement {intro:number;outro:number;duration:number;introEnd:number;outroEnd:number;adapted:boolean}
/** Explicit fit consent only. Never changes the source passage, playback rate,
 * programme-body audio or OUT duration. Every number is in source-timeline s. */
export function baVoicePlacement(duration:number,placement:BAVoicePlacementMode,offsets={intro:1.92,outro:68.48}):BAVoicePlacement{
  if(!Number.isFinite(duration)||duration<.04-1e-9)throw Error('Le passage vocal doit durer au moins 0,04 seconde.');
  if(!['source','fit-complete','manual'].includes(placement))throw Error('Choisissez explicitement le placement de la voix.');
  const intro=placement==='fit-complete'?Math.min(1.92,4.36-duration):offsets.intro,outro=placement==='fit-complete'?68.48:offsets.outro;
  if(!Number.isFinite(intro)||!Number.isFinite(outro))throw Error('Placement vocal invalide.');
  const introEnd=intro+duration,outroEnd=outro+duration;
  if(placement==='source'){
    if(intro<1.92-1e-9||introEnd>4.36+1e-9||outro<68.48-1e-9||outroEnd>70.92+1e-9)throw Error('La voix ne tient pas dans les créneaux source de 2,44 s. Acceptez explicitement l’adaptation pour lire le passage entier, ou choisissez un autre passage attesté. Aucun son n’est coupé.');
  }else if(placement==='manual'){
    if(intro<0||introEnd>9.68+1e-9||outro<64.8||outroEnd>72.92+1e-9)throw Error('Calage personnalisé : le passage entier doit tenir dans l’introduction (0–9,68 s) et le carton final (0–8,12 s après OUT). Déplacez le départ ou choisissez un passage plus court ; aucune coupe automatique.');
  }else if(intro<.04-1e-9||introEnd>4.36+1e-9||outroEnd>72.52+1e-9){
    throw Error('La voix entière dépasse les créneaux graphiques sûrs (4,04 s maximum). Choisissez un passage attesté compatible ; aucune coupe ni accélération automatique.');
  }
  return {intro,outro,duration,introEnd,outroEnd,adapted:placement!=='source'};
}
export function baVoiceDucking(config:Record<string,unknown>):{intro:[number,number][];outro:[number,number][]}|undefined{
  const mode=config._studio_ba_voice_fit;
  if((mode!=='fit-complete'&&mode!=='manual')||config._audio_voice_enabled===false)return;
  const offsets={intro:Number(config._audio_voice_intro_offset_seconds),outro:Number(config._audio_voice_outro_offset_seconds)};
  const duration=Number(config._audio_voice_out_seconds)-Number(config._audio_voice_in_seconds),placement=baVoicePlacement(duration,mode,offsets);
  if(mode==='fit-complete'&&(Math.abs(offsets.intro-placement.intro)>1e-7||Math.abs(offsets.outro-placement.outro)>1e-7))throw Error('Le placement de la voix adaptée a changé. Reprenez la proposition complète ou choisissez le calage personnalisé.');
  const envelope=(at:number,end:number):[number,number][]=>[[Math.max(0,at-.4),0],[at,-10],[end,-10],[end+.4,0]];
  return {intro:envelope(placement.intro,placement.introEnd),outro:envelope(placement.outro,placement.outroEnd)};
}
