// The "Live data" inspector: a toggleable panel that streams this session's reducer calls (the activity event table)
// and row changes (client cache callbacks) as they happen, plus the scene history scrubber and the shared library.
// Everything shown is what this client's subscriptions receive under row-level security.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, reducers } from '../module_bindings/index.ts';
import type { Activity } from '../module_bindings/types.ts';
import { useConn, usePresence, useSceneHistory } from './hooks.ts';
import './spacetime.css';

type Entry = { n: number; at: number; kind: 'call' | 'insert' | 'update' | 'delete'; table: string; text: string; who?: string };
const MAX = 250;
// Session-scoped tables whose row changes the feed shows, with a one-line label for a row.
const WATCH: Record<string, (r: any) => string> = {
  sceneObject: r => `#${r.id} ${r.name || r.kind}`,
  sceneChange: r => `${r.action} #${r.objectId} by ${r.byName}`,
  camera: r => `heading ${r.pose.heading.toFixed(0)}°, ${r.pose.f35.toFixed(0)} mm`,
  shotSettings: r => `${r.focalMm} mm f/${r.aperture}`,
  person: r => r.label,
  photo: r => `photo ${r.id} (${r.source})`,
  solveJob: r => `solve ${r.id}: ${r.state}, ${r.progress}`,
  solveResult: r => `${r.confidence}, ${r.inliers} matches`,
  previewJob: r => `${r.kind} ${r.id}: ${r.state}`,
  message: r => `${r.channel} ${r.direction}: ${String(r.text).slice(0, 60)}`,
  agentStep: r => `${r.tool} ${r.ms} ms`,
  presence: r => `${r.name} ${r.status}`,
  participant: r => `${r.name} (${r.role}) ${r.online ? 'online' : 'offline'}`,
  sunClock: r => `sun ${r.rate}x`,
  shotVersion: r => `${r.label} at change ${r.sceneChangeId}${r.channel ? ` via ${r.channel}` : ''}`,
  checkin: r => `${r.verdict}, ${r.distanceM.toFixed(1)} m off`,
  channelLink: r => `${r.channel}${r.verified ? ' verified' : ''}`,
  session: r => `"${r.title}"`,
};
const snake = (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);

const fmt = (v: unknown): string => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : typeof v === 'bigint' ? String(v) : typeof v === 'string' ? v.slice(0, 24) : typeof v === 'boolean' ? String(v) : '';
/** "x 1.20 → 1.35, y 2.00 → 2.10" for the primitive fields that changed. */
function diff(a: Record<string, unknown>, b: Record<string, unknown>) {
  const out: string[] = [];
  for (const k of Object.keys(b)) {
    if (k === 'updatedAt' || k === 'at' || k === 'lastSeen') continue;
    const x = a[k], y = b[k];
    if (typeof y === 'object' || x === y) continue;
    out.push(`${k} ${fmt(x)} → ${fmt(y)}`);
  }
  return out.slice(0, 4).join(', ');
}

