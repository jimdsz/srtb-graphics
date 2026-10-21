// Isolated UI qualification only. Never imported by the production Vite/Pages build.
// No remote bindings, no deployment, no Cloudflare credentials, no network listener.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { getPlatformProxy,unstable_splitSqlQuery } from 'wrangler';
import { readFile,stat,readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { api } from './server/router';
import { HttpError,secureHeaders,json } from './server/http';
import { ParameterError } from './src/studio/domain';
import type { Member } from './src/studio/domain';
import { ZodError } from 'zod';
import { libraryFiles } from './scripts/library-dev-plugin.ts';
import { videoQualification } from './scripts/video-qualification-plugin.ts';

const qualificationPort=Number(process.env.SRTB_QUALIFICATION_PORT||5192);
if(!Number.isInteger(qualificationPort)||qualificationPort<1024||qualificationPort>65535)throw Error('Invalid loopback qualification port.');
export default defineConfig({
  define:{'import.meta.env.VITE_STUDIO_QUALIFICATION':'true'},
  plugins:[react(),libraryFiles(),videoQualification(),{
    name:'local-studio-qualification',apply:'serve',
    async configureServer(server){
      if(server.config.server.host!=='127.0.0.1')throw Error('Qualification must bind only to loopback.');
      const proxy=await getPlatformProxy<Env>({configPath:'wrangler.qualification.jsonc',persist:false});
      for(const filename of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
        const statements=unstable_splitSqlQuery(await readFile(`migrations/${filename}`,'utf8'));
        for(const statement of statements)await proxy.env.DB.prepare(statement).run();
      }
      const account=await proxy.env.DB.prepare('SELECT email,name,role,active FROM members WHERE role=?').bind('admin').first<Member>();
      if(!account)throw Error('Qualification account missing.');
      const member={...account,name:'Qualification locale'};
      const large=new Map([
        ['/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4','BTV_BA_1P/lib/media/programme.mp4'],
        ['/library/v1.7.0/BTV_BA_1P/sourceassets/VOIX OFF BA.wav','BTV_BA_1P/sourceassets/VOIX OFF BA.wav'],
        ['/library/v1.7.0/BTV_BA_TDS/lib/audio/VOIX OFF BA.wav','BTV_BA_TDS/lib/audio/VOIX OFF BA.wav'],
      ]);
      server.httpServer?.once('close',()=>void proxy.dispose());
      server.middlewares.use(async(req,res,next)=>{
        if(req.headers.host!==`127.0.0.1:${qualificationPort}`){res.writeHead(403).end('Loopback qualification only');return;}
        const url=new URL(req.url||'/',`http://127.0.0.1:${qualificationPort}`);
        const source=large.get(decodeURIComponent(url.pathname));
        if(source){
          const path=resolve('../BroadcastTemplates/DELIVERABLES/BTV_HABILLAGE_DYNAMIQUE_v1.7.0/templates',source);
          const {size}=await stat(path),range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
          const start=range?Number(range[1]):0,end=range?.[2]?Math.min(size-1,Number(range[2])):size-1;
          if(start>=size||end<start){res.writeHead(416).end();return;}
          res.writeHead(range?206:200,{'Content-Type':path.endsWith('.mp4')?'video/mp4':'audio/wav','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});
          if(req.method==='HEAD')res.end();else createReadStream(path,{start,end}).pipe(res);return;
        }
        if(!url.pathname.startsWith('/api/')){next();return;}
        try{
          const chunks:Buffer[]=[];let count=0;
          for await(const item of req){const chunk=Buffer.from(item);count+=chunk.length;if(count>9*1024**2)throw new HttpError(413,'Request too large');chunks.push(chunk);}
          const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(typeof value==='string')headers.set(key,value);
          const request=new Request(url,{method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
          const response=secureHeaders(await api(request,proxy.env,member)??json({error:'Not found'},404));
          res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
        }catch(error){
          const status=error instanceof HttpError?error.status:error instanceof ParameterError?422:error instanceof ZodError?400:500;
          if(status===500)console.error(error);
          res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({error:error instanceof Error?error.message:'Qualification error'}));
        }
      });
    },
  }],
  // Long-running frame exports must not be destroyed by an unrelated source edit.
  server:{host:'127.0.0.1',port:qualificationPort,strictPort:true,hmr:false,watch:{ignored:['**/.local/**','**/.qa-delivery/**','**/.tools/**','**/reports/**','**/tmp/**']}},
});
