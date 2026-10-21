// Actual Preview, public catalogue data only. No remote API or user projects.
import {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {broadcastTemplates,getTemplate} from '../src/studio/domain';
import {cataloguePreviewData,isCatalogueMediaExample} from '../src/studio/catalogue-preview';
import {PRESENTATIONS,simpleBaDefaults} from '../src/studio/presentation';
import type {Presentation} from '../src/studio/presentation';
import {previewTimeline} from '../src/studio/preview-timeline';
import {FrameRaster} from '../src/studio/video/raster';
import Preview from '../src/studio/Preview';
import '../src/studio/studio.css';
import '../src/studio/theme.css';

type Choice={id:string;simple:boolean;key:string};
type Selection={choice:Choice;format:Presentation;size:'laptop'|'desktop';serial:number};
const choices:Choice[]=[{id:'BTV_BA_1P',simple:true,key:'ba-simple'},...broadcastTemplates.map(t=>({id:t.id,simple:false,key:t.id.toLowerCase().replaceAll('_','-')}))];
const formats=Object.keys(PRESENTATIONS) as Presentation[];
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const paint=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
async function bounded<T>(operation:Promise<T>,label:string,milliseconds=20000):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' : délai dépassé')),milliseconds);})]);}
  finally{clearTimeout(timer);}
}
function dataFor(selection:Selection){
  let data=cataloguePreviewData(getTemplate(selection.choice.id));
  if(selection.choice.simple)data=simpleBaDefaults(data);
  data={...data,_studio_format:selection.format};
  for(const key of Object.keys(data))if(/^_audio.*_enabled$/.test(key))data[key]=false;
  return data;
}
function markers(id:string,outAt:number,duration:number){
  const specific:Record<string,number[]>={
    BTV_BA_1P:[.64,2.92,5.56,5.6,8],BTV_PopUp:[.4,.64,1.6,3.16],
    BTV_BA_TDS:[.64,3,7.6,14.8],BTV_BA_TDS_SUIVI_DE:[.64,3,13.76,13.8,16,23.8],
    BTV_Ce_Soir:[.4,1.6,4,8,12],BTV_Relais_Antenne:[.4,1.4,4,8],
    BTV_Passerelle_Replay:[.4,1.2,4,10,14],BTV_Renvoi:[.4,2.76,3,5,7],
    BTV_Evenement:[.64,2.56,4.08,7,10.68,15],
    BTV_Semainier:[.64,2.56,2.96,5.16,7.56,9.96,12.36,14.76,17.16,19.56,21.4],
  };
  return [...new Set([...(specific[id]||[]).filter(t=>t<outAt),outAt,Math.round((outAt+(duration-outAt)/2)*25)/25,Math.max(outAt,duration-.04)].map(t=>Math.round(t*25)/25))].sort((a,b)=>a-b);
}
async function save(name:string,body:Blob|string){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await fetch('/__catalogue-visual-evidence/'+name,{method:'POST',headers:{'Content-Type':typeof body==='string'?'application/json':'image/png'},body,signal:controller.signal});
    if(response.status!==201)throw Error('Enregistrement local impossible (configuration serveur requise, HTTP '+response.status+') : '+(await response.text()).slice(0,160));
  }finally{clearTimeout(timer);}
}
function visible(node:Element){
  for(let p:Element|null=node;p;p=p.parentElement){const style=getComputedStyle(p);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;}
  const r=node.getBoundingClientRect();return r.width>0&&r.height>0;
}

