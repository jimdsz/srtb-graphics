import {commercialSequenceTimeline, commercialTextSlots, commercialTimeline} from './model';
import type {CommercialData} from './model';

export interface CommercialPreviewIdentity {sequenceId:string;slot:number}
export function commercialPreviewIdentity(data:CommercialData,page:number):CommercialPreviewIdentity|null {
  const slot=commercialTextSlots(data)[page],span=slot&&commercialSequenceTimeline(data)[slot.sequenceIndex];
  return span?{sequenceId:span.id,slot:slot.slot}:null;
}
export function commercialPreviewPage(data:CommercialData,identity:CommercialPreviewIdentity|null,fallback=0):number {
  const slots=commercialTextSlots(data),spans=commercialSequenceTimeline(data);
  const sequence=identity?spans.find(span=>span.id===identity.sequenceId):undefined;
  if(sequence)return sequence.pageIndices[Math.min(identity!.slot,sequence.pageIndices.length-1)]??0;
  return Math.max(0,Math.min(slots.length-1,fallback));
}
export function commercialPreviewMoment(data:CommercialData,page:number):number {
  const slot=commercialTextSlots(data)[page],span=commercialSequenceTimeline(data)[slot?.sequenceIndex??0];
  return span?span.start+Math.min(2,span.duration/2):0;
}
/** Scrubbing and playback preserve the chosen side of a visible two-column scene. */
export function commercialPreviewPageAt(data:CommercialData,seconds:number,preferredPage=0):number {
  const spans=commercialSequenceTimeline(data);
  const span=spans.find(item=>seconds>=item.start&&seconds<item.end)??(seconds<(spans[0]?.start??0)?spans[0]:spans.at(-1));
  return span?.pageIndices.includes(preferredPage)?preferredPage:span?.pageIndices[0]??0;
}
function timingKey(data:CommercialData) {
  return JSON.stringify(commercialSequenceTimeline(data).map(({id,layout,start,end,pageIndices})=>[id,layout,start,end,pageIndices]));
}
/** Follow IDs across edits, rather than retaining an unrelated old timestamp/index. */
export function rebaseCommercialPreview(previous:CommercialData,next:CommercialData,page:number,seconds:number,requestedPage?:number) {
  const identity=commercialPreviewIdentity(previous,page);
  const index=requestedPage===undefined?commercialPreviewPage(next,identity,page):commercialPreviewPage(next,commercialPreviewIdentity(next,requestedPage),requestedPage);
  const changed=timingKey(previous)!==timingKey(next);
  const time=requestedPage!==undefined||changed?commercialPreviewMoment(next,index):Math.max(0,Math.min(seconds,commercialTimeline(next).duration-.04));
  return {page:index,time,identity:commercialPreviewIdentity(next,index),timingChanged:changed};
}
