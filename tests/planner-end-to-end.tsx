// Local HTTP API and ephemeral database, no production account or data writes.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import DayPlanner from '../src/studio/DayPlanner';
import {api} from '../src/studio/api';
import type {Project} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
if(location.origin!=='http://127.0.0.1:5192'||String(import.meta.env.VITE_STUDIO_QUALIFICATION)!=='true')throw Error('Ephemeral loopback qualification only');
Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:undefined});
const member=await api.me();
function Fixture(){
 const [opened,setOpened]=useState<Project|null>(null);
 return <main style={{maxWidth:1300,margin:'auto',padding:20}}><h1>À faire — recette complète locale</h1><p>API réelle, base éphémère. Aucun projet de production modifié.</p><DayPlanner member={member} onOpenProject={setOpened}/>{opened?<output aria-label="Projet relu depuis la base" style={{display:'block',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(opened,null,2)}</output>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
