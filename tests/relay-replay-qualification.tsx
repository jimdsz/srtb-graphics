import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {ProjectData} from '../src/studio/domain';
import Preview from '../src/studio/Preview';
import Fields from '../src/studio/Fields';
import {prepareGraphic} from '../src/studio/video/engine';
import {replayQR} from '../src/studio/ReplaySettings';
import {replayCatalogue} from '../src/studio/replay-catalogue';
import {relayGeometry} from '../src/studio/relay-placement';
import '../src/studio/studio.css';
import '../src/studio/workbench.css';
function App(){
  const[id,setId]=useState('BTV_Relais_Antenne'),[data,setData]=useState<ProjectData>(templateDefaults(getTemplate(id))),[report,setReport]=useState(''),[frame,setFrame]=useState(''),[comparisons,setComparisons]=useState<{label:string;src:string}[]>([]);
  const t=getTemplate(id);
  async function check(){setReport('Contrôle…');let rendered;try{
    for(const item of replayCatalogue)await replayQR(item.url);
    rendered=await prepareGraphic(t,data,undefined,true,new AbortController().signal);const c=await rendered.frame(75,null);setFrame(c.toDataURL('image/png'));
    if(id==='BTV_Relais_Antenne'){
      const p=relayGeometry(data),pixels=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let minX=c.width,minY=c.height,maxX=0,maxY=0;
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels[(y*c.width+x)*4+3]>200){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
      if(Math.abs(minX-p.x)>2||Math.abs(minY-p.y)>2||Math.abs(maxX+1-p.x-p.width)>2||Math.abs(maxY+1-p.y-p.height)>2)throw Error('Bornes export incorrectes '+JSON.stringify({minX,minY,maxX,maxY,p}));
    }
    setReport('PASS · 12 QR générés, image export calculée et position vérifiée.');
  }catch(error){setReport(error instanceof Error?error.message:String(error));}finally{await rendered?.dispose();}}
  async function compare(){
    setReport('Comparaison sur le programme local…');setComparisons([]);
    const video=document.createElement('video');video.muted=true;video.preload='auto';
    const event=(type:string)=>new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>done(Error('Lecture vidéo trop longue')),15000);
      const success=()=>done(),failure=()=>done(Error('Lecture vidéo impossible'));
      function done(error?:Error){clearTimeout(timer);video.removeEventListener(type,success);video.removeEventListener('error',failure);error?reject(error):resolve();}
      video.addEventListener(type,success,{once:true});video.addEventListener('error',failure,{once:true});
    });
    try{
      const loaded=event('loadeddata');video.src='/library/v1.7.0/BTV_BA_1P/lib/media/programme.mp4';await loaded;
      const seeked=event('seeked');video.currentTime=13;await seeked;
      const relay=getTemplate('BTV_Relais_Antenne'),base=templateDefaults(relay),results:{label:string;src:string}[]=[],stamp=Date.now();
      for(const [label,patch]of [['Avant',{_studio_relay_scale:75,_studio_relay_x:50,_studio_relay_y:0}],['Compact gauche',{}],['Compact droite',{_studio_relay_x:100}]] as [string,ProjectData][]){
        const prepared=await prepareGraphic(relay,{...base,...patch},undefined,true,new AbortController().signal);
        try{
          const overlay=await prepared.frame(75,null),canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
          const ctx=canvas.getContext('2d')!;ctx.drawImage(video,0,0,1920,1080);ctx.drawImage(overlay,0,0);
          results.push({label,src:canvas.toDataURL('image/png')});
          const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG impossible')),'image/png'));
          const saved=await fetch('/__video-evidence/relay-compact-'+stamp+'-'+results.length+'.png',{method:'POST',body:blob});if(!saved.ok)throw Error('Enregistrement local impossible');
          const last=await prepared.frame(prepared.timeline.frames-1,null),alpha=last.getContext('2d')!.getImageData(0,0,last.width,last.height).data;
          // The last sample is 40 ms before OUT completes. Its last quantized
          // alpha step may remain, but the completed OUT must be fully empty.
          if(alpha.some((value,index)=>index%4===3&&value>1))throw Error('Le relais reste visible à la dernière image');
          const ended=await prepared.frame(prepared.timeline.frames,null),endedPixels=ended.getContext('2d')!.getImageData(0,0,ended.width,ended.height).data;
          if(endedPixels.some((value,index)=>index%4===3&&value>0))throw Error('Le relais reste visible après la sortie');
        }finally{await prepared.dispose();}
      }
      setComparisons(results);setReport('PASS · Comparaison sur une image du programme ; les trois sorties se terminent sans résidu. Images enregistrées localement.');
    }catch(error){setReport(error instanceof Error?error.message:String(error));}finally{video.removeAttribute('src');video.load();}
  }
  return <main style={{padding:24}}><h1>Contrôle local · aucun projet partagé</h1><select aria-label="Modèle" value={id} onChange={e=>{setId(e.target.value);setData(templateDefaults(getTemplate(e.target.value)));setFrame('');setReport('');setComparisons([]);}}><option value="BTV_Relais_Antenne">Relais</option><option value="BTV_Passerelle_Replay">Replay</option></select><button onClick={()=>void check()}>Contrôler les QR et le rendu export</button><button onClick={()=>void compare()}>Comparer sur une image de programme</button><p role="status">{report}</p>{comparisons.map(item=><figure key={item.label}><figcaption>{item.label}</figcaption><img alt={item.label} src={item.src} style={{width:'100%',maxWidth:1100}}/></figure>)}<div style={{display:'grid',gridTemplateColumns:'minmax(0,2fr) minmax(340px,1fr)',gap:24}}><div><Preview key={id} template={t} data={data}/>{frame?<img alt="Image du rendu export" src={frame} width="720"/>:null}</div><Fields template={t} data={data} media={[]} onChange={setData}/></div></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
