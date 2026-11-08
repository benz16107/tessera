// Temporary dev harness for the Map view (deleted before the lead commits). /map-dev.html?code=A9TVAN
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider, useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { DbConnection, tables, reducers } from '../../module_bindings/index.ts';
import { useGeoLayers, GeoMapView } from '../index.ts';
import '../../studio/studio.css';

const code = new URLSearchParams(location.search).get('code') ?? 'A9TVAN';
function Inner() {
  const { isActive, identity } = useSpacetimeDB();
  const [rows] = useTable(tables.session.where(r => r.code.eq(code)));
  const [spots] = useTable(tables.spot);
  const join = useReducer(reducers.joinSession);
  const tried = useRef(false);
  useEffect(() => { if (isActive && !tried.current) { tried.current = true; join({ code, name: 'Geo', role: 'planner' }).catch(console.error); } }, [isActive, join]);
  const s = rows[0], spot = spots.find(x => x.id === s?.spotId);
  if (!s || !spot || !identity) return <p style={{ color: '#fff' }}>joining {code}...</p>;
  return <View sid={s.id} spotId={s.spotId} at={s.planTime?.toDate() ?? new Date()} origin={{ lat: spot.lat, lon: spot.lon, height: 0 }} />;
}
function View({ sid, spotId, at, origin }: { sid: bigint; spotId: string; at: Date; origin: { lat: number; lon: number; height: number } }) {
  const geo = useGeoLayers(sid, spotId, at);
  const [objs] = useTable(tables.sceneObject.where(r => r.sessionId.eq(sid)));
  const update = useReducer(reducers.updateSceneObject);
  Object.assign(window, { __objs: objs, __update: update }); // drag test: read Cam A, restore it exactly
  const [log, setLog] = useState('');
  (window as unknown as { __mapLog: string }).__mapLog = log;
  return <Suspense fallback={null}><GeoMapView compact={new URLSearchParams(location.search).has('compact')} geo={geo} sessionId={sid} origin={origin} at={at} zone="America/New_York"
    onEnter3D={(c, h, p) => setLog(`enter3D ${c.lat.toFixed(5)},${c.lon.toFixed(5)} h${h.toFixed(0)} p${p.toFixed(0)}`)}
    onOpenShot={(t, m) => setLog(`open ${m} ${String(t.objectId)} ${t.lat.toFixed(5)}`)} /></Suspense>;
}
function Boot() {
  const [cfg, setCfg] = useState<{ spacetimeHost: string; dbName: string } | null>(null);
  useEffect(() => { fetch('/api/config').then(r => r.json()).then(setCfg); }, []);
  const b = useMemo(() => cfg && DbConnection.builder().withUri(cfg.spacetimeHost).withDatabaseName(cfg.dbName)
    .withToken(localStorage.getItem('geo-dev-token') ?? undefined).onConnect((_c, _i, t) => localStorage.setItem('geo-dev-token', t)), [cfg]);
  return b ? <SpacetimeDBProvider connectionBuilder={b}><Inner /></SpacetimeDBProvider> : null;
}
createRoot(document.getElementById('root')!).render(<Boot />);
