import {previewPNG} from './preview-png';
self.onmessage=(event:MessageEvent<{id:number;width:number;height:number;rgba:ArrayBuffer}>)=>{
  const {id,width,height,rgba}=event.data;
  try{const png=previewPNG(width,height,new Uint8ClampedArray(rgba));self.postMessage({id,png:png.buffer},{transfer:[png.buffer]});}
  catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
