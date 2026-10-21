import {zlibSync} from 'fflate';

// Preview transport only: lossless PNG, deliberately without compression.
// A video frame must not compete with layout/animation for PNG compression.
// No network transfer: these bytes live only between this tab and its worker.
const table=new Uint32Array(256).map((_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type:string,data:Uint8Array){const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);out.set([...type].map(c=>c.charCodeAt(0)),4);out.set(data,8);view.setUint32(out.length-4,crc(out.subarray(4,-4)));return out;}
export function previewPNG(width:number,height:number,rgba:Uint8ClampedArray){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1920||height>1920||rgba.length!==width*height*4)throw Error('Image d’aperçu invalide.');
  const header=new Uint8Array(13),view=new DataView(header.buffer);view.setUint32(0,width);view.setUint32(4,height);header[8]=8;header[9]=6;
  const stride=width*4,scanlines=new Uint8Array((stride+1)*height);
  for(let y=0;y<height;y++)scanlines.set(rgba.subarray(y*stride,(y+1)*stride),y*(stride+1)+1);
  const chunks=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlibSync(scanlines,{level:0})),chunk('IEND',new Uint8Array())];
  const result=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}return result;
}
