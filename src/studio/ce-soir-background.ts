import type {BroadcastField,ProjectData} from './domain';

export const CE_SOIR_BACKGROUND='_studio_ce_soir_background';
export const CE_SOIR_COLORS={vert:'#007300',rouge:'#eb1905',or:'#f0b900'} as const;
export type CeSoirBackground='original'|keyof typeof CE_SOIR_COLORS;
export const ceSoirBackgroundFields:Record<string,BroadcastField>={
  [CE_SOIR_BACKGROUND]:{type:'string',default:'original',enum:['original','vert','rouge','or'],title:'Fond du panneau','x-section':'Fond du panneau','x-enumLabels':{original:'Fond actuel',vert:'Vert',rouge:'Rouge',or:'Or'}},
};
export function ceSoirBackground(data:ProjectData){
  const key=String(data[CE_SOIR_BACKGROUND]||'original');
  return Object.hasOwn(CE_SOIR_COLORS,key)?CE_SOIR_COLORS[key as keyof typeof CE_SOIR_COLORS]:undefined;
}
export function ceSoirBackgroundPatch(data:ProjectData,value:CeSoirBackground):ProjectData{
  // A hidden background must not remain the clock responsible for ending IN.
  return {[CE_SOIR_BACKGROUND]:value,...(value!=='original'&&data._out_mode==='media_end'&&data._out_media_track==='background'?{_out_mode:'duration'}:{})};
}
