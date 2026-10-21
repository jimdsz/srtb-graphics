import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import TimeRuler from '../src/studio/TimeRuler';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';

function App(){
  const [width,setWidth]=useState(300),[position,setPosition]=useState(36.44);
  return <main style={{padding:20}}><h1>Recette locale · réglette</h1><p>Aucun média ni projet. Seule la largeur du panneau change.</p>
    <label style={{maxWidth:300}}>Largeur du panneau<select value={width} onChange={event=>setWidth(Number(event.target.value))}><option value={180}>180 px · très étroit</option><option value={300}>300 px · inspecteur</option><option value={600}>600 px · aperçu</option></select></label>
    <section style={{width,maxWidth:'100%',marginTop:20,border:'1px solid var(--line)'}}><TimeRuler value={position} duration={72.92} onSeek={setPosition}/></section>
    <output aria-label="Position sélectionnée">{position.toFixed(2)} s · durée 72.92 s · pas 0.04 s</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
