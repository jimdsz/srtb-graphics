import type {LegacyGraphic,Track} from './engine';

/** TV media and AE visibility have distinct clocks when OUT is moved. */
export async function seekSignatureMedia(graphic:LegacyGraphic,tracks:Record<string,Track>,seconds:number,outAt:number){
  graphic.elapsed=seconds;graphic.outAt=outAt;graphic.phase=seconds>=outAt?'out':'inspection';
  // The pinned 25 fps AE engines hold their last IN pose and remap OUT. Use
  // that native pose for layer visibility, while videos retain elapsed time.
  const sceneSeconds=typeof graphic.sourceFrame==='function'?graphic.sourceFrame(seconds)/25:seconds;
  for(const [kind,track]of Object.entries(tracks))if(kind!=='audio'&&(track.activeEnd===undefined||sceneSeconds>=(track.activeStart||0)&&sceneSeconds<track.activeEnd))await track.seek?.(Math.max(0,seconds-(track.activeStart||0)));
}
