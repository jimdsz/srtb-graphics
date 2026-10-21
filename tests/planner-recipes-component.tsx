// Local-only API, no account, network media or production writes.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PlannerRecipes from '../src/studio/PlannerRecipes';
import {plannerAPI} from '../src/studio/day-planner-api';
import {programmeIdentity} from '../src/studio/day-planner-model';
import type {Plan,PlannerRow,PlannerRecord,ProgrammeRule} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
import '../src/studio/day-planner.css';
const rows:PlannerRow[]=Array.from({length:3},(_,i)=>({id:String(i),sheet:'Lundi',cell:'A'+i,raw:'',title:i===0?'Bonjour le Bénin — le rendez-vous des régions':`Magazine ${i+1}`,subtitle:'Épisode 1',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-07',time:'20:30:00',duration:1800,included:true,kinds:['ba','popup'],formats:['tv','portrait','vertical'],issues:[],media:null,location:null}));
const rules:PlannerRecord<ProgrammeRule>[]=rows.map(row=>({id:row.id,revision:1,archived:false,updatedAt:'2026-09-25T00:00:00Z',createdBy:'test@example.test',updatedBy:'test@example.test',data:{kind:'rule',name:row.title,programme:programmeIdentity(row),keywords:row.title,directoryId:null,preferredPath:null,kinds:['tds','renvoi']}}));
if(new URLSearchParams(location.search).has('weekly-only'))for(const rule of rules)rule.data.kinds=[];
let fail=false;
plannerAPI.rules=async()=>{if(fail)throw Error('Réseau indisponible (simulation locale)');return {rules};};
function Fixture(){const [plan,setPlan]=useState<Plan>({kind:'plan',name:'Recette',source:'fixture.xlsx',sourceHash:'a'.repeat(64),rows});return <main style={{padding:8}}><h1 style={{fontSize:20}}>Recettes d’équipe</h1><button onClick={()=>{fail=!fail;}}>Basculer la panne simulée</button><PlannerRecipes plan={plan} rows={plan.rows} onChange={setPlan}/><output aria-label="État local">{JSON.stringify(plan.rows.map(row=>({id:row.id,kinds:row.kinds,formats:row.formats})))}</output></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
