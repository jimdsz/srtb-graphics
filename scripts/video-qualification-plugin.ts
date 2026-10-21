import type {Plugin} from 'vite';
import {mkdir,open} from 'node:fs/promises';
import {resolve} from 'node:path';
// Local-only evidence sink. Never imported by the production build.
export function videoQualification():Plugin{return {name:'video-qualification-evidence',apply:'serve',configureServer(server){
  server.middlewares.use(async(req,res,next)=>{
    const name=req.url?.match(/^\/__video-evidence\/([a-zA-Z0-9_-]+\.(?:png|mp4|webm|json|wav))$/)?.[1];if(!name)return next();
    if(server.config.server.host!=='127.0.0.1'||req.headers.host!=='127.0.0.1:5192'||req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:5192'){res.writeHead(403).end();return;}
    let handle;try{
      const root=resolve('reports/video-browser');await mkdir(root,{recursive:true});handle=await open(resolve(root,name),'wx');
      let bytes=0;for await(const item of req){bytes+=item.length;if(bytes>256*1024**2)throw Error('Evidence too large');await handle.write(item);}
      await handle.close();res.writeHead(201).end('Saved');
    }catch(error){await handle?.close().catch(()=>{});res.writeHead(400).end(error instanceof Error?error.message:'Evidence failed');}
  });
}};}