// Contact sheets serialize the current paused composition; they are NOT browser
// compositor screenshots. Only detached copies are read back. Stage normalization
// removes display scaling on the COPY, never on the live preview.
async function snapshot(g:any,format:Presentation,host:HTMLElement,omitLayers:number[]=[]){
  const social=host.querySelector<HTMLCanvasElement>('.graphic-host>canvas');
  if(format!=='tv'){
    if(!social)throw Error('Surface réseau absente');
    const copy=document.createElement('canvas');copy.width=social.width;copy.height=social.height;copy.getContext('2d')!.drawImage(social,0,0);return copy;
  }
  const holder=document.createElement('div'),root=holder.attachShadow({mode:'open'});
  for(const node of g.shadowRoot.childNodes)root.append(node.cloneNode(true));
  const sourceElements=[...g.shadowRoot.querySelectorAll('*')] as Element[],copies=[...root.querySelectorAll('*')];
  const omitted=new Set<Element>((g.animation?.renderer?.elements||[]).filter((e:any)=>omitLayers.includes(e?.data?.ind)).flatMap((e:any)=>[e.layerElement,e.getBaseElement?.()].filter(Boolean)));
  for(let i=0;i<sourceElements.length;i++){
    const source=sourceElements[i],target=copies[i];
    if(omitted.has(source))(target as SVGElement).style.display='none';
    if(source===g.stage||source===g.scene?.container){const style=(target as HTMLElement).style;style.transform='none';style.left='0';style.top='0';style.width='1920px';style.height='1080px';}
    if(source instanceof HTMLCanvasElement&&(target instanceof HTMLCanvasElement)){
      if(source.width&&source.height)target.getContext('2d')!.drawImage(source,0,0);
    }else if(source instanceof HTMLVideoElement){
      const canvas=document.createElement('canvas');for(const a of source.attributes)if(!['src','autoplay','poster'].includes(a.name))canvas.setAttribute(a.name,a.value);
      canvas.width=source.videoWidth||1;canvas.height=source.videoHeight||1;
      if(source.readyState>=2)canvas.getContext('2d')!.drawImage(source,0,0);else canvas.style.display='none';target.replaceWith(canvas);
    }
  }
  const controller=new AbortController(),raster=new FrameRaster(root,new URL(getTemplate(g.__matrixTemplate).module,location.href).href,controller.signal);
  try{await raster.prepare();const source=await raster.draw(null,false,true),copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;copy.getContext('2d')!.drawImage(source,0,0);return copy;}
  finally{controller.abort();raster.dispose();root.replaceChildren();}
}
function Bench(){
  const [selection,setSelection]=useState<Selection>({choice:choices[0],format:'tv',size:'laptop',serial:0});
  const [busy,setBusy]=useState(false),[status,setStatus]=useState('Prêt à lancer'),[report,setReport]=useState<any>(),[sheets,setSheets]=useState<{name:string;url:string}[]>([]);
  const host=useRef<HTMLDivElement>(null),ready=useRef(-1),serial=useRef(0),cancel=useRef(false),started=useRef(false);
  const template=getTemplate(selection.choice.id),data=useRef(dataFor(selection)),loaded=useRef(selection.serial);
  if(loaded.current!==selection.serial){loaded.current=selection.serial;data.current=dataFor(selection);}
  async function waitReady(wanted:number){
    const start=performance.now();while(ready.current!==wanted){
      if(cancel.current)throw Error('Recette interrompue');
      const error=host.current?.querySelector('[role="alert"]')?.textContent;if(error)throw Error(error);
      if(performance.now()-start>45000)throw Error('Chargement supérieur à 45 s');await pause(60);
    }
    await bounded(paint(),'Deux rafraîchissements');return host.current!.querySelector('.graphic-host')!.firstElementChild as any;
  }
  async function load(choice:Choice,format:Presentation,size:Selection['size']){
    const next={choice,format,size,serial:++serial.current};ready.current=-1;setSelection(next);return {next,g:await waitReady(next.serial)};
  }
  async function inspect(seconds:number){try{setBusy(true);const g=await waitReady(selection.serial);await bounded(g.__previewTransport.pause(),'Pause');await bounded(g.__previewTransport.seek(seconds),'Inspection');await bounded(paint(),'Présentation');setStatus(`Inspection réelle ${seconds.toFixed(2)} s`);}catch(error){setStatus(String(error));}finally{setBusy(false);}}
  async function probeEdges(){
    if(busy)return;setBusy(true);cancel.current=false;setSheets([]);const runId='edges-'+Date.now(),rows:any[]=[];
    try{
      const {g}=await load(choices.find(c=>c.id==='BTV_Semainier')!,'tv','desktop');g.__matrixTemplate='BTV_Semainier';
      await bounded(g.__previewTransport.pause(),'Pause');await bounded(g.__previewTransport.seek(2.56),'Inspection');await bounded(paint(),'Présentation');
      const layers=(g.animation?.renderer?.elements||[]).filter((e:any)=>[14,15,72,73,74,75,76,77].includes(e?.data?.ind)).map((e:any)=>({ind:e.data.ind,name:e.data.nm,parent:e.data.parent,transform:e.layerElement?.getAttribute('transform'),baseTransform:e.getBaseElement?.()?.getAttribute('transform')}));
      const probes=[...([['baseline',[]],['no-large',[74,75]],['no-74',[74]],['no-75',[75]],['no-small',[14,15]],['no-intro-72',[72]],['no-intro-73',[73]]] as [string,number[]][]).map(([label,omit])=>({label,omit,frame:64})),...[65,66,67,68].map(frame=>({label:'frame-'+frame,omit:[] as number[],frame}))];
      for(const {label,omit,frame}of probes){
        if(frame!==64){await bounded(g.__previewTransport.seek(frame/25),'Inspection');await bounded(paint(),'Présentation');}
        setStatus('Probe Semainier · '+label);const canvas=await bounded(snapshot(g,'tv',host.current!,omit),'Capture'),pixels=canvas.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,canvas.width,canvas.height).data;
        const bands:Record<string,{count:number;bounds:number[]|null}>={};
        for(const [band,top,bottom]of [['top',0,4],['bottom',1076,1080],['middle',537,543]] as [string,number,number][]){
          let count=0;const bounds=[1920,1080,-1,-1];
          for(let y=top;y<bottom;y++)for(let x=0;x<1920;x++){const i=(y*1920+x)*4;if(pixels[i]>180&&pixels[i+1]>180&&pixels[i+2]>180&&pixels[i+3]>200){count++;bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);}}
          bands[band]={count,bounds:count?bounds:null};
        }
        const name=`${runId}-${label}.png`,blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG impossible')),'image/png'));await save(name,blob);
        rows.push({label,frame,omit,bands,image:name,mediaTransforms:(g.animation?.renderer?.elements||[]).filter((e:any)=>[72,73].includes(e?.data?.ind)).map((e:any)=>({ind:e.data.ind,transform:e.layerElement?.getAttribute('transform')}))});setSheets(previous=>[...previous,{name,url:URL.createObjectURL(blob)}]);canvas.width=canvas.height=0;
      }
      const result={runId,template:'BTV_Semainier',time:2.56,sourceFrame:64,layers,rows,userAgent:navigator.userAgent,method:'Only detached shadow copies are changed. Normalized SVG/DOM raster, not browser compositor screenshots. Layer omission identifies an operand, not an authorized geometry correction.'};
      await save(runId+'.json',JSON.stringify(result,null,2));setReport(result);setStatus('Probe bords terminé : lire les compteurs et les images.');
    }catch(error){setReport({runId,error:String(error),rows});setStatus(String(error));}finally{setBusy(false);}
  }
  async function run(scope:'all'|'tv'|'social'|'selected',sizeScope:'both'|'laptop'|'desktop'='both'){
    if(busy)return;setBusy(true);cancel.current=false;setSheets([]);
    const runId='matrix-'+Date.now(),rows:any[]=[],requested=scope==='selected'?[selection.choice]:choices;
    const requestedFormats=scope==='selected'?[selection.format]:scope==='tv'?['tv' as const]:scope==='social'?formats.filter(f=>f!=='tv'):formats;
    const sizes=sizeScope==='both'?['laptop','desktop'] as const:[sizeScope];let done=0;
    const expected=requested.length*requestedFormats.length*sizes.length;
    const metadata={runId,started:new Date().toISOString(),userAgent:navigator.userAgent,dpr:devicePixelRatio,hardwareConcurrency:navigator.hardwareConcurrency,viewport:[innerWidth,innerHeight],scope,sizeScope,expected,templates:10,catalogueChoices:11,formats:3,displayWidths:{tv:[576,960],portrait:[300,540],vertical:[300,432]},visualVerdict:'NOT AUTOMATIC: contact sheets require human review; display widths only, not complete responsive UI or physical Mac/Safari qualification',capture:'Social canvas copy; TV serialized current shadow composition with detached stage scaling normalized. Not browser compositor screenshots.'};
    try{
      if(broadcastTemplates.length!==10||choices.length!==11||formats.length!==3||new Set(choices.map(c=>c.key)).size!==11)throw Error('Inventaire du catalogue modifié : revoir explicitement la couverture.');
      for(const choice of requested)for(const format of requestedFormats)for(const size of sizes){
        if(cancel.current)throw Error('Recette interrompue');setStatus(`${++done}/${expected} · ${choice.key} · ${format} · ${size}`);
        const row:any={choice:choice.key,id:choice.id,format,size,frames:[],errors:[]};rows.push(row);
        try{
          const {next,g}=await load(choice,format,size);g.__matrixTemplate=choice.id;
          const currentData=dataFor(next),timeline=previewTimeline(g,getTemplate(choice.id),currentData),times=markers(choice.id,timeline.outAt,timeline.duration);
          row.timeline=timeline;row.illustrationFields=Object.entries(currentData).filter(([,v])=>isCatalogueMediaExample(typeof v==='object'?v.url:typeof v==='string'?v:'')).map(([key])=>key);
          const sheet=document.createElement('canvas'),cellW=320,cellH=format==='tv'?210:440;sheet.width=960;sheet.height=Math.ceil(times.length/3)*cellH;const ctx=sheet.getContext('2d',{willReadFrequently:true})!;ctx.fillStyle='#14181f';ctx.fillRect(0,0,sheet.width,sheet.height);
          await bounded(g.__previewTransport.pause(),'Pause');
          for(let index=0;index<times.length;index++){
            if(cancel.current)throw Error('Recette interrompue');const time=times[index];
            await bounded(g.__previewTransport.seek(time),'Inspection');await bounded(paint(),'Présentation');await bounded(Promise.resolve(g.scene?.canvases?.flush?.()),'Publication');
            const state=g.__previewTransport.snapshot(),screen=host.current!.querySelector('.graphic-host')!.getBoundingClientRect(),logical=PRESENTATIONS[format];
            const alerts=[...host.current!.querySelectorAll('[role="alert"]')].map(n=>n.textContent),warnings=[...host.current!.querySelectorAll('.notice:not(.error)')].map(n=>n.textContent);
            const frame:any={time,actual:state.seconds,phase:state.phase,screen:[screen.width,screen.height],renderer:g.__previewRenderer||'native/social',alerts,warnings,
              checks:{time:Math.abs(state.seconds-time)<.041,aspect:Math.abs(screen.width/screen.height-logical.width/logical.height)<.003,visibleBox:screen.width>0&&screen.height>0,errors:alerts.length===0},
              visibleSVGGroups:[...g.shadowRoot.querySelectorAll('svg g')].filter(visible).length,visibleText:[...g.shadowRoot.querySelectorAll('text,tspan,.fit')].filter(visible).map(n=>n.textContent).filter(Boolean).slice(0,40),
              socialTextBoxes:g.__socialTypography?.boxes?.()||[],socialElementBoxes:g.__socialPreview?.elementBoxes?.()||[]};
            row.frames.push(frame);
            try{
              const image=await bounded(snapshot(g,format,host.current!),'Capture'),x=(index%3)*cellW,y=Math.floor(index/3)*cellH,scale=Math.min((cellW-8)/image.width,(cellH-32)/image.height),w=image.width*scale,h=image.height*scale;
              ctx.fillStyle='#eceef0';ctx.fillRect(x+4,y+28,cellW-8,cellH-32);ctx.drawImage(image,x+(cellW-w)/2,y+28,w,h);ctx.fillStyle='white';ctx.font='13px sans-serif';ctx.fillText(`${choice.key} · ${time.toFixed(2)} s`,x+5,y+18);frame.capture=true;image.width=image.height=0;
            }catch(error){frame.capture=false;frame.captureError=String(error);}
            frame.pass=Object.values(frame.checks).every(Boolean);
          }
          const blob=await new Promise<Blob>((resolve,reject)=>sheet.toBlob(b=>b?resolve(b):reject(Error('PNG impossible')),'image/png'));
          const name=`${runId}-${choice.key}-${format}-${size}.png`;await save(name,blob);row.sheet=name;setSheets(previous=>[...previous,{name,url:URL.createObjectURL(blob)}]);sheet.width=sheet.height=0;
          row.pass=row.frames.length===times.length&&row.frames.every((f:any)=>f.pass);
        }catch(error){row.errors.push(String(error));row.pass=false;}
        setReport({...metadata,complete:false,rows,completed:rows.length});
      }
      const keys=rows.map(r=>`${r.choice}/${r.format}/${r.size}`),result={...metadata,complete:true,completed:rows.length,coveragePass:rows.length===expected&&new Set(keys).size===expected,mechanicalPass:rows.every(r=>r.pass),capturePass:rows.every(r=>r.frames.length>0&&r.frames.every((f:any)=>f.capture)),rows};
      await save(runId+'.json',JSON.stringify(result,null,2));setReport(result);setStatus(`Terminé : ${rows.filter(r=>r.pass).length}/${expected} configurations mécaniques. Revue visuelle requise.`);
    }catch(error){const result={...metadata,complete:false,error:String(error),rows};await save(runId+'-partial.json',JSON.stringify(result,null,2)).catch(()=>{});setReport(result);setStatus(String(error));}
    finally{setBusy(false);}
  }
  useEffect(()=>{const params=new URLSearchParams(location.search),scope=params.get('autorun');if(!started.current&&params.get('probe')==='edges'){started.current=true;void probeEdges();}else if(!started.current&&['tv','social','all'].includes(scope||'')){started.current=true;void run(scope as 'tv'|'social'|'all',params.get('size')==='laptop'?'laptop':params.get('size')==='desktop'?'desktop':'both');}},[]);
  const width=selection.format==='tv'?(selection.size==='laptop'?576:960):(selection.size==='laptop'?300:selection.format==='vertical'?432:540);
  return <main style={{padding:20,color:'#eee',background:'#14181f',minHeight:'100vh'}}>
    <h1>Catalogue — matrice visuelle locale</h1><p>10 moteurs + BA simple × 3 formats × 2 tailles = 66 configurations. Données publiques du catalogue, son coupé. Aucun projet modifié.</p>
    <p>Les planches sont des compositions sérialisées, pas des captures du compositeur du navigateur. Contrôles automatiques ≠ fidélité visuelle. Aucun Safari/Mac physique n’est présumé testé.</p>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button disabled={busy} onClick={()=>run('tv')}>TV · 22 configurations</button><button disabled={busy} onClick={()=>run('social')}>Réseaux · 44 configurations</button><button disabled={busy} onClick={()=>run('all')}>Tout · 66 configurations</button><button disabled={busy} onClick={()=>run('selected')}>Modèle sélectionné · 2 tailles</button><button disabled={busy} onClick={()=>probeEdges()}>Probe bords Semainier</button><button disabled={!busy} onClick={()=>{cancel.current=true;}}>Interrompre</button></div>
    <p role="status" id="matrix-status">{status}</p>
    <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
      <label>Modèle <select disabled={busy} value={selection.choice.key} onChange={e=>void load(choices.find(c=>c.key===e.target.value)!,selection.format,selection.size)}>{choices.map(c=><option key={c.key} value={c.key}>{c.simple?'BA simple':getTemplate(c.id).name}</option>)}</select></label>
      <label>Format <select disabled={busy} value={selection.format} onChange={e=>void load(selection.choice,e.target.value as Presentation,selection.size)}>{formats.map(f=><option key={f}>{f}</option>)}</select></label>
      <label>Taille <select disabled={busy} value={selection.size} onChange={e=>void load(selection.choice,selection.format,e.target.value as Selection['size'])}><option>laptop</option><option>desktop</option></select></label>
      {[.64,2.56,5.16,10.68,21.4].map(t=><button disabled={busy} key={t} onClick={()=>inspect(t)}>{t.toFixed(2)} s</button>)}
    </div>
    <div ref={host} style={{width,maxWidth:'none',margin:'20px auto'}}><Preview key={selection.serial} template={template} data={data.current} onReadinessChange={value=>{if(value)ready.current=selection.serial;}}/></div>
    <details><summary>Résultats JSON ({report?.completed||0} configurations)</summary><pre id="matrix-result" style={{whiteSpace:'pre-wrap',maxHeight:600,overflow:'auto'}}>{JSON.stringify(report||{},null,2)}</pre></details>
    <section aria-label="Planches à contrôler">{sheets.map(sheet=><figure key={sheet.name}><figcaption>{sheet.name}</figcaption><img src={sheet.url} alt={sheet.name} style={{width:960,maxWidth:'100%'}}/></figure>)}</section>
  </main>;
}
createRoot(document.querySelector('#root')!).render(<Bench/>);
