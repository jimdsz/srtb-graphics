import {previewCanvasContext,checkPreviewCanvas} from './preview-canvas-guard';
type Kind='intro'|'body'|'pack';
type Placement={x:number;y:number;width:number;height:number};
function size(canvas:HTMLCanvasElement,width:number,height:number){
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
}
/** Keep the native preview's existing colour conversion, alpha, placement and
 * interpolation. Chromium intro/body can paint into their first visible slot
 * instead of an intermediate canvas. Pack must still be graded afterwards. */
export function paintBAPreviewCanvas(source:CanvasImageSource,canvas:HTMLCanvasElement,width:number,height:number,kind:Kind,placement:Placement){
  size(canvas,width,height);
  const ctx=previewCanvasContext(canvas);
  ctx.setTransform(width/1920,0,0,height/(kind==='pack'?540:1080),0,0);
  ctx.clearRect(0,0,1920,kind==='pack'?540:1080);
  if(kind==='intro'){ctx.fillStyle='rgba(0,0,0,.1)';ctx.fillRect(0,0,1920,1080);}
  ctx.drawImage(source,placement.x,placement.y,placement.width,placement.height);
  checkPreviewCanvas(ctx);
}
export function copyBAPreviewCanvas(frame:HTMLCanvasElement,targets:HTMLCanvasElement[],width:number,height:number){
  for(const target of targets){
    if(target===frame)continue;
    size(target,width,height);
    const out=previewCanvasContext(target);
    // A slot can previously have been the first visible (working) canvas.
    // Resizing is not guaranteed here, so explicitly reset its old scale.
    out.setTransform(1,0,0,1,0,0);out.clearRect(0,0,width,height);out.drawImage(frame,0,0,width,height);
    checkPreviewCanvas(out);
  }
}
