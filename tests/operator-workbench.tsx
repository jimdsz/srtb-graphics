// Local UI fixture only. No authenticated session, API writes or user media.
import {createRoot} from 'react-dom/client';
import Studio from '../src/studio/Studio';
import Activity from '../src/studio/Activity';
import {api,ApiError} from '../src/studio/api';
import {derivations} from '../src/studio/derivation-api';
import {getTemplate,templateDefaults,type Project} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

const requestedTemplate=new URL(location.href).searchParams.get('template');
const template=getTemplate(requestedTemplate&&['BTV_Renvoi','BTV_Evenement','BTV_Semainier'].includes(requestedTemplate)?requestedTemplate:'BTV_PopUp');
let project:Project={id:'operator-fixture',title:'Le rendez-vous du soir',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,status:'draft',revision:1,data:{...templateDefaults(template),...(template.id==='BTV_PopUp'?{_background_visible:false,_out_mode:'manual',_out_duration_seconds:12}:{})},created_by:'recette@example.test',updated_by:'recette@example.test',created_at:'2026-09-23T12:00:00Z',updated_at:'2026-09-23T12:00:00Z',archived:0};
api.projects=async()=>({projects:[project],next:null});
api.project=async()=>structuredClone(project);
api.media=async()=>[];
api.comments=async()=>[];
api.revisions=async()=>[];
derivations.origin=async()=>{throw new ApiError('Projet de recette sans provenance dérivée.',404);};
api.save=async(_previous,title,data)=>{
  await new Promise(resolve=>setTimeout(resolve,120));
  project={...project,title,data,revision:project.revision+1};
  return structuredClone(project);
};
const activity=new URL(location.href).searchParams.get('activity');
createRoot(document.querySelector('#root')!).render(activity?<main style={{padding:24}}><Activity label="Préparation de recette" percent={activity==='determinate'?61.8:undefined}/></main>:<Studio member={{email:'recette@example.test',name:'Poste de recette',role:'designer',active:1}}/>);
