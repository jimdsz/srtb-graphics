import type {ProjectData} from './domain';

/** BA simple/multiple share this engine. Do not change TV or the dedicated TDS. */
export function baSocialDirect(id:string,data:ProjectData){
  return id==='BTV_BA_1P'&&(data._studio_format==='portrait'||data._studio_format==='vertical');
}
export function baSocialUnusedField(key:string){
  return /^_media_(intro|pack)_/.test(key)||key.startsWith('_audio_bed_')||key==='_couleur_sortie';
}
/** Runtime copy only: obsolete TV sources must not block a social project. */
export function baSocialSelectedData(data:ProjectData):ProjectData{
  const next={...data,_audio_bed_enabled:false};
  for(const kind of ['intro','pack'])Object.assign(next,{[`_media_${kind}_url`]:'',[`_media_${kind}_sequence`]:'[]',[`_media_${kind}_audio_enabled`]:false});
  return next;
}
