import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Suite from './Suite';
import InterfaceBoundary from './InterfaceBoundary';
import AppUpdateNotice from './AppUpdateNotice';
import './studio.css';
import './responsive.css';
import './workbench.css';
import {captureConnectorHandoff} from './connector-handoff';

captureConnectorHandoff();
createRoot(document.getElementById('root')!).render(<StrictMode><InterfaceBoundary><AppUpdateNotice/><Suite/></InterfaceBoundary></StrictMode>);
