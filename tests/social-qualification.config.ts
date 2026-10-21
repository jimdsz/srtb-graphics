import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import base from './mov-integration.config';
// Loopback-only evidence sink. No user file is sent to a remote service.
export default defineConfig({...base,server:{...base.server,watch:{ignored:['**/.tools/**','**/reports/**']}},plugins:[react(),{name:'social-evidence',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  const match=req.url?.match(/^\/__social-evidence\/([a-z0-9-]+\.(?:svg|png|json|mp4|mov|zip))$/);if(!match)return next();
  if(req.headers.host!=='127.0.0.1:5194'||req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:5194'){res.writeHead(403).end();return;}
  try{const chunks:Buffer[]=[];let size=0;for await(const bytes of req){size+=bytes.length;if(size>1024**3)throw Error('Evidence too large');chunks.push(bytes);}
    const dir=resolve('reports/social-qualification');await mkdir(dir,{recursive:true});await writeFile(resolve(dir,match[1]),Buffer.concat(chunks),{flag:'wx'});res.writeHead(201).end('Preuve locale conservée');
  }catch(error){res.writeHead(400).end(String(error));}
});}},...base.plugins!]});
