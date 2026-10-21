import { lazy, Suspense, useEffect } from 'react';
import { ArrowUpRight, ArrowLeft, LockKeyhole } from 'lucide-react';
import { roleLabels } from './domain';
import {useSession} from './useSession';
import { studioTools, toolForPath } from './tools';
import LogoutButton from './LogoutButton';
import ThemeToggle from './ThemeToggle';
import SessionBoundary from './SessionBoundary';

const Graphics = lazy(() => import('./Studio'));
const Commercial = lazy(() => import('./commercial/Commercial'));
const Login = lazy(() => import('./Login'));
const AccountRecovery = lazy(() => import('./AccountRecovery'));
const nativeFrame = '/library/v1.7.0/BTV_BA_TDS/lib/frames/frame_0070.png';

export default function Suite() {
  if(window.location.pathname==='/auth/action')return <Suspense fallback={<p role="status">Ouverture du lien sécurisé…</p>}><AccountRecovery actionLink/></Suspense>;
  return <AuthenticatedSuite/>;
}
function AuthenticatedSuite() {
  const {member,error,signedOut,reason,suspended,checking,retry}=useSession();
  const path = window.location.pathname;
  const tool = toolForPath(path==='/login'?'/graphics':path);
  const localQualification = !!import.meta.env.VITE_STUDIO_QUALIFICATION;
  useEffect(() => { document.title = member?.role==='commercial'?'SRTB Annonces':tool ? `${tool.title} · SRTB` : 'SRTB · Espace outils'; }, [tool,member?.role]);

  if (!member && signedOut && !localQualification) return <Suspense fallback={<p className="empty" role="status">Ouverture de la connexion…</p>}><Login serviceMessage={reason==='logout'?'Vous êtes déconnecté.':'Votre session a expiré ou a été fermée. Reconnectez-vous pour continuer.'} onConnected={() => { /* sessionState.open already requests fresh server proof; no second navigation. */ }} /></Suspense>;

  if (!member) return <main className="auth-screen">
    <div className="auth-masthead"><span className="suite-wordmark">SRTB</span><span>Espace outils</span><ThemeToggle /></div>
    <div className="auth-content">
      <LockKeyhole size={28} strokeWidth={1.4} aria-hidden="true" />
      <p className="eyebrow">Votre espace de travail</p>
      <h1>{error ? 'Retrouvons votre accès.' : 'Ouverture de votre espace…'}</h1>
      <p role={error ? 'alert' : 'status'}>{error?.message || 'Vérification de votre accès personnel.'}</p>
      {error ? <><div className="row wrap"><button className="primary" onClick={() => window.location.reload()}>Réessayer <ArrowUpRight size={17} /></button></div><p className="small muted">Les projets et médias sont réservés aux membres autorisés.</p></> : null}
    </div>
    <p className="auth-footer">Société de Radio et de Télévision du Bénin</p>
  </main>;

  if (member.role === 'commercial' || tool?.id === 'commercial') {
    if (member.role !== 'commercial' && member.role !== 'admin') return <main className="auth-screen"><div className="auth-content"><h1>Accès réservé</h1><p>Les annonces sont réservées au service commercial et aux administrateurs.</p><a className="button-link" href="/">Tous les outils</a></div></main>;
    return <SessionBoundary suspended={suspended} error={error?.message} checking={checking} onRetry={retry}><Suspense fallback={<p className="empty" role="status">Ouverture des annonces…</p>}><Commercial member={member}/></Suspense></SessionBoundary>;
  }
  if (tool?.id === 'graphics') return <SessionBoundary suspended={suspended} error={error?.message} checking={checking} onRetry={retry}><Suspense fallback={<p className="empty" role="status">Ouverture de Graphics…</p>}><Graphics member={member} /></Suspense></SessionBoundary>;
  if (tool || !['/', '/studio.html', '/index.html'].includes(path)) return <main className="auth-screen">
    <div className="auth-masthead"><a className="suite-wordmark" href="/">SRTB</a><span>Espace outils</span><ThemeToggle /></div>
    <div className="auth-content"><p className="eyebrow">{tool ? 'À venir' : 'Adresse inconnue'}</p><h1>{tool ? tool.title : 'Page introuvable'}</h1><p>{tool ? 'Cet outil est prévu. Son espace et ses fonctionnalités sont encore à construire.' : 'Cette adresse ne correspond à aucun outil disponible.'}</p><a className="button-link primary" href="/"><ArrowLeft size={18} /> Tous les outils</a></div>
  </main>;

  const graphics = studioTools.find(item => item.id === 'graphics')!;
  const planned = studioTools.filter(item => item.status === 'planned');
  return <SessionBoundary suspended={suspended} error={error?.message} checking={checking} onRetry={retry}><div className="suite-page">
    <a className="skip-link" href="#tools-main">Aller aux outils</a>
    <header className="suite-header">
      <a className="suite-brand" href="/" aria-label="SRTB — tous les outils"><span className="suite-wordmark">SRTB</span><span className="suite-brand-description">Société de Radio et de<br />Télévision du Bénin</span></a>
      <div className="suite-account"><div><strong>{member.name}</strong><small>{roleLabels[member.role]}</small></div><div className="account-actions"><ThemeToggle /><LogoutButton /></div></div>
    </header>
    <main id="tools-main" className="suite-main">
      <div className="suite-intro"><div><p className="eyebrow">Espace de travail</p><h1>Les outils SRTB.</h1></div><p>Un point d’entrée pour les équipes.<br />À chaque métier, son espace de création.</p></div>
      <section className="tool-directory" aria-label="Outils SRTB">
        <article className="tool-feature">
          <div className="tool-feature-copy">
            <div className="tool-category"><span>Habillage BTV</span><span className={`tool-state ${graphics.status}`}>{graphics.status === 'available' ? 'Disponible' : 'En qualification'}</span></div>
            <h2>Graphics<span aria-hidden="true">.</span></h2>
            <p>De la première composition<br />à la version validée.</p>
            <span className="tool-description">Les habillages de la chaîne, vos médias et les projets de l’équipe dans un même espace.</span>
            <a className="button-link primary" href={graphics.path}>Ouvrir Graphics <ArrowUpRight size={20} /></a>
          </div>
          <figure className="tool-feature-visual">
            <div className="native-frame"><img src={nativeFrame} width="1920" height="1080" alt="Image native de l’habillage BÉNIN TV Tout de suite" /></div>
            <figcaption><span>Tout de suite</span><span>Image native · bibliothèque BTV 1.7.0</span></figcaption>
          </figure>
          <ul className="tool-feature-details"><li><strong>Bibliothèque évolutive</strong><span>Habillages BTV qualifiés</span></li><li><strong>Projets partagés</strong><span>Révisions conservées</span></li><li><strong>Validation éditoriale</strong><span>Préparation hors antenne</span></li></ul>
        </article>
        {member.role==='admin'?<article className="tool-planned-entry"><span className="tool-planned-label">Service commercial</span><div><h2>SRTB Annonces</h2><p>Communiqués, voix off, musique et logos des annonceurs.</p></div><a className="button-link primary" href="/commercial">Ouvrir Annonces <ArrowUpRight size={18}/></a></article>:null}
        {planned.map(item => <article className="tool-planned-entry" key={item.id}><span className="tool-planned-label">Prochain outil</span><div><h2>{item.title}</h2><p>{item.description}</p></div><span className="tool-state planned">À venir</span></article>)}
      </section>
      <div className="suite-status"><span className="status-label">{localQualification?'Banc de test':'Espace équipe'}</span><p>{localQualification ? 'Banc local : utilisez uniquement des données de test. Aucun média n’est envoyé dans le cloud ; les données sont effacées au redémarrage du banc.' : 'Les projets sont partagés avec les membres autorisés. Les médias restent sur votre poste, sauf si vous choisissez explicitement de les partager. Aucun ordre n’est envoyé à l’antenne.'}</p></div>
    </main>
    <footer className="suite-footer"><span>SRTB · Espace réservé aux équipes</span><span>Les outils évoluent. Les projets gardent leur espace.</span></footer>
  </div></SessionBoundary>;
}
