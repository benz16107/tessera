// SpacetimeDB hooks for the set: session lookup by code, presence, ephemeral set events, the live sun clock and scene
// history. Every value here is a subscription to the shotmatch module; nothing goes through the crew server.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import type { Identity } from 'spacetimedb';
import { tables, reducers, type DbConnection } from '../module_bindings/index.ts';
import type { SceneChange, SceneObject, SessionCardRow, SetEvent } from '../module_bindings/types.ts';

/** The live connection, typed with this module's bindings. */
export function useConn(): DbConnection | null {
  const { getConnection, isActive } = useSpacetimeDB();
  return isActive ? (getConnection() as unknown as DbConnection | null) : null;
}

/**
 * The public card for a session code (title, spot, people online), from the session_card(code) view. Session rows are
 * visible only to participants, so a page that opens /p/<code> uses this to show "Join <title>" before joining.
 */
export function useSessionCard(code: string): [SessionCardRow | undefined, boolean] {
  const conn = useConn();
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const [card, setCard] = useState<SessionCardRow>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setCard(undefined);
    setReady(!clean); // a code with no letters or digits can't match: not found, not loading
    if (!conn || !clean) return;
    // A view row without a primary key changes as delete + insert (here whenever the online count moves), so a delete
    // alone keeps the last card instead of flashing "no such shoot".
    const read = () => { const c = [...conn.db.sessionCard.iter()].find(x => x.code === clean); if (c) setCard(c); };
    conn.db.sessionCard.onInsert(read);
    conn.db.sessionCard.onDelete(read);
    // TypeScript query builders don't take view arguments yet, so this one subscription is SQL.
    const h = conn.subscriptionBuilder().onApplied(() => { read(); setReady(true); }).subscribe(`SELECT * FROM session_card('${clean}')`);
    return () => {
      conn.db.sessionCard.removeOnInsert(read);
      conn.db.sessionCard.removeOnDelete(read);
      try { h.unsubscribe(); } catch { /* already closed */ }
    };
  }, [conn, clean]);
  return [card, ready];
}

/**
 * Presence rows for the session plus a heartbeat every 10 s while this tab is visible (hidden tabs go idle).
 * `focusObjectId` is what this person has selected; leave it undefined to keep whatever their row already says.
 * `rttMs` is the measured round trip of the last heartbeat (reducer call to commit acknowledgement).
 */
export function usePresence(sessionId: bigint, focusObjectId?: bigint | null) {
  const { identity } = useSpacetimeDB();
  const [rows] = useTable(tables.presence.where(r => r.sessionId.eq(sessionId)));
  const beat = useReducer(reducers.heartbeat);
  const [rttMs, setRtt] = useState<number | null>(null);
  const mine = identity ? rows.find(r => r.identity.isEqual(identity))?.focusObjectId : undefined;
  const focus = focusObjectId === undefined ? (mine ?? 0n) : (focusObjectId ?? 0n);
  useEffect(() => {
    const go = () => {
      if (document.visibilityState !== 'visible') return;
      const t0 = performance.now();
      beat({ sessionId, focusObjectId: focus }).then(() => setRtt(Math.round(performance.now() - t0))).catch(() => {});
    };
    go();
    const t = setInterval(go, 10_000);
    document.addEventListener('visibilitychange', go);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', go); };
  }, [beat, sessionId, focus]);
  return { people: rows, rttMs };
}

export type Point = { x: number; y: number; z: number };
export type Cursor = Point & { name: string; color: string; at: number };
export type Ping = Point & { name: string; color: string; objectId: bigint; at: number; key: number };
export type View = { eye: Point; target: Point; name: string; at: number };

/**
 * Ephemeral collaboration in the 3D set: cursors, laser-pointer pings, camera views and follow requests. Rows come
 * through the set_event event table: each reaches the session's members once and is never stored.
 *
 * The studio draws `cursors` and `pings` in the scene, calls `cursor()` on pointer move over the ground (throttled to
 * 10 Hz here), `ping()` on a click with the laser tool, and `view()` from its camera while someone follows it.
 * `following` is whom this client follows; apply `views.get(following)` to the camera each frame.
 */
