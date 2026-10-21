import {initializeApp,getApps} from 'firebase/app';
import {getAuth,setPersistence,browserSessionPersistence,signInWithEmailAndPassword,createUserWithEmailAndPassword,sendEmailVerification,sendPasswordResetEmail,signOut,onIdTokenChanged,reload} from 'firebase/auth';
import type {User} from 'firebase/auth';
import {api,ApiError} from './api';
import type {Member} from './domain';
import {sessionState} from './session-state';

let initialized:ReturnType<typeof createClient>|undefined;
let signingOut:Promise<void>|undefined;
async function createClient(){
  const response=await fetch('/api/auth/config',{cache:'no-store',credentials:'same-origin'}),config=await response.json();
  if(!response.ok||!config.enabled)throw new Error('La connexion est en cours de configuration. Aucun compte ni média privé n’est accessible pour le moment.');
  const app=getApps().find(app=>app.name==='srtb')||initializeApp({apiKey:config.apiKey,projectId:config.projectId,authDomain:config.authDomain},'srtb');
  const auth=getAuth(app);auth.languageCode='fr';await setPersistence(auth,browserSessionPersistence);return auth;
}
const emailReturn=()=>({url:new URL('/?connexion=1',window.location.origin).href});
export const authClient=()=>initialized??=(createClient().catch(error=>{initialized=undefined;throw error;}));
export async function connect(email:string,password:string,create=false){
  await signingOut;
  const epoch=sessionState.snapshot().epoch;
  const auth=await authClient();
  let credential;
  try{credential=await (create?createUserWithEmailAndPassword(auth,email,password):signInWithEmailAndPassword(auth,email,password));}
  catch(error){
    // Removing Graphics membership does not delete the Firebase identity. Do not
    // silently change its password or attempt a second authentication request.
    if(create&&isExistingIdentity(error))return 'existing' as const;
    throw error;
  }
  if(!credential.user.emailVerified){if(create)await sendEmailVerification(credential.user,emailReturn());return 'verify' as const;}
  await refreshSession(credential.user,false,true);
  if(epoch!==sessionState.snapshot().epoch)throw new ApiError('La session a été fermée pendant la connexion. Réessayez.',401);
  sessionState.open();return 'connected' as const;
}
export async function verificationEmail(){const user=(await authClient()).currentUser;if(!user)throw Error('Connectez-vous d’abord.');await sendEmailVerification(user,emailReturn());}
export async function resetPassword(email:string){await sendPasswordResetEmail(await authClient(),email,emailReturn());}
/** Waiting screen only: never sign out somebody already using the workspace. */
export function watchVerification(onVerified:()=>void,onError:(error:unknown)=>void){
  let stopped=false,running=false;
  async function check(){
    if(stopped||running||document.hidden)return;running=true;
    try{
      const auth=await authClient(),user=auth.currentUser;
      if(!user||stopped)return;
      await reload(user);
      if(stopped||auth.currentUser?.uid!==user.uid||!user.emailVerified)return;
      await signOut(auth);if(stopped)return;stopped=true;clearInterval(timer);onVerified();
    }catch(error){if(!stopped)onError(error);}finally{running=false;}
  }
  const timer=setInterval(()=>void check(),5000),focus=()=>void check();
  window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);void check();
  return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
}
export async function refreshSession(user:User,renew=true,fresh=false){
  const response=await fetch(renew?'/api/auth/refresh':'/api/auth/session',{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:await user.getIdToken(fresh)})});
  if(!response.ok){const body=await response.json().catch(()=>null);throw new ApiError(body?.error||(response.status===401||response.status===403?'Connexion refusée. Reconnectez-vous.':'Service de connexion momentanément indisponible. Réessayez sans fermer cet onglet.'),response.status);}
}
export async function logout(){
  // Revoke the opaque server session even if the Firebase SDK cannot initialise.
  const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});
  if(!response.ok)throw new Error('Déconnexion non confirmée. Réessayez.');
  // Unmount private views immediately; do not wait for Firebase/network or a redirect.
  signingOut=authClient().then(auth=>signOut(auth)).catch(()=>undefined);
  sessionState.end('logout');
  try{await signingOut;}finally{signingOut=undefined;}
}
export function keepSession(onMember:(member:Member)=>void,onError:(error:unknown)=>void){
  let disposed=false,unsubscribe:(()=>void)|undefined,running=false,seenUser=false,lastRenewal=0;
  const epoch=sessionState.snapshot().epoch,current=()=>!disposed&&sessionState.current(epoch);
  async function refresh(user:User|null,fresh=false){
    if(!current()||running)return;
    if(!user?.emailVerified){if(seenUser)sessionState.end('expired',epoch);return;}
    seenUser=true;running=true;
    try{await refreshSession(user,true,fresh);if(current()){const member=await api.me();if(current()){lastRenewal=Date.now();onMember(member);}}}
    catch(error){
      const code=typeof error==='object'&&error!==null&&'code'in error?String(error.code):'';
      if(current()&&((error instanceof ApiError&&[401,403].includes(error.status))||['auth/user-token-expired','auth/invalid-user-token','auth/user-disabled','auth/user-not-found'].includes(code)))sessionState.end('expired',epoch);
      else if(current())onError(error);
    }finally{running=false;}
  }
  void authClient().then(auth=>{if(!disposed)unsubscribe=onIdTokenChanged(auth,user=>void refresh(user));}).catch(error=>{if(!disposed)onError(error);});
  // A cached ID token can be almost one hour old: posting it repeatedly does
  // not extend the server expiry. A periodic fresh token really renews it.
  // onIdTokenChanged uses the token already issued, avoiding a refresh loop.
  const renew=()=>{if(!current()||Date.now()-lastRenewal<5*60*1000)return;void authClient().then(auth=>refresh(auth.currentUser,true)).catch(error=>{if(current())onError(error);});};
  const wake=()=>{if(!document.hidden)renew();};
  const interval=setInterval(renew,10*60*1000);
  window.addEventListener('focus',wake);window.addEventListener('online',wake);document.addEventListener('visibilitychange',wake);
  return()=>{disposed=true;unsubscribe?.();clearInterval(interval);window.removeEventListener('focus',wake);window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);};
}
export function friendlyAuthError(error:unknown){
  const code=typeof error==='object'&&error!==null&&'code'in error?String(error.code):'';
  if(['auth/invalid-credential','auth/user-not-found','auth/wrong-password'].includes(code))return 'Adresse ou mot de passe incorrect.';
  if(code==='auth/email-already-in-use')return 'Un compte existe déjà avec cette adresse. Connectez-vous ou utilisez « Mot de passe oublié ». ';
  if(['auth/weak-password','auth/password-does-not-meet-requirements'].includes(code))return 'Choisissez un mot de passe d’au moins 12 caractères.';
  if(code==='auth/too-many-requests')return 'Trop de tentatives. Patientez avant de réessayer.';
  if(code==='auth/network-request-failed')return 'Connexion internet interrompue. Réessayez.';
  return error instanceof Error?error.message:'Connexion non confirmée.';
}
export function isExistingIdentity(error:unknown){return typeof error==='object'&&error!==null&&'code'in error&&error.code==='auth/email-already-in-use';}
