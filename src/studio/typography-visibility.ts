/** Lottie writes display:none on inactive AE layers. This is a sufficient
 * condition, not a general visibility test: do not infer hidden text from a
 * mask, its size, opacity, viewport position or the editor's hidden glyphs.
 * Recheck each frame so a newly active layer is prepared immediately. */
export function nativeTextLayerHidden(node:Element){
  for(let current:Element|null=node;current;current=current.parentElement){
    if((current as HTMLElement|SVGElement).style?.display==='none')return true;
  }
  return false;
}
