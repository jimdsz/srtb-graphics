import type {Plugin} from 'vite';
// Synthetic, quiet tones for local duration/audition tests only. No user audio.
export const fixtureVoiceId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export function plannerVoiceFixture():Plugin{
 const rate=48000,length=rate*3,wav=Buffer.alloc(44+length*2);
 wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(length*2,40);
 for(let n=0;n<length;n++)wav.writeInt16LE(Math.round(300*Math.sin(n*2*Math.PI*220/rate)*Math.min(1,n/2400,(length-n)/2400)),44+n*2);
 return {name:'local-planner-voice-fixture',apply:'serve',configureServer(server){server.middlewares.use((req,res,next)=>{
  if(req.url?.split('?')[0]!==`/api/graphics/media/${fixtureVoiceId}/content`)return next();
  const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range?.[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;
  if(start>=wav.length||end<start){res.writeHead(416).end();return;}
  res.writeHead(range?206:200,{'Content-Type':'audio/wav','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store',...(range?{'Content-Range':`bytes ${start}-${end}/${wav.length}`}:{})});
  res.end(req.method==='HEAD'?undefined:wav.subarray(start,end+1));
 });}};
}
