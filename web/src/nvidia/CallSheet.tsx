// The session's call sheet from Nemotron 3.5 Super (reasoning on): shots, lenses, times inside the real sun windows, people.
import { useState } from 'react';
import { call, sid, useElapsed } from './api.ts';

type Shot = { n: number; name: string; time: string; lens_mm: number; aperture: number; shutter: string; framing: string; people: string; light: string; notes: string };
type Sheet = { title: string; date: string; call_time: string; wrap_time: string; location: string; shots: Shot[]; crew_notes?: string[]; windows: Record<string, string>; model: string };

export function CallSheet({ sessionId }: { sessionId: bigint }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const secs = useElapsed(busy);
  const go = async () => {
    setBusy(true); setError('');
    try { setSheet(await call<Sheet>('/api/set/callsheet', { sessionId: sid(sessionId) })); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  return (
    <section className="nv nv-card" aria-label="Call sheet">
      <header><h3>Call sheet</h3><span className="nv-muted">shots timed to the sun</span></header>
      <button className="nv-btn primary wide" onClick={go} disabled={busy}>{sheet ? 'Write it again' : 'Write the call sheet'}</button>
      {busy && <div className="nv-skel tall"><span className="nv-num">Nemotron is planning, {secs} s</span></div>}
      {sheet && (
        <div className="nv-sheet">
          <p><strong>{sheet.title}</strong></p>
          <p className="nv-muted nv-num">{sheet.date} · call {sheet.call_time} · wrap {sheet.wrap_time} · {sheet.location}</p>
          <table>
            <thead><tr><th>#</th><th>Shot</th><th>Time</th><th>Lens</th><th>Framing and people</th></tr></thead>
            <tbody>
              {sheet.shots.map(s => (
                <tr key={s.n}><td className="nv-num">{s.n}</td><td>{s.name}<br /><span className="nv-muted">{s.light}</span></td><td className="nv-num">{s.time}</td>
                  <td className="nv-num">{s.lens_mm} mm f/{s.aperture}<br />{s.shutter}</td><td>{s.framing}{s.people ? `. ${s.people}` : ''}{s.notes ? <><br /><span className="nv-muted">{s.notes}</span></> : null}</td></tr>
              ))}
            </tbody>
          </table>
          {sheet.crew_notes?.length ? <ul className="nv-muted">{sheet.crew_notes.map(n => <li key={n}>{n}</li>)}</ul> : null}
          <p className="nv-dim nv-num">{Object.values(sheet.windows).join(' · ')}</p>
        </div>
      )}
      {error && <p className="nv-error" role="alert">{error}</p>}
    </section>
  );
}
