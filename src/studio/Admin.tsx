import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import type {Member,Role} from './domain';
import {roleLabels} from './domain';
import {HelpBubble} from './GraphicsHelp';
import {MemberDeletion} from './MemberDeletion';
import './member-invitations.css';

const empty:Member={email:'',name:'',role:'designer',active:1};
const emailKey=(email:string)=>email.trim().toLowerCase();
const errorMessage=(error:unknown)=>error instanceof Error?error.message:String(error);

function InvitationStatus({member}:{member:Member}){
  const invitation=member.invitation;
  const date=invitation?.at?new Date(invitation.at):null;
  const dated=!!date&&!Number.isNaN(date.getTime());
  const status=invitation?.status==='requested'?'Envoi demandé':invitation?.status==='failed'?'Envoi non confirmé':invitation?.status==='pending'?'Envoi en cours ou non confirmé':'Aucun envoi enregistré';
  return <dl className="member-access-status">
    <div><dt>Accès</dt><dd>{member.active?'Autorisé':'Suspendu'}</dd></div>
    <div><dt>Invitation</dt><dd className={invitation?.status==='failed'?'invitation-failed':invitation?.status==='pending'?'invitation-pending':undefined}>{status}{dated?<time dateTime={date.toISOString()}> · {date.toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})}</time>:null}{invitation?.message&&invitation.status!=='requested'?<small>{invitation.message}</small>:null}</dd></div>
    <div><dt>Connexion</dt><dd>{member.has_connected===true?'Première connexion effectuée':member.has_connected===false?'Première connexion à effectuer':'Première connexion non renseignée'}</dd></div>
  </dl>;
}

