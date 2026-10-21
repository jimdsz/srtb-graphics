import type {LegacyGraphic} from './video/engine';

/** A temporary, inert copy of the accepted picture covers destructive engine
 * rebuilds. No PNG encoding/readback, replay or export changes.
 * SVG IDs stay in an independent shadow root; canvas/video pixels are frozen. */
export async function holdPreviewFrame(graphic:LegacyGraphic,signal:AbortSignal):Promise<(()=>void)|undefined>{
  const source=graphic.shadowRoot,parent=graphic.parentElement,social=graphic.__socialPreview?.canvas as HTMLCanvasElement|undefined;
  if((!source&&!social)||!parent)return;
  const hold=document.createElement('div');hold.setAttribute('aria-hidden','true');hold.setAttribute('data-preview-hold','');
  hold.style.cssText='position:absolute;inset:0;display:block;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:9';
  const shadow=hold.attachShadow({mode:'open'});
  const owned:string[]=[];let closed=false;
  const pending=new AbortController();
  const release=()=>{if(closed)return;closed=true;clearTimeout(timeout);signal.removeEventListener('abort',release);pending.abort();hold.remove();owned.forEach(url=>URL.revokeObjectURL(url));};
  // Preparation is optional and bounded independently of the engine's 60 s
  // watchdog. Closing the preview also releases an in-flight image decode.
  const timeout=setTimeout(release,5000);
  signal.addEventListener('abort',release,{once:true});
  const decoded=(image:HTMLImageElement)=>new Promise<void>((resolve,reject)=>{
    const abort=()=>{image.removeAttribute('src');reject(new DOMException('Image figée interrompue.','AbortError'));};
    if(pending.signal.aborted){abort();return;}
    pending.signal.addEventListener('abort',abort,{once:true});
    image.decode().then(resolve,reject).finally(()=>pending.signal.removeEventListener('abort',abort));
  });
  try{
    signal.throwIfAborted();
    // The social renderer is a sibling canvas. Its native TV shadow is hidden
    // and can contain a completely different composition (or no drawing).
    // Capture that exact displayed surface, never the hidden source engine.
    if(social){
      const canvas=document.createElement('canvas');canvas.width=social.width;canvas.height=social.height;
      canvas.style.cssText=social.style.cssText;
      if(!canvas.width||!canvas.height)throw Error('Surface sociale non prête.');
      canvas.getContext('2d')!.drawImage(social,0,0);shadow.append(canvas);
    }else for(const child of source!.childNodes)shadow.append(child.cloneNode(true));
    const originals=social?[]:source!.querySelectorAll('canvas,video,audio'),copies=shadow.querySelectorAll('canvas,video,audio');
    originals.forEach((node,index)=>{
      const copy=copies[index];
      if(node instanceof HTMLAudioElement){copy.remove();return;}
      const canvas=document.createElement('canvas');
      for(const attribute of copy.attributes)if(!['src','autoplay','controls'].includes(attribute.name))canvas.setAttribute(attribute.name,attribute.value);
      canvas.width=node instanceof HTMLVideoElement?node.videoWidth:(node as HTMLCanvasElement).width;
      canvas.height=node instanceof HTMLVideoElement?node.videoHeight:(node as HTMLCanvasElement).height;
      if(node instanceof HTMLVideoElement){const css=getComputedStyle(node);for(const key of ['width','height','object-fit','object-position','transform','transform-origin'])canvas.style.setProperty(key,css.getPropertyValue(key));}
      if(canvas.width&&canvas.height)canvas.getContext('2d')!.drawImage(node as CanvasImageSource,0,0);
      copy.replaceWith(canvas);
    });
    // A media surface may revoke its current blob URL during the rebuild. Own
    // the snapshot's local blob references until its pixels are released.
    const blobs=new Map<string,Promise<string>>();
    await Promise.all([...shadow.querySelectorAll('image,img')].map(async node=>{
      const attribute=node.localName==='img'?'src':'href',url=node.getAttribute(attribute)||node.getAttributeNS('http://www.w3.org/1999/xlink','href');
      if(!url?.startsWith('blob:'))return;
      let copy=blobs.get(url);if(!copy){copy=fetch(url,{signal:pending.signal}).then(response=>response.blob()).then(blob=>{signal.throwIfAborted();if(closed)throw Error('Image figée fermée.');const ownedURL=URL.createObjectURL(blob);owned.push(ownedURL);return ownedURL;});blobs.set(url,copy);}
      const ownedURL=await copy;node.setAttribute(attribute,ownedURL);if(node.hasAttributeNS('http://www.w3.org/1999/xlink','href'))node.setAttributeNS('http://www.w3.org/1999/xlink','href',ownedURL);
      const image=new Image();image.src=ownedURL;await decoded(image);
    }));
    signal.throwIfAborted();if(closed)return;clearTimeout(timeout);parent.append(hold);return release;
  }catch{release();return;}
}

/** Keep the accepted picture until an asynchronous inspection acknowledges its
 * replacement. Explicit Clear/OUT never use this helper and still clear normally. */
export async function withHeldPreviewFrame<T>(graphic:LegacyGraphic,signal:AbortSignal,replace:()=>Promise<T>):Promise<T>{
  const release=await holdPreviewFrame(graphic,signal);
  try{signal.throwIfAborted();return await replace();}finally{release?.();}
}
