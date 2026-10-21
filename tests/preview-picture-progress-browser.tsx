import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Preview from '../src/studio/Preview';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import {SVGMediaPublisher} from '../src/studio/svg-media-preview';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
if(location.origin!=='http://127.0.0.1:5192')throw Error('Recette locale uniquement.');
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function until(check:()=>boolean,message:string,ms=45000){const end=performance.now()+ms;while(!check()){if(performance.now()>end)throw Error(message);await wait(60);}}
function Bench(){
 const mount=useRef<HTMLDivElement>(null),[busy,setBusy]=useState(false),[result,setResult]=useState('Prêt.');
 async function run(){
  setBusy(true);const checks:any[]=[];let root:ReturnType<typeof createRoot>|undefined,publisher:SVGMediaPublisher|undefined;
  const decode=HTMLImageElement.prototype.decode;let release:()=>void=()=>{};
  try{
   for(const mode of ['canvas','svg','svg-all-png','canvas-hidden'] as const){
    setResult(`${mode} — aperçu réel et diagnostic…`);const template=getTemplate('BTV_BA_1P');
    root=createRoot(mount.current!);root.render(<Preview template={template} data={templateDefaults(template)} mediaPresentation={mode==='canvas-hidden'?'canvas':mode}/>);
    const graphic=()=>mount.current!.querySelector('.graphic-host')?.firstElementChild as any;
    await until(()=>!!graphic()?.__previewTransport,'Aperçu non chargé');const g=graphic(),transport=g.__previewTransport;
    await transport.seek(mode==='svg'?4.9:11);await transport.resume();await wait(100);
    const button=[...mount.current!.querySelectorAll('button')].find(b=>b.textContent==='Tester la fluidité sur ce poste')!;
    await until(()=>!!button&&!button.disabled,'Diagnostic indisponible');(mount.current!.querySelector('.monitor-precision summary') as HTMLElement).click();button.click();await wait(1500);
    // Controlled missing draw: native video/transport keep running. This is
    // not a claim to reproduce the original Mac cause, only its symptom.
    const draw=g.scene.canvases.draw;g.scene.canvases.draw=()=>{};
    if(mode==='canvas-hidden')for(const target of g.scene.canvases.targets.body){const wrapper=document.createElement('div');wrapper.style.opacity='0';target.before(wrapper);wrapper.append(target);}
    await wait(3300);await transport.pause();await wait(150);g.scene.canvases.draw=draw;
    const pre=mount.current!.querySelector('.preview-health pre')!;assert(pre,'Bilan absent');const report=JSON.parse(pre.textContent!);
    assert(report.schema===9&&report.observationEnd==='playback-stopped','Version/motif incorrect');
    if(mode==='canvas-hidden')assert(!report.pictureProgress.copyStallSignals.includes('body'),'Calques volontairement invisibles classés en gel');
    else{
     assert(report.pictureProgress.copyStallSignals.includes('body'),'Avertissement de copie figée absent');
     assert(mount.current!.querySelector('.preview-health')!.textContent!.includes('sa copie dans l’aperçu n’a pas progressé'),'Message faussement rassurant');
    }
    const samples=report.pictureProgress.samples,active=samples.filter((s:any)=>s.surfaces.some((v:any)=>v.kind==='body'&&v.phaseActive));
    const last=active.at(-2),before=active.at(-4),body=(s:any)=>s.surfaces.find((v:any)=>v.kind==='body');
    const count=(v:any)=>v.sink==='svg-href'?v.svg:v.copy;
    assert(count(body(last)).completed===count(body(before)).completed,'Gel de copie non conservé dans les échantillons');
    assert(count(body(last)).lastCompletedAgeMs>1500,'Silence final absent du diagnostic');
    const src=(s:any)=>s.sources.find((v:any)=>v.id===body(s).sourceId);
    assert(src(last).time>src(before).time+.4&&src(last).frames>src(before).frames,'Progression du décodeur/source non distincte des copies');
    if(mode==='svg')assert(samples.some((s:any)=>s.surfaces.some((v:any)=>v.kind==='body'&&v.sink==='svg-href'))&&samples.some((s:any)=>s.surfaces.some((v:any)=>v.kind==='body'&&v.sink==='html-canvas')),'Bascule SVG/HTML non observable');
    assert(!/https?:|blob:|programme\.mp4|C:\\/.test(JSON.stringify(report.pictureProgress)),'Nom/chemin média dans le diagnostic');
    checks.push({mode,pass:true,report});root.unmount();root=undefined;
   }
   setResult('SVG — attente de décodage et dernière image…');
   const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
   const image=document.createElementNS('http://www.w3.org/2000/svg','image');let failure:unknown;
   const gate=new Promise<void>(resolve=>{release=resolve;});HTMLImageElement.prototype.decode=async function(){await gate;return decode.call(this);};
   publisher=new SVGMediaPublisher([image],error=>{failure=error;});publisher.publish(canvas);
   await until(()=>publisher!.pictureProgress().phase==='decode','Étape decode absente');await wait(1100);
   const pending=publisher.pictureProgress();assert(pending.busy&&pending.phaseAgeMs>1000&&pending.completed===0,'Attente mal mesurée');
   release();await publisher.flush();HTMLImageElement.prototype.decode=decode;await wait(1100);
   const completed=publisher.pictureProgress();assert(!failure&&!completed.busy&&completed.completed===1&&completed.lastCompletedAgeMs!>1000,'Dernière image non mesurée');
   checks.push({mode:'svg-decode-delay',pass:true,pending,completed});
   const report={pass:true,scope:'Chromium Windows, diagnostic sur vrai Preview ; SVG forcé, gel de copie synthétique, pas une qualification Mac.',checks},evidence=`preview-picture-progress-${Date.now()}.json`;
   const response=await fetch('/__video-evidence/'+evidence,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report,null,2)});assert(response.ok,'Preuve non enregistrée');
   setResult(JSON.stringify({pass:true,evidence,checks:checks.map(({mode,pass})=>({mode,pass}))},null,2));
  }catch(error){setResult(JSON.stringify({pass:false,error:String(error),completed:checks.map(c=>c.mode)},null,2));}
  finally{release();HTMLImageElement.prototype.decode=decode;publisher?.dispose();root?.unmount();setBusy(false);}
 }
 return <main style={{maxWidth:950,margin:'20px auto'}}><h1>Diagnostic de gel — sources et copies</h1><p>Test local, pannes simulées, aucun projet modifié.</p><button disabled={busy} onClick={()=>void run()}>Vérifier le diagnostic</button><pre role="status">{result}</pre><div ref={mount}/></main>;
}
createRoot(document.querySelector('#root')!).render(<Bench/>);
