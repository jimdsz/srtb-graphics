// UI-only qualification. The runner intercepts every recovery request; never
// enter real credentials or connect this fixture to a member account.
import {createRoot} from 'react-dom/client';
import AccountRecovery from '../src/studio/AccountRecovery';
import '../src/studio/studio.css';
import '../src/studio/responsive.css';
import '../src/studio/workbench.css';
const actionLink=new URLSearchParams(location.search).has('mode');
createRoot(document.getElementById('root')!).render(<AccountRecovery actionLink={actionLink}/>);
