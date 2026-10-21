import { Component, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="recovery">
        <h1>L’atelier a rencontré une erreur.</h1>
        <p>
          Vos fichiers locaux n’ont pas été envoyés. Rechargez l’application
          pour reprendre ; les changements de cette session seront perdus.
        </p>
        <button onClick={() => location.reload()}>Recharger l’atelier</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
