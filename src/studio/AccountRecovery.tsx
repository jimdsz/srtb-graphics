import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {applyActionCode,checkActionCode} from 'firebase/auth';
import {ArrowLeft,Check,Eye,EyeOff,KeyRound,MailCheck} from 'lucide-react';
import {authClient} from './firebase-client';
import {recoveryRequest,RecoveryError} from './account-recovery';
import {EmailActionError,emailActionCopy,emailActionMode,reviewEmailAction,waitForEmailProvider,type ReviewedEmailAction} from './email-action';
import ThemeToggle from './ThemeToggle';

// The SDK cannot cancel an email mutation. Keep this lock beyond the UI timeout
// and component lifetime, until the original provider request has settled.
let pendingEmailWrite:Promise<void>|null=null;
const pendingListeners=new Set<()=>void>();
const subscribePending=(listener:()=>void)=>{pendingListeners.add(listener);return()=>{pendingListeners.delete(listener);};};
const pendingSnapshot=()=>pendingEmailWrite!==null;
const notifyPending=()=>{for(const listener of pendingListeners)listener();};
const providerCode=(error:unknown)=>typeof error==='object'&&error!==null&&'code'in error?String(error.code):'';
const invalidAction=(error:unknown)=>error instanceof RecoveryError?error.status===410:['auth/expired-action-code','auth/invalid-action-code','auth/user-disabled','auth/user-not-found'].includes(providerCode(error));

function actionError(error:unknown,passwordAction:boolean){
  if(error instanceof RecoveryError||error instanceof EmailActionError)return error.message;
  if(['auth/expired-action-code','auth/invalid-action-code'].includes(providerCode(error)))return passwordAction?'Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien.':'Ce lien a expiré ou a déjà été utilisé. Aucune nouvelle confirmation n’a été effectuée.';
  if(['auth/user-disabled','auth/user-not-found'].includes(providerCode(error)))return 'Cette action n’est plus disponible pour ce compte. Contactez l’administrateur SRTB.';
  // Provider error messages can contain credentials or addresses. Never render them.
  return 'La vérification n’a pas abouti. Vérifiez la connexion et réessayez.';
}

