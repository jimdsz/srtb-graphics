import {plannerProject} from '../src/studio/day-planner-project';
import type {Plan} from '../src/studio/day-planner-model';
import {prepareGraphic} from '../src/studio/video/engine';
import {patchTextStyle,textFields} from '../src/studio/typography-model';
const titles=['FITFORME',"LE BENIN QUE J’AIME",'LE TRONE','FOI CHRETIENNE','LE BONHEUR','INTERVIEW EXCLUSIVE OLYMPE BHÊLY-QUENUM','LES COULEURS DE L’OMBRE'];
const plan:Plan={kind:'plan',name:'Contrôle local',source:'fixture',sourceHash:'a'.repeat(64),rows:titles.map((title,i)=>({id:String(i),sheet:'fixture',cell:'B'+i,raw:title,title,subtitle:'',category:'Magazine',broadcastDate:`2026-09-${7+i<10?'0':''}${7+i}`,airDate:`2026-09-${7+i<10?'0':''}${7+i}`,time:'20:30:00',duration:1800,included:true,issues:[],kinds:['ba'],formats:['tv'],media:null,location:null}))};
let prepared:Awaited<ReturnType<typeof prepareGraphic>>|undefined;
document.querySelector<HTMLButtonElement>('#measure')!.onclick=async()=>{
 const output=document.querySelector('#result')!,button=document.querySelector<HTMLButtonElement>('#measure')!;button.disabled=true;
 try{
  const draft=plannerProject(plan,{kind:'weekly',format:'tv',rowIds:plan.rows.map(r=>r.id)}),g=await prepareGraphic(draft.template,draft.data,23.32,false,new AbortController().signal);
  try{
   await g.frame(123,null);const graphic=g.graphic,read=graphic.getBoundingClientRect.bind(graphic);let reads=0;
   graphic.getBoundingClientRect=()=>{reads++;return read();};
   const start=performance.now();for(let i=0;i<1000;i++)graphic.__typography.refresh();
   output.textContent=JSON.stringify({refreshes:1000,hostGeometryReads:reads,elapsedMs:performance.now()-start},null,2);
  }finally{await g.dispose();}
 }catch(error){output.textContent=String(error);}finally{button.disabled=false;}
};
document.querySelector<HTMLButtonElement>('#run')!.onclick=async()=>{
 const result=document.querySelector('#result')!,button=document.querySelector<HTMLButtonElement>('#run')!;button.disabled=true;
 try{
  if(!prepared){const draft=plannerProject(plan,{kind:'weekly',format:'tv',rowIds:plan.rows.map(r=>r.id)});for(const [field] of textFields(draft.template))Object.assign(draft.data,patchTextStyle(draft.data,field,{size:100}));prepared=await prepareGraphic(draft.template,draft.data,23.32,false,new AbortController().signal);}
  const slot=Number(document.querySelector<HTMLSelectElement>('#slot')!.value),time=4.92+(slot-1)*2.4,frame=await prepared.frame(Math.round(time*25),null);
  document.querySelector('#stage')!.replaceChildren(frame);result.textContent=JSON.stringify({slot,time,title:titles[slot-1],boxes:prepared.graphic.__typography.boxes()},null,2);
 }catch(error){result.textContent=String(error);}finally{button.disabled=false;}
};
