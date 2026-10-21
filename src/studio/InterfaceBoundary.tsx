import { Component } from 'react';
import type { ReactNode } from 'react';
export default class InterfaceBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){
    if(!this.state.failed)return this.props.children;
    return <main className="auth-screen" role="alert"><p className="eyebrow">SRTB · ESPACE OUTILS</p><h1>L’affichage a été interrompu.</h1><p>Les projets déjà enregistrés restent sur le serveur. Les saisies non enregistrées peuvent être perdues si vous rechargez la page.</p><button className="primary" onClick={()=>window.location.reload()}>Recharger l’espace</button><a href="/">Revenir aux outils</a></main>;
  }
}
