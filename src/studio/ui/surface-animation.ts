/** A dialog becomes rendered in its parent's effect. Start on the next frame,
 * and cancel without committing styles when its surface is hidden/unmounted. */
export function scheduleSurfaceAnimation(node:HTMLElement,start:(node:HTMLElement)=>{cancel():void}){
  let controls:{cancel():void}|undefined,cancelled=false;
  const frame=requestAnimationFrame(()=>{
    if(cancelled||!node.isConnected||node.getClientRects().length===0)return;
    controls=start(node);
  });
  return()=>{cancelled=true;cancelAnimationFrame(frame);controls?.cancel();};
}
