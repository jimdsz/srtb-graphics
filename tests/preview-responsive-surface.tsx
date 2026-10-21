// Local, synthetic projects rendered by the real Studio/Workspace/Preview.
// The only simulated actions are API reads and opening the fixture project.
import {createRoot} from 'react-dom/client';
import Studio from '../src/studio/Studio';
import {api,ApiError} from '../src/studio/api';
import {derivations} from '../src/studio/derivation-api';
import {getTemplate,templateDefaults,type Member,type Project} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

const params=new URLSearchParams(location.search),format=params.get('format')||'tv';
document.documentElement.dataset.theme=params.get('theme')==='light'?'light':'dark';
const template=getTemplate('BTV_PopUp');
const member:Member={email:'responsive@example.test',name:'Recette responsive',role:'designer',active:1};
const project:Project={id:'responsive-synthetic',title:'Cadre complet · projet de recette',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,status:'draft',revision:1,data:{...templateDefaults(template),_studio_format:format,_background_visible:false},created_by:member.email,updated_by:member.email,created_at:'2026-09-24T12:00:00Z',updated_at:'2026-09-24T12:00:00Z',archived:0};
api.projects=async()=>({projects:[structuredClone(project)],next:null});
api.project=async()=>structuredClone(project);
api.media=async()=>[];
api.comments=async()=>[];
api.revisions=async()=>[];
derivations.origin=async()=>{throw new ApiError('Projet de recette ordinaire.',404);};
// Open the only synthetic project once. No authentication or remote project.
const initial=new MutationObserver(()=>{
  const button=document.querySelector<HTMLButtonElement>('[data-project-id="responsive-synthetic"] .project-row-title');
  if(button){initial.disconnect();button.click();}
});
initial.observe(document.getElementById('root')!,{childList:true,subtree:true});
createRoot(document.getElementById('root')!).render(<Studio member={member}/>);
