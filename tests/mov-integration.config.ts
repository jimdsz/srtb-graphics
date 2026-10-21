// Qualification only. Named sources only, read-only and loopback-only.
import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import {mkdir,open,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {libraryFiles} from '../scripts/library-dev-plugin.ts';
const root=resolve(import.meta.dirname,'..'),release=resolve(root,'../BroadcastTemplates/DELIVERABLES/BTV_HABILLAGE_DYNAMIQUE_v1.7.0/templates');
const sources=new Map([
  ['/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4',resolve(release,'BTV_BA_1P/lib/media/programme.mp4')],
  ['/library/v1.7.0/BTV_BA_1P/sourceassets/VOIX OFF BA.wav',resolve(release,'BTV_BA_1P/sourceassets/VOIX OFF BA.wav')],
  ['/library/v1.7.0/BTV_BA_TDS/lib/audio/VOIX OFF BA.wav',resolve(release,'BTV_BA_TDS/lib/audio/VOIX OFF BA.wav')],
  ['/__mov-source/network.mp4','\\\\10.59.3.92\\montage\\_\\CELINE\\DORCAS\\RÉCAP J1 V1.mp4'],
]);
export default defineConfig({root,build:{outDir:'reports/mov-integration/build',copyPublicDir:false,emptyOutDir:false,rolldownOptions:{input:resolve(root,'tests/mov-integration.html')}},plugins:[{
  name:'mov-local-recipe',configureServer(server){server.middlewares.use(async(req,res,next)=>{
    if(req.headers.host!=='127.0.0.1:5194'){res.writeHead(403).end();return;}
    const path=decodeURIComponent(new URL(req.url||'/','http://127.0.0.1:5194').pathname),source=sources.get(path);
    if(source){try{const {size}=await stat(source),range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range?.[2]?Math.min(size-1,Number(range[2])):size-1;
      if(start>=size||end<start){res.writeHead(416).end();return;}res.writeHead(range?206:200,{'Content-Type':source.endsWith('.mp4')?'video/mp4':'audio/wav','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});if(req.method==='HEAD')res.end();else createReadStream(source,{start,end}).pipe(res);
    }catch(error){res.writeHead(404).end(String(error));}return;}
    const name=path.match(/^\/__mov-evidence\/([a-z0-9-]+\.(?:mov|json))$/)?.[1];if(!name)return next();
    if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:5194'){res.writeHead(403).end();return;}
    let handle;try{await mkdir(resolve(root,'reports/mov-integration'),{recursive:true});handle=await open(resolve(root,'reports/mov-integration',name),'wx');let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>8*1024**3)throw Error('Evidence limit');await handle.write(chunk);}await handle.close();res.writeHead(201).end('Saved locally');}catch(error){await handle?.close().catch(()=>{});res.writeHead(400).end(String(error));}
  });}
},libraryFiles()],server:{host:'127.0.0.1',port:5194,strictPort:true,hmr:false,headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; media-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'"}}});
