import type {BroadcastTemplate,ProjectData} from './domain';
import type {LegacyGraphic,Track} from './video/engine';
import {tracksOf} from './media-tracks';
import {makeTimeline,graphicTime,socialExcerptEnd} from './video/timeline';
import {seekSignatureMedia} from './video/signature-media';
import {presentation,locateClip} from './presentation';
/** Browsers quantize seeks to microseconds. Modulo clip time can produce e.g.
 * 11.079999 instead of frame 11.08. Approach the intended timestamp from inside
 * its frame, like the offline decoder, without advancing a whole frame. */
export async function seekPreviewTrack(track:Track|undefined,seconds:number){
  if(!track)return;await track.seek?.(seconds+1e-7);
  const at=locateClip(track.clips,seconds,track.loop,track.rate),node=at?track.clips[at.index]?.node:undefined;
  if(!(node instanceof HTMLVideoElement)||!at)return;
  const target=Math.round(at.time*1e6)/1e6+1e-7;
  // A native seek may skip sub-millisecond moves after its own positioning.
  if(node.currentTime>=target-2e-7||Math.abs(node.currentTime-target)>.000002)return;
  await new Promise<void>((resolve,reject)=>{
    const done=()=>{clearTimeout(timer);node.removeEventListener('seeked',ready);node.removeEventListener('error',failed);};
    const ready=()=>{if(!node.seeking&&node.readyState>=2){done();resolve();}};
    const failed=()=>{done();reject(Error('Image vidéo indisponible pendant l’inspection.'));};
    const timer=setTimeout(failed,5000);node.addEventListener('seeked',ready);node.addEventListener('error',failed,{once:true});node.currentTime=target;
  });
}
export function previewTimeline(g:LegacyGraphic,t:BroadcastTemplate,data:ProjectData,outAt?:number){
  const lengths=Object.fromEntries(Object.entries(tracksOf(g)).map(([key,track])=>[key,track.length??track.clips.reduce((n,c)=>n+c.length,0)/(track.rate||1)]));
  const timeline=makeTimeline(t.id,data,lengths,Number(data._out_duration_seconds||12),false);
  // An operator may have triggered OUT before the scheduled end (even in IN).
  // Restoring settings/audio must preserve that actual boundary, not reschedule it.
  if(outAt!==undefined){if(!Number.isFinite(outAt)||outAt<0)throw Error('Début de sortie invalide.');outAt=Math.min(outAt,socialExcerptEnd(t.id,data,lengths));return {...timeline,outAt,duration:outAt+timeline.timing.out+timeline.terminalHoldFrames/25,frames:Math.round((outAt+timeline.timing.out)*25)+timeline.terminalHoldFrames};}
  return timeline;
}
/** Inspection uses output time, including the complete OUT, not AE source time. */
export async function inspectPreview(g:LegacyGraphic,t:BroadcastTemplate,data:ProjectData,seconds:number,outAt?:number){
  if(presentation(data)!=='tv'){const position={seconds,outAt};return g.goToTime(position);}
  const tl=previewTimeline(g,t,data,outAt),source=graphicTime(tl,seconds),tracks=tracksOf(g);
  const result=await g.goToTime({seconds:source});if(result?.statusCode>=400)return result;
  if(t.id==='BTV_BA_1P'){
    const body=seconds>=tl.outAt?Math.max(0,tl.outAt-4.36)+seconds-tl.outAt:Math.max(0,seconds-4.36);
    await g.media.sync(source,{introSeconds:seconds,bodySeconds:body,packSeconds:Math.max(0,seconds-tl.outAt),playing:false,muted:true,exact:true});
    if(source<5.6)await seekPreviewTrack(tracks.intro,seconds);
    if(source>=4.36&&source<66.16)await seekPreviewTrack(tracks.body,body);
    if(source>=64.8&&source<71.24)await seekPreviewTrack(tracks.pack,Math.max(0,seconds-tl.outAt));
    g.scene.canvases.draw();
  }else if(tl.timing.kind==='signature'){
    g.elapsed=seconds;g.outAt=tl.outAt;g.phase=seconds>=tl.outAt?'out':'inspection';
    // Native seek intentionally uses its inspection/IN clock. Once OUT is
    // remapped, prepare any newly visible AE media before drawing that pose.
    // Preserve native seek's pause/cancellation behavior; do not seek twice
    // when the source pose did not change (or for HTML signature templates).
    if(typeof g.sourceFrame==='function'&&g.sourceFrame(seconds)!==g.frame)await seekSignatureMedia(g,tracks,seconds,tl.outAt);
    g.stage.style.visibility='visible';g._draw(seconds,false);
    return g.getStatus();
  }else{
    // PopUp's native seek restores media but does not unhide the SVG after STOP.
    // Other Ferryman templates already do this; it is safe and required here.
    g.state.animation.show();
    if(t.id==='BTV_PopUp'){await seekPreviewTrack(tracks.background,seconds);await seekPreviewTrack(tracks.popup,Math.max(0,seconds-.64));}
    else if(t.id==='BTV_BA_TDS')await seekPreviewTrack(tracks.background,seconds);
    else if(t.id==='BTV_BA_TDS_SUIVI_DE'){await seekPreviewTrack(tracks.programme_1,Math.min(seconds,15.32));await seekPreviewTrack(tracks.programme_2,Math.max(0,seconds-13.8));}
  }
  return result;
}
