import type {BroadcastField,ProjectData} from './domain';
export const relayKeys=['_studio_relay_scale','_studio_relay_x','_studio_relay_y'] as const;
// Compact lower-side placement, raised clear of the bottom 23% of the picture.
// This is a starting point, not face detection: operators still inspect the shot.
export const relayMinScale=25;
export const relayNewDefaults:ProjectData={_studio_relay_scale:40,_studio_relay_x:100,_studio_relay_y:80};
export const relayFields:Record<string,BroadcastField>=Object.fromEntries(relayKeys.map((key,i)=>[key,{type:'number',default:i===0?100:i===1?50:100,minimum:i===0?relayMinScale:0,maximum:100,title:['Taille du relais TV','Position horizontale du relais TV','Position verticale du relais TV'][i]}]));
/** Legacy defaults reproduce the frozen 144/728/1632/249 ribbon exactly. */
export function relayGeometry(data:ProjectData){
  const number=(key:string,fallback:number,min=0)=>Math.max(min,Math.min(100,Number.isFinite(Number(data[key]))?Number(data[key]):fallback));
  const scale=number(relayKeys[0],100,relayMinScale)/100,width=1632*scale,height=249*scale;
  return {scale,width,height,x:144+(1632-width)*number(relayKeys[1],50)/100,y:108+(869-height)*number(relayKeys[2],100)/100};
}