export function useSetEvents(sessionId: bigint, me?: Identity) {
  const send = useReducer(reducers.sendSetEvent);
  const [cursors, setCursors] = useState<Map<string, Cursor>>(new Map());
  const [pings, setPings] = useState<Ping[]>([]);
  const [views, setViews] = useState<Map<string, View>>(new Map());
  const [followers, setFollowers] = useState<Set<string>>(new Set());
  const [following, setFollowing] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ from: string; name: string } | null>(null);
  const meHex = me?.toHexString();
  const key = useRef(0);

  const onInsert = useCallback((e: SetEvent) => {
    const from = e.from.toHexString();
    const mine = from === meHex;
    const at = Date.now();
    if (e.kind === 'cursor' && !mine) setCursors(m => new Map(m).set(from, { x: e.x, y: e.y, z: e.z, name: e.name, color: e.color, at }));
    else if (e.kind === 'ping') setPings(p => [...p.filter(x => at - x.at < 4000), { x: e.x, y: e.y, z: e.z, name: e.name, color: e.color, objectId: e.objectId, at, key: ++key.current }]);
    else if (e.kind === 'view' && !mine) setViews(m => new Map(m).set(from, { eye: { x: e.x, y: e.y, z: e.z }, target: { x: e.tx, y: e.ty, z: e.tz }, name: e.name, at }));
    else if (e.kind === 'follow' && !mine) {
      if (e.target && e.target.toHexString() === meHex) setFollowers(s => new Set(s).add(from)); // someone follows me
      else if (!e.target) setInvite({ from, name: e.name });                                    // "follow me"
    } else if (e.kind === 'unfollow' && !mine) setFollowers(s => { const n = new Set(s); n.delete(from); return n; });
  }, [meHex]);
  useTable(tables.setEvent.where(r => r.sessionId.eq(sessionId)), { onInsert });

  // Cursors fade after 3 s without a move; pings after 4 s.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setCursors(m => (([...m.values()].some(c => now - c.at > 3000)) ? new Map([...m].filter(([, c]) => now - c.at <= 3000)) : m));
      setPings(p => (p.some(x => now - x.at > 4000) ? p.filter(x => now - x.at <= 4000) : p));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const zero = { tx: 0, ty: 0, tz: 0, objectId: 0n, target: undefined };
  const lastCursor = useRef(0);
  const api = useMemo(() => ({
    cursor(p: Point) {
      const now = performance.now();
      if (now - lastCursor.current < 100) return;
      lastCursor.current = now;
      send({ sessionId, kind: 'cursor', ...p, ...zero }).catch(() => {});
    },
    ping(p: Point, objectId = 0n) { return send({ sessionId, kind: 'ping', ...p, ...zero, objectId }); },
    view(eye: Point, target: Point) { return send({ sessionId, kind: 'view', ...eye, tx: target.x, ty: target.y, tz: target.z, objectId: 0n, target: undefined }); },
    follow(target: Identity | null) {
      setFollowing(target ? target.toHexString() : null);
      return send({ sessionId, kind: 'follow', x: 0, y: 0, z: 0, ...zero, target: target ?? undefined });
    },
    unfollow(target: Identity) { setFollowing(null); return send({ sessionId, kind: 'unfollow', x: 0, y: 0, z: 0, ...zero, target }); },
    acceptInvite() { if (invite) setFollowing(invite.from); setInvite(null); },
    dismissInvite() { setInvite(null); },
  }), [send, sessionId, invite]); // eslint-disable-line react-hooks/exhaustive-deps

  return { cursors, pings, views, followers, following, invite, ...api };
}

/** The live sun schedule for the session: rate 0 off, 1 follows the real clock, 60 or 600 time-lapse. */
export function useSunClock(sessionId: bigint) {
  const [rows] = useTable(tables.sunClock.where(r => r.sessionId.eq(sessionId)));
  const set = useReducer(reducers.setSunClock);
  return { rate: rows[0]?.rate ?? 0, startedBy: rows[0]?.startedBy ?? '', setRate: (rate: number) => set({ sessionId, rate }) };
}

type Snap = Record<string, unknown>;
/**
 * The set as it was right after change `changeId`, rebuilt on the client from the live objects and the history
 * (each object touched later goes back to the `before` of its earliest later change). Use it to draw a ghost while
 * scrubbing; restoreSceneTo makes it real.
 */
export function sceneAt(objects: readonly SceneObject[], changes: readonly SceneChange[], changeId: bigint): Map<bigint, Snap> {
  const out = new Map<bigint, Snap>(objects.map(o => [o.id, { ...o }]));
  const earliest = new Map<bigint, SceneChange>();
  for (const c of changes) if (c.id > changeId && (!earliest.has(c.objectId) || c.id < earliest.get(c.objectId)!.id)) earliest.set(c.objectId, c);
  for (const [id, c] of earliest) {
    if (!c.before) out.delete(id);
    else out.set(id, { ...(out.get(id) ?? { id }), ...JSON.parse(c.before) });
  }
  return out;
}

/** Scene history for the session, oldest first, with undo and restore. */
export function useSceneHistory(sessionId: bigint) {
  const [changes] = useTable(tables.sceneChange.where(r => r.sessionId.eq(sessionId)));
  const [objects] = useTable(tables.sceneObject.where(r => r.sessionId.eq(sessionId)));
  const undo = useReducer(reducers.undoSceneChange);
  const restore = useReducer(reducers.restoreSceneTo);
  const sorted = useMemo(() => [...changes].sort((a, b) => Number(a.id - b.id)), [changes]);
  return {
    changes: sorted, objects,
    undo: (changeId: bigint) => undo({ changeId }),
    restoreTo: (changeId: bigint) => restore({ sessionId, changeId }),
    at: (changeId: bigint) => sceneAt(objects, sorted, changeId),
  };
}
