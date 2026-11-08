// Similar shots, the shoot-day route and golden-hour reminders: crew HTTP plus the reminder table.
import { useEffect, useRef, useState } from 'react';
import { useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module_bindings/index.ts';
import { compassWord, fmtTime } from './geo.ts';

export interface ShotPose { lat: number; lon: number; heading: number; pitch: number; roll: number; f35: number; alt?: number }
export interface SpotShot { spot: string; file: string; url: string; score: number; pose: ShotPose; credit: string }
export interface Stop {
  order: number; name: string; lat: number; lon: number; heading: number; face: string; f35: number;
  arrive: string; light: string; walk_min: number; credit?: string; url?: string;
}
interface RouteReply { stops: Stop[]; dropped?: { name?: string; reason?: string; url?: string }[]; solver?: string; period?: string; date?: string }

export const shotKey = (s: { spot: string; file: string }) => `${s.spot}/${s.file}`;

/** "Title.jpg by Author, CC BY 4.0, https://..." as title, byline and link. */
export function parseCredit(c: string) {
  const m = c.match(/^(.*) by (.*), ([^,]+), (https:\/\/\S+)$/);
  if (!m) return { title: c, by: '', url: undefined as string | undefined };
  return { title: m[1].replace(/\.(jpe?g|png|tiff?)$/i, ''), by: `${m[2]}, ${m[3]}`, url: m[4] };
}

/** GET JSON; these requests are read-only, so one retry rides out a dropped connection. */
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error(r.status >= 502 ? 'The ShotMatch service is not answering.' : `Request failed (${r.status}).`);
      return (await r.json()) as T;
    } catch (e) {
      if (signal?.aborted || !(e instanceof TypeError) || attempt >= 3) {
        throw e instanceof TypeError ? new Error('Could not reach the ShotMatch service.') : e;
      }
      await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
}

export function SimilarShots({ photoUrl, starred, onStar, onLook, looking }: {
  photoUrl: string; starred: ReadonlySet<string>; onStar: (s: SpotShot) => void; onLook: (s: SpotShot) => void; looking?: string;
}) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState(''); // submitted text; empty means "like my photo"
  const [shots, setShots] = useState<SpotShot[] | null>(null);
  const [err, setErr] = useState('');
  const [tries, setTries] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setShots(null); setErr('');
    const url = query ? `/api/similar?q=${encodeURIComponent(query)}&k=6` : `/api/similar?photo=${encodeURIComponent(photoUrl)}&k=6`;
    getJson<{ results: SpotShot[] }>(url, ac.signal)
      .then(r => setShots(r.results ?? []))
      .catch(e => { if (!ac.signal.aborted) { setErr(e instanceof Error ? e.message : String(e)); setShots([]); } });
    return () => ac.abort();
  }, [photoUrl, query, tries]);

  return (
    <section className="block similar" aria-label="Similar shots">
      <div className="block-head">
        <h2>{query ? `Spot photos for "${query}"` : 'Similar shots at this spot'}</h2>
        {query && <button className="linkish small" onClick={() => { setQ(''); setQuery(''); }}>Like my photo</button>}
      </div>
      <form className="composer" role="search" onSubmit={e => { e.preventDefault(); setQuery(q.trim()); }}>
        <label className="sr-only" htmlFor="similar-q">Search spot photos</label>
        <input id="similar-q" value={q} onChange={e => setQ(e.target.value)} placeholder="bridge at dusk" autoComplete="off" />
        <button className="btn">Search</button>
      </form>
      {err && <p className="error">{err} <button className="btn small" onClick={() => setTries(t => t + 1)}>Try again</button></p>}
      <ul className="shots" aria-busy={shots === null}>
        {shots === null
          ? Array.from({ length: 6 }, (_, i) => <li key={i}><span className="sk shot-sk" /></li>)
          : shots.map(s => {
            const c = parseCredit(s.credit);
            const key = shotKey(s);
            const on = starred.has(key);
            return (
              <li key={key} data-looking={looking === s.url || undefined}>
                <button className="shot-thumb" onClick={() => onLook(s)} aria-label={`Show ${c.title} in 3D, facing ${compassWord(s.pose.heading)}, ${Math.round(s.pose.f35)} mm`}>
                  <img src={s.url} alt="" loading="lazy" />
                  <span className="mono">{Math.round(s.pose.f35)} mm {compassWord(s.pose.heading)}</span>
                </button>
                <button className="star" aria-pressed={on} onClick={() => onStar(s)} aria-label={on ? `Remove ${c.title} from the route` : `Add ${c.title} to the route`}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
                </button>
                <p className="credit" title={s.credit}>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.by || c.title}</a> : c.by || c.title}</p>
              </li>
            );
          })}
      </ul>
      {shots?.length === 0 && !err && <p className="muted small">No spot photos matched.</p>}
      <p className="muted small">Wikimedia Commons photos from the spot model, placed by their registered camera pose. Star the ones you want on the shoot-day route.</p>
    </section>
  );
}

