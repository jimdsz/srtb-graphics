import {setSvgAttribute} from './svg-attributes';
/** The AE split-title layers deliberately reveal two copies through
 * complementary mattes. Edited glyphs must remain in that paint tree; drawing
 * them in the top-level editor overlay exposes both complete copies. */
export function textRevealParent(node:Element,templateId:string):SVGGElement|undefined{
  if(!['BTV_Semainier','BTV_Evenement','BTV_Renvoi'].includes(templateId))return;
  const parent=node.parentElement;
  if(parent?.namespaceURI==='http://www.w3.org/2000/svg'&&parent.localName==='g'&&parent.hasAttribute('mask')&&parent.children.length===1)return parent as unknown as SVGGElement;
}
export function createTextReveal(source:SVGGElement,group:SVGGElement){
  const placement=document.createElementNS('http://www.w3.org/2000/svg','g');
  placement.setAttribute('data-studio-text-reveal','');
  const masked=document.createElementNS('http://www.w3.org/2000/svg','g');
  placement.append(masked);masked.append(group);source.after(placement);
  return {
    source,placement,
    sync(){
      // The engine owns the changing mask, transform and visibility. Keep its
      // live references, never duplicate IDs or snapshot a moving matte.
      for(const key of ['mask','transform','opacity','style']){
        setSvgAttribute(masked,key,source.getAttribute(key));
      }
    },
    remove(){placement.remove();},
  };
}
