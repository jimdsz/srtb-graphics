import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
const root=resolve(import.meta.dirname,'..'),port=5196;
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.otf':'font/otf','.ttf':'font/ttf','.mp4':'video/mp4'};
http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${port}`||!['GET','HEAD'].includes(req.method)){res.writeHead(403).end();return;}
  const p=decodeURIComponent(new URL(req.url,`http://127.0.0.1:${port}`).pathname);
  const base=p.startsWith('/tests/')?resolve(root,'tests'):p.startsWith('/library/')?resolve(root,'public/library'):p.startsWith('/studio-engines/')?resolve(root,'public/studio-engines'):p.startsWith('/preview-media/')?resolve(root,'public/preview-media'):p.startsWith('/fonts/')?resolve(root,'public/fonts'):undefined;
  if(!base){res.writeHead(404).end();return;}
  const f=resolve(base,p.slice(p.indexOf('/',1)+1));if(!f.startsWith(base+sep)||!(await stat(f)).isFile()){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':types[extname(f)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:await readFile(f));
 }catch{res.writeHead(404).end();}
}).listen(port,'127.0.0.1',()=>console.log(`Template diagnostic http://127.0.0.1:${port}/tests/ae-occlusion.html`));
