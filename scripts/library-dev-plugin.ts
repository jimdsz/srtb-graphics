import type { Plugin } from 'vite';
import { createReadStream } from 'node:fs';
import { stat,readFile } from 'node:fs/promises';
import { resolve,sep,extname } from 'node:path';
// Serve the immutable engine modules without Vite import rewriting.
export function libraryFiles():Plugin {
  return {name:'immutable-library-files',apply:'serve',configureServer(server){
    server.middlewares.use(async(req,res,next)=>{
      const url=new URL(req.url||'/','http://127.0.0.1');
      if(url.pathname==='/__typography-runtime.mjs'){
        try{const bundle=JSON.parse(await readFile(resolve(server.config.root,'src/studio/typography-runtime.generated.json'),'utf8'));res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(bundle.code);}catch{res.writeHead(500).end();}return;
      }
      if(['/', '/graphics', '/signatures', '/commercial'].includes(url.pathname)){req.url='/studio.html'+url.search;next();return;}
      const prefix=url.pathname.startsWith('/library/')?'/library/':url.pathname.startsWith('/studio-engines/')?'/studio-engines/':null;
      if(!prefix)return next();
      const root=resolve(server.config.root,'public',prefix.slice(1,-1));
      let file:string;try{file=resolve(root,decodeURIComponent(url.pathname.slice(prefix.length)));}catch{return next();}
      if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
      try{
        const info=await stat(file);if(!info.isFile())return next();
        const mime:Record<string,string>={'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.otf':'font/otf','.ttf':'font/ttf','.woff2':'font/woff2','.mp4':'video/mp4','.webm':'video/webm','.wav':'audio/wav','.mp3':'audio/mpeg'};
        const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range?.[2]?Math.min(info.size-1,Number(range[2])):info.size-1;
        if(start>=info.size||end<start){res.writeHead(416).end();return;}
        res.writeHead(range?206:200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${info.size}`}:{})});
        if(req.method==='HEAD')res.end();else createReadStream(file,{start,end}).pipe(res);
      }catch{next();}
    });
  }};
}
