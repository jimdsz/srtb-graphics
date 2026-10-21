import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerExcerptDialog from '../src/studio/PlannerExcerptDialog';
import {beginLocalFile} from '../src/studio/local-media';
import type {PlannerRow} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';
function App({initial}:{initial:PlannerRow}){
 const [row,setRow]=useState(initial),[open,setOpen]=useState(true);
 return <><button onClick={()=>setOpen(true)}>Choisir le passage</button><output>{JSON.stringify(row.excerpt)}</output>{open?<PlannerExcerptDialog row={row} onClose={()=>setOpen(false)} onSelect={excerpt=>{setRow(r=>({...r,excerpt}));setOpen(false);}}/>:null}</>;
}
async function mount(){
 if(location.hostname!=='127.0.0.1')throw Error('Recette locale uniquement');
 const response=await fetch('/preview-media/v1/ba-programme.mp4');if(!response.ok)throw Error('Vidéo locale indisponible');
 const media=await beginLocalFile(new File([await response.blob()],'Programme de démonstration.mp4',{type:'video/mp4'})).verified;
 const row:PlannerRow={id:'recette',sheet:'RECETTE',cell:'A1',raw:'',title:'Programme de démonstration',subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:30:00',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media,location:null,excerpt:{source:media.url,start:10,end:14,duration:66.88}};
 const root=createRoot(document.getElementById('root')!);root.render(<App initial={row}/>);import.meta.hot?.dispose(()=>root.unmount());
}
void mount();
