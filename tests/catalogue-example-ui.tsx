import React from 'react';
import {createRoot} from 'react-dom/client';
import Catalogue from '../src/studio/Catalogue';
import {templateDefaults,broadcastTemplates} from '../src/studio/domain';
import {api} from '../src/studio/api';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/theme.css';
import '../src/studio/workbench.css';
api.catalogue=async()=>broadcastTemplates;
function Bench(){const [result,setResult]=React.useState('Aucun projet créé.');return <main style={{padding:24}}><p role="status">{result}</p><Catalogue create={template=>{const values=Object.values(templateDefaults(template));setResult(values.some(value=>typeof value==='object'?value.url.startsWith('blob:'):typeof value==='string'&&/^(blob:|data:)/.test(value))?'FAIL : illustration copiée':'PASS : projet sans illustration de démonstration. Aucun enregistrement distant.');}}/></main>;}
createRoot(document.getElementById('root')!).render(<Bench/>);
