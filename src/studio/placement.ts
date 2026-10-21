import type {ProjectData} from './domain';
export interface LayoutBox {x:number;y:number;w:number;h:number}
/** One bounded transform for the whole block: never stretch text independently. */
export function blockPlacement(box:LayoutBox,width:number,height:number,vertical:boolean,data:ProjectData){
  const requested=Number(data._studio_block_scale??100)/100,anchor=data._studio_block_anchor||'original';
  if(requested===1&&anchor==='original'&&!data._studio_block_x&&!data._studio_block_y)return {x:box.x,y:box.y,scale:1};
  const left=80,top=vertical?300:190,right=width-(vertical?150:80),bottom=height-(vertical?350:100);
  const scale=Math.min(requested,(right-left)/box.w,(bottom-top)/box.h);
  const baseY=anchor==='top'?top:anchor==='center'?top+(bottom-top-box.h*scale)/2:anchor==='bottom'?bottom-box.h*scale:box.y;
  const x=Math.max(left,Math.min(right-box.w*scale,box.x+(box.w-box.w*scale)/2+Number(data._studio_block_x||0)));
  const y=Math.max(top,Math.min(bottom-box.h*scale,baseY+Number(data._studio_block_y||0)));
  return {x,y,scale};
}
