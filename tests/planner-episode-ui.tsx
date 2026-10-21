// Real UI, worker and local API. Test names describe episode matching, not the
// content of the duplicated public demonstration MP4. No production writes.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerBatchMedia from '../src/studio/PlannerBatchMedia';
import PlannerMediaDialog from '../src/studio/PlannerMediaDialog';
import type {PlannerRow} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';
if(location.origin!=='http://127.0.0.1:5192')throw Error('Loopback fixture only');
Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:undefined});
const member={email:'admin@example.com',name:'Qualification locale',role:'admin' as const,active:1};
const initial:PlannerRow[]=[10,31].map(n=>({id:`episode-${n}`,title:'NTC',subtitle:`N°${n}`,sheet:'Lundi',cell:'B1',raw:'',category:'Magazine',broadcastDate:'2026-08-31',airDate:'2026-08-31',time:n===10?'09:00:00':'10:00:00',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null}));
function Fixture(){
 const [rows,setRows]=useState(initial),[mode,setMode]=useState<'batch'|'single'|null>(null);
 const apply=(id:string,media:PlannerRow['media'],location:PlannerRow['location'])=>setRows(previous=>previous.map(row=>row.id===id?{...row,media,location}:row));
 return <main style={{padding:20}}><h1>Recette locale — épisodes</h1><p>Choisir uniquement .local/planner-episodes. Vidéos de démonstration renommées, pas des épisodes NTC réels. API et base locales.</p><button onClick={()=>setMode('batch')}>Rechercher les deux épisodes</button><button onClick={()=>setMode('single')}>Choix manuel pour le N°31</button><button onClick={()=>setRows(initial)}>Réinitialiser les lignes</button>{mode==='batch'?<PlannerBatchMedia rows={rows} member={member} onApply={apply} onClose={()=>setMode(null)}/>:mode==='single'?<PlannerMediaDialog row={rows[1]} member={member} onClose={()=>setMode(null)} onSelect={(media,location)=>{apply(rows[1].id,media,location);setMode(null);}}/>:null}<pre aria-label="Liaisons obtenues" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(rows,null,2)}</pre></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
