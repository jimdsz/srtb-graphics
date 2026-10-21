import type {BroadcastField,BroadcastTemplate,ProjectData} from './domain';

export const RENVOI_RATING='_renvoi_rating_visible';
export const RENVOI_AD='_renvoi_ad_visible';
export const renvoiSignageKeys=[RENVOI_RATING,RENVOI_AD] as const;
export const renvoiSignageFields:Record<string,BroadcastField>={
  [RENVOI_RATING]:{type:'boolean',default:true,title:'Afficher le pictogramme −10',description:'Décochez pour retirer ce pictogramme de l’image.','x-section':'Signalétique'},
  [RENVOI_AD]:{type:'boolean',default:true,title:'Afficher le pictogramme d’audiodescription (AD)',description:'Décochez pour masquer ce pictogramme. Ne modifie pas le son.','x-section':'Signalétique'},
};
export function renvoiSignageTemplate(template:Pick<BroadcastTemplate,'id'|'version'|'libraryVersion'>){
  return template.id==='BTV_Renvoi'&&template.version==='1.0.0'&&template.libraryVersion==='1.7.0';
}
export function renvoiSignageAvailable(template:BroadcastTemplate,data:ProjectData){
  return renvoiSignageTemplate(template)&&(!data._studio_format||data._studio_format==='tv')&&data.variant==='2L';
}
export function renvoiSignageKey(key:string){return renvoiSignageKeys.some(name=>name===key);}
/** Missing means the original saved composition. XML in portable HTML carries
 * booleans as strings; explicit false must never become truthy on that path. */
export function renvoiSignageVisible(data:ProjectData,key:string){return data[key]!==false&&data[key]!=='false';}

/** Pinned 2L AE shape contract: AD is the right-hand seven-path group, −10 the
 * left-hand circle/numerals. Never select an unrelated icon by its DOM order. */
export function renvoiSignageShapeContract(layer:any){
  const [ad,rating]=layer?.shapes||[];
  return layer?.nm==='MENTIONS'&&layer.ind===5&&layer.ty===4&&layer.parent===14&&
    layer.ip===64&&layer.op===203&&layer.shapes.length===2&&
    ad?.ty==='gr'&&ad.nm==='Group 1'&&ad.it?.[0]?.it?.filter((item:any)=>item.ty==='sh').length===7&&
    JSON.stringify(ad.it.at(-1)?.p?.k)==='[1762.369,985.16]'&&
    rating?.ty==='gr'&&rating.nm==='Group 2'&&rating.it?.[1]?.it?.[0]?.ty==='el'&&
    JSON.stringify(rating.it.at(-1)?.p?.k)==='[1705.584,985.16]';
}
