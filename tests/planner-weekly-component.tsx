import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import PlannerWeekly from '../src/studio/PlannerWeekly';
import {updatePlannerWeekly,weeklyChoices} from '../src/studio/planner-weekly';
import type {Plan} from '../src/studio/day-planner-model';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/day-planner.css';
const initial:Plan={kind:'plan',name:'Recette locale',source:'local.xlsx',sourceHash:'a'.repeat(64),weekly:{rowIds:['0','1','2','3','4','5','6'],formats:['tv']},rows:Array.from({length:7},(_,i)=>({id:String(i),sheet:'Grille',cell:'A1',raw:'',title:i?'Programme '+(i+1):'Bonjour le Bénin — présentation de la semaine et des rendez-vous',subtitle:'',category:'Magazine',broadcastDate:'2026-09-07',airDate:'2026-09-'+String(7+i).padStart(2,'0'),time:'20:30:00',duration:1800,included:true,kinds:['ba'],formats:['tv'],issues:[],media:null,location:null}))};
function Fixture(){const [plan,setPlan]=useState(initial),[result,setResult]=useState('');return <main className="day-planner" style={{padding:8}}><PlannerWeekly plan={plan} tasks={[]} onChange={patch=>setPlan(p=>updatePlannerWeekly(p,patch))} onCreate={()=>setResult(JSON.stringify(weeklyChoices(plan)))} onOpen={()=>{}} onVoice={()=>setResult('Choisir une voix')} onPropose={()=>setResult('Proposer la semaine')} onMedia={id=>setResult(`Média du programme ${id}`)} onExcerpt={id=>setResult(`Passage du programme ${id}`)}/><output id="weekly-audit" style={{display:'block',overflowWrap:'anywhere'}}>{result}</output></main>;}
createRoot(document.querySelector('#root')!).render(<Fixture/>);
