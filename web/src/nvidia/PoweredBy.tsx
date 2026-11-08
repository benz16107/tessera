// "Powered by NVIDIA": every NVIDIA model ShotMatch calls, what it does here, and its measured latency (GET /api/nvidia/models).
import { useEffect, useState } from 'react';
import { call } from './api.ts';

type Entry = { model: string; family: string; where: string; does: string[] };
type Use = { model: string; provider: string; roles: string[]; calls: number; errors: number; medianMs: number | null; lastMs: number | null; lastError?: string };

const sameModel = (a: string, b: string) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
const ms = (x: number | null) => (x === null ? '' : x < 1000 ? `${x} ms` : `${(x / 1000).toFixed(1)} s`);

export function PoweredBy() {
  const [data, setData] = useState<{ models: Entry[]; usage: Use[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => call<{ models: Entry[]; usage: Use[] }>('/api/nvidia/models').then(d => live && setData(d)).catch(e => live && setError(e.message));
    void load();
    const i = setInterval(load, 15_000);
    return () => { live = false; clearInterval(i); };
  }, []);

  return (
    <section className="nv nv-card" aria-label="Powered by NVIDIA">
      <header><h3>Powered by NVIDIA</h3><span className="nv-muted">median latency, live</span></header>
      {!data && !error && <div className="nv-skel tall" aria-hidden="true" />}
      {error && <p className="nv-error">{error}</p>}
      {data && (
        <ul className="nv-models">
          {data.models.map(m => {
            const uses = data.usage.filter(u => sameModel(u.model, m.model));
            const calls = uses.reduce((s, u) => s + u.calls, 0), med = uses.find(u => u.medianMs !== null)?.medianMs ?? null;
            return (
              <li key={m.model}>
                <div className="nv-row"><strong>{m.family}</strong><span className="nv-num nv-muted">{calls ? `${ms(med)} · ${calls} calls` : 'not called yet'}</span></div>
                <p className="nv-muted">{m.does.join('; ')}</p>
                <p className="nv-dim nv-num">{m.model} · {m.where}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
