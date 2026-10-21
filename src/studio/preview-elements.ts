import type {BroadcastTemplate} from './domain';
import type {LegacyGraphic} from './video/engine';
import {OVERLAY_LOGO,clippedBox} from './element-selection';
import type {ElementBox} from './element-selection';
import {tracksOf} from './media-tracks';
import {previewMediaElement} from './svg-media-preview';

/** Read the actual visible rectangles, not guesses from template percentages. */
export function previewElementBoxes(g:LegacyGraphic,template:BroadcastTemplate,social:boolean):ElementBox[]{
  const phase=g.__previewTransport?.snapshot().phase;
  if(['ready','stopped'].includes(phase))return [];
  if(social)return g.__socialPreview?.elementBoxes?.()||[];
  const host=g.getBoundingClientRect();if(!host.width||!host.height)return [];
  const result:ElementBox[]=[];
  const add=(field:string,node:Element|undefined|null)=>{
    if(!node?.isConnected||!template.fields[field])return;
    let rect=node.getBoundingClientRect(),left=rect.left,top=rect.top,right=rect.right,bottom=rect.bottom,alpha=1;
    for(let parent:Element|null=node;parent&&parent!==g;parent=parent.parentElement){
      const css=getComputedStyle(parent);if(css.display==='none'||css.visibility==='hidden')return;
      alpha*=Number(css.opacity);if(alpha<=.05)return;
      if(parent!==node&&[css.overflowX,css.overflowY].some(value=>['hidden','clip'].includes(value))){
        const clip=parent.getBoundingClientRect();left=Math.max(left,clip.left);top=Math.max(top,clip.top);right=Math.min(right,clip.right);bottom=Math.min(bottom,clip.bottom);
      }
    }
    const box=clippedBox(field,{x:(left-host.left)/host.width,y:(top-host.top)/host.height,width:(right-left)/host.width,height:(bottom-top)/host.height});
    if(box)result.push(box);
  };
  if(template.id==='BTV_BA_1P'){
    for(const [kind,nodes]of Object.entries(g.scene?.canvases?.targets||{}))for(const node of nodes as HTMLCanvasElement[])add(`_media_${kind}_url`,previewMediaElement(node));
  }else for(const [kind,track]of Object.entries(tracksOf(g))){
    if(kind==='audio')continue;
    // Clip nodes can exceed their slot when cover-fit is used; add() clips all
    // overflow ancestors so a thumbnail never becomes a full-screen target.
    for(const clip of track.clips)add(`_media_${kind}_url`,clip.node);
  }
  add('_replay_url',g.scene?.root?.querySelector('.qr'));
  const animation=g.state?.animation;
  if(animation){
    const names=new Map((animation.animationData?.assets||[]).map((asset:any)=>[asset.id,asset.nm]));
    const walk=(container:any,scope='')=>{for(const layer of container?.elements||[]){if(!layer)continue;
      const name=String(layer.data?.nm||'');
      if(layer.data?.ty===2&&/sponsor/i.test(scope+' '+name)){
        const field=template.id==='BTV_BA_1P'?'_sponsor_url':template.id==='BTV_BA_TDS'?'_sponsor_logo':/2/.test(scope)?'_p2_sponsor_logo':'_p1_sponsor_logo';add(field,layer.layerElement);
      }
      walk(layer,String(names.get(layer.data?.refId)||scope));
    }};walk(animation.renderer);
  }
  add(OVERLAY_LOGO,g.shadowRoot?.querySelector('[data-studio-overlay-logo] image'));
  return result;
}
