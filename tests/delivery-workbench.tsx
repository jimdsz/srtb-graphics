// Isolated presentation fixture. No saved projects, production API, or private media.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {getTemplate,templateDefaults,type Project} from '../src/studio/domain';
import ExportPanel from '../src/studio/ExportPanel';
import {ExportReport} from '../src/studio/VideoExport';
import Activity from '../src/studio/Activity';
import Preview from '../src/studio/Preview';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/theme.css';
import '../src/studio/workbench.css';
import '../src/studio/production-controls.css';
import '../src/studio/delivery-workbench.css';

const template=getTemplate('BTV_PopUp');
const project:Project={id:'ui-delivery-fixture',title:'Recette locale · atelier d’export',template_id:template.id,template_version:template.version,library_version:template.libraryVersion,status:'draft',revision:1,data:{...templateDefaults(template),_background_visible:false,_out_mode:'manual',_out_duration_seconds:12},created_by:'recette',updated_by:'recette',created_at:'2026-09-23',updated_at:'2026-09-23',archived:0};
const noop=()=>{};
function Bench(){
  const [backupCount,setBackupCount]=useState(0),[voicePending,setVoicePending]=useState(true),[sample,setSample]=useState('none');
  return <main style={{padding:24,maxWidth:1440,margin:'auto'}}>
    <h1>Recette locale · atelier d’export</h1><p>Jeu de contrôle UI, sans accès aux projets de l’équipe.</p>
    <div className="row" style={{flexWrap:'wrap',marginBottom:20}}><label className="row"><input type="checkbox" checked={voicePending} onChange={event=>setVoicePending(event.target.checked)}/>Voix à associer (recette)</label><label>État de contrôle<select value={sample} onChange={event=>setSample(event.target.value)}><option value="none">Réglages</option><option value="working">Progression mesurée simulée</option><option value="result">Rapport simulé</option><option value="warning">Avertissement simulé</option></select></label><output aria-label="Sauvegardes de recette">{backupCount}</output></div>
    <div className="editor-grid"><div><Preview template={template} data={project.data}/>{sample!=='none'?<section className="panel side-content delivery-panel" aria-label="États de recette" style={{marginTop:20}}>{sample==='working'?<Activity label="Calcul des images · recette" percent={61} detail="Image 196 / 321 · environ 5 s restantes (estimation de recette)"/>:<ExportReport report={{format:'mp4',width:1920,height:1080,fps:25,frames:321,duration:12.84,audio:true,audioPeak:.2,alpha:false,bytes:4000000,checkedFrames:[0,160,320],videoBitrate:24123456,minimumOneSecondVideoBitrate:21234567,bitrateMeasurementWindows:12,targetVideoBitrate:50000000,minimumVideoBitrate:30000000,bitrateMode:'constant',exportProfile:'native-only',...(sample==='warning'?{bitrateWarning:'Recette : le débit mesuré est inférieur au profil demandé.'}:{})}}/>}</section>:null}</div><aside className="editor-sidebar"><ExportPanel project={project} template={template} backup={()=>setBackupCount(value=>value+1)} voicePending={voicePending} onRunningChange={noop}/></aside></div>
  </main>;
}
createRoot(document.querySelector('#root')!).render(<Bench/>);
