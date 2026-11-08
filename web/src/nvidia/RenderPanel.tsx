// The AI render: the studio's layers (only the user's objects, from the shot camera) go to POST /api/render, where the crew
// composites them over the user's photo and FLUX.1-dev renders it. The result always carries the "AI interpretation" label.
import { useState } from 'react';
import { label, setLastRender, sid, useAgentSteps, useElapsed, type RenderResult } from './api.ts';

export type Layers = { beauty: Blob; depth: Blob; mask: Blob; shadow?: Blob; width: number; height: number; depthNearM: number; depthFarM: number; legend: unknown[] };
type Props = { sessionId: bigint; photoId?: bigint; getLayers: () => Promise<Layers>; settings?: Record<string, unknown>; onSunFix?: (azimuthDeg: number, altitudeDeg: number) => void };

/** POST the layers; mode 'composite' returns the composite alone (no AI), for a quick look or a critique. */
export async function postLayers(l: Layers, f: { sessionId: bigint; photoId: bigint; text?: string; mode?: string; settings?: Record<string, unknown> }): Promise<RenderResult> {
  const fd = new FormData();
  fd.append('beauty', l.beauty, 'beauty.png');
  fd.append('depth', l.depth, 'depth.png');
  fd.append('mask', l.mask, 'mask.png');
  if (l.shadow) fd.append('shadow', l.shadow, 'shadow.png');
  fd.append('legend', JSON.stringify(l.legend));
  for (const [k, v] of Object.entries({ sessionId: sid(f.sessionId), photoId: sid(f.photoId), text: f.text ?? '', mode: f.mode ?? 'depth', settings: JSON.stringify(f.settings ?? {}), depthNearM: l.depthNearM, depthFarM: l.depthFarM }))
    fd.append(k, String(v));
  const r = await fetch('/api/render', { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `render HTTP ${r.status}`);
  return j;
}

export function RenderPanel({ sessionId, photoId, getLayers, settings, onSunFix }: Props) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'depth' | 'canny'>('depth');
  const [busy, setBusy] = useState('');
  const [out, setOut] = useState<RenderResult | null>(null);
  const [showComposite, setShowComposite] = useState(false);
  const [error, setError] = useState('');
  const secs = useElapsed(!!busy);
  const id = out?.url.match(/\/preview\/([a-z0-9]+)\.jpg/)?.[1];
  const check = useAgentSteps(sessionId).filter(s => s.tool === 'physical_check' && id && s.args.includes(id.slice(0, 16))).pop();

  const go = async () => {
    if (photoId === undefined) { setError('This session has no photo to render over yet.'); return; }
    setError(''); setOut(null); setShowComposite(false);
    try {
      setBusy('Rendering your objects');
      const l = await getLayers();
      setBusy('Compositing, harmonizing, then Nemotron checks the physics');
      const r = await postLayers(l, { sessionId, photoId, text, mode, settings });
      setOut(r); setLastRender(r);
    } catch (e) { setError((e as Error).message); }
    setBusy('');
  };

  return (
    <section className="nv nv-card" aria-label="AI render">
      <header><h3>AI render</h3><span className="nv-muted">composite, harmonize, Nemotron check</span></header>
      <input className="nv-input" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.stopPropagation()} placeholder="Anything to add: light rain, film grain" aria-label="Render instruction" />
      <div className="nv-row">
        <select className="nv-input" value={mode} onChange={e => setMode(e.target.value as 'depth' | 'canny')} aria-label="Conditioning">
          <option value="depth">Depth (keeps distances)</option>
          <option value="canny">Canny (keeps edges)</option>
        </select>
        <button className="nv-btn primary" onClick={go} disabled={!!busy}>Render</button>
      </div>
      {busy && <div className="nv-skel tall"><span className="nv-num">{busy}, {secs} s</span></div>}
      {out && (
        <figure className="nv-render">
          <div className="nv-render-img">
            <img src={showComposite ? out.compositeUrl : out.url} alt={showComposite ? 'Your objects composited over your photo' : 'AI render of the shot'} />
            {!showComposite && <span className="nv-badge">{out.label}</span>}
          </div>
          <figcaption>
            <div className="nv-row nv-small">
              <button className="nv-btn" onClick={() => setShowComposite(v => !v)}>{showComposite ? 'Show the render' : 'Show the composite'}</button>
              <a className="nv-btn" href={out.url} download>Download</a>
            </div>
            <p className="nv-muted nv-num">{out.model} · {(out.ms / 1000).toFixed(1)} s</p>
            {out.fallback && <p className="nv-warn">{out.fallback}. The fallback above made this one.</p>}
            {out.checks.map(c => (
              <div key={c.round} className="nv-check">
                <p className={c.pass ? 'nv-ok' : 'nv-warn'}>Nemotron check {c.round}: {c.pass ? 'pass' : 'needs work'}. {c.summary}</p>
                <ul className="nv-muted">{c.objects.filter(o => !(o.light && o.shadow && o.scale && o.color)).slice(0, 4).map((o, i) => (
                  <li key={i}>{o.name}: {[!o.light && 'light', !o.shadow && 'shadow', !o.scale && 'scale', !o.color && 'colour'].filter(Boolean).join(', ')} off. {o.note}</li>))}</ul>
              </div>
            ))}
            {out.rerendered && <p className="nv-muted nv-num">Re-rendered once at strength {out.strength.toFixed(2)} after the first check.</p>}
            {out.sunFix && (
              <p className="nv-warn">Sun fix: azimuth {out.sunFix.azimuth} deg, altitude {out.sunFix.altitude} deg. {out.sunFix.why}
                {onSunFix && <> <button className="nv-btn" onClick={() => onSunFix(out.sunFix!.azimuth, out.sunFix!.altitude)}>Set the sun</button></>}</p>
            )}
            {check && <p className={/IMPLAUSIBLE/i.test(check.result) ? 'nv-warn' : 'nv-muted'}>{label(check.tool)}: {check.result}</p>}
          </figcaption>
        </figure>
      )}
      {error && <p className="nv-error" role="alert">{error}</p>}
    </section>
  );
}
