import manifest from './preview-assets.json';
import {HttpError} from './http';

type Asset={bytes:number;sha256:string};
type AssetFetch=(request:Request)=>Promise<Response>;
type Lifetime=(promise:Promise<unknown>)=>void;

/** One bounded, single byte range. Multipart ranges are not used by the player. */
export function previewByteRange(raw:string,size:number):{start:number;end:number}|null{
  const match=/^bytes=(\d*)-(\d*)$/.exec(raw.trim());
  if(!match||(!match[1]&&!match[2]))return null;
  const a=Number(match[1]),b=Number(match[2]);
  if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b))return null;
  const start=match[1]?a:Math.max(0,size-b),end=match[1]&&match[2]?Math.min(b,size-1):size-1;
  return start>=0&&start<size&&end>=start?{start,end}:null;
}

/** Constant-memory slice; cancellation stops the upstream read, including suffixes. */
export function previewByteSlice(body:ReadableStream<Uint8Array>,start:number,length:number):ReadableStream<Uint8Array>{
  const reader=body.getReader();let skip=start,left=length,done=false;
  const stop=async(reason?:unknown)=>{if(done)return;done=true;try{await reader.cancel(reason);}finally{reader.releaseLock();}};
  return new ReadableStream<Uint8Array>({
    async pull(controller){
      try{
        while(!done){
          const item=await reader.read();
          if(item.done)throw Error('Incomplete preview asset');
          if(skip>=item.value.byteLength){skip-=item.value.byteLength;continue;}
          const part=item.value.subarray(skip,skip+left);skip=0;left-=part.byteLength;
          controller.enqueue(part);
          if(left===0){controller.close();await stop();}
          return;
        }
      }catch(error){controller.error(error);await stop(error).catch(()=>undefined);}
    },
    cancel:stop,
  });
}

/** Call only AFTER authentication. Pages ASSETS currently ignores Range.
 * Serve the two build-verified lightweight proxies with actual byte ranges and
 * a fixed-length stream (a plain stream loses Content-Length in Workers).
 * Never buffers a whole MP4 or redirects to a public asset URL. */
export async function previewAssetResponse(request:Request,assetFetch:AssetFetch,waitUntil:Lifetime):Promise<Response|null>{
  const url=new URL(request.url),asset=(manifest as Record<string,Asset>)[url.pathname];
  if(!asset||!['GET','HEAD'].includes(request.method))return null;
  const etag='"'+asset.sha256+'"',headers=new Headers({
    'Content-Type':'video/mp4','Accept-Ranges':'bytes','Cache-Control':'private, no-store',
    'ETag':etag,'X-Content-Type-Options':'nosniff',
  });
  const raw=request.method==='GET'?request.headers.get('Range'):null,ifRange=request.headers.get('If-Range');
  const range=raw&&(!ifRange||ifRange===etag)?previewByteRange(raw,asset.bytes):undefined;
  if(range===null){headers.set('Content-Range',`bytes */${asset.bytes}`);return new Response(null,{status:416,headers});}
  const start=range?.start??0,end=range?.end??asset.bytes-1,length=end-start+1;
  headers.set('Content-Length',String(length));
  if(range)headers.set('Content-Range',`bytes ${start}-${end}/${asset.bytes}`);
  const init={status:range?206:200,headers};
  if(request.method==='HEAD')return new Response(null,init);
  // Exact known asset, no cache-key variants and no client conditionals. This is
  // an internal binding, not a network fetch; the original session is not forwarded.
  url.search='';url.hash='';
  const upstream=await assetFetch(new Request(url,{headers:{'Accept-Encoding':'identity'},signal:request.signal,redirect:'manual'}));
  const declared=upstream.headers.get('Content-Length'),encoding=upstream.headers.get('Content-Encoding');
  if(upstream.status!==200||!upstream.body||upstream.headers.get('Content-Type')?.split(';')[0]!=='video/mp4'||
    (encoding&&encoding!=='identity')||(declared!==null&&Number(declared)!==asset.bytes)){
    await upstream.body?.cancel();throw new HttpError(502,'Vidéo d’aperçu indisponible. Réessayez dans quelques instants.');
  }
  const fixed=new FixedLengthStream(length);
  const transfer=previewByteSlice(upstream.body,start,length).pipeTo(fixed.writable,{signal:request.signal}).catch(error=>{
    // A disconnected/paused player normally cancels its response. No path or media data in logs.
    if(!request.signal.aborted&&!(error instanceof Error&&error.name==='AbortError'))console.warn(JSON.stringify({event:'preview.stream.interrupted'}));
  });
  waitUntil(transfer);
  return new Response(fixed.readable,init);
}
