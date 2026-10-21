import type {BroadcastTemplate,FieldValue,ProjectData} from './domain';

export interface NativeLogoSlot {key:string;visible:string;original?:string;label:string}
export const overlayLogoPrefix='_studio_overlay_logo_';
export function hasOverlayLogo(template:BroadcastTemplate){return template.fields[overlayLogoPrefix+'url']?.['x-control']==='image'&&template.fields[overlayLogoPrefix+'enabled']?.type==='boolean';}
export function overlayLogoSourcePatch(value:FieldValue):ProjectData{
  if(typeof value!=='string'&&typeof value!=='object'||typeof value==='object'&&!value.mimeType.startsWith('image/'))throw Error('Choisissez une image pour le logo.');
  // Choosing bytes never enables an extra on-screen layer implicitly.
  return {[overlayLogoPrefix+'url']:value,[overlayLogoPrefix+'enabled']:false};
}
const slots:Record<string,NativeLogoSlot[]>={
  BTV_BA_1P:[{key:'_sponsor_url',visible:'_sponsor_visible',original:'_sponsor_original',label:'Logo du sponsor'}],
  BTV_BA_TDS:[{key:'_sponsor_logo',visible:'_sponsor_visible',label:'Logo du sponsor'}],
  BTV_BA_TDS_SUIVI_DE:[{key:'_p1_sponsor_logo',visible:'_p1_sponsor_visible',label:'Programme 1 · logo du sponsor'},{key:'_p2_sponsor_logo',visible:'_p2_sponsor_visible',label:'Programme 2 · logo du sponsor'}],
};
export function nativeLogoSlots(template:BroadcastTemplate){return (Object.hasOwn(slots,template.id)?slots[template.id]:[]).filter(slot=>template.fields[slot.key]?.['x-control']==='image'&&template.fields[slot.visible]?.type==='boolean'&&(!slot.original||template.fields[slot.original]?.type==='boolean'));}
export function nativeLogoFieldNames(template:BroadcastTemplate){return new Set(nativeLogoSlots(template).flatMap(slot=>[slot.key,slot.visible,...(slot.original?[slot.original,'_sponsor_label','_sponsor_label_visible']:[])]));}
export function logoSourcePatch(template:BroadcastTemplate,key:string,value:FieldValue):ProjectData{
  const slot=nativeLogoSlots(template).find(item=>item.key===key);if(!slot)throw Error('Cet emplacement de logo n’existe pas dans le modèle.');
  if(typeof value!=='string'&&typeof value!=='object'||typeof value==='object'&&!value.mimeType.startsWith('image/'))throw Error('Choisissez une image pour le logo.');
  const url=typeof value==='object'?value.url:value;
  return {[slot.key]:value,[slot.visible]:!!url,...(slot.original?{[slot.original]:false}:{})};
}
