// Local qualification only. This entry is not included in any production build.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Workspace from '../src/studio/Workspace';
import Studio from '../src/studio/Studio';
import {api} from '../src/studio/api';
import type {Project} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
function Bench(){
  const [project,setProject]=useState<Project|null>(null),[error,setError]=useState('');
  useEffect(()=>{void api.project(new URL(location.href).searchParams.get('project')!).then(setProject).catch(error=>setError(error.message));},[]);
  return <main style={{padding:24}}><h1>Recette collaborative locale</h1>{error?<p role="alert">{error}</p>:null}{project?<Workspace project={project} member={{email:'test@example.test',name:'Poste de recette',role:'admin',active:1}} media={[]} onChanged={()=>{}} onBack={()=>{}}/>:null}</main>;
}
createRoot(document.querySelector('#root')!).render(new URL(location.href).searchParams.has('studio')?<Studio member={{email:'test@example.test',name:'Poste de recette',role:'designer',active:1}}/>:<Bench/>);
