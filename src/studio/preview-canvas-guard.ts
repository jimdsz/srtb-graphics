/** Preview only: a lost Canvas2D context can silently ignore drawImage while
 * the decoder and timeline keep running. Never accept that as a new frame.
 * Weak ownership follows each canvas; no timer, pixel readback or GPU fence.
 * Loss is sticky for this surface: retry rebuilds it, so an in-flight encoded
 * frame cannot be accepted after a loss/restoration pair either. */
const observed=new WeakSet<CanvasRenderingContext2D>();
const lost=new WeakSet<CanvasRenderingContext2D>();
const unavailable=()=>Error('La surface d’image de l’aperçu ne répond plus. Relancez l’aperçu ; vos réglages sont conservés.');

export function checkPreviewCanvas(context:CanvasRenderingContext2D){
  if(context.isContextLost?.())lost.add(context);
  if(lost.has(context))throw unavailable();
}

export function previewCanvasContext(canvas:HTMLCanvasElement,options?:CanvasRenderingContext2DSettings){
  const context=canvas.getContext('2d',options);
  if(!context)throw unavailable();
  if(!observed.has(context)){
    // Do not cancel the browser's restoration behavior. This listener belongs
    // only to the canvas and becomes collectible with it on preview disposal.
    canvas.addEventListener('contextlost',()=>lost.add(context));
    observed.add(context);
  }
  checkPreviewCanvas(context);return context;
}
