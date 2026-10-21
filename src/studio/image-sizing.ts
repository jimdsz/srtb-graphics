import type {BroadcastTemplate,FieldValue,ProjectData} from './domain';
import type {LegacyGraphic} from './video/engine';
import {tracksOf} from './media-tracks';
import {IMAGE_SIZES,imageScale,imageSizeFields,isResizableImage,resizedImageGeometry} from './image-sizing-model';

/** Static image preparation, once per explicit size change, never per frame.
 * Only engine-bound copies contain object URLs; saved projects retain sources. */
export function installImageSizing(g:LegacyGraphic,template:BroadcastTemplate,initial:ProjectData){
  const fields=imageSizeFields(template),cache=new Map<string,string>(),abort=new AbortController();
  let data=initial;
  let accepted=new Set<string>();
  let chain:Promise<unknown>=Promise.resolve();
  function queue<T>(work:()=>Promise<T>){const job=chain.catch(()=>{}).then(()=>{abort.signal.throwIfAborted();return work();});chain=job;return job;}
  const load=g.load.bind(g),update=g.updateAction.bind(g),dispose=g.dispose.bind(g);
  const styled=new WeakMap<HTMLElement,string>(),wrapped=new WeakSet<object>();
  function transparent(node:HTMLElement|undefined,enabled:boolean){
    if(!node)return;
    if(enabled){if(!styled.has(node))styled.set(node,node.style.backgroundColor);node.style.backgroundColor='transparent';}
    else if(styled.has(node)){node.style.backgroundColor=styled.get(node)!;styled.delete(node);}
  }
  function refreshPopupImages(){
    if(template.id!=='BTV_PopUp')return;
    // The frozen pop-up gives every media element a black technical backdrop.
    // Keep it for native sources/video, but preserve alpha around resized images.
    const urls=new Set(cache.values());
    for(const track of Object.values(tracksOf(g)) as any[]){
      const refresh=()=>{
        for(const clip of track.clips||[])transparent(clip.node,clip.node instanceof HTMLImageElement&&urls.has(clip.node.src));
        const active=track.clips?.[track.index]?.node;
        transparent(track.slot,active instanceof HTMLImageElement&&urls.has(active.src));
      };
      // Read the current cache on each clip switch, including after another edit.
      if(!wrapped.has(track)&&typeof track.show==='function'){
        const show=track.show.bind(track);track.show=(index:number)=>{show(index);refreshPopupImages();};wrapped.add(track);
      }
      refresh();
    }
  }
  async function resize(value:FieldValue,percent:number,used:Set<string>):Promise<FieldValue>{
    if(percent===100||!isResizableImage(value))return value;
    const source=typeof value==='object'?value.url:String(value),url=new URL(source,new URL(template.module,document.baseURI)).href,key=JSON.stringify([url,percent]);
    used.add(key);let result=cache.get(key);
    if(!result){
      const img=new Image();img.crossOrigin='anonymous';
      await new Promise<void>((resolve,reject)=>{
        const finish=(error?:Error)=>{clearTimeout(timer);abort.signal.removeEventListener('abort',cancel);img.onload=img.onerror=null;if(error){img.removeAttribute('src');reject(error);}else resolve();};
        const cancel=()=>finish(new DOMException('Préparation de l’image annulée.','AbortError'));
        const timer=setTimeout(()=>finish(Error('Cette image ne répond pas. Reconnectez le fichier ou réessayez.')),10000);
        img.onload=()=>finish();img.onerror=()=>finish(Error('Image illisible : choisissez un PNG, JPEG ou WebP.'));
        abort.signal.addEventListener('abort',cancel,{once:true});img.src=url;if(abort.signal.aborted)cancel();
      });
      abort.signal.throwIfAborted();
      const box=resizedImageGeometry(img.naturalWidth,img.naturalHeight,percent),canvas=document.createElement('canvas');canvas.width=box.width;canvas.height=box.height;
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('Préparation de l’image indisponible.');
      ctx.drawImage(img,box.x,box.y,box.w,box.h);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Impossible de redimensionner cette image.')),'image/png'));
      abort.signal.throwIfAborted();result=URL.createObjectURL(blob);cache.set(key,result);
    }
    return {url:result,name:typeof value==='object'?value.name:'Image ajustée.png',mimeType:'image/png'};
  }
  async function prepare(raw:ProjectData){
    const next={...data,...raw},native={...raw},used=new Set<string>();delete native[IMAGE_SIZES];
    for(const field of fields){
      if(!(field in next))continue;
      if(field.endsWith('_url'))native[field]=await resize(next[field],imageScale(next,field),used);
      else{
        const clips=JSON.parse(String(next[field]||'[]')) as Array<{url:FieldValue;start:number;end:number}>;
        // Sequential preparation bounds memory on seven-programme image sets.
        const changed=[];for(const [index,clip]of clips.entries())changed.push({...clip,url:await resize(clip.url,imageScale(next,`${field}:${index}`),used)});
        native[field]=JSON.stringify(changed);
      }
    }
    return {next,native,used};
  }
  function prune(keep:Set<string>){
    for(const [key,url]of cache)if(!keep.has(key)){URL.revokeObjectURL(url);cache.delete(key);}
  }
  async function apply(raw:ProjectData,invoke:(native:ProjectData)=>Promise<any>){
    try{const prepared=await prepare(raw),result=await invoke(prepared.native);if(!(result?.statusCode>=400)){data=prepared.next;accepted=prepared.used;}prune(accepted);refreshPopupImages();return result;}
    catch(error){prune(accepted);throw error;}
  }
  g.load=(params:any={})=>queue(()=>apply(params.data||{},native=>load({...params,data:native})));
  g.updateAction=(raw:ProjectData)=>queue(()=>apply(raw,update));
  g.dispose=async()=>{abort.abort();try{return await dispose();}finally{for(const url of cache.values())URL.revokeObjectURL(url);cache.clear();}};
}
