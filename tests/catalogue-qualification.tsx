// Recette visuelle locale : aucune session, aucun projet et aucune écriture API.
import {createRoot} from 'react-dom/client';
import Catalogue from '../src/studio/Catalogue';
import {api} from '../src/studio/api';
import {broadcastTemplates} from '../src/studio/domain';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/theme.css';
import '../src/studio/workbench.css';
api.catalogue=async()=>broadcastTemplates;

createRoot(document.querySelector('#root')!).render(<main id="graphics-main" style={{maxWidth:1440,margin:'auto',padding:24}}><Catalogue create={()=>undefined}/></main>);
