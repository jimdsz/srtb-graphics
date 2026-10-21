import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {broadcastTemplates,templateDefaults} from '../src/studio/domain';
import type {BroadcastTemplate,ProjectData} from '../src/studio/domain';
import Preview from '../src/studio/Preview';
import Fields from '../src/studio/Fields';
import {imageSizePatch} from '../src/studio/image-sizing-model';
import {prepareGraphic} from '../src/studio/video/engine';
import {tracksOf} from '../src/studio/media-tracks';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
const photo='/library/v1.7.0/BTV_Ce_Soir/lib/media/programme.jpg';
const popup=broadcastTemplates.find(t=>t.id==='BTV_PopUp')!;
function example(template:BroadcastTemplate,format:string){
  let data:ProjectData={...templateDefaults(template),_studio_format:format};
  if(template.id==='BTV_BA_TDS')data._background_visible=true;
  if(template.id==='BTV_BA_TDS_SUIVI_DE')data._media_mode='internal';
  if(template.id==='BTV_Passerelle_Replay')data._replay_url='https://example.com/replay';
  for(const key of Object.keys(data)){
    if(/_audio.*enabled$/.test(key))data[key]=false;
    if(/^_media_.+_sequence$/.test(key))data[key]='[]';
    if(/^_media_.+_url$/.test(key)&&!(template.id==='BTV_PopUp'&&key==='_media_background_url')){
      data[key]=photo;data={...data,...imageSizePatch(data,key,50)};
      const prefix=key.slice(0,-4);if(prefix+'_start_seconds'in data)data[prefix+'_start_seconds']=0;if(prefix+'_end_seconds'in data)data[prefix+'_end_seconds']=40;
    }
  }
  return data;
}
async function until(test:()=>boolean){const deadline=performance.now()+40000;while(!test()){if(performance.now()>deadline)throw Error('Aperçu non prêt : '+document.querySelector('.monitor-sync')?.textContent);await new Promise(r=>setTimeout(r,80));}}
function inspectImages(graphic:any,template:BroadcastTemplate){
  const nodes=Object.values(tracksOf(graphic)).flatMap(track=>track.clips).map(clip=>clip.node).filter((node):node is HTMLImageElement=>node instanceof HTMLImageElement&&node.complete&&!!node.naturalWidth);
  if(!nodes.length&&Object.keys(template.fields).some(key=>/^_media_.*_url$/.test(key)))throw Error('Aucune image préparée');
  const results=nodes.map(node=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const ctx=canvas.getContext('2d')!;ctx.drawImage(node,0,0,8,8);return {corner:ctx.getImageData(0,0,1,1).data[3],center:ctx.getImageData(4,4,1,1).data[3]};});
  if(results.some(p=>p.corner!==0||p.center!==255))throw Error('Taille/alpha incorrect : '+JSON.stringify(results));return results.length;
}
function App(){
  const [active,setActive]=useState({template:popup,data:templateDefaults(popup),key:'manual'}),[running,setRunning]=useState(false),[stage,setStage]=useState('Prêt'),[results,setResults]=useState<any[]>([]),[output,setOutput]=useState('');
  const ready=useRef(false);
  async function run(){setRunning(true);const collected=[];setResults([]);
    try{for(const format of ['tv','portrait','vertical'])for(const template of broadcastTemplates){
      const data=example(template,format),result:any={template:template.id,format};let prepared:Awaited<ReturnType<typeof prepareGraphic>>|undefined;
      try{
        setStage(template.name+' · '+format+' · aperçu');ready.current=false;flushSync(()=>setActive({template,data,key:template.id+format}));await until(()=>ready.current);
        const graphic=document.querySelector('.graphic-host')?.firstElementChild as any;await graphic.__previewTransport.seek(8);
        result.preview=inspectImages(graphic,template);
        setStage(template.name+' · '+format+' · rendu export');prepared=await prepareGraphic(template,data,12,false,new AbortController().signal);await prepared.frame(200,null);result.export=inspectImages(prepared.graphic,template);
        if(template.id==='BTV_PopUp'&&format==='tv'){
          const canvas=await prepared.frame(100,null),slot=prepared.graphic.media.popupSlot.getBoundingClientRect(),root=prepared.graphic.getBoundingClientRect(),ctx=canvas.getContext('2d')!;
          const x=Math.round(slot.left-root.left+slot.width*.1),y=Math.round(slot.top-root.top+slot.height*.5);
          result.popupMarginAlpha=ctx.getImageData(x,y,1,1).data[3];
          if(result.popupMarginAlpha!==0)throw Error('Fond technique opaque autour de l’image réduite');
          setOutput(canvas.toDataURL());
        }
        result.ok=true;
      }catch(error){result.error=String(error);}finally{await prepared?.dispose();}
      collected.push(result);setResults([...collected]);
    }}finally{setRunning(false);setStage(`Terminé : ${collected.filter(r=>r.ok).length}/${collected.length}`);}
  }
  return <main style={{maxWidth:1400,margin:'auto',padding:24}}><h1>Images proportionnelles et nouveaux textes</h1><p>Recette locale : pas de compte, de sauvegarde, de transfert ni de fichier utilisateur modifié.</p><button disabled={running} onClick={()=>void run()}>Vérifier aperçu et export sur 30 compositions</button><button disabled={running} onClick={()=>{ready.current=false;setActive({template:popup,data:templateDefaults(popup),key:'manual-'+Date.now()});}}>Nouveau pop-up</button><p role="status">{stage}</p><pre aria-label="Résultats images" style={{maxHeight:160,overflow:'auto'}}>{JSON.stringify(results,null,2)}</pre><div style={{display:'grid',gridTemplateColumns:'minmax(0,2fr) minmax(300px,1fr)',gap:24}}><Preview key={active.key} template={active.template} data={active.data} onChange={data=>setActive(current=>({...current,data}))} onReadinessChange={value=>{ready.current=value;}}/><Fields template={active.template} data={active.data} media={[]} onChange={data=>setActive(current=>({...current,data}))}/></div>{output?<figure><figcaption>Image d’export du pop-up à 50 %, fond transparent</figcaption><img style={{maxWidth:800,width:'100%'}} src={output}/></figure>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
