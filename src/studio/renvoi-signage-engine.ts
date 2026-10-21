import type {BroadcastTemplate,ProjectData} from './domain';
import type {LegacyGraphic} from './video/engine';
import {RENVOI_AD,RENVOI_RATING,renvoiSignageAvailable,renvoiSignageShapeContract,renvoiSignageVisible} from './renvoi-signage';

/** Instance-only SVG visibility, shared by preview, video and portable HTML.
 * Native paths, matrices, opacity keys and appearance/disappearance stay intact.
 * Cache two targets once per animation: no scene queries/layout reads per frame. */
export function createRenvoiSignage(graphic:LegacyGraphic,template:BroadcastTemplate){
  let animation:any;
  let targets:{node:SVGGElement;key:string;visibility:string;priority:string}[]=[];
  function reset(){
    for(const {node,visibility,priority}of targets){
      if(visibility)node.style.setProperty('visibility',visibility,priority);else node.style.removeProperty('visibility');
      node.removeAttribute('data-studio-renvoi-signage');
    }
    targets=[];animation=undefined;
  }
  return {dispose:reset,refresh(data:ProjectData){
    if(!renvoiSignageAvailable(template,data)){if(animation)reset();return;}
    const next=graphic.animation;if(!next?.isLoaded)return;
    if(next!==animation){
      reset();
      const mentions=next.renderer?.elements?.filter((element:any)=>element?.data?.nm==='MENTIONS')||[];
      const layer=mentions[0];
      if(mentions.length!==1||!renvoiSignageShapeContract(layer?.data)||!layer.itemsData?.[0]?.gr?.style||!layer.itemsData?.[1]?.gr?.style)throw Error('Signalétique du renvoi : cette composition doit être vérifiée avant utilisation.');
      targets=[RENVOI_AD,RENVOI_RATING].map((key,index)=>{
        const node=layer.itemsData[index].gr as SVGGElement;
        node.setAttribute('data-studio-renvoi-signage',key===RENVOI_AD?'ad':'rating');
        return {node,key,visibility:node.style.getPropertyValue('visibility'),priority:node.style.getPropertyPriority('visibility')};
      });
      animation=next;
    }
    for(const {node,key,visibility,priority}of targets){
      const value=renvoiSignageVisible(data,key)?visibility:'hidden';
      if(node.style.getPropertyValue('visibility')!==value){
        if(value)node.style.setProperty('visibility',value,priority);else node.style.removeProperty('visibility');
      }
    }
  }};
}
