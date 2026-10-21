import {defineConfig} from 'vite';
import base from './ui-refinement.config';
import {resolve} from 'node:path';
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
// Qualification only: export reads the original, preview keeps its light copy.
const source=resolve(import.meta.dirname,'../../BroadcastTemplates/DELIVERABLES/BTV_HABILLAGE_DYNAMIQUE_v1.7.0/templates/BTV_BA_1P/lib/media/programme.mp4');
export default defineConfig({...base,plugins:[{name:'ba-direct-source',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4')return next();
  if(req.headers.host!=='127.0.0.1:5198'||!['GET','HEAD'].includes(req.method||'')){res.writeHead(403).end();return;}
  try{
    const {size}=await stat(source),range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range?.[2]?Math.min(size-1,Number(range[2])):size-1;
    if(start>=size||end<start){res.writeHead(416).end();return;}
    res.writeHead(range?206:200,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
    if(req.method==='HEAD')res.end();else createReadStream(source,{start,end}).pipe(res);
  }catch{res.writeHead(404).end();}
});}},...(base.plugins||[])],define:{...base.define,__SRTB_NATIVE_ONLY__:'true'},optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','lucide-react','zod','motion/react','mediabunny']}});
