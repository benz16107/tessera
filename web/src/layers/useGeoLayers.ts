// One fetch of /api/layers per session and half hour of set time, shared by the 3D set, the 2D map, the panel and the
// timeline. Layer toggles are shared through SpacetimeDB (`layer_toggle`) when the module has it, else kept per browser.
// When the module's scheduled procedure refreshes `layer_snapshot` (weather, alerts), the hook refetches at once.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from '../module_bindings/index.ts';
import type { FC, Feature, Place } from '../../../crew/src/layers/types.ts';

export type { FC, Feature, Place };

export const LAYERS = [
  { id: 'alerts', name: 'Weather alerts', color: '#e8675e', spatial: true, def: true, note: 'NWS warnings and advisories' },
  { id: 'film', name: 'Film and event permits', color: '#f2a33a', spatial: true, def: true, note: 'NYC film shoots, parades, load-ins' },
  { id: 'closures', name: 'Street closures', color: '#e8675e', spatial: true, def: true, note: 'NYC DOT construction closures' },
  { id: 'construction', name: 'Sheds and scaffolds', color: '#d9b44a', spatial: true, def: true, note: 'NYC DOB permits' },
  { id: 'shadow', name: 'Building shadows', color: '#7f8ea8', spatial: true, def: true, note: 'Real footprints cast shadows' },
  { id: 'buildings', name: 'Building outlines', color: '#a39f96', spatial: true, def: false, note: 'Footprints and heights' },
  { id: 'photographers', name: 'Where photographers stand', color: '#e6d3a8', spatial: true, def: true, note: 'Geotagged Commons photos' },
  { id: 'pois', name: 'Places', color: '#5ec8c2', spatial: true, def: false, note: 'Viewpoints, transit, cafes, restrooms, parking' },
  { id: 'quakes', name: 'Earthquakes', color: '#b48ce0', spatial: true, def: false, note: 'USGS, 300 km, 30 days' },
  { id: 'weather', name: 'Clouds and rain', color: '#8fb3e8', spatial: false, def: true, note: 'On the timeline' },
  { id: 'tides', name: 'Tides', color: '#5f9cf0', spatial: false, def: true, note: 'On the timeline' },
  { id: 'moon', name: 'Moon', color: '#c9d8f5', spatial: false, def: true, note: 'Rise, set and phase' },
] as const;
export type LayerId = (typeof LAYERS)[number]['id'];

export interface Hour { t: string; cloud: number; low: number; mid: number; high: number; visKm: number; rainPct: number; rainMm: number; windMph: number; gustMph: number; windDir: number; tempF: number; rh: number; code: number; pm25: number | null; aod: number | null }
export interface SunEvent { kind: 'sunrise' | 'sunset'; t: string; hour: string; chance: { score: number; label: string; why: string } }
export interface Summary {
  weather?: { hours: Hour[]; events: SunEvent[]; now: Hour | null; haze: { label: string; detail: string } | null; sky: string };
  tides?: { station: { id: string; name: string; km: number } | null; hilo: { t: string; type: 'H' | 'L'; ft: number }[]; hourly: { t: string; ft: number }[]; note: string };
  shadow?: { probes: { label: string; lat: number; lon: number; bands: { start: string; end: string; by: string }[]; readout: string; now: { shadow: boolean } }[]; readout: string; casters: number; sun: { az: number; alt: number } };
  moon?: { rise: string | null; set: string | null; phaseName: string; illumination: number; at: { az: number; alt: number } };
  alerts?: { count: number };
  film?: { active: number; history: number; note: string };
  photographers?: { count: number; withHeading: number; hotspots: { lat: number; lon: number; n: number; heading: number | null; text: string }[] };
  [k: string]: unknown;
}
export interface Conditions { at: string; text: string; lines: string[]; colorChance: { score: number; label: string; why: string; kind: string; t: string } | null; haze: string | null; shadow: string | null; moon: string | null }
export interface Source { layer: string; name: string; url: string; license: string; fetchedAt: number | null; stale?: boolean; error?: string }
export interface LayersData { place: Place; at: string; nyc: boolean; layers: Partial<Record<LayerId, FC>>; summary: Summary; sources: Source[]; errors: Partial<Record<LayerId, string>>; conditions?: Conditions; ms: number }

