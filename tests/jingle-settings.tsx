import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import SoundSettings from '../src/studio/SoundSettings';
import {getTemplate,templateDefaults,type ProjectData} from '../src/studio/domain';
import '../src/studio/studio.css';

// Local component fixture: no project, API call or media load. Display the exact
// changes caused by the real operator button; do not auto-click it in test code.
function Settings(){
 const [id,setId]=useState('BTV_Renvoi'),template=getTemplate(id);
 const [patch,setPatch]=useState<ProjectData>({});
 return <main style={{maxWidth:460,margin:'24px auto',padding:16}}><h1>Jingles — contrôle local</h1><p>Aucun projet enregistré, aucun chargement de média.</p><label>Modèle<select value={id} onChange={e=>{setId(e.target.value);setPatch({});}}>{['BTV_Renvoi','BTV_Evenement','BTV_Semainier'].map(value=><option key={value} value={value}>{getTemplate(value).name}</option>)}</select></label><SoundSettings template={template} data={{...templateDefaults(template),...patch}} onChange={value=>setPatch({...patch,...value})} disabled={false}/><pre id="changes" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(patch,null,2)}</pre></main>;
}
createRoot(document.getElementById('root')!).render(<Settings/>);
