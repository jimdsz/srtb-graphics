import {defineConfig} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import base from './operator-ux.config.ts';

// Isolated, bounded, loopback-only evidence; no API, project or authentication writes.
export default defineConfig({...base,
  cacheDir:resolve(import.meta.dirname,'../node_modules/.vite-catalogue-visual-matrix'),
  server:{host:'127.0.0.1',port:5192,strictPort:true,hmr:false,watch:{ignored:['**/reports/**']}},
  plugins:[...base.plugins!,{name:'catalogue-visual-evidence',configureServer(server){
    server.middlewares.use(async(req,res,next)=>{
      const match=req.url?.match(/^\/__catalogue-visual-evidence\/([a-z0-9-]{1,140}\.(json|png))$/);
      if(!match)return next();
      if(req.method!=='POST'||req.headers.host!=='127.0.0.1:5192'||req.headers.origin!=='http://127.0.0.1:5192'){
        res.writeHead(403).end('Local evidence only');return;
      }
      try{
        const chunks:Buffer[]=[];let length=0;
        for await(const chunk of req){length+=chunk.length;if(length>8*1024*1024)throw Error('Evidence exceeds 8 MiB');chunks.push(chunk);}
        const bytes=Buffer.concat(chunks);
        if(match[2]==='json')JSON.parse(bytes.toString('utf8'));
        else if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('PNG required');
        const directory=resolve(import.meta.dirname,'../reports/catalogue-visual-matrix');
        await mkdir(directory,{recursive:true});await writeFile(resolve(directory,match[1]),bytes,{flag:'wx'});
        res.writeHead(201).end('Local evidence saved');
      }catch(error){res.writeHead(400).end(String(error));}
    });
  }}],
});
