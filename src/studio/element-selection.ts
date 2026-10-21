import type {BroadcastTemplate} from './domain';
import {isMediaField} from './domain';
import {nativeLogoFieldNames} from './native-logo-settings';

export const OVERLAY_LOGO='_studio_overlay_logo_url';
export const BRAND_POSITION='_studio_logo_anchor';
export interface SelectedElement {field:string;serial:number}
export interface ElementBox {field:string;x:number;y:number;width:number;height:number}
export function selectionCategory(template:BroadcastTemplate,field:string){
  if(field===BRAND_POSITION)return 'Graphisme';
  if(field===OVERLAY_LOGO||nativeLogoFieldNames(template).has(field))return 'Logos';
  if(template.fields[field]&&isMediaField(field,template.fields[field]))return 'Médias';
  return 'Textes et dates';
}
export function clippedBox(field:string,box:{x:number;y:number;width:number;height:number}):ElementBox|undefined{
  const x=Math.max(0,box.x),y=Math.max(0,box.y),right=Math.min(1,box.x+box.width),bottom=Math.min(1,box.y+box.height);
  if(![x,y,right,bottom].every(Number.isFinite)||right<=x||bottom<=y)return;
  return {field,x,y,width:right-x,height:bottom-y};
}
/** Reveal the inspector only after a pointer drag has finished. Never move
 * focus out of the stage: arrows must continue to move the selected text. */
export function revealInspector(node:HTMLElement){
  const details:HTMLDetailsElement[]=[];
  for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)details.push(parent);
  details.forEach(parent=>{parent.open=true;});
  const show=()=>{if(node.isConnected)node.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});};
  const active=document.activeElement;
  if(active instanceof HTMLElement&&active.matches('.typography-handle')&&active.hasAttribute('data-dragging')){
    window.addEventListener('pointerup',show,{once:true});
    return ()=>window.removeEventListener('pointerup',show);
  }
  const frame=requestAnimationFrame(show);return()=>cancelAnimationFrame(frame);
}