export interface Snapshot { layer: string; fetchedAt: Date; error: string }
export interface GeoLayers {
  data: LayersData | null; loading: boolean; error: string;
  on: (id: LayerId) => boolean; toggle: (id: LayerId) => void; shared: boolean;
  snapshots: Snapshot[]; refresh: () => void;
}

const HALF_HOUR = 30 * 60_000;
// The module's tables, when this build's bindings have them (the spacetime thread publishes them).
const T = tables as unknown as Record<string, any>, Rd = reducers as unknown as Record<string, any>;
const HAS_TOGGLE = !!T.layerToggle && !!Rd.setLayerToggle, HAS_SNAPSHOT = !!T.layerSnapshot;

function useToggles(sessionId: bigint) {
  const key = `shotmatch.layers.${sessionId}`;
  const [local, setLocal] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; } });
  /* eslint-disable react-hooks/rules-of-hooks -- HAS_TOGGLE is fixed for the life of the build */
  const [rows] = HAS_TOGGLE ? useTable(T.layerToggle.where((r: any) => r.sessionId.eq(sessionId))) : [[] as any[]];
  const set = HAS_TOGGLE ? useReducer(Rd.setLayerToggle) : null;
  /* eslint-enable react-hooks/rules-of-hooks */
  const shared = new Map<string, boolean>((rows as any[]).map(r => [r.layer, r.on]));
  const on = useCallback((id: LayerId) => shared.get(id) ?? local[id] ?? LAYERS.find(l => l.id === id)!.def, [rows, local]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = useCallback((id: LayerId) => {
    const next = !on(id);
    setLocal(v => { const n = { ...v, [id]: next }; try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* private mode */ } return n; });
    if (set) (set as (a: unknown) => Promise<unknown>)({ sessionId, layer: id, on: next }).catch(console.error);
  }, [on, set, sessionId, key]);
  return { on, toggle, shared: HAS_TOGGLE };
}

function useSnapshots(spotId: string): Snapshot[] {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [rows] = HAS_SNAPSHOT ? useTable(T.layerSnapshot.where((r: any) => r.spotId.eq(spotId))) : [[] as any[]];
  return useMemo(() => (rows as any[]).map(r => ({ layer: r.layer, fetchedAt: r.fetchedAt.toDate(), error: r.error })), [rows]);
}

export function useGeoLayers(sessionId: bigint, spotId: string, at: Date): GeoLayers {
  const slot = Math.round(at.getTime() / HALF_HOUR) * HALF_HOUR;
  const [data, setData] = useState<LayersData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [n, setN] = useState(0);
  const { on, toggle, shared } = useToggles(sessionId);
  const snapshots = useSnapshots(spotId);
  const snapKey = snapshots.map(s => s.fetchedAt.getTime()).join(',');
  const live = useRef(0);
  useEffect(() => {
    const id = ++live.current;
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/layers?session=${sessionId}&at=${new Date(slot).toISOString()}`, { signal: ctl.signal })
        .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as LayersData; })
        .then(j => { if (id === live.current) { setData(j); setError(''); } })
        .catch(e => { if (id === live.current && e.name !== 'AbortError') setError(String(e.message ?? e)); })
        .finally(() => { if (id === live.current) setLoading(false); });
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [sessionId, slot, n, snapKey]);
  // Weather and alerts move; refetch every 5 minutes (the crew's cache answers in well under a second).
  useEffect(() => { const t = setInterval(() => setN(v => v + 1), 5 * 60_000); return () => clearInterval(t); }, []);
  return { data, loading, error, on, toggle, shared, snapshots, refresh: () => setN(v => v + 1) };
}
