import type {ProjectData} from '../domain';
import {ceilFrameSeconds} from '../frame-time';
import {AE_COMPLETE_OUT} from '../ae-out-timing';
import {baSocialDirect} from '../ba-social-direct';
export interface Timing {entry:number;stop:number;out:number;kind:'ba'|'legacy'|'signature'}
export const TIMINGS:Record<string,Timing>={
  BTV_BA_1P:{entry:7.6,stop:64.8,out:8.12,kind:'ba'},
  BTV_PopUp:{entry:3.2,stop:9.84,out:.84,kind:'legacy'},
  BTV_BA_TDS:{entry:15.28,stop:15.28,out:.72,kind:'legacy'},
  BTV_BA_TDS_SUIVI_DE:{entry:24.28,stop:24.28,out:.72,kind:'legacy'},
  BTV_Ce_Soir:{entry:1.6,stop:13.8,out:1.2,kind:'signature'},
  BTV_Relais_Antenne:{entry:1.4,stop:9,out:1,kind:'signature'},
  BTV_Passerelle_Replay:{entry:1.2,stop:14.8,out:1.2,kind:'signature'},
  BTV_Renvoi:{entry:2.8,stop:7.4,out:2.6,kind:'signature'},
  BTV_Evenement:{entry:4.08,stop:AE_COMPLETE_OUT.BTV_Evenement.outStart,out:AE_COMPLETE_OUT.BTV_Evenement.outDuration,kind:'signature'},
  BTV_Semainier:{entry:2.72,stop:AE_COMPLETE_OUT.BTV_Semainier.outStart,out:AE_COMPLETE_OUT.BTV_Semainier.outDuration,kind:'signature'},
};
export interface VideoTimeline {timing:Timing;outAt:number;duration:number;frames:number;terminalHoldFrames:number}
/** Non-looping social excerpts cannot inherit an empty tail from the TV clock. */
export function socialExcerptEnd(id:string,data:ProjectData,lengths:Record<string,number>){
  const body=lengths.body;
  return baSocialDirect(id,data)&&data._media_body_loop!==true&&Number.isFinite(body)&&body>0?ceilFrameSeconds(body):Infinity;
}
export function makeTimeline(id:string,data:ProjectData,lengths:Record<string,number>,manualOut:number,exportLimit=true):VideoTimeline{
  const direct=baSocialDirect(id,data),timing=direct?{entry:.04,stop:0,out:0,kind:'ba' as const}:TIMINGS[id];if(!timing)throw Error('Adaptateur de rendu absent pour ce modèle.');
  let outAt=data._out_mode==='manual'?manualOut:Number(data._out_duration_seconds);
  if(data._out_mode==='media_end'){
    let keys:string[];
    if(id==='BTV_BA_1P')outAt=direct?(lengths.body??NaN):4.36+(lengths.body??NaN)-1.36;
    else{
      const selected=String(data._out_media_track||'background');
      keys=selected==='all'?(id==='BTV_PopUp'?['popup',...(data._background_visible?['background']:[])]:['programme_1','programme_2']):[selected];
      outAt=Math.max(...keys.map(k=>(lengths[k]??NaN)+(k==='popup'?.64:k==='programme_2'?13.8:0)));
    }
  }
  if(!Number.isFinite(outAt)||outAt<0)throw Error('Durée indéterminée : précisez la sortie ou la durée des médias.');
  outAt=Math.min(Math.max(timing.entry,ceilFrameSeconds(outAt)),socialExcerptEnd(id,data,lengths));
  // TV PopUp's native OUT is 246..266 inclusive. Keep every motion sample,
  // then hold frame 266 for five additional samples; never stretch OUT itself.
  const terminalHoldFrames=id==='BTV_PopUp'&&(!data._studio_format||data._studio_format==='tv')?5:0;
  const frames=Math.round((outAt+timing.out)*25)+terminalHoldFrames;
  // Bound memory and accidental all-day renders. No truncation: refuse with an explicit error.
  if(exportLimit&&frames>25*600)throw Error('Un export navigateur est limité à 10 minutes. Réduisez la durée avant OUT.');
  return {timing,outAt,duration:frames/25,frames,terminalHoldFrames};
}
export function graphicTime(timeline:VideoTimeline,seconds:number){
  const {timing,outAt}=timeline;
  if(timing.kind==='ba'&&timing.out===0)return seconds;
  if(timing.kind==='signature')return seconds;
  if(seconds>=outAt){
    const source=timing.stop+seconds-outAt;
    return timeline.terminalHoldFrames?Math.min(source,(Math.round((timing.stop+timing.out)*25)-1)/25):source;
  }
  return Math.min(seconds,(timing.kind==='ba'?timing.stop:timing.entry)-.04);
}
export const clamp01=(value:number)=>Math.min(1,Math.max(0,value));
