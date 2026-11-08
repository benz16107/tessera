// OpenStreetMap through Overpass (ODbL 1.0, "© OpenStreetMap contributors"): building footprints with heights as shadow
// casters, a quiet layer of useful places, and named streets for mapping permits outside NYC.
import { cached, getJson, TTL, at4 } from './cache.ts';
import { metres, streetKey, type LonLat } from './geom.ts';
import type { Street, Footprint } from './nyc.ts';
import type { Feature, Place, Source } from './types.ts';

// The main instance first; the public mirrors when it is at capacity (it often is on a Saturday night).
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

export const OSM_LICENSE = 'ODbL 1.0, © OpenStreetMap contributors';

async function overpass(q: string) {
  const errs: string[] = [];
  for (const m of MIRRORS) {
    try {
      const j = await getJson(m, { form: { data: q }, timeoutMs: 60_000 });
      if (Array.isArray(j.elements)) return j;
      errs.push(`${new URL(m).host}: no elements`);
    } catch (e) { errs.push((e as Error).message.slice(0, 80)); }
  }
  throw new Error(`Overpass unavailable (${errs.join('; ')})`);
}

export interface Osm { buildings: (Footprint & { estimated: boolean })[]; pois: Feature[]; streets: Street[] }

/** Height in metres from building:height or height ("36.2", "36.2 m", "120'"), else levels x 3 m, else 9 m (estimated). */
export function osmHeight(t: Record<string, string>) {
  const raw = t['building:height'] ?? t.height;
  if (raw) {
    const v = parseFloat(raw);
    if (Number.isFinite(v) && v > 0) return { h: /'|ft/.test(raw) ? v * 0.3048 : v, estimated: false };
  }
  const lv = parseFloat(t['building:levels'] ?? '');
  if (Number.isFinite(lv) && lv > 0) return { h: lv * 3 + (parseFloat(t['roof:levels'] ?? '') || 0) * 1.5, estimated: false };
  return { h: 9, estimated: true };
}

const POI_KIND = (t: Record<string, string>) =>
  t.tourism === 'viewpoint' ? 'viewpoint'
    : t.railway === 'subway_entrance' || t.public_transport === 'platform' || t.highway === 'bus_stop' || t.railway === 'station' ? 'transit'
      : t.amenity === 'parking' ? 'parking' : t.amenity === 'toilets' ? 'restroom' : t.amenity === 'cafe' ? 'cafe' : null;

export async function osmAround(p: Place): Promise<{ osm: Osm; source: Source }> {
  const c = `${p.lat},${p.lon}`;
  const q = `[out:json][timeout:60];
(way["building"](around:350,${c});relation["building"](around:350,${c}););out body geom;
(node["tourism"="viewpoint"](around:800,${c});node["public_transport"="platform"](around:800,${c});node["railway"="subway_entrance"](around:800,${c});node["highway"="bus_stop"](around:800,${c});nwr["amenity"~"^(parking|toilets|cafe)$"](around:800,${c}););out tags center;
way["highway"]["name"](around:800,${c});out tags geom;`;
  const got = await cached(`osm-${at4(p.lat, p.lon)}`, TTL.osm, () => overpass(q));
  const buildings: Osm['buildings'] = [], pois: Feature[] = [];
  const streets = new Map<string, Street>();
  for (const e of got.data.elements as any[]) {
    const t = e.tags ?? {};
    if (t.building && (e.type === 'way' || e.type === 'relation')) {
      const ring: LonLat[] | undefined = e.type === 'way' ? e.geometry?.map((g: any) => [g.lon, g.lat])
        : e.members?.find((m: any) => m.role === 'outer' && m.geometry)?.geometry.map((g: any) => [g.lon, g.lat]);
      if (!ring || ring.length < 4) continue;
      const { h, estimated } = osmHeight(t);
      buildings.push({ bin: t['nycdoitt:bin'] ?? '', name: t.name ?? '', h: Math.round(h * 10) / 10, ring, year: Number(t.start_date) || null, estimated });
      continue;
    }
    if (t.highway && t.highway !== 'bus_stop' && e.type === 'way' && t.name && e.geometry) {
      const key = streetKey(t.name);
      const s: Street = streets.get(key) ?? { key, name: t.name, lines: [] };
      s.lines.push(e.geometry.map((g: any) => [g.lon, g.lat]));
      streets.set(key, s);
      continue;
    }
    const kind = POI_KIND(t);
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (!kind || !Number.isFinite(lat)) continue;
    const name = t.name ?? { viewpoint: 'Viewpoint', transit: 'Transit stop', parking: 'Parking', restroom: 'Restroom', cafe: 'Cafe' }[kind];
    pois.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {
      layer: 'pois', kind, label: name, detail: [t.opening_hours && `open ${t.opening_hours}`, t.fee === 'yes' && 'fee', t.access === 'customers' && 'customers only', t.wheelchair === 'yes' && 'step-free'].filter(Boolean).join(', '),
      m: Math.round(metres(p, { lat, lon })), url: e.type && e.id ? `https://www.openstreetmap.org/${e.type}/${e.id}` : undefined } });
  }
  pois.sort((a, b) => Number(a.properties.m) - Number(b.properties.m));
  return {
    osm: { buildings, pois, streets: [...streets.values()] },
    source: { layer: 'pois', name: 'OpenStreetMap via Overpass API', url: 'https://www.openstreetmap.org/copyright', license: OSM_LICENSE, fetchedAt: got.fetchedAt, stale: got.stale, error: got.error },
  };
}
