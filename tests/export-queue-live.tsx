// Local qualification: real workspace, queue, snapshot and encoder. API supplied
// by the test runner only; no account, project or external database is mutated.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import Workspace from '../src/studio/Workspace';
import ExportQueuePanel from '../src/studio/ExportQueuePanel';
import {exportQueue} from '../src/studio/export-queue';
import {sessionState} from '../src/studio/session-state';
import {getTemplate,templateDefaults} from '../src/studio/domain';
import type {Project,Member} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
const template=getTemplate('BTV_BA_1P');
const projects:Project[]=['a','b'].map((key,index)=>({id:`00000000-0000-4000-8000-00000000000${index+1}`,title:`Recette ${key.toUpperCase()}`,template_id:template.id,template_version:template.version,library_version:template.libraryVersion,revision:1,status:'draft',archived:0,created_at:'',updated_at:'',created_by:'qualification',updated_by:'qualification',data:{...templateDefaults(template),_studio_format:index?'vertical':'portrait',_out_mode:'duration',_out_duration_seconds:64.8,_media_body_start_seconds:2,_media_body_end_seconds:index?4:14,_media_body_loop:false,_media_body_audio_enabled:true,_audio_bed_enabled:false,_audio_voice_enabled:false}}));
const member={email:'qualification@example.invalid',name:'Recette locale',role:'admin',active:1} as Member;
(window as any).queueLive={projects,snapshot:()=>exportQueue.snapshot(),clear:()=>exportQueue.clear(),suspend:()=>sessionState.suspend()};
function Bench(){
 const [active,setActive]=useState<Project|null>(null);
 return <div className={`studio-shell${active?' is-editing':''}`}><header className="graphics-header"><div className="graphics-masthead"><div className="graphics-identity"><span className="brand">SRTB Graphics · recette locale</span></div><ExportQueuePanel/></div></header><div className="studio-body"><main id="graphics-main">{active?<Workspace key={active.id} project={active} member={member} media={[]} onBack={()=>setActive(null)} onChanged={setActive} initialTab="exports"/>:<><h1>Projets de recette</h1>{projects.map(project=><button key={project.id} onClick={()=>setActive(project)}>Ouvrir {project.title}</button>)}</>}</main></div></div>;
}
createRoot(document.getElementById('root')!).render(<Bench/>);
