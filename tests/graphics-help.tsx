import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import GraphicsHelp,{HelpBubble,requestGraphicsHelp} from '../src/studio/GraphicsHelp';
import type {GraphicsHelpRole} from '../src/studio/graphics-help';
import '../src/studio/studio.css';
import '../src/studio/theme.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
const params=new URLSearchParams(location.search);
const role:GraphicsHelpRole=params.get('role')==='admin'?'admin':'designer';
function Harness(){
  const [member,setMember]=useState('one@example.test');
  const [page,setPage]=useState('programmes');
  const [generation,setGeneration]=useState(0);
  return <main style={{padding:'1rem',maxWidth:'70rem',margin:'0 auto'}}>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}><h1>Graphics · banc du guide</h1><GraphicsHelp key={generation} memberId={member} role={role} helpSection={page} channelName="Bénin TV" onNavigate={setPage}/></div>
    <p>Vue actuelle : {page}</p><p>Membre : {member}</p>
    <div className="help-title-row"><h2>Émissions</h2><HelpBubble section="programmes" role={role}/></div>
    <p>Cette page fictive ne contient aucune donnée de production.</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:8}}><button onClick={()=>setGeneration(value=>value+1)}>Simuler le changement de chaîne</button><button onClick={()=>setMember(value=>value==='one@example.test'?'two@example.test':'one@example.test')}>Changer de membre</button><button onClick={()=>requestGraphicsHelp('audio')}>Aide du son</button><button onClick={()=>requestGraphicsHelp('admin')}>Demande administration</button><button onClick={()=>requestGraphicsHelp('start')}>Relancer la prise en main</button></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
