import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { PendingTransfer } from './domain';

export default function TransferRecovery({ uploading, refreshMedia }: { uploading: boolean; refreshMedia: () => Promise<void> }) {
  const [transfers, setTransfers] = useState<PendingTransfer[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const reload = useCallback(async () => { setTransfers(await api.transfers()); setLoaded(true); }, []);
  useEffect(() => {
    if (uploading) return;
    let alive = true;
    void api.transfers().then(rows => { if (alive) { setTransfers(rows); setLoaded(true); } }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { alive = false; };
  }, [uploading]);

  async function run(action: () => Promise<void>) {
    if (busy || uploading) return;
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  return <section className="panel" aria-labelledby="transfers-heading">
    <div className="row"><h2 id="transfers-heading">Mes transferts à terminer</h2><span className="grow" /><button disabled={busy || uploading} onClick={() => void run(reload)}>Actualiser les transferts</button></div>
    <p className="small muted">Après une coupure, un fichier entièrement reçu peut être finalisé sans le renvoyer. Sinon, annulez uniquement le transfert incomplet, puis sélectionnez à nouveau le fichier à partager. Aucun média déjà partagé n’est supprimé.</p>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    {message ? <p className="notice" role="status">{message}</p> : null}
    {!transfers.length ? <p className="small" role="status">{loaded ? 'Aucun transfert en attente pour votre compte.' : uploading ? 'Un partage est en cours…' : 'Vérification des transferts…'}</p> : <ul>
      {transfers.map(transfer => {
        const complete = transfer.received_bytes === transfer.bytes && transfer.received_parts === transfer.expected_parts;
        return <li key={transfer.id}>
          <p><strong>{transfer.name}</strong> · {Math.floor(transfer.received_bytes / transfer.bytes * 100)} % reçus</p>
          <p className="small muted">{new Date(transfer.created_at).toLocaleString('fr-FR')} · {transfer.busy ? 'Une opération est encore en cours. Actualisez dans quelques instants.' : complete ? 'Tous les fragments ont été reçus ; la finalisation doit être confirmée.' : 'Ce fichier n’est pas encore utilisable dans les projets.'}</p>
          <div className="row">
            <button disabled={busy || uploading || transfer.busy || !complete} onClick={() => void run(async () => {
              await api.finishTransfer(transfer.id); await Promise.all([reload(), refreshMedia()]); setMessage('Média finalisé et disponible dans les projets.');
            })}>Finaliser ce média</button>
            <button disabled={busy || uploading || transfer.busy} onClick={() => {
              if (!window.confirm(`Annuler le transfert inachevé « ${transfer.name} » ? Les fragments reçus seront abandonnés. Votre fichier sur l’ordinateur et les médias déjà partagés ne seront pas supprimés.`)) return;
              void run(async () => { await api.cancelTransfer(transfer.id); await reload(); setMessage('Transfert incomplet annulé. Vous pouvez partager à nouveau le fichier.'); });
            }}>Annuler ce transfert</button>
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}
