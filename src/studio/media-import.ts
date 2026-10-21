/** Visibility in the picker is not a promise of native codec support. */
export function needsMediaPreparation(file:{name:string;type?:string}){
  return /\.(mxf|mov)$/i.test(file.name)||/^(application\/mxf|video\/(?:mxf|quicktime))$/i.test(file.type||'');
}
export function mediaPickerAccept(kind='media'){
  const images='.png,.jpg,.jpeg,.webp',video='.mp4,.webm,.mxf,.mov',audio='.mp3,.wav,.m4a,.ogg';
  return kind==='audio'?audio:kind==='image'?images:kind==='all'?`${images},${video},${audio}`:`${images},${video}`;
}
export const preparationRequiredMessage='Ce fichier professionnel doit être préparé en MP4 par le connecteur avant d’être utilisé. Son original sera conservé.';
/** Decode a first frame/sample before replacing the current source. Never
 * upload or hash the whole file here. Failure leaves the current draft intact. */
export async function assertBrowserMedia(source:File|{url:string;mimeType:string},signal?:AbortSignal){
  signal?.throwIfAborted();const isFile=source instanceof File;
  if(isFile&&needsMediaPreparation(source))throw Error(preparationRequiredMessage);
  const mime=isFile?(/^(image|audio|video)\//.test(source.type)?source.type:(/\.(png|jpe?g|webp)$/i.test(source.name)?'image/':/\.(mp3|wav|m4a|ogg)$/i.test(source.name)?'audio/':'video/')):source.mimeType;
  const url=isFile?URL.createObjectURL(source):source.url;
  const node=mime.startsWith('image/')?new Image():document.createElement(mime.startsWith('audio/')?'audio':'video');
  try{await new Promise<void>((resolve,reject)=>{
    let timer:ReturnType<typeof setTimeout>;
    const finish=(error?:unknown)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);node.removeEventListener('error',fail);node.removeEventListener('load',ready);node.removeEventListener('loadeddata',ready);error?reject(error):resolve();};
    const abort=()=>finish(signal?.reason||new DOMException('Lecture annulée.','AbortError'));
    const fail=()=>finish(Error('Ce fichier ne peut pas être lu sur ce poste. Choisissez un fichier compatible ; le média actuel est conservé.'));
    const ready=()=>{
      if(node instanceof HTMLImageElement){if(!node.naturalWidth||!node.naturalHeight){fail();return;}}
      else if(!Number.isFinite(node.duration)||node.duration<=0||(node instanceof HTMLVideoElement&&(!node.videoWidth||!node.videoHeight))){fail();return;}
      finish();
    };
    timer=setTimeout(()=>finish(Error('Le fichier ne répond pas. Vérifiez le disque réseau puis réessayez. Le média actuel est conservé.')),20000);
    signal?.addEventListener('abort',abort,{once:true});node.addEventListener('error',fail,{once:true});node.addEventListener(node instanceof HTMLImageElement?'load':'loadeddata',ready,{once:true});
    if(node instanceof HTMLMediaElement){node.preload='auto';node.muted=true;}node.src=url;if(signal?.aborted)abort();
  });}finally{if(node instanceof HTMLMediaElement){node.pause();node.removeAttribute('src');node.load();}else node.removeAttribute('src');if(isFile)URL.revokeObjectURL(url);}
}
