// Isolated browser qualification. Only the team API is simulated. Folder
// selection, scan, worker search, fingerprint and media binding are real.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerBatchMedia from '../src/studio/PlannerBatchMedia';
import {plannerAPI} from '../src/studio/day-planner-api';
import type {PlannerDocument,PlannerRecord,PlannerRow} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';
if(location.origin!=='http://127.0.0.1:5192')throw Error('Loopback qualification only');
Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:undefined});
const member={email:'local-index@example.test',name:'Recette locale',role:'designer' as const,active:1};
const initial:PlannerRow={id:'local-test',sheet:'Lundi',cell:'B1',raw:'',title:'BA Programme',subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'09:00:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:null,location:null};
const records=new Map<string,PlannerRecord<PlannerDocument>>();
let writes=0,gets=0,failCatalog=false;
plannerAPI.list=async()=>{if(failCatalog)throw Error('Catalogue indisponible (simulation)');return {documents:[...records.values()].filter(r=>r.data.kind==='directory').map(r=>({id:r.id,revision:r.revision,kind:r.data.kind,name:r.data.name,updatedAt:r.updatedAt,archived:false})),next:null};};
plannerAPI.rules=async()=>({rules:[]});
plannerAPI.get=async<T extends PlannerDocument>(id:string)=>{gets++;const record=records.get(id);if(!record)throw Error('Index local envoyé à tort au serveur');return record as PlannerRecord<T>;};
plannerAPI.save=async<T extends PlannerDocument>(id:string,revision:number,data:T)=>{writes++;const result={id,revision:revision+1,data,createdBy:member.email,updatedBy:member.email,updatedAt:new Date().toISOString(),archived:false};records.set(id,result);return result;};
function Fixture(){
 const [rows,setRows]=useState([initial]),[open,setOpen]=useState(false),[evidence,setEvidence]=useState<unknown>(null);
 return <main style={{padding:20}}><h1>Recherche sans partage — recette isolée</h1><p>Choisir uniquement public/preview-media/v1. Aucun appel à la production.</p><label><input type="checkbox" onChange={e=>{failCatalog=e.target.checked;}}/>Simuler un catalogue indisponible</label><button onClick={()=>{setRows([initial]);setOpen(true);}}>Rechercher les médias</button>{open?<PlannerBatchMedia rows={rows} member={member} onApply={(id,media,location)=>{setRows(previous=>previous.map(row=>row.id===id?{...row,media,location}:row));setEvidence({writes,gets,media,location});}} onClose={()=>{setEvidence({writes,gets,rows});setOpen(false);}}/>:null}<output aria-label="Résultat local">{JSON.stringify(evidence)}</output></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
