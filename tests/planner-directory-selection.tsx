// Local-only real-API fixture. Force the directory-input branch in Chromium;
// this exercises that branch, not Safari itself. No production writes.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerBatchMedia from '../src/studio/PlannerBatchMedia';
import type {PlannerRow} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';
if(location.origin!=='http://127.0.0.1:5192')throw Error('Loopback fixture only');
Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:undefined});
const member={email:'admin@example.com',name:'Qualification locale',role:'admin' as const,active:1};
const initial:PlannerRow={id:'compat-test',sheet:'Lundi',cell:'B1',raw:'',title:'BA Programme',subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'09:00:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv'],issues:[],media:null,location:null};
function Fixture(){
 const [rows,setRows]=useState([initial]),[open,setOpen]=useState(false);
 return <main style={{padding:20}}><h1>Recette locale — sélection de dossier compatible</h1><p>Composants et API réels, base locale temporaire. Choisir uniquement public/preview-media/v1. Aucun fichier envoyé.</p><button onClick={()=>setOpen(true)}>Rechercher les médias</button><button onClick={()=>setRows([initial])}>Réinitialiser la ligne de test</button>{open?<PlannerBatchMedia rows={rows} member={member} onApply={(id,media,location)=>setRows(previous=>previous.map(row=>row.id===id?{...row,media,location}:row))} onClose={()=>setOpen(false)}/>:null}<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}} aria-label="Résultat de liaison">{JSON.stringify(rows,null,2)}</pre></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
