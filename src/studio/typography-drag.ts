import type {ProjectData} from './domain';
import {currentStyle} from './typography-model';
import {positionText} from './typography-position';
export interface TextDrag {field:string;x:number;y:number;dx:number;dy:number;moved:boolean;cancelled:boolean}
/** No mutation on click/cancel; a concurrent position edit always takes priority. */
export function finishTextDrag(latest:ProjectData,drag:TextDrag):ProjectData{
  const current=currentStyle(latest,drag.field),x=current?.x??0,y=current?.y??0;
  if(!drag.moved||drag.cancelled||x!==drag.x||y!==drag.y)return latest;
  const next=positionText(latest,drag.field,drag.x+drag.dx,drag.y+drag.dy),after=currentStyle(next,drag.field)!;
  return x===after.x&&y===after.y?latest:next;
}
