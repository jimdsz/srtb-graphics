import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import Preview from '../src/studio/Preview';
import {prepareGraphic} from '../src/studio/video/engine';
import {audioEvents,mixAudio} from '../src/studio/video/audio';
import {exportBroadcastVideo} from '../src/studio/video/export';
import '../src/studio/studio.css';

const ids=['BTV_BA_TDS','BTV_BA_TDS_SUIVI_DE'];
function settings(id:string,format='tv'){
 const template=getTemplate(id),data={...templateDefaults(template),_studio_format:format};
 for(const [key,value]of Object.entries({_background_visible:false,_media_background_url:'',_media_background_sequence:'[]',_media_mode:'external',_media_programme_1_url:'',_media_programme_2_url:'',_media_programme_1_sequence:'[]',_media_programme_2_sequence:'[]'}))if(template.fields[key])data[key]=value;
 return data;
}
function rms(buffer:AudioBuffer,from:number,to:number){
 let sum=0,count=0;for(let c=0;c<buffer.numberOfChannels;c++){const samples=buffer.getChannelData(c);for(let i=Math.round(from*buffer.sampleRate);i<Math.min(samples.length,Math.round(to*buffer.sampleRate));i++){sum+=samples[i]**2;count++;}}
 return Math.sqrt(sum/Math.max(1,count));
}
function App(){
 const [id,setId]=useState(ids[0]),[show,setShow]=useState(true),[busy,setBusy]=useState(false),[status,setStatus]=useState('Prêt'),[results,setResults]=useState<unknown[]>([]),[files,setFiles]=useState<{name:string;url:string}[]>([]);
 async function qualify(){
  if(location.hostname!=='127.0.0.1')throw Error('Recette locale uniquement.');
  setBusy(true);setShow(false);const rows:unknown[]=[];
  try{
   for(const templateId of ids){
    const template=getTemplate(templateId),signal=new AbortController().signal;
    for(const format of ['tv','portrait','vertical']){
     setStatus(template.name+' · '+format+' · mixage');
     const prepared=await prepareGraphic(template,settings(templateId,format),templateId===ids[0]?15.28:24.28,false,signal);
     try{
      const events=audioEvents(prepared,templateId,false),mixed=await mixAudio(events,prepared.timeline.duration,signal,setStatus);
      const opening=rms(mixed.buffer,0,2),body=rms(mixed.buffer,2,Math.min(10,mixed.buffer.duration));
      if(!mixed.audible||!events.length||events[0].at!==0||opening<.001||body<.001)throw Error('Son absent au début ou pendant l’habillage : '+JSON.stringify({templateId,format,opening,body}));
      rows.push({templateId,format,kind:'mix',openingRms:opening,bodyRms:body,peak:mixed.peak,events:events.map(e=>({at:e.at,start:e.start,duration:e.duration})),pass:true});setResults([...rows]);
     }finally{await prepared.dispose();}
    }
    setStatus(template.name+' · export MP4 natif');
    const exported=await exportBroadcastVideo(template,settings(templateId),{format:'mp4',manualOut:templateId===ids[0]?15.28:24.28,removeBackground:false,audio:true,background:'#131617'},signal,p=>setStatus(template.name+' · '+p.message));
    try{
     if(!exported.report.audio||exported.report.audioPeak<.001)throw Error('Export sans habillage sonore.');
     // exportBroadcastVideo independently decodes and compares AAC to its mix.
     rows.push({templateId,kind:'full-mp4-export',report:exported.report,pass:true});setResults([...rows]);
     const downloadable=new Blob([await exported.blob.arrayBuffer()],{type:'video/mp4'});
     setFiles(previous=>[...previous,{name:templateId+'-signature.mp4',url:URL.createObjectURL(downloadable)}]);
    }finally{await exported.dispose();}
   }
   setStatus('PASS — 6 mixages audibles, 2 MP4 complets encodés et relus.');
  }catch(error){setStatus('FAIL — '+String(error));}finally{setBusy(false);}
 }
 return <main style={{maxWidth:1000,margin:'24px auto',padding:16}}><h1>Tout de suite — recette audio locale</h1><p>Aucun média utilisateur. Aucun projet distant modifié.</p><label>Modèle<select disabled={busy} value={id} onChange={e=>{setId(e.target.value);setShow(true);}}>{ids.map(value=><option key={value} value={value}>{getTemplate(value).name}</option>)}</select></label><button disabled={busy} onClick={()=>void qualify()}>Vérifier le son et les exports</button><p id="status" role="status">{status}</p>{files.map(file=><p key={file.name}><a href={file.url} download={file.name}>{file.name}</a></p>)}<pre id="results">{JSON.stringify(results,null,2)}</pre>{show?<Preview key={id} template={getTemplate(id)} data={settings(id)}/>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