export default function AccountRecovery({initialEmail='',onBack,actionLink=false}:{initialEmail?:string;onBack?:()=>void;actionLink?:boolean}){
  const[action]=useState(()=>{
    const query=new URLSearchParams(window.location.search);
    return {mode:actionLink&&query.getAll('mode').length===1?query.get('mode'):null,code:actionLink&&query.getAll('oobCode').length===1?query.get('oobCode'):null};
  });
  const[email,setEmail]=useState(initialEmail),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[visible,setVisible]=useState(false);
  const[stage,setStage]=useState<'request'|'checking'|'reset'|'email-action'|'sent'|'done'|'invalid'|'uncertain'>(actionLink?'checking':'request');
  const[busy,setBusy]=useState(false),[error,setError]=useState('');
  const[retry,setRetry]=useState(0),[retryable,setRetryable]=useState(false);
  const[reviewed,setReviewed]=useState<ReviewedEmailAction|null>(null),[unsupported,setUnsupported]=useState(false),[uncertain,setUncertain]=useState(false);
  const mounted=useRef(true),lock=useRef(false),heading=useRef<HTMLHeadingElement>(null);
  const pendingWrite=useSyncExternalStore(subscribePending,pendingSnapshot,()=>false);
  const passwordAction=!actionLink||action.mode==='resetPassword';
  const copy=emailActionMode(action.mode)?emailActionCopy[action.mode]:null;
  const back=()=>{mounted.current=false;if(onBack)onBack();else window.location.assign('/login');};

  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(stage!=='checking')heading.current?.focus({preventScroll:true});},[stage]);
  useEffect(()=>{
    if(!actionLink)return;
    let cancelled=false;
    setStage('checking');setRetryable(false);setReviewed(null);
    // Remove one-use credentials before loading the SDK or making a provider call.
    window.history.replaceState(null,'',window.location.pathname);
    const current=()=>!cancelled&&mounted.current;
    async function inspect(){
      try{
        if(!action.code||action.code.length>4096)throw new EmailActionError('data','Ce lien est incomplet ou non reconnu. Aucune modification n’a été demandée.');
        if(action.mode==='resetPassword'){
          const result=await recoveryRequest<{email:string}>('verify',{code:action.code});
          if(current()){setEmail(result.email);setStage('reset');}
          return;
        }
        if(!emailActionMode(action.mode)){
          if(current())setUnsupported(true);
          throw new EmailActionError('unsupported',action.mode==='revertSecondFactorAddition'?'L’annulation d’un second facteur n’est pas prise en charge par Graphics. Aucune modification n’a été demandée. Contactez l’administrateur SRTB.':'Cette action n’est pas prise en charge par Graphics. Aucune modification n’a été demandée. Contactez l’administrateur SRTB.');
        }
        const info=await waitForEmailProvider(authClient().then(auth=>checkActionCode(auth,action.code!)));
        if(!current())return;
        const result=reviewEmailAction(action.mode,info);
        setReviewed(result);setUncertain(false);setError('');setStage('email-action');
      }catch(error){
        if(current()){
          setError(actionError(error,passwordAction));
          setRetryable(!(error instanceof EmailActionError)&&!invalidAction(error));
          setStage('invalid');
        }
      }
    }
    void inspect();
    return()=>{cancelled=true;};
  },[actionLink,action,retry,passwordAction]);

  async function run(work:()=>Promise<void>){
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try{await work();}
    catch(error){if(mounted.current){setError(actionError(error,passwordAction));if(invalidAction(error)){setRetryable(false);setStage('invalid');}}}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }

  async function confirmEmail(){
    if(lock.current||pendingEmailWrite||!reviewed||stage!=='email-action'||!action.code)return;
    lock.current=true;setBusy(true);setError('');
    const write=authClient().then(auth=>applyActionCode(auth,action.code!));
    pendingEmailWrite=write;notifyPending();
    const release=()=>{if(pendingEmailWrite===write){pendingEmailWrite=null;notifyPending();}};
    void write.then(release,release);
    try{
      await waitForEmailProvider(write);
      if(mounted.current){setUncertain(false);setStage('done');}
    }catch(error){
      if(mounted.current){
        if(invalidAction(error)){setError(actionError(error,false));setRetryable(false);setStage('invalid');}
        else{
          setUncertain(true);
          setError('La réponse du fournisseur n’a pas été reçue. L’action a peut-être été effectuée ; aucun nouvel essai n’a été envoyé.');
          setStage('uncertain');
        }
      }
    }finally{lock.current=false;if(mounted.current)setBusy(false);}
  }

  const title=stage==='reset'?'Nouveau mot de passe.':stage==='done'?(passwordAction?'Votre accès est prêt.':copy?.done||'Action confirmée.'):stage==='sent'?'Vérifiez votre messagerie.':stage==='checking'?'Vérification du lien…':stage==='email-action'?(copy?.title||'Vérifier votre adresse.'):stage==='uncertain'?'Confirmation non reçue.':stage==='invalid'?(unsupported?'Action non prise en charge.':passwordAction?'Un nouveau lien suffit.':'Ce lien n’est pas utilisable.'):'Retrouver votre accès.';
  return <main className="auth-screen"><header className="auth-masthead"><span className="suite-wordmark">SRTB</span><span>Graphics</span><ThemeToggle/></header><div className="auth-content">
    {stage==='done'?<Check size={28} aria-hidden="true"/>:passwordAction?<KeyRound size={28} aria-hidden="true"/>:<MailCheck size={28} aria-hidden="true"/>}
    <h1 ref={heading} tabIndex={-1} style={{outline:'none'}}>{title}</h1>
    {error&&<p className="notice error" role="alert">{error}</p>}
    {stage==='checking'&&<p role="status">Nous vérifions ce lien sécurisé.</p>}
    {stage==='request'&&<form onSubmit={event=>{event.preventDefault();void run(async()=>{await recoveryRequest('request',{email:email.trim()});if(mounted.current)setStage('sent');});}}><p>Recevez un lien pour choisir un nouveau mot de passe.</p><label>Adresse e-mail<input type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={event=>setEmail(event.target.value)}/></label><button className="primary" disabled={busy}>{busy?'Envoi…':'Recevoir le lien'}</button></form>}
    {stage==='sent'&&<><p role="status">Si un compte correspond à cette adresse, un e-mail sera envoyé. Regardez aussi les courriers indésirables.</p><button onClick={()=>setStage('request')}>Corriger l’adresse ou renvoyer</button></>}
    {stage==='invalid'&&<>
      {uncertain&&<p>Une confirmation a été envoyée auparavant. Ce résultat ne permet pas de savoir si elle a abouti. Vérifiez votre accès depuis la connexion.</p>}
      {retryable&&<button className="primary" disabled={pendingWrite} onClick={()=>{setError('');setRetry(value=>value+1);}}>Réessayer la vérification</button>}
      {passwordAction?<button onClick={()=>{setError('');setStage('request');}}>Demander un nouveau lien</button>:!unsupported&&copy&&<p>{copy.invalid}</p>}
    </>}
    {stage==='reset'&&<form onSubmit={event=>{event.preventDefault();if(password!==confirmation){setError('Les deux mots de passe ne correspondent pas.');return;}void run(async()=>{await recoveryRequest('confirm',{code:action.code,password});if(mounted.current){setPassword('');setConfirmation('');setStage('done');}});}}><p>{email}</p><label>Nouveau mot de passe<input type={visible?'text':'password'} autoComplete="new-password" minLength={12} maxLength={4096} required value={password} disabled={busy} onChange={event=>setPassword(event.target.value)}/></label><label>Confirmer le mot de passe<input type={visible?'text':'password'} autoComplete="new-password" minLength={12} maxLength={4096} required value={confirmation} disabled={busy} onChange={event=>setConfirmation(event.target.value)}/></label><div className="row wrap"><button type="button" className="quiet" aria-pressed={visible} onClick={()=>setVisible(value=>!value)}>{visible?<EyeOff size={16}/>:<Eye size={16}/>} {visible?'Masquer':'Afficher'}</button><small>Au moins 12 caractères.</small></div><button className="primary" disabled={busy}>{busy?'Confirmation…':'Enregistrer le mot de passe'}</button></form>}
    {stage==='email-action'&&reviewed&&copy&&<>
      <p>{copy.intention}</p>
      <dl style={{display:'grid',gap:16,margin:'24px 0',padding:'16px 0',borderTop:'1px solid var(--line)',borderBottom:'1px solid var(--line)'}}>
        {reviewed.previousEmail&&<div><dt style={{fontSize:13,color:'var(--muted)'}}>Adresse actuelle</dt><dd style={{margin:'6px 0 0',overflowWrap:'anywhere'}}><bdi>{reviewed.previousEmail}</bdi></dd></div>}
        <div><dt style={{fontSize:13,color:'var(--muted)'}}>{copy.destination}</dt><dd style={{margin:'6px 0 0',overflowWrap:'anywhere'}}><bdi>{reviewed.email}</bdi></dd></div>
      </dl>
      {pendingWrite&&!busy&&<p role="status">Le fournisseur termine encore la demande. Aucun second envoi ne sera effectué.</p>}
      <button className="primary" disabled={busy||pendingWrite} onClick={()=>void confirmEmail()}>{busy?'Confirmation…':copy.button}</button>
    </>}
    {stage==='uncertain'&&<>
      {pendingWrite&&<p role="status">Le fournisseur termine encore la demande. Aucun second envoi ne sera effectué.</p>}
      <p>Vous pouvez revérifier la validité du lien. Cette vérification ne confirme aucune action.</p>
      <button className="primary" disabled={pendingWrite} onClick={()=>{setError('');setRetry(value=>value+1);}}>Revérifier le lien</button>
    </>}
    {stage==='done'&&<>
      <p role="status">{passwordAction?'La modification est confirmée. Vous pouvez vous reconnecter. Vos projets et vos droits sont conservés.':copy?.complete}</p>
      {action.mode==='recoverEmail'&&<p>Si vous n’aviez pas demandé le changement d’adresse, changez aussi votre mot de passe depuis la connexion.</p>}
      <button className="primary" onClick={back}>Se connecter</button>
    </>}
    {stage!=='done'&&<button className="quiet" disabled={busy} onClick={back}><ArrowLeft size={16}/> Retour à la connexion</button>}
  </div><p className="auth-footer">SRTB · Accès personnel sécurisé</p></main>;
}
