// Experimental only; not imported by the renderer. The measured native BA run
// showed no end-to-end improvement, so the runtime retains its original scan.
type PixelReader=Pick<CanvasRenderingContext2D,'getImageData'>;

/** Exact opacity decision: one non-opaque pixel is sufficient, never the reverse. */
export function bitmapOpacity(context:PixelReader,width:number,height:number){
  let pixelsRead=0;
  if(width>0&&height>0){
    const corner=context.getImageData(0,0,1,1).data;pixelsRead++;
    if(corner[3]!==255)return {opaque:false,pixelsRead,fullScan:false};
    if(width===1&&height===1)return {opaque:true,pixelsRead,fullScan:false};
  }
  // An opaque corner proves nothing about the rest of the image. Preserve the
  // full scan, including the native failure for an empty or unreadable canvas.
  const pixels=context.getImageData(0,0,width,height).data;pixelsRead+=width*height;
  for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255)return {opaque:false,pixelsRead,fullScan:true};
  return {opaque:true,pixelsRead,fullScan:true};
}
