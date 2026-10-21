import type {BroadcastTemplate,ProjectData} from './domain';

export const baTextDefaults:ProjectData={_studio_ba_pack_scale:100,_studio_ba_body_scale:100,_studio_ba_pack_x:0,_studio_ba_pack_y:0,_studio_ba_body_x:0,_studio_ba_body_y:0};
export const baTextKey=(key:string)=>Object.hasOwn(baTextDefaults,key);
export function studioEngineModule(template:BroadcastTemplate){
  if(template.libraryVersion==='1.7.0'&&template.version==='1.0.0'&&['BTV_Evenement','BTV_Semainier'].includes(template.id)&&template.module===`/library/v1.7.0/${template.id}/graphic-v2.mjs`)return `/studio-engines/ae-out-v1/${template.id}.mjs`;
  return template.id==='BTV_BA_1P'&&template.version==='1.0.3'&&template.libraryVersion==='1.7.0'?'/studio-engines/ba-text-v2/graphic.mjs':template.module;
}
export function titleLines(data:ProjectData){return [1,2,3].map(n=>String(data[`_titre_ligne_${n}`]||''));}
/** Balanced words, never shortened or reordered. Only a proposal until accepted. */
export function distributeTitle(lines:string[],count:2|3):string[]{
  const words=lines.join(' ').trim().split(/\s+/).filter(Boolean);
  if(words.length<count)return [...lines];
  // Small dynamic program avoids pathological cubic enumeration for pasted titles.
  const target=words.join(' ').length/count,memo=new Map<string,{cost:number;lines:string[]}>();
  function solve(start:number,left:number):{cost:number;lines:string[]}{
    const key=start+':'+left,cached=memo.get(key);if(cached)return cached;
    if(left===1){const line=words.slice(start).join(' ');return {cost:(line.length-target)**2,lines:[line]};}
    let best={cost:Infinity,lines:[] as string[]};
    for(let end=start+1;end<=words.length-left+1;end++){
      const line=words.slice(start,end).join(' '),tail=solve(end,left-1),cost=(line.length-target)**2+tail.cost;
      if(cost<best.cost)best={cost,lines:[line,...tail.lines]};
    }memo.set(key,best);return best;
  }
  return [...solve(0,count).lines,...Array(3-count).fill('')];
}
