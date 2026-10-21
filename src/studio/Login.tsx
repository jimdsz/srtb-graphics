import {useEffect,useRef,useState} from 'react';
import {connect,verificationEmail,friendlyAuthError,watchVerification} from './firebase-client';
import ThemeToggle from './ThemeToggle';
import AccountRecovery from './AccountRecovery';
export default function Login({onConnected,serviceMessage}:{onConnected:()=>void;serviceMessage?:string}){
  const[email,setEmail]=useState(''),[password,setPassword]=useState(''),[create,setCreate]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[verify,setVerify]=useState(false);
  const passwordInput=useRef<HTMLInputElement>(null);
  const[recover,setRecover]=useState(false);
  const[existing,setExisting]=useState(false);
  useEffect(()=>{if(!verify)return;return watchVerification(()=>{setVerify(false);setCreate(false);setError('');setPassword('');setMessage('Adresse vérifiée. Vous pouvez maintenant vous connecter.');passwordInput.current?.focus();},e=>setError(friendlyAuthError(e)));},[verify]);
  async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setMessage('');try{await action();}catch(e){setError(friendlyAuthError(e));}finally{setBusy(false);}}
  if(recover)return <AccountRecovery initialEmail={email} onBack={()=>setRecover(false)}/>;
  return <main className="auth-screen">
    <header className="auth-masthead"><span className="suite-wordmark">SRTB</span><span>Espace outils</span><ThemeToggle /></header>
    <div className="auth-content">
      <p className="eyebrow">Accès réservé aux équipes</p><h1>{existing?'Reprendre votre accès.':create?'Activer votre compte.':'Connexion.'}</h1>
      <p>Utilisez l’adresse autorisée par votre administrateur. Une adresse SRTB, Google ou Microsoft convient ; aucun abonnement personnel n’est requis.</p>
      {serviceMessage?<p className="notice warning" role="status">{serviceMessage}</p>:null}
      {existing?<p className="notice" role="status">Un compte a déjà été préparé ou créé avec cette adresse. Utilisez votre mot de passe habituel, ou demandez un lien pour choisir votre mot de passe. Votre accès doit être autorisé par l’administrateur.</p>:null}
      {create?<p>Votre administrateur vous a invité ? Consultez votre messagerie pour choisir votre mot de passe. Le message peut être intitulé « Réinitialiser votre mot de passe ».</p>:null}
      <form onSubmit={event=>{event.preventDefault();void run(async()=>{setVerify(false);const result=await connect(email.trim(),password,create);setPassword('');if(result==='existing'){setExisting(true);setCreate(false);passwordInput.current?.focus();}else if(result==='verify'){setVerify(true);setMessage('Consultez votre messagerie et ouvrez le lien de vérification. Cet écran détectera la vérification et vous invitera à vous connecter.');setCreate(false);}else onConnected();});}}>
        <label>Adresse e-mail<input name="email" type="email" autoComplete="email" spellCheck={false} value={email} required maxLength={254} disabled={busy} onChange={e=>{setEmail(e.target.value);setExisting(false);setError('');}}/></label>
        <label>Mot de passe SRTB<input name="password" ref={passwordInput} type="password" autoComplete={create?'new-password':'current-password'} minLength={create?12:undefined} required value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
        {create?<p className="small">Au moins 12 caractères. L’activation ne donne accès qu’aux personnes autorisées par SRTB.</p>:null}
        <button className="primary" type="submit" disabled={busy}>{busy?'Connexion…':create?'Activer mon compte':'Se connecter'}</button>
      </form>
      {error?<p role="alert" className="notice error">{error}</p>:null}{message?<p role="status" className="notice">{message}</p>:null}
      <div className="row wrap">
        {!existing?<button className="quiet" disabled={busy} onClick={()=>{setCreate(!create);setError('');setPassword('');}}>{create?'J’ai déjà un compte':'Première connexion'}</button>:null}
        <button className={existing?'primary':'quiet'} disabled={busy} onClick={()=>{setPassword('');setRecover(true);}}>{existing||create?'Recevoir un lien':'Mot de passe oublié'}</button>
        {verify?<button disabled={busy} onClick={()=>void run(async()=>{await verificationEmail();setMessage('Envoi de l’e-mail de vérification demandé. Consultez votre messagerie.');})}>Renvoyer la vérification</button>:null}
      </div>
    </div>
    <p className="auth-footer">Société de Radio et de Télévision du Bénin · Connexion personnelle</p>
  </main>;
}