export function RoutePanel({ sessionId, starred, ownThumb, onStops, onStop, onOverview }: {
  sessionId: bigint; starred: readonly string[]; ownThumb: string; onStops: (s: Stop[]) => void; onStop: (s: Stop) => void; onOverview: () => void;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [reply, setReply] = useState<RouteReply | null>(null);
  const [err, setErr] = useState('');
  const [secs, setSecs] = useState(0);
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);
  useEffect(() => {
    if (state !== 'busy') return;
    const t0 = Date.now();
    const t = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(t);
  }, [state]);

  const plan = async () => {
    ac.current?.abort();
    const c = new AbortController();
    ac.current = c;
    setState('busy'); setErr(''); setSecs(0);
    const timer = setTimeout(() => c.abort(), 90_000);
    try {
      const shots = starred.length ? `&shots=${encodeURIComponent(starred.join(','))}` : '';
      const r = await getJson<RouteReply>(`/api/route?session=${sessionId}${shots}`, c.signal);
      setReply(r); setState('done'); onStops(r.stops ?? []);
    } catch (e) {
      if (c.signal.aborted && ac.current !== c) return;
      setErr(c.signal.aborted ? 'The route took longer than 90 seconds. Try again.' : e instanceof Error ? e.message : String(e));
      setState('error');
    } finally { clearTimeout(timer); }
  };

  return (
    <section className="block route" aria-label="Shoot-day route">
      <div className="block-head">
        <h2>Shoot-day route</h2>
        {reply?.date && <span className="mono muted small">{reply.period} {reply.date}</span>}
      </div>
      <p className="small">{starred.length ? `Your mark plus ${starred.length} starred ${starred.length === 1 ? 'shot' : 'shots'}, in the order that keeps the light.` : 'Your mark plus the best nearby shots, in the order that keeps the light. Star similar shots to choose them.'}</p>
      <div className="row-actions">
        <button className="btn primary" onClick={plan} disabled={state === 'busy'} aria-describedby="route-status">
          {state === 'busy' ? 'Planning the route' : reply ? 'Plan again' : 'Plan the route'}
        </button>
        {reply && state !== 'busy' && <button className="btn" onClick={onOverview}>See it in 3D</button>}
      </div>
      <p id="route-status" className="mono muted small" aria-live="polite">
        {state === 'busy' ? `Walking times and light windows go to cuOpt. ${secs} s` : ''}
      </p>
      {state === 'busy' && <ol className="timeline" aria-hidden="true">{[0, 1, 2].map(i => <li key={i}><span className="sk sk-stop" /></li>)}</ol>}
      {state === 'error' && <p className="error" role="alert">{err}</p>}
      {state !== 'busy' && reply && (
        <>
          <ol className="timeline">
            {reply.stops.map((s, i) => {
              const c = s.credit ? parseCredit(s.credit) : null;
              return (
                <li key={`${s.order}-${s.name}`}>
                  <span className="stop-n mono" aria-hidden="true">{i + 1}</span>
                  <button className="stop" onClick={() => onStop(s)} aria-label={`Stop ${i + 1}: show in 3D`}>
                    <img src={s.url ?? ownThumb} alt="" />
                    <span className="stop-body">
                      <span className="stop-time mono">{s.arrive}</span>
                      <span className="stop-what">{s.url ? (c?.title ?? s.name) : 'Your shot'}</span>
                      <span className="stop-facts mono">Face {s.face} {Math.round(s.heading)}°, {Math.round(s.f35)} mm</span>
                      <span className="stop-light">{s.light}</span>
                    </span>
                  </button>
                  {i < reply.stops.length - 1 && <p className="walk mono">{reply.stops[i + 1].walk_min} min walk</p>}
                </li>
              );
            })}
          </ol>
          {!!reply.dropped?.length && (
            <p className="muted small">Left out: {reply.dropped.map(d => [d.name, d.reason].filter(Boolean).join(', ')).join('; ')}.</p>
          )}
          <p className="muted small solver">Route ordered by NVIDIA cuOpt. Photos from Wikimedia Commons, credited on each stop's page.</p>
        </>
      )}
    </section>
  );
}

/** Schedules a database reminder 30 minutes before a light window; one per shoot. */
export function Reminder({ sessionId, start, zone, text }: { sessionId: bigint; start: Date; zone: string; text: string }) {
  const [rows] = useTable(tables.reminder.where(r => r.sessionId.eq(sessionId)));
  const schedule = useReducer(reducers.scheduleReminder);
  const cancel = useReducer(reducers.cancelReminder);
  const [err, setErr] = useState('');
  const row = rows[0];
  const at = row && row.scheduledAt.tag === 'Time' ? row.scheduledAt.value.toDate() : undefined;
  if (at) {
    return (
      <span className="remind set">
        <span>Reminder {fmtTime(at, zone, true)}</span>
        <button className="btn small" onClick={() => cancel({ sessionId }).catch(e => setErr(String(e?.message ?? e)))}>Cancel</button>
        {err && <span className="error">{err}</span>}
      </span>
    );
  }
  const when = Math.max(start.getTime() - 30 * 60_000, Date.now() + 60_000);
  if (when >= start.getTime()) return null; // already under way
  return (
    <span className="remind">
      <button className="btn small" onClick={() => schedule({ sessionId, atMicros: BigInt(when) * 1000n, text }).catch(e => setErr(String(e?.message ?? e)))}>
        Remind me 30 min before
      </button>
      {err && <span className="error">{err}</span>}
    </span>
  );
}
