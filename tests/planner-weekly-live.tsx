import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Preview from '../src/studio/Preview';
import {getTemplate} from '../src/studio/domain';
import type {Project} from '../src/studio/domain';
import type {Plan} from '../src/studio/day-planner-model';
import {bindLocalFile} from '../src/studio/local-media';
import {plannerAPI} from '../src/studio/day-planner-api';
import {createPlannerQueue} from '../src/studio/day-planner-queue';
import {weeklyChoices} from '../src/studio/planner-weekly';
import {previewMediaElement,needsSVGMediaPreview} from '../src/studio/svg-media-preview';
import '../src/studio/studio.css';
import '../src/studio/theme.css';

if(location.origin!=='http://127.0.0.1:5192')throw Error('Qualification locale uniquement.');
const colours=[[187,41,51],[24,128,66],[36,100,187],[153,46,175],[188,112,29],[22,126,148],[150,155,35]];
const centres=[4.96,7.36,9.76,12.16,14.56,16.96,19.36];
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function ensure(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function read<T>(path:string):Promise<T>{const response=await fetch('/api/graphics'+path);ensure(response.ok,`HTTP ${response.status}: ${path}`);return response.json();}
function pixels(source:CanvasImageSource){const c=document.createElement('canvas');c.width=160;c.height=90;const context=c.getContext('2d',{willReadFrequently:true})!;context.drawImage(source,0,0,160,90);return context.getImageData(0,0,160,90).data;}
function identity(data:Uint8ClampedArray){
 const counts=colours.map(()=>0);
 for(let p=0;p<data.length;p+=4){if(data[p+3]<240)continue;const rgb=[data[p],data[p+1],data[p+2]];let best=-1,error=Infinity;
  for(const [index,colour]of colours.entries()){const gain=rgb.reduce((sum,v,i)=>sum+v*colour[i],0)/colour.reduce((sum,v)=>sum+v*v,0);if(gain<.55||gain>1.15)continue;const delta=Math.sqrt(rgb.reduce((sum,v,i)=>sum+(v-colour[i]*gain)**2,0));if(delta<error){error=delta;best=index;}}
  if(best>=0&&error<22)counts[best]++;
 }
 return {slot:counts.indexOf(Math.max(...counts)),counts};
}
function visible(node:Element){for(let p:Element|null=node;p;p=p.parentElement){const style=getComputedStyle(p);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;}const b=node.getBoundingClientRect();return b.width>0&&b.height>0;}
const difference=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;

function Bench(){
 const mount=useRef<HTMLDivElement>(null),abort=useRef<AbortController|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState('Prêt.'),[report,setReport]=useState('');
 async function run(){
  const controller=new AbortController();abort.current=controller;const signal=controller.signal,records:any[]=[],stamp=Date.now();let root:ReturnType<typeof createRoot>|undefined;
  setBusy(true);setReport('');
  const timer=setTimeout(()=>controller.abort(new Error('Limite de quatre minutes.')),240000);
  try{
   const media=[];for(let i=1;i<=7;i++){setStatus(`Lecture du témoin ${i}/7`);const response=await fetch(`/tests/fixtures/weekly-witnesses-v2/media-${i}.mp4`,{signal});ensure(response.ok,'Témoin absent');media.push(await bindLocalFile(new File([await response.blob()],`media-${i}.mp4`,{type:'video/mp4'}),()=>{},undefined,undefined,signal));}
   const plan:Plan={kind:'plan',name:`Contrôle local semainier continu ${stamp}`,source:'Sept témoins synthétiques silencieux',sourceHash:'8'.repeat(64),rows:media.map((source,i)=>({id:`live-${i}`,sheet:'SEMAINE',cell:`A${i+1}`,raw:'',title:`PROGRAMME ${i+1}`,subtitle:`ÉPISODE ${i+1}`,category:'MAGAZINE',broadcastDate:`2026-09-${String(7+i).padStart(2,'0')}`,airDate:`2026-09-${String(7+i).padStart(2,'0')}`,time:`${19+i%3}:30`,duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:source,location:null,excerpt:{source:source.url,start:1,end:5,duration:8}}))};
   plan.weekly={rowIds:plan.rows.map(row=>row.id),formats:['tv','portrait','vertical']};
   const beforeMedia=await read('/media'),saved=await plannerAPI.save(crypto.randomUUID(),0,plan,signal);
   const queue=await createPlannerQueue({record:saved,choices:weeklyChoices(plan),api:plannerAPI,signal,onProgress:p=>setStatus(`Création locale ${p.completed}/${p.total}`)});
   ensure(queue.tasks.length===3,'Trois projets privés attendus');
   const projects=await Promise.all(queue.tasks.map(task=>read<Project>(`/projects/${task.projectId}`)));
   for(const [format,presentation]of [['tv','canvas'],['tv','svg'],['portrait','canvas'],['vertical','canvas']] as const){
    signal.throwIfAborted();const project=projects.find(p=>p.data._studio_format===format)!;ensure(project?.visibility==='private','Projet privé absent');
    for(let i=0;i<7;i++){ensure((project.data[`_media_programme_${i+1}_url`] as any).url===media[i].url,'Mauvais média stocké');ensure(String(project.data[`programme_${i+1}_category`]).endsWith(plan.rows[i].time.replace(':','H')),'Mauvais horaire stocké');}
    root=createRoot(mount.current!);root.render(<Preview template={getTemplate(project.template_id)} data={project.data} mediaPresentation={presentation}/>);
    setStatus(`${format}/${presentation} — chargement`);let g:any;const deadline=performance.now()+45000;
    while(!(g=mount.current!.querySelector('.graphic-host')?.firstElementChild as any)?.__previewTransport){signal.throwIfAborted();ensure(performance.now()<deadline,'Chargement trop long');const alert=mount.current!.querySelector('[role="alert"]');ensure(!alert,alert?.textContent||'Erreur aperçu');await wait(100);}
    const transport=g.__previewTransport;await transport.start();
    const recordsForMode:any[]=[],gaps:number[]=[];let observing=true,raf=0,last=performance.now();
    const tick=(time:number)=>{gaps.push(time-last);last=time;if(observing)raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
    try{
     for(let slot=0;slot<7;slot++){
      let previous:Uint8ClampedArray|undefined,priorTime=0,priorDecoded=0;
      for(const targetTime of [centres[slot]-.2,centres[slot]+.2]){
       while(transport.snapshot().seconds<targetTime){signal.throwIfAborted();ensure(transport.snapshot().playing,'Lecture arrêtée avant le passage');await wait(15);}
       const playhead=transport.snapshot().seconds;ensure(playhead-targetTime<.25,'Échantillon de passage manqué');
       const item=g.mediaItems.get(`programme_${slot+1}`),node=item?.node as HTMLVideoElement;ensure(node?.tagName==='VIDEO'&&!node.paused,'Média attendu non lu');
       const sourceTime=node.currentTime,decoded=node.getVideoPlaybackQuality().totalVideoFrames;
       let surface:CanvasImageSource,temporary:HTMLImageElement|undefined;
       if(format!=='tv'){surface=mount.current!.querySelector('.graphic-host > canvas') as HTMLCanvasElement;ensure(surface,'Composition sociale absente');}
       else{const target=item.targets.map(previewMediaElement).find(visible);ensure(target,'Aucune surface visible pour ce programme');
        if(target instanceof HTMLCanvasElement)surface=target;
        else{const href=target.getAttribute('href');ensure(href,'Image SVG sans contenu');temporary=new Image();temporary.src=href;await temporary.decode();surface=temporary;}
       }
       const sample=pixels(surface),found=identity(sample),change=previous?difference(previous,sample):null;temporary?.removeAttribute('src');
       ensure(found.slot===slot&&found.counts[slot]>14400*.2,`Mauvais média présenté ${format} P${slot+1}`);
       if(previous){ensure(change!>.05,`Surface figée ${format} P${slot+1}`);ensure(sourceTime-priorTime>.15&&decoded-priorDecoded>=4,`Source figée ${format} P${slot+1}`);}
       recordsForMode.push({slot:slot+1,playhead,sourceTime,decoded,change,counts:found.counts});previous=sample;priorTime=sourceTime;priorDecoded=decoded;
       setStatus(`${format}/${presentation} — programme ${slot+1}/7, image renouvelée`);
      }
     }
     const started=performance.now();await transport.pause();const pauseMs=performance.now()-started,paused=transport.snapshot().seconds;
     await wait(150);ensure(!transport.snapshot().playing&&Math.abs(transport.snapshot().seconds-paused)<.002,'La pause ne tient pas');ensure(pauseMs<500,'Commande pause trop lente');await transport.resume();
     while(transport.snapshot().playing){signal.throwIfAborted();await wait(30);}
     ensure(transport.snapshot().seconds>=26.28,'La sortie du semainier est coupée');
     gaps.sort((a,b)=>a-b);records.push({format,presentation,renderer:g.__previewRenderer||(format==='tv'?'ae-native-canvas':'social'),pauseMs,final:transport.snapshot(),rafP95Ms:gaps[Math.floor(gaps.length*.95)],records:recordsForMode});
    }finally{observing=false;cancelAnimationFrame(raf);await transport.clear();root.unmount();root=undefined;}
    const after=await read<Project>(`/projects/${project.id}`);ensure(after.revision===project.revision&&JSON.stringify(after.data)===JSON.stringify(project.data),'Projet altéré pendant la lecture');
   }
   ensure(JSON.stringify(await read('/media'))===JSON.stringify(beforeMedia),'Catalogue de médias modifié');
   const proof={pass:true,scope:'Lecture continue des vrais aperçus à partir des trois projets privés stockés localement ; quatre chemins de présentation. Chromium Windows, SVG forcé, pas Safari/Mac ni réseau lent. Sans audio.',planId:saved.id,projectIds:projects.map(p=>p.id),nativeSVG:needsSVGMediaPreview(navigator.userAgent),records};
   const response=await fetch(`/__video-evidence/planner-weekly-live-${stamp}.json`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof,null,2)});ensure(response.ok,'Preuve non enregistrée');setReport(JSON.stringify(proof,null,2));setStatus('PASS — 56 observations, sept médias, pause et sortie complètes.');
  }catch(error){setStatus('FAIL — '+String(error));setReport(JSON.stringify({pass:false,error:String(error),records},null,2));}
  finally{clearTimeout(timer);root?.unmount();abort.current=null;setBusy(false);}
 }
 return <main style={{maxWidth:900,margin:'20px auto'}}><h1>Semainier — lecture continue</h1><p>Sept vidéos techniques silencieuses, base locale seulement. Aucun projet de production.</p><button disabled={busy} onClick={()=>void run()}>Contrôler la lecture des sept programmes</button><button disabled={!busy} onClick={()=>abort.current?.abort(new Error('Annulé'))}>Annuler</button><p role="status">{status}</p><div ref={mount}/><pre>{report}</pre></main>;
}
createRoot(document.querySelector('#root')!).render(<Bench/>);
