/** Device-local raster size for the image actually visible in the monitor.
 * Logical composition dimensions, crop and export resolution never change.
 * Quantization avoids reallocating a canvas for every pixel of a panel resize. */
export function previewDisplayEdge(width:number,height:number,logicalWidth:number,logicalHeight:number,pixelRatio:number,budget:number){
  if(![width,height,logicalWidth,logicalHeight].every(n=>Number.isFinite(n)&&n>0))return budget;
  const density=Number.isFinite(pixelRatio)&&pixelRatio>0?Math.min(2,Math.max(1,pixelRatio)):1;
  const fit=Math.min(width/logicalWidth,height/logicalHeight);
  const wanted=Math.ceil(Math.max(logicalWidth,logicalHeight)*fit*density/64)*64;
  return Math.min(budget,Math.max(320,wanted));
}
