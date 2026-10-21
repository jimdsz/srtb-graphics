import {defineConfig} from 'vite';
import {resolve} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import base from './text-position-qualification.config';

// Use the same native-only profile as production. The CBR source-licensing
// work is unrelated to the MOV/PNG regression and must not be pulled into it.
export default defineConfig({...base,
  server:{...base.server,port:5198},
  plugins:[...base.plugins!,{name:'popup-local-evidence',configureServer(server){server.middlewares.use(async(req,res,next)=>{
    const url=new URL(req.url||'/', 'http://127.0.0.1:5198');
    const audioRoute=url.pathname.match(/^\/__ba-audio-clock-qualification\/(studio|portable)\/(manifest\.json|audio\.mjs|audio-clock\.mjs|voice-layout\.mjs)$/);
    if(audioRoute){
      if(req.headers.host!=='127.0.0.1:5198'||req.method!=='GET'||(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:5198')){res.writeHead(403).end();return;}
      try{
        const profile=audioRoute[1],name=audioRoute[2],directory=resolve(import.meta.dirname,'../public/studio-engines/ba-text-v2');
        let sources:Record<string,string>;
        if(profile==='portable'){
          const generated=JSON.parse(await readFile(resolve(import.meta.dirname,'../src/studio/ba-editor.generated.json'),'utf8'));
          sources={'audio.mjs':generated.audio,'audio-clock.mjs':generated.audioClock,'voice-layout.mjs':generated.voiceLayout};
        }else sources=Object.fromEntries(await Promise.all(['audio.mjs','audio-clock.mjs','voice-layout.mjs'].map(async file=>[file,await readFile(resolve(directory,file),'utf8')])));
        if(Object.values(sources).some(source=>typeof source!=='string'||!source.length)||!sources['audio.mjs'].includes('installBAScheduledAudio'))throw Error('Incomplete v2 qualification graph');
        const hash=(source:string)=>createHash('sha256').update(source).digest('hex'),graphSha256=hash(JSON.stringify({profile,sources}));
        res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
        if(name==='manifest.json'){
          res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({profile,graphSha256,sourceHashes:Object.fromEntries(Object.entries(sources).map(([file,source])=>[file,hash(source)]))}));return;
        }
        if(url.searchParams.get('v')!==graphSha256){res.writeHead(409).end('Qualification graph changed; reload the page.');return;}
        let source=sources[name];
        if(name==='audio.mjs')for(const [dependency,portableDependency]of [['audio-clock.mjs','studio-audio-clock.mjs'],['voice-layout.mjs','studio-voice-layout.mjs']]){
          const from=`'./${profile==='portable'?portableDependency:dependency}'`;
          if(!source.includes(from))throw Error('Qualification import is missing');
          source=source.replaceAll(from,JSON.stringify(`/__ba-audio-clock-qualification/${profile}/${dependency}?v=${graphSha256}`));
        }
        if(/from\s*['"]\./.test(source))throw Error('Unexpected relative qualification import');
        res.writeHead(200,{'Content-Type':'text/javascript'}).end(source);
      }catch(error){res.writeHead(500).end(String(error));}
      return;
    }
    const match=req.url?.match(/^\/__social-evidence\/([a-z0-9-]+\.(?:png|json|mov|zip))$/);if(!match)return next();
    if(req.headers.host!=='127.0.0.1:5198'||req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:5198'){res.writeHead(403).end();return;}
    try{const chunks:Buffer[]=[];let size=0;for await(const bytes of req){size+=bytes.length;if(size>512*1024**2)throw Error('Evidence exceeds local test limit');chunks.push(bytes);}
      const dir=resolve('reports/social-qualification');await mkdir(dir,{recursive:true});await writeFile(resolve(dir,match[1]),Buffer.concat(chunks),{flag:'wx'});res.writeHead(201).end('Local evidence saved');
    }catch(error){res.writeHead(400).end(String(error));}
  });}}],
  define:{__SRTB_NATIVE_ONLY__:'true','import.meta.env.VITE_STUDIO_QUALIFICATION':'false'},
  resolve:{alias:[{find:/^\.\/cbr-fallback(?:\.ts)?$/,replacement:resolve(import.meta.dirname,'../src/studio/video/opaque-native-adapter.ts')}]},
});
