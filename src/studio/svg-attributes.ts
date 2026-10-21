/** Avoid invalidating SVG layout/paint for attributes that did not change.
 * Read the actual DOM: native animation code may also own these attributes. */
export function setSvgAttribute(node:Element,key:string,value:string|null){
  if(node.getAttribute(key)===value)return;
  if(value===null)node.removeAttribute(key);else node.setAttribute(key,value);
}
