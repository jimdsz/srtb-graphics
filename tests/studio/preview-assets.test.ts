import {expect,it,vi} from 'vitest';
import manifest from '../../server/preview-assets.json';
import {previewAssetResponse,previewByteRange,previewByteSlice} from '../../server/preview-assets';
import {secureHeaders} from '../../server/http';

const path='/preview-media/v1/ba-programme.mp4',size=manifest[path].bytes;
const url='https://studio.example'+path;
function source(bytes=size,options:{declared?:string;mime?:string;status?:number;encoding?:string}={}){
  let read=0,cancelled=false;
  const fetch=vi.fn(async(request:Request)=>{
    expect(request.headers.has('Range')).toBe(false);expect(request.headers.has('Cookie')).toBe(false);
    expect(request.headers.has('If-None-Match')).toBe(false);expect(new URL(request.url).search).toBe('');
    const body=new ReadableStream<Uint8Array>({pull(controller){
      if(read===bytes){controller.close();return;}
      const count=Math.min(65536,bytes-read),chunk=Uint8Array.from({length:count},(_,i)=>(read+i)%251);read+=count;controller.enqueue(chunk);
    },cancel(){cancelled=true;}});
    return new Response(body,{status:options.status??200,headers:{'Content-Type':options.mime??'video/mp4',
      ...(options.declared!==undefined?{'Content-Length':options.declared}:{}),...(options.encoding?{'Content-Encoding':options.encoding}:{})}});
  });
  return {fetch,get read(){return read;},get cancelled(){return cancelled;}};
}
async function response(range?:string,extras:Record<string,string>={},input=source()){
  const pending:Promise<unknown>[]=[];
  const result=await previewAssetResponse(new Request(url+'?test=1',{headers:{Cookie:'never-forward-me','If-None-Match':'stale',...(range?{Range:range}:{}),...extras}}),input.fetch,p=>pending.push(p));
  expect(result).not.toBeNull();return {result:secureHeaders(result!),pending,input};
}
it.each(['bytes=0-1','bytes=100000-100001','bytes=65535-65537','bytes=-4','bytes=12037472-','bytes=12037472-99999999'])('returns exact streamed %s even when Pages ignores Range',async range=>{
  const {result,pending,input}=await response(range),expected=previewByteRange(range,size)!;
  expect(result.status).toBe(206);expect(result.headers.get('Content-Range')).toBe(`bytes ${expected.start}-${expected.end}/${size}`);
  expect(result.headers.get('Accept-Ranges')).toBe('bytes');expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  const bytes=new Uint8Array(await result.arrayBuffer());await Promise.all(pending);
  expect([...bytes]).toEqual(Array.from({length:expected.end-expected.start+1},(_,i)=>(expected.start+i)%251));
  expect(result.headers.get('Content-Length')).toBe(String(bytes.length));
  if(expected.end<size-1)expect(input.cancelled).toBe(true);
  // The tiny Safari probe must not read the entire file.
  if(range==='bytes=0-1')expect(input.read).toBeLessThanOrEqual(2*65536);
});
it('streams full content for no Range and for a nonmatching If-Range',async()=>{
  for(const headers of [{},{'If-Range':'"old"'}]){
    const {result,pending}=await response('If-Range' in headers?'bytes=0-1':undefined,headers);
    expect(result.status).toBe(200);expect(result.headers.get('Content-Range')).toBeNull();
    const bytes=new Uint8Array(await result.arrayBuffer());await Promise.all(pending);
    expect(bytes.length).toBe(size);expect(bytes[size-1]).toBe((size-1)%251);
  }
});
it('supports strong matching If-Range and HEAD without loading a body',async()=>{
  const {result,pending}=await response('bytes=0-1',{'If-Range':'"'+manifest[path].sha256+'"'});
  expect(result.status).toBe(206);await result.arrayBuffer();await Promise.all(pending);
  const upstream=source(),head=await previewAssetResponse(new Request(url,{method:'HEAD',headers:{Range:'bytes=0-1'}}),upstream.fetch,()=>{});
  expect(head?.status).toBe(200);expect(head?.headers.get('Content-Length')).toBe(String(size));expect(head?.body).toBeNull();expect(upstream.fetch).not.toHaveBeenCalled();
});
it.each(['bytes=-0','bytes=-','bytes=12-2','bytes=12037476-','bytes=1-2,4-6','bytes=0-9007199254740992','items=0-1'])('rejects invalid/unsatisfiable %s without reading the file',async range=>{
  const {result,input}=await response(range);expect(result.status).toBe(416);expect(result.headers.get('Content-Range')).toBe(`bytes */${size}`);expect(input.fetch).not.toHaveBeenCalled();
});
it('does not intercept arbitrary or user assets',async()=>{
  const upstream=source();
  for(const pathname of ['/preview-media/user.mp4','/api/graphics/media/file/content','/library/elsewhere.mp4'])expect(await previewAssetResponse(new Request('https://studio.example'+pathname),upstream.fetch,()=>{})).toBeNull();
  expect(upstream.fetch).not.toHaveBeenCalled();
});
it('rejects missing, encoded, mismatched or nonvideo upstream bodies',async()=>{
  for(const options of [{status:404},{mime:'text/html'},{declared:'999'},{encoding:'gzip'}])await expect(response('bytes=0-1',{},source(size,options))).rejects.toMatchObject({status:502});
});
it('propagates truncation instead of completing a corrupt partial response',async()=>{
  const {result,pending}=await response('bytes=100-200',{},source(110));
  await expect(result.arrayBuffer()).rejects.toThrow();await Promise.all(pending);
});
it('cancels upstream when the client cancels the slice',async()=>{
  let cancelled=false;
  const body=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(16));},cancel(){cancelled=true;}});
  const reader=previewByteSlice(body,2,1000).getReader();await reader.read();await reader.cancel();expect(cancelled).toBe(true);
});
it('cancels the asset read through the fixed-length response on disconnect',async()=>{
  const input=source(),{result,pending}=await response(undefined,{},input);
  const reader=result.body!.getReader();await reader.read();await reader.cancel('client disconnected');
  await Promise.all(pending);expect(input.cancelled).toBe(true);expect(input.read).toBeLessThan(size);
});
