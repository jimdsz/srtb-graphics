import type {Track} from './video/engine';
import {TIMINGS} from './video/timeline';

const weeklyStarts=[2.96,5.4,7.8,10.2,12.6,15,17.4];
export function aeSocialTrackTimes(id:string,seconds:number):Record<string,number>|undefined{
  if(id==='BTV_Renvoi')return {renvoi:seconds};
  if(id==='BTV_Evenement')return {intro:seconds,event:seconds,event_logo:seconds};
  if(id==='BTV_Semainier'){
    if(seconds<weeklyStarts[0])return {intro:seconds};
    if(seconds>=19.8)return {final:Math.max(0,seconds-19.8)};
    let index=0;for(let next=1;next<weeklyStarts.length&&seconds>=weeklyStarts[next];next++)index=next;
    return {[`programme_${index+1}`]:Math.max(0,seconds-weeklyStarts[index])};
  }
}

export interface AEMediaWindow {at:number;until:number;elapsed:number}
/** Picture and audio share one output-time/source-time mapping. elapsed is the
 * already-consumed playlist time when an AE layer becomes visible after OUT. */
export function aeMediaWindows(id:string,kind:string,track:Pick<Track,'activeStart'|'activeEnd'>,outAt:number,duration:number,social=false):AEMediaWindow[]{
  if(social){
    let start=0,end=duration;
    if(id==='BTV_Semainier'){
      const programme=kind.match(/^programme_([1-7])$/);
      if(kind==='intro')end=weeklyStarts[0];
      else if(kind==='final')start=19.8;
      else if(programme){const index=Number(programme[1])-1;start=weeklyStarts[index];end=weeklyStarts[index+1]??19.8;}
      else return [];
    }
    return start<Math.min(duration,end)?[{at:start,until:Math.min(duration,end),elapsed:0}]:[];
  }
  const start=track.activeStart??0,end=track.activeEnd??Infinity,stop=TIMINGS[id]?.stop??Infinity;
  const windows:AEMediaWindow[]=[];
  const add=(at:number,until:number)=>{
    // Native source seeks hold source time zero until activeStart even when an
    // early OUT jumps directly to a layer whose original entrance was later.
    at=Math.max(at,start,0);until=Math.min(until,duration);if(!(at<until))return;
    const prior=windows.at(-1);if(prior&&Math.abs(prior.until-at)<1e-7)prior.until=until;
    else windows.push({at,until,elapsed:at-start});
  };
  if(start<=stop-.04)add(start,Math.min(outAt,end<=stop-.04?end:outAt));
  if(Number.isFinite(outAt)&&end>stop)add(outAt+Math.max(0,start-stop),outAt+end-stop);
  return windows;
}

export function aeMediaFade(seconds:number,outAt:number,outDuration:number){
  return outDuration>0?1-Math.max(0,Math.min(1,(seconds-outAt)/outDuration)):Number(seconds<outAt);
}
