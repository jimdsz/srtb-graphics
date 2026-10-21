import {sessionState} from '../src/studio/session-state';
export async function connect(){await fetch('/__session-test/login',{method:'POST'});sessionState.open();return 'connected';}
export async function logout(){await fetch('/api/auth/logout',{method:'POST'});sessionState.end('logout');}
export function keepSession(){return()=>{};}
export function watchVerification(){return()=>{};}
export async function verificationEmail(){}
export async function resetPassword(){}
export function friendlyAuthError(error:unknown){return String(error);}
