// Local UI fixture only: excluded from all production entry points.
import {createRoot} from 'react-dom/client';
import Studio from '../src/studio/Studio';
import {getTemplate,templateDefaults,type Project} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/theme.css';
import '../src/studio/workbench.css';
const template=getTemplate('BTV_PopUp');
const project:Project={id:'ui-audit-popup',title:'Magazine · contrôle visuel',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,status:'draft',revision:1,data:{...templateDefaults(template),_background_visible:false,_out_mode:'manual',_out_duration_seconds:12},created_by:'recette@example.test',updated_by:'recette@example.test',created_at:'2026-09-23T12:00:00Z',updated_at:'2026-09-23T12:00:00Z',archived:0};
Object.assign(window,{layoutAuditProjects:[project]});
createRoot(document.querySelector('#root')!).render(<Studio member={{email:'recette@example.test',name:'Poste de recette',role:'admin',active:1}}/>);
