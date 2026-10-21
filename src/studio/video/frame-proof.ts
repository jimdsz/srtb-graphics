export type SampleProof={frame:number;alpha:Uint8ClampedArray<ArrayBuffer>;rgb:Uint8ClampedArray<ArrayBuffer>};
export function sampleProof(canvas:CanvasImageSource,frame:number):SampleProof{
  const tiny=document.createElement('canvas');tiny.width=96;tiny.height=54;
  const c=tiny.getContext('2d',{willReadFrequently:true})!;c.drawImage(canvas,0,0,96,54);
  const rgb=c.getImageData(0,0,96,54).data,alpha=new Uint8ClampedArray(96*54);
  for(let i=0;i<alpha.length;i++)alpha[i]=rgb[i*4+3];tiny.width=tiny.height=0;return {frame,alpha,rgb};
}
