import type {BroadcastTemplate,ProjectData} from './domain';
import type {LegacyGraphic} from './video/engine';
import {relayGeometry,relayKeys} from './relay-placement';
/** Instance adapter shared by preview, movie export and portable packages. */
export function installRelayPlacement(g:LegacyGraphic,template:BroadcastTemplate,initial:ProjectData){
  if(template.id!=='BTV_Relais_Antenne')return;
  let data=initial;
  const clean=(raw:ProjectData)=>Object.fromEntries(Object.entries(raw).filter(([key])=>!relayKeys.includes(key as typeof relayKeys[number])));
  function apply(){
    const ribbon=g.shadowRoot?.querySelector<HTMLElement>('.ribbon');if(!ribbon)return;
    const p=relayGeometry(data);Object.assign(ribbon.style,{left:p.x+'px',right:'auto',top:p.y+'px',bottom:'auto',width:'1632px',transformOrigin:'0 0',transform:`scale(${p.scale})`});
  }
  const load=g.load.bind(g),update=g.updateAction.bind(g);
  g.load=async (params:any)=>{data={...data,...params.data};const result=await load({...params,data:clean(params.data)});apply();return result;};
  g.updateAction=async (raw:ProjectData)=>{const next={...data,...raw},result=await update(clean(raw));if(!result||result.statusCode<400){data=next;apply();}return result;};
}
