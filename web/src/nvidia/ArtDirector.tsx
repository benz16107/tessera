// Nemotron 3.5 Super VL as art director: a composition critique of the latest render (or of the plain composite, when
// nothing is rendered yet) with two or three fixes, each one click away as scene edits (POST /api/set/apply).
import { useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings/index.ts';
import { call, sid, useElapsed, useLastRender, type Critique, type Fix } from './api.ts';
import { postLayers, type Layers } from './RenderPanel.tsx';

type Props = { sessionId: bigint; photoId?: bigint; getLayers?: () => Promise<Layers> };

export function ArtDirector({ sessionId, photoId, getLayers }: Props) {
  const last = useLastRender();
  const [jobs] = useTable(tables.previewJob.where(r => r.sessionId.eq(sessionId)));
  const latest = [...jobs].filter(j => j.state === 'done' && j.imageUrl && j.kind === 'render').sort((a, b) => Number(b.id - a.id))[0];
  const image = last?.url ?? latest?.imageUrl;
  const [busy, setBusy] = useState('');
  const [crit, setCrit] = useState<(Critique & { image: string }) | null>(null);
  const [applied, setApplied] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const secs = useElapsed(!!busy);

  const run = async () => {
    setError(''); setCrit(null); setApplied({});
    try {
      let img = image;
      if (!img) {
        if (!getLayers || photoId === undefined) throw new Error('Render the shot first.');
        setBusy('Compositing your objects over the photo');
        img = (await postLayers(await getLayers(), { sessionId, photoId, mode: 'composite' })).compositeUrl;
      }
      setBusy('Nemotron is looking at the frame');
      setCrit({ ...(await call<Critique>('/api/set/critique', { sessionId: sid(sessionId), imageUrl: img })), image: img });
    } catch (e) { setError((e as Error).message); }
    setBusy('');
  };

  const apply = async (i: number, f: Fix) => {
    setApplied(a => ({ ...a, [i]: 'applying' }));
    try {
      const r = await call<{ results: { error?: string }[] }>('/api/set/apply', { sessionId: sid(sessionId), steps: f.steps });
      const bad = r.results.filter(x => x.error);
      setApplied(a => ({ ...a, [i]: bad.length ? `${r.results.length - bad.length} of ${r.results.length} applied: ${bad[0].error}` : 'applied' }));
    } catch (e) { setApplied(a => ({ ...a, [i]: (e as Error).message })); }
  };

  return (
    <section className="nv nv-card" aria-label="Art director">
      <header><h3>Art director</h3><span className="nv-muted">Nemotron Super VL, reasoning on</span></header>
      <p className="nv-muted">{image ? 'Critiques the latest render.' : 'No render yet: critiques your objects over the photo.'}</p>
      <button className="nv-btn primary wide" onClick={run} disabled={!!busy}>Critique the composition</button>
      {busy && <div className="nv-skel tall"><span className="nv-num">{busy}, {secs} s</span></div>}
      {crit && (
        <div className="nv-crit">
          <img src={crit.image} alt="The frame Nemotron critiqued" />
          <p>{crit.summary}</p>
          {crit.strengths.length > 0 && <ul className="nv-muted">{crit.strengths.map(s => <li key={s}>{s}</li>)}</ul>}
          <ol className="nv-fixes">
            {crit.fixes.map((f, i) => (
              <li key={i}>
                <strong>{f.title}</strong>
                <p className="nv-muted">{f.why}</p>
                <button className="nv-btn" onClick={() => apply(i, f)} disabled={!!applied[i] && applied[i] !== 'applying' && !applied[i].includes('of')}>
                  {applied[i] === 'applied' ? 'Applied' : applied[i] === 'applying' ? 'Applying' : 'Apply fix'}
                </button>
                {applied[i] && !['applied', 'applying'].includes(applied[i]) && <p className="nv-warn">{applied[i]}</p>}
              </li>
            ))}
          </ol>
          {!crit.fixes.length && <p className="nv-muted">No fixes came back as scene edits this time.</p>}
        </div>
      )}
      {error && <p className="nv-error" role="alert">{error}</p>}
    </section>
  );
}
