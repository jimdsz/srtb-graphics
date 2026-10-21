import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Preview from '../src/studio/Preview';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
if(location.origin!=='http://127.0.0.1:5192')throw Error('Recette locale uniquement.');
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const url='/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4';
function App(){
  const mount=useRef<HTMLDivElement>(null),[busy,setBusy]=useState(false),[result,setResult]=useState('Prêt.');
  async function run(stall:boolean){
    setBusy(true);const checks:any[]=[];let root:ReturnType<typeof createRoot>|undefined,restore=()=>{};
    try{
      const cases=stall?[['BTV_Renvoi','canvas','tv']]:['BTV_Evenement','BTV_Semainier','BTV_Renvoi'].flatMap(id=>[['canvas','tv'],['svg','tv'],['canvas','9:16']].map(([mode,format])=>[id,mode,format]));
      for(const [id,mode,format]of cases){
        setResult(`${id} · ${mode} · ${format} · ${stall?'panne simulée':'lecture réelle, promesse play laissée ouverte'}…`);
        const template=getTemplate(id),sources={_media_intro_url:url,_media_event_url:url,_media_renvoi_url:url,...Object.fromEntries(Array.from({length:7},(_,i)=>[`_media_programme_${i+1}_url`,url]))};
        const data={...templateDefaults(template),_studio_format:format==='tv'?'tv':'vertical',_out_mode:'manual',...Object.fromEntries(Object.entries(sources).filter(([key])=>key in template.fields))};
        root=createRoot(mount.current!);root.render(<Preview template={template} data={data} mediaPresentation={mode as 'canvas'|'svg'}/>);
        let g:any;const deadline=performance.now()+45000;
        while(!(g=(mount.current!.querySelector('.graphic-host')?.firstElementChild as any))?.__previewTransport&&performance.now()<deadline){const alert=mount.current!.querySelector('[role="alert"]');if(alert)throw Error(alert.textContent||'Aperçu invalide');await wait(100);}
        assert(g?.__previewTransport,'Aperçu non chargé');
        const transport=g.__previewTransport;await transport.seek(id==='BTV_Renvoi'?3:id==='BTV_Evenement'?5:4.1);
        const items=id==='BTV_Renvoi'?[{node:g.media,canvas:g.mediaCanvas}]:[...g.mediaItems.values()].filter((item:any)=>item.video);
        const originalRender=g.renderMedia.bind(g);let renders=0;
        g.renderMedia=(...args:any[])=>{renders++;return originalRender(...args);};
        const originals=items.map((item:any)=>({node:item.node,play:item.node.play,quality:item.node.getVideoPlaybackQuality().totalVideoFrames}));
        const hash=(canvas:HTMLCanvasElement)=>{const sample=document.createElement('canvas');sample.width=32;sample.height=18;const ctx=sample.getContext('2d')!;ctx.drawImage(canvas,0,0,32,18);return ctx.getImageData(0,0,32,18).data.reduce((n,v,i)=>(n+v*(i+1))%2147483647,0);};
        const before=items.map((item:any)=>hash(item.canvas));
        restore=()=>{for(const item of originals)item.node.play=item.play;g.renderMedia=originalRender;};
        for(const item of originals)item.node.play=()=>{if(!stall)void item.play.call(item.node);return new Promise<void>(()=>{});};
        await transport.resume();const started=performance.now();
        if(stall){
          while(transport.snapshot().playing&&performance.now()-started<18000)await wait(100);
          assert(!transport.snapshot().playing,'Compteur toujours en lecture après le délai vidéo');
          const alert=mount.current!.textContent||'';assert(alert.includes('15 secondes'),'Pas de message utile après panne');
        }else await wait(2400);
        const decoded=originals.map((item:any)=>item.node.getVideoPlaybackQuality().totalVideoFrames-item.quality),after=items.map((item:any)=>hash(item.canvas));
        const pauseStart=performance.now();await transport.pause();const pauseMs=performance.now()-pauseStart;
        assert(pauseMs<500&&originals.every((item:any)=>item.node.paused),'Pause lente ou vidéo toujours active');
        if(!stall){assert(decoded.some((n:number)=>n>20),'Pas de décodage réel');assert(renders>15,'Images suivantes bloquées derrière play()');assert(after.some((n:number,i:number)=>n!==before[i]),'Toutes les surfaces sont restées figées');}
        checks.push({id,mode,format,stall,decoded,renders,surfaceChanged:after.map((n:number,i:number)=>n!==before[i]),pauseMs,elapsedMs:performance.now()-started});
        restore();restore=()=>{};
        if(stall){await transport.seek(3);await transport.resume();await wait(800);assert(transport.snapshot().playing,'Relance impossible');await transport.pause();}
        root.unmount();root=undefined;await wait(50);
      }
      const report={pass:true,checks},name=`ae-live-playback-${Date.now()}.json`;
      const response=await fetch('/__video-evidence/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});assert(response.ok,'Bilan local non enregistré');
      setResult(JSON.stringify({...report,evidence:name},null,2));
    }catch(error){setResult(JSON.stringify({pass:false,error:String(error),checks},null,2));}finally{restore();root?.unmount();setBusy(false);}
  }
  return <main style={{maxWidth:1050,margin:'20px auto'}}><h1>Lecture vidéo — Événement, Semainier, Renvoi</h1><p>Médias publics de démonstration. Aucun projet créé ou modifié.</p><button disabled={busy} onClick={()=>void run(false)}>Tester les neuf lectures</button><button disabled={busy} onClick={()=>void run(true)}>Tester attente bloquée et relance</button><pre role="status">{result}</pre><div ref={mount}/></main>;
}
createRoot(document.querySelector('#root')!).render(<App/>);
