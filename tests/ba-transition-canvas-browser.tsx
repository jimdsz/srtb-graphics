import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Preview from '../src/studio/Preview';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
if(location.origin!=='http://127.0.0.1:5192')throw Error('Recette locale uniquement.');
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
// Isolated readback: do not change the rendering contexts' acceleration policy.
function hash(source:HTMLCanvasElement){const sample=document.createElement('canvas');sample.width=32;sample.height=18;const ctx=sample.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,0,0,32,18);return ctx.getImageData(0,0,32,18).data.reduce((n,v,i)=>(n+v*(i+1))%2147483647,0);}
function Bench(){
 const mount=useRef<HTMLDivElement>(null),[busy,setBusy]=useState(false),[result,setResult]=useState('Prêt.');
 async function run(){
  setBusy(true);const checks:any[]=[];let root:ReturnType<typeof createRoot>|undefined;
  try{
   for(const mode of ['canvas','svg'] as const){
    const template=getTemplate('BTV_BA_1P');root=createRoot(mount.current!);
    root.render(<Preview template={template} data={templateDefaults(template)} mediaPresentation={mode}/>);
    setResult(`${mode} — ouverture de la BA réelle…`);let g:any;const deadline=performance.now()+45000;
    while(!(g=(mount.current!.querySelector('.graphic-host')?.firstElementChild as any))?.__previewTransport&&performance.now()<deadline){const alert=mount.current!.querySelector('[role="alert"]');if(alert)throw Error(alert.textContent||'Aperçu invalide');await wait(100);}
    assert(g?.__previewTransport,'Aperçu non chargé');const transport=g.__previewTransport;
    for(const [time,kind,width]of [[4.16,'body',960],[11.52,'body',724],[64.7,'pack',540]] as const){
     setResult(`${mode} — ${time}s, largeur ${width}px…`);mount.current!.style.width=`${width}px`;
     await wait(100);await transport.seek(time);await transport.resume();await wait(900);
     const node=g.media.node(kind) as HTMLVideoElement;assert(node?.tagName==='VIDEO',`${kind} n’est pas une vidéo`);
     const q=node.getVideoPlaybackQuality(),source=node.currentTime;
     // The same logical surfaces exist in both implementations. The SVG route
     // publishes a separate image (or HTML body); track its delivery explicitly.
     const targets=g.scene.canvases.targets[kind] as HTMLCanvasElement[];
     const before=mode==='canvas'?targets.map(hash):[];
     const presentedBefore=mode==='svg'?g.__previewPresentationStats().find((s:any)=>s.kind===kind):undefined;
     const gaps:number[]=[];let active=true,last=performance.now(),raf=0;
     const tick=(now:number)=>{gaps.push(now-last);last=now;if(active)raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
     await wait(1100);active=false;cancelAnimationFrame(raf);
     const after=node.getVideoPlaybackQuality(),surfaceChanged=mode==='canvas'?targets.map((target,i)=>hash(target)!==before[i]):[];
     const presentedAfter=mode==='svg'?g.__previewPresentationStats().find((s:any)=>s.kind===kind):undefined;
     const p=transport.snapshot(),begun=performance.now();await transport.pause();const pauseMs=performance.now()-begun;
     assert(g.state.phase!=='error'&&p.playing,'La lecture s’est interrompue');
     assert(node.currentTime-source>.5&&after.totalVideoFrames-q.totalVideoFrames>10,'La vidéo ne décode plus d’images');
     assert(pauseMs<500&&node.paused,'Pause figée');
     if(mode==='canvas')assert(surfaceChanged.some(Boolean),'Les canevas restent figés');
     else assert((presentedAfter.presented-presentedBefore.presented)+(presentedAfter.htmlPresented??0)-(presentedBefore.htmlPresented??0)>5,'La présentation reste figée');
     gaps.sort((a,b)=>a-b);
     checks.push({mode,renderer:g.__previewRenderer,time,kind,width,sceneSeconds:p.seconds,sourceProgress:node.currentTime-source,decoded:after.totalVideoFrames-q.totalVideoFrames,dropped:after.droppedVideoFrames-q.droppedVideoFrames,surfaceChanged,presentedBefore,presentedAfter,pauseMs,rafP95Ms:gaps[Math.floor(gaps.length*.95)],stats:g.__previewPlaybackStats()});
    }
    await transport.clear();root.unmount();root=undefined;
   }
   const report={pass:true,scope:'Navigateur Chromium Windows réel ; chemin SVG forcé, pas un Mac/Safari physique.',checks},evidence=`ba-transition-canvas-${Date.now()}.json`;
   const response=await fetch('/__video-evidence/'+evidence,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});assert(response.ok,'Preuve non enregistrée');setResult(JSON.stringify({...report,evidence},null,2));
  }catch(error){setResult(JSON.stringify({pass:false,error:String(error),checks},null,2));}
  finally{root?.unmount();setBusy(false);}
 }
 return <main style={{maxWidth:1050,margin:'20px auto'}}><h1>BA — transitions, redimensionnement et reprise</h1><p>Médias publics de démonstration. Aucun projet modifié.</p><button disabled={busy} onClick={()=>void run()}>Contrôler les six passages</button><pre role="status">{result}</pre><div ref={mount} style={{maxWidth:'100%'}}/></main>;
}
createRoot(document.querySelector('#root')!).render(<Bench/>);