function useFeed(sessionId: bigint, paused: boolean) {
  const conn = useConn();
  const [entries, setEntries] = useState<Entry[]>([]);
  const n = useRef(0);
  const times = useRef<number[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const push = (e: Omit<Entry, 'n' | 'at'>) => {
    const at = Date.now();
    times.current.push(at);
    if (pausedRef.current) return;
    setEntries(list => [{ ...e, n: ++n.current, at }, ...list].slice(0, MAX));
  };
  // Reducer calls, named by the module itself (clients only learn reducer names for their own calls).
  useTable(tables.activity.where(r => r.sessionId.eq(sessionId)), {
    onInsert: (a: Activity) => push({ kind: 'call', table: a.reducer, text: a.detail, who: a.who }),
  });
  // Row changes from the client cache.
  useEffect(() => {
    if (!conn) return;
    const offs: (() => void)[] = [];
    for (const [name, label] of Object.entries(WATCH)) {
      const tbl = (conn.db as any)[name];
      if (!tbl) continue;
      const mine = (r: any) => (name === 'session' ? r.id : r.sessionId) === sessionId;
      const ins = (_c: unknown, r: any) => mine(r) && push({ kind: 'insert', table: snake(name), text: label(r) });
      const upd = (_c: unknown, a: any, b: any) => mine(b) && push({ kind: 'update', table: snake(name), text: `${label(b)}${diff(a, b) ? `: ${diff(a, b)}` : ''}` });
      const del = (_c: unknown, r: any) => mine(r) && push({ kind: 'delete', table: snake(name), text: label(r) });
      tbl.onInsert(ins); tbl.onUpdate?.(upd); tbl.onDelete(del);
      offs.push(() => { tbl.removeOnInsert(ins); tbl.removeOnUpdate?.(upd); tbl.removeOnDelete(del); });
    }
    return () => offs.forEach(f => f());
  }, [conn, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rate, setRate] = useState(0);
  useEffect(() => {
    const t = setInterval(() => { const now = Date.now(); times.current = times.current.filter(x => now - x < 5000); setRate(times.current.length / 5); }, 1000);
    return () => clearInterval(t);
  }, []);
  return { entries, rate, clear: () => setEntries([]) };
}

function Feed({ sessionId }: { sessionId: bigint }) {
  const [paused, setPaused] = useState(false);
  const [onlyCalls, setOnlyCalls] = useState(false);
  const { entries, rate, clear } = useFeed(sessionId, paused);
  const { rttMs } = usePresence(sessionId);
  const conn = useConn();
  const counts = conn ? (['sceneObject', 'sceneChange', 'participant', 'presence', 'message', 'agentStep'] as const).map(k => [snake(k), Number((conn.db as any)[k].count())] as const) : [];
  const shown = onlyCalls ? entries.filter(e => e.kind === 'call') : entries;
  return (
    <div className="stdb-feed">
      <div className="stdb-stats">
        <span><b>{rate.toFixed(1)}</b> changes/s</span>
        <span><b>{rttMs ?? '…'}</b> ms round trip</span>
        <span title="Rows this client can see. Row-level security limits every session table to its participants.">{counts.map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
      </div>
      <div className="stdb-tools">
        <button className="stdb-seg" aria-pressed={paused} onClick={() => setPaused(p => !p)}>{paused ? 'Resume' : 'Pause'}</button>
        <button className="stdb-seg" aria-pressed={onlyCalls} onClick={() => setOnlyCalls(v => !v)}>Reducer calls only</button>
        <button className="stdb-seg" onClick={clear}>Clear</button>
      </div>
      <ol className="stdb-log" aria-live="off">
        {shown.length === 0 && <li className="stdb-empty">Move something in the set. Every reducer call and row change in this session streams here.</li>}
        {shown.map(e => (
          <li key={e.n} data-kind={e.kind}>
            <time>{new Date(e.at).toLocaleTimeString([], { hour12: false })}</time>
            <span className="stdb-kind">{e.kind === 'call' ? 'call' : e.kind}</span>
            <code>{e.table}</code>
            <span className="stdb-text">{e.who ? <em>{e.who}</em> : null} {e.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HistoryScrubber({ sessionId, onPreview }: { sessionId: bigint; onPreview?: (state: Map<bigint, Record<string, unknown>> | null) => void }) {
  const h = useSceneHistory(sessionId);
  const last = h.changes.at(-1)?.id ?? 0n;
  const [pos, setPos] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const idx = pos ?? h.changes.length;
  const at = idx === 0 ? 0n : h.changes[idx - 1]?.id ?? last;
  const state = useMemo(() => (pos === null ? null : h.at(at)), [pos, at, h.objects, h.changes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onPreview?.(state); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (p: Promise<void>) => p.then(() => { setErr(''); setPos(null); }).catch(e => setErr(String(e?.message ?? e)));
  return (
    <div className="stdb-history">
      <label className="stdb-scrub">
        <span>Time travel the set</span>
        <input type="range" min={0} max={h.changes.length} value={idx} onChange={e => { const v = Number(e.target.value); setPos(v === h.changes.length ? null : v); }} aria-valuetext={`${idx} of ${h.changes.length} changes`} />
        <span className="stdb-mono">{idx}/{h.changes.length}{state ? `, ${state.size} objects then` : ''}</span>
      </label>
      {pos !== null && (
        <div className="stdb-tools">
          <button className="stdb-seg primary" onClick={() => run(h.restoreTo(at))}>Restore the set to here</button>
          <button className="stdb-seg" onClick={() => setPos(null)}>Back to now</button>
        </div>
      )}
      {err && <p className="stdb-err" role="alert">{err}</p>}
      <ol className="stdb-log">
        {[...h.changes].reverse().slice(0, 80).map(c => (
          <li key={String(c.id)} data-kind={c.action}>
            <time>{c.at.toDate().toLocaleTimeString([], { hour12: false })}</time>
            <span className="stdb-kind">{c.action}</span>
            <span className="stdb-text"><em>{c.byName}</em> {(JSON.parse(c.after || c.before || '{}').name as string) || `object ${c.objectId}`}</span>
            <button className="stdb-link" onClick={() => run(h.undo(c.id))} title="Put this object back the way it was before this change">Undo</button>
          </li>
        ))}
      </ol>
    </div>
  );
}

const ROUTE = 'https://maincloud.spacetimedb.com/v1/database/shotmatch/route';

export function SharedLibrary({ sessionId }: { sessionId: bigint }) {
  const [props] = useTable(tables.propLibrary);
  const [shots] = useTable(tables.shotLibrary);
  const [live] = useTable(tables.liveSessions);
  const [previews] = useTable(tables.previewJob.where(r => r.sessionId.eq(sessionId)));
  const add = useReducer(reducers.addSceneObject);
  const share = useReducer(reducers.shareShot);
  const [msg, setMsg] = useState('');
  const done = previews.filter(p => p.state === 'done' && p.imageUrl);
  const mineShared = new Set(shots.filter(s => s.sessionId === sessionId).map(s => s.imageUrl));
  const place = (url: string, name: string) => add({
    sessionId, kind: 'prop_generated', assetId: url, name, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, scale: 1,
    color: '', intensity: 0, lightType: '', params: '', visible: true,
  }).then(() => setMsg(`${name} added at the spot's centre`)).catch(e => setMsg(String(e?.message ?? e)));
  return (
    <div className="stdb-library">
      <h4>Props from every session <small>shotmatch-library, through an outbox</small></h4>
      {props.length === 0 ? <p className="stdb-empty">Generate a prop and it lands here for every session.</p> : (
        <ul className="stdb-list">{props.map(p => (
          <li key={p.assetUrl}><span title={p.prompt}>{p.name}</span><button className="stdb-link" onClick={() => place(p.assetUrl, p.name)}>Add to set</button></li>
        ))}</ul>
      )}
      <h4>Share a finished shot</h4>
      {done.length === 0 ? <p className="stdb-empty">Finish a preview or render first.</p> : (
        <ul className="stdb-list">{done.map(p => (
          <li key={String(p.id)}><span>{p.kind} {String(p.id)}</span>
            {[...mineShared].some(u => u.endsWith(p.imageUrl)) ? <span className="stdb-mono">shared</span>
              : <button className="stdb-link" onClick={() => share({ sessionId, previewJobId: p.id }).then(() => setMsg('Sent to the library')).catch(e => setMsg(String(e?.message ?? e)))}>Share</button>}
          </li>
        ))}</ul>
      )}
      {shots.length > 0 && (
        <ul className="stdb-list">{shots.slice(-6).reverse().map(s => (
          <li key={s.shareCode}><span>{s.title}</span><a className="stdb-link" href={`${ROUTE}/shot?code=${s.shareCode}`} target="_blank" rel="noreferrer">{s.shareCode}</a></li>
        ))}</ul>
      )}
      <h4>Live now <small>anonymous view</small></h4>
      <p className="stdb-mono">{live.length ? live.map(l => `${l.spotId || 'no spot'}: ${l.online} online, ${l.objects} objects`).join(' · ') : 'Nobody else is online.'}</p>
      {msg && <p className="stdb-note" role="status">{msg}</p>}
    </div>
  );
}

export type Tab = 'live' | 'history' | 'library';
/**
 * Toggleable panel. `defaultOpen` mounts it open inside a host's own drawer; there it shows only the Feed, since the
 * host mounts HistoryScrubber and SharedLibrary itself. Pass `tabs` to choose explicitly.
 */
export function LiveInspector({ sessionId, defaultOpen = false, tabs }: { sessionId: bigint; myName?: string; defaultOpen?: boolean; tabs?: Tab[] }) {
  const { isActive } = useSpacetimeDB();
  const [open, setOpen] = useState(defaultOpen);
  const shown = tabs ?? (defaultOpen ? ['live'] : ['live', 'history', 'library']);
  const [tab, setTab] = useState<Tab>(shown[0] ?? 'live');
  return (
    <section className="stdb-inspector" data-open={open}>
      {/* Mounted open inside a host's own drawer (defaultOpen), the panel needs no toggle of its own. */}
      {defaultOpen ? <p className="stdb-mono"><span className="stdb-live" data-on={isActive} aria-hidden="true" /> {isActive ? 'connected to Maincloud' : 'reconnecting'}</p> : (
        <button className="stdb-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          <span className="stdb-live" data-on={isActive} aria-hidden="true" /> Live data {open ? 'hide' : ''}
        </button>
      )}
      {open && (
        <div className="stdb-body">
          <p className="stdb-sub">SpacetimeDB is the server: these are this session's reducer calls and row changes as they arrive over one websocket.</p>
          {shown.length > 1 && <div className="stdb-tabs" role="tablist">
            {shown.map(t => (
              <button key={t} role="tab" aria-selected={tab === t} className="stdb-seg" onClick={() => setTab(t)}>{t === 'live' ? 'Feed' : t === 'history' ? 'History' : 'Library'}</button>
            ))}
          </div>}
          {tab === 'live' && <Feed sessionId={sessionId} />}
          {tab === 'history' && <HistoryScrubber sessionId={sessionId} />}
          {tab === 'library' && <SharedLibrary sessionId={sessionId} />}
        </div>
      )}
    </section>
  );
}
