import type {LegacyGraphic} from './video/engine';

const ids=new Set(['BTV_Renvoi','BTV_Evenement','BTV_Semainier']);
export const hasAESignature=(id:string)=>ids.has(id);

/** Preserve the source AE accompaniment: one pass from IN, no added OUT fade,
 * loop or stretch. Renvoi's original sound stops at 10 s, even on a longer hold. */
export function aeSignatureEnd(id:string,programmeEnd:number){
  return id==='BTV_Renvoi'?Math.min(10,programmeEnd):programmeEnd;
}

/** Renvoi's frozen engine forgot to apply _audio_volume. Instance-only adapter
 * shared by the editor and portable HTML; native assets stay byte-identical. */
export function installAESignatureLevel(g:LegacyGraphic,template:{id:string;libraryVersion:string}){
  if(template.libraryVersion!=='1.7.0'||!hasAESignature(template.id)||typeof g.syncAudio!=='function'||g.__aeSignatureLevel)return;
  const sync=g.syncAudio.bind(g);
  g.syncAudio=(...args:any[])=>{
    const value=Number(g.data?._audio_volume??1),volume=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
    for(const item of g.audio||[]){const node=item.node||item.element;if(node)node.volume=volume;}
    return sync(...args);
  };
  g.__aeSignatureLevel=true;
}
