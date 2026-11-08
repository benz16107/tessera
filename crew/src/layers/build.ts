// Builds the layers for one place and time. No SpacetimeDB here, so tests and scripts can call it directly;
// index.ts resolves sessions and serves it over HTTP.
import { inNYC, nycStreets, nycFootprints, filmLayer, closuresLayer, constructionLayer, boroughOf, NYC_BUILDINGS_SOURCE, type Footprint, type Street } from './nyc.ts';
import { weatherLayer } from './weather.ts';
import { alertsLayer, quakesLayer } from './hazards.ts';
import { tidesLayer } from './tides.ts';
import { osmAround, OSM_LICENSE, type Osm } from './osm.ts';
import { photographersLayer } from './photographers.ts';
import { moonLayer } from './sky.ts';
import { buildingFeatures, shadowLayer, type Building } from './buildings.ts';
import { buildConditions, type Conditions } from './conditions.ts';
import { fc, type FC, type LayerOut, type Place, type Source } from './types.ts';
import type { XY } from './geom.ts';

export const LAYER_IDS = ['weather', 'alerts', 'quakes', 'film', 'closures', 'construction', 'tides', 'buildings', 'shadow', 'pois', 'photographers', 'moon'] as const;
export type LayerId = (typeof LAYER_IDS)[number];
const NYC_ONLY: LayerId[] = ['film', 'closures', 'construction'];

export interface LayersResponse {
  place: Place; at: string; nyc: boolean;
  layers: Partial<Record<LayerId, FC>>; summary: Partial<Record<LayerId, unknown>>;
  sources: Source[]; errors: Partial<Record<LayerId, string>>; conditions?: Conditions; ms: number;
}

/** A layer that takes longer than this answers "still loading" while its fetch carries on and fills the cache. */
const DEADLINE_MS = 14_000;
function within<T>(p: Promise<T>, ms = DEADLINE_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error('still loading; ask again in a minute')), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

export async function buildLayers(place: Place, at: Date, ids: LayerId[], probes: { label: string; xy: XY }[], withConditions = false): Promise<LayersResponse> {
  const t0 = Date.now(), nyc = inNYC(place);
  const once = <T,>(f: () => Promise<T>) => { let p: Promise<T> | null = null; return () => (p ??= f()); };
  const osm = once(() => osmAround(place));
  const foot = once(async () => (nyc ? nycFootprints(place) : { list: [] as Footprint[], fetchedAt: 0, stale: false, error: undefined as string | undefined }));
  const streets = once(async (): Promise<Street[]> => (nyc ? nycStreets(place) : (await osm()).osm.streets));
  const buildings = once(async (): Promise<{ list: Building[]; source: Source }> => {
    const f = await foot().catch(() => null);
    if (f?.list.length) return { list: f.list.map(b => ({ name: b.name, h: b.h, ring: b.ring, source: 'nyc' as const })), source: NYC_BUILDINGS_SOURCE(f.fetchedAt, f.stale, f.error) };
    const o = await osm();
    return { list: o.osm.buildings.map(b => ({ name: b.name, h: b.h, ring: b.ring, estimated: b.estimated, source: 'osm' as const })), source: { ...o.source, layer: 'buildings', name: 'OpenStreetMap building footprints and heights', license: OSM_LICENSE } };
  });

  const run: Record<LayerId, () => Promise<LayerOut>> = {
    weather: () => weatherLayer(place, at),
    alerts: () => alertsLayer(place, at),
    quakes: () => quakesLayer(place),
    film: async () => filmLayer(place, at, await streets(), boroughOf((await foot()).list[0]?.bin)),
    closures: () => closuresLayer(place, at),
    construction: async () => constructionLayer(place, at, (await foot()).list),
    tides: () => tidesLayer(place, at),
    buildings: async () => { const b = await buildings(); return { geojson: fc(buildingFeatures(b.list)), summary: { count: b.list.length, from: b.list[0]?.source ?? null, estimated: b.list.filter(x => x.estimated).length }, sources: [b.source] }; },
    shadow: async () => { const b = await buildings(); return shadowLayer(place, at, b.list, probes); },
    pois: async () => { const o: { osm: Osm; source: Source } = await osm(); return { geojson: fc(o.osm.pois), summary: { count: o.osm.pois.length, viewpoints: o.osm.pois.filter(f => f.properties.kind === 'viewpoint').length }, sources: [o.source] }; },
    photographers: () => photographersLayer(place),
    moon: async () => moonLayer(place, at),
  };
  const want = ids.filter(id => nyc || !NYC_ONLY.includes(id));
  const out: LayersResponse = { place, at: at.toISOString(), nyc, layers: {}, summary: {}, sources: [], errors: {}, ms: 0 };
  await Promise.all(want.map(async id => {
    try {
      const r = await within(run[id]());
      out.layers[id] = r.geojson; out.summary[id] = r.summary; out.sources.push(...r.sources);
    } catch (e) { out.errors[id] = (e as Error).message.slice(0, 200); }
  }));
  if (withConditions) out.conditions = buildConditions(place, at, out);
  out.ms = Date.now() - t0;
  return out;
}