export default function Admin({member}:{member:Member}){
  const [members,setMembers]=useState<Member[]>([]),[form,setForm]=useState<Member>(empty),[activity,setActivity]=useState<Awaited<ReturnType<typeof api.activity>>>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[messageWarning,setMessageWarning]=useState(false);
  const [deleting,setDeleting]=useState<Member|null>(null),[pendingDeletion,setPendingDeletion]=useState('');
  const [inviting,setInviting]=useState<string[]>([]);
  const invitationLocks=useRef(new Set<string>());
  const nameInput=useRef<HTMLInputElement>(null);
  const existingMember=members.find(item=>emailKey(item.email)===emailKey(form.email));
  const invitesOnSave=!!form.active&&(!existingMember||!existingMember.active);
  const saveLabel=!form.active?'Enregistrer l’accès suspendu':!existingMember?'Autoriser et inviter':!existingMember.active?'Réautoriser et inviter':'Enregistrer les modifications';

  function edit(target:Member){
    setForm({email:target.email,name:target.name,role:target.role,active:target.active});
    nameInput.current?.focus({preventScroll:true});
    nameInput.current?.scrollIntoView({block:'center',behavior:'instant'});
  }
  async function refresh(){
    const [m,a,d]=await Promise.all([api.members(true),api.activity(),api.deletionStatus()]);
    setMembers(m);setActivity(a);setPendingDeletion(d.job?.email??'');
  }
  useEffect(()=>{void refresh().catch(e=>setError(errorMessage(e)));},[]);

  async function save(){
    if(busy)return;
    setBusy(true);setError('');setMessage('');setMessageWarning(false);
    const saved={email:form.email.trim(),name:form.name.trim(),role:form.role,active:form.active};
    try{
      const result=await api.member(saved);
      setMessage(result.notice);setMessageWarning(!!result.invitation&&result.invitation.status!=='requested');
      setMembers(current=>{
        const previous=current.find(item=>emailKey(item.email)===emailKey(saved.email));
        const updated={...previous,...saved,...(result.invitation?{invitation:result.invitation}:{})};
        return previous?current.map(item=>emailKey(item.email)===emailKey(saved.email)?updated:item):[...current,updated];
      });
      setForm(empty);
      await refresh().catch(()=>setError('L’accès a été enregistré, mais la liste n’a pas pu être actualisée. Rechargez la page pour vérifier les derniers états.'));
    }catch(e){setError(errorMessage(e));}
    finally{setBusy(false);}
  }

  async function invite(target:Member){
    const key=emailKey(target.email);
    if(!target.active||invitationLocks.current.has(key))return;
    invitationLocks.current.add(key);setInviting(current=>[...current,key]);
    setError('');setMessage('');setMessageWarning(false);
    try{
      const result=await api.inviteMember(target.email);
      setMembers(current=>current.map(item=>emailKey(item.email)===key?{...item,invitation:result.invitation}:item));
      setMessage(result.notice);setMessageWarning(result.invitation.status!=='requested');
      await refresh().catch(()=>setError('Le résultat de l’envoi est affiché. La liste n’a pas pu être actualisée ; rechargez la page pour vérifier les derniers états.'));
    }catch(e){setError(`Demande d’envoi non confirmée pour ${target.email}. ${errorMessage(e)}`);}
    finally{invitationLocks.current.delete(key);setInviting(current=>current.filter(email=>email!==key));}
  }

  return <>
    <div className="section-heading"><div><p className="eyebrow">ADMINISTRATION</p><div className="help-title-row"><h1>Équipe & accès</h1><HelpBubble section="admin" role={member.role}/></div><p>Les comptes du studio ne donnent aucun accès à votre compte Cloudflare ou au réseau de diffusion.</p></div></div>
    {error?<div className="notice error" role="alert">{error}</div>:null}
    {message?<div className={`notice${messageWarning?' warning':''}`} role="status">{message}</div>:null}
    {pendingDeletion?<div className="notice error" role="status">Suppression à terminer : {pendingDeletion}. L’équipe peut continuer à travailler.<button onClick={()=>setDeleting(members.find(m=>m.email===pendingDeletion)??{...empty,email:pendingDeletion,name:pendingDeletion})}>Reprendre la suppression</button></div>:null}
    {deleting?<MemberDeletion target={deleting} onClose={()=>{setDeleting(null);void refresh().catch(e=>setError(errorMessage(e)));}} onDone={async()=>{setForm(empty);setMessageWarning(false);setMessage('Compte et contenus supprimés définitivement. Un nouvel accès peut être créé avec cette adresse.');await refresh();}}/>:null}
    <div className="admin-grid member-invitations">
      <form className="panel" onSubmit={e=>{e.preventDefault();void save();}}>
        <h2>{existingMember?'Modifier l’accès':'Ajouter un membre'}</h2>
        <label>Nom<input ref={nameInput} name="member-name" autoComplete="off" required maxLength={100} disabled={busy} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label>Adresse e-mail<input name="member-email" type="email" autoComplete="off" spellCheck={false} required maxLength={254} disabled={busy} value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
        <label>Rôle<select name="member-role" disabled={busy} value={form.role} onChange={e=>setForm({...form,role:e.target.value as Role})}>{Object.entries(roleLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <p className="small muted">Commercial : crée les annonces sans accès à Graphics. Infographiste : prépare et soumet. Diffuseur : valide et prépare les livraisons. Administrateur : gère aussi les membres.</p>
        <label className="check"><input type="checkbox" name="member-active" disabled={busy} checked={!!form.active} onChange={e=>setForm({...form,active:e.target.checked?1:0})}/>Accès autorisé</label>
        <p className="member-invitation-help">{invitesOnSave?'Un e-mail permet de choisir son mot de passe. Le message peut être intitulé « Réinitialiser votre mot de passe ».':form.active?'Les modifications sont enregistrées sans nouvel e-mail. Vous pouvez renvoyer une invitation depuis la liste.':'Aucune invitation n’est envoyée pour un accès suspendu.'}</p>
        <div className="row wrap"><button className="primary" disabled={busy}>{busy?'Enregistrement…':saveLabel}</button><button type="button" disabled={busy} onClick={()=>setForm(empty)}>{existingMember?'Annuler la modification':'Effacer le formulaire'}</button></div>
      </form>
      <div className="panel">
        <h2>Membres des outils SRTB</h2>
        <p className="small muted">Pour suspendre un accès sans effacer les contenus, choisissez Modifier puis décochez « Accès autorisé ».</p>
        <p className="member-invitation-help">« Envoi demandé » confirme la demande au service d’e-mail. La réception dans la messagerie n’est pas vérifiée.</p>
        {members.map(m=>{
          const sending=inviting.includes(emailKey(m.email));
          const own=emailKey(m.email)===emailKey(member.email);
          return <div className="member-row invitation-member" key={m.email}>
            <div className="member-identity"><strong>{m.name}</strong><small>{m.email}</small><span>{roleLabels[m.role]}</span></div>
            <InvitationStatus member={m}/>
            <div className="member-row-actions">
              {m.active?<button className="member-invite-button" disabled={busy||sending||emailKey(pendingDeletion)===emailKey(m.email)} aria-label={`${m.invitation?'Renvoyer':'Envoyer'} l’invitation : ${m.name} (${m.email})`} onClick={()=>void invite(m)}>{sending?'Envoi en cours…':m.invitation?'Renvoyer l’invitation':'Envoyer l’invitation'}</button>:null}
              <button disabled={busy||sending} aria-label={`Modifier : ${m.name} (${m.email})`} onClick={()=>edit(m)}>Modifier</button>
              <button className="danger" disabled={busy||sending||!!pendingDeletion||own} title={own?'Votre propre compte ne peut pas être supprimé.':undefined} aria-label={`Supprimer : ${m.name} (${m.email})`} onClick={()=>setDeleting(m)}>Supprimer…</button>
            </div>
          </div>;
        })}
      </div>
    </div>
    <section className="panel"><h2>Journal des dernières actions</h2><div className="table-scroll"><table><thead><tr><th>Date</th><th>Membre</th><th>Action</th><th>Détail</th></tr></thead><tbody>{activity.map(a=><tr key={a.id}><td>{new Date(a.created_at).toLocaleString('fr-FR')}</td><td>{a.actor}</td><td>{a.action}</td><td>{a.detail}</td></tr>)}</tbody></table></div></section>
  </>;
}
