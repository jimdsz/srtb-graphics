import type {BroadcastTemplate,ProjectData} from './domain';
import type {LegacyGraphic} from './video/engine';
import {CE_SOIR_BACKGROUND,ceSoirBackground} from './ce-soir-background';

/** Same instance adapter in live preview, video export and portable packages.
 * The solid fill is independent of the animated stage: opaque from frame zero
 * through the terminal frame, while the original cards keep their IN/OUT. */
export function installCeSoirBackground(g:LegacyGraphic,template:BroadcastTemplate,initial:ProjectData){
  if(template.id!=='BTV_Ce_Soir')return;
  let data=initial;
  let underlay:HTMLElement|undefined;
  const clean=(raw:ProjectData)=>Object.fromEntries(Object.entries(raw).filter(([key])=>key!==CE_SOIR_BACKGROUND));
  function apply(){
    const root=g.scene?.root as HTMLElement|undefined;if(!root)return;
    const color=ceSoirBackground(data);
    if(color&&!underlay&&g.shadowRoot){
      underlay=g.ownerDocument.createElement('div');
      underlay.className='srtb-ce-soir-solid';
      underlay.style.cssText='position:absolute;inset:0;pointer-events:none';
      underlay.setAttribute('aria-hidden','true');
      g.shadowRoot.prepend(underlay);
    }
    if(underlay){underlay.style.background=color||'';underlay.style.display=color?'block':'none';}
    root.style.background=color||'';
    const media=root.querySelector<HTMLElement>('.background');if(media)media.style.display=color?'none':'';
    for(const selector of ['.heading','.station']){
      const node=root.querySelector<HTMLElement>(selector);if(node)node.style.color=color==='#f0b900'?'#000':'';
    }
  }
  const load=g.load.bind(g),update=g.updateAction.bind(g);
  g.load=async(params:any)=>{data={...data,...params.data};const result=await load({...params,data:clean(params.data)});if(!result||result.statusCode<400)apply();return result;};
  g.updateAction=async(raw:ProjectData)=>{const next={...data,...raw},result=await update(clean(raw));if(!result||result.statusCode<400){data=next;apply();}return result;};
}
