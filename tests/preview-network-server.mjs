// Local-only controlled fault proxy. No upload, account or project endpoints.
import {createServer,request} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
const root=resolve(import.meta.dirname,'../public'),port=5200,upstream=5193;
const allowed=new Set([
  ...['BTV_Renvoi','BTV_Evenement','BTV_Semainier','BTV_Ce_Soir','BTV_Relais_Antenne','BTV_Passerelle_Replay'].map(id=>`/library/v1.7.0/${id}/lib/fonts/BeninSemiBold-Regular.otf`),
  '/library/v1.7.0/BTV_Semainier/source/animation.json',
  '/preview-media/v1/ba-programme.mp4',
  '/library/v1.7.0/BTV_BA_TDS/lib/audio/BTV_BA TDS -23LUFS.wav',
]);
// Fail at startup if a fixture source was moved; never misreport a 404 as a codec regression.
await Promise.all([...allowed].map(path=>stat(resolve(root,'.'+path))));
let fault={path:'',mode:'none',delayMs:0},sequence=0;const logs=[];
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||'/','http://127.0.0.1:'+port);
  if(url.pathname.startsWith('/api/')){res.writeHead(403).end('Accounts and projects are not part of this fixture.');return;}
  if(url.pathname==='/__network_fixture/config'&&req.method==='POST'){
    let body='';for await(const chunk of req){body+=chunk;if(body.length>2048){res.writeHead(413).end();return;}}
    try{const input=JSON.parse(body);if(input.mode!=='none'&&(!allowed.has(input.path)||!['once-503','delay'].includes(input.mode)))throw Error('Unknown fixture.');fault={path:String(input.path||''),mode:input.mode,delayMs:Math.max(0,Math.min(10000,Number(input.delayMs)||0))};logs.length=0;res.writeHead(200,{'Content-Type':'application/json'}).end('{}');}catch{res.writeHead(400).end();}return;
  }
  if(url.pathname==='/__network_fixture/log'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(logs));return;}
  let decoded;try{decoded=decodeURIComponent(url.pathname);}catch{res.writeHead(400).end();return;}
  if(allowed.has(decoded)){
    const row={id:++sequence,path:decoded,status:0,aborted:false,finished:false};logs.push(row);if(logs.length>200)logs.shift();
    let timer,stream;res.on('close',()=>{clearTimeout(timer);if(!res.writableFinished){row.aborted=true;stream?.destroy();}});res.on('finish',()=>{row.finished=true;});
    if(fault.path===decoded&&fault.mode==='once-503'){fault.mode='none';row.status=503;res.writeHead(503,{'Cache-Control':'no-store'}).end('Controlled transient failure');return;}
    const send=async()=>{
      try{const path=resolve(root,'.'+decoded);if(!path.startsWith(root+sep))throw Error('Invalid file');const info=await stat(path);
        const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),info.size-1):info.size-1;
        if(start>=info.size||end<start){row.status=416;res.writeHead(416).end();return;}
        row.status=range?206:200;const mime={'.otf':'font/otf','.json':'application/json','.mp4':'video/mp4','.wav':'audio/wav'}[extname(path)]||'application/octet-stream';
        res.writeHead(row.status,{'Content-Type':mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store',...(range?{'Content-Range':`bytes ${start}-${end}/${info.size}`}:{})});
        stream=createReadStream(path,{start,end});stream.on('error',()=>res.destroy());stream.pipe(res);
      }catch{if(!res.headersSent)res.writeHead(404);res.end();}
    };
    if(fault.path===decoded&&fault.mode==='delay')timer=setTimeout(()=>void send(),fault.delayMs);else void send();return;
  }
  const proxy=request({hostname:'127.0.0.1',port:upstream,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:'+upstream}},response=>{res.writeHead(response.statusCode||502,response.headers);response.pipe(res);});
  proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Start local Vite on '+upstream);});res.on('close',()=>proxy.destroy());req.pipe(proxy);
});
server.listen(port,'127.0.0.1',()=>console.log('Controlled preview network fixture http://127.0.0.1:'+port+' → local Vite '+upstream));
