/** On-demand diagnostic for the two shipped BA proxies only. No user media,
 * arbitrary URLs, cookies or response bodies are included in the result. */
export const BA_PREVIEW_PROXIES=['/preview-media/v1/ba-programme.mp4','/preview-media/v3/ba-prepared-slow-1280.mp4'];
export function knownBAPreviewProxy(raw:unknown,base:string){
  try{const url=new URL(String(raw),base);return url.origin===new URL(base).origin&&!url.search&&!url.hash&&BA_PREVIEW_PROXIES.includes(url.pathname)?url:null;}catch{return null;}
}
export type PreviewRangeResult={status:number|null;partial:boolean|null;length:number|null;acceptsBytes:boolean;contentRange:string|null;contentType:string|null};
export async function probePreviewRange(raw:string,base:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<PreviewRangeResult|null>{
  const url=knownBAPreviewProxy(raw,base);if(!url)return null;
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,8000);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  try{
    const response=await fetcher(url.href,{headers:{Range:'bytes=0-1'},credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
    try{
      const range=response.headers.get('Content-Range'),match=range?.match(/^bytes 0-1\/(\d+)$/),rawLength=response.headers.get('Content-Length');
      return {status:response.status,partial:response.status===206&&!!match&&Number(match[1])>2,length:rawLength!==null&&/^\d+$/.test(rawLength)?Number(rawLength):null,acceptsBytes:response.headers.get('Accept-Ranges')==='bytes',contentRange:match?range:null,contentType:response.headers.get('Content-Type')?.split(';')[0]??null};
    }finally{await response.body?.cancel();}
  }catch{return {status:null,partial:null,length:null,acceptsBytes:false,contentRange:null,contentType:null};}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
