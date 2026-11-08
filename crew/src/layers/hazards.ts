// Danger zones anywhere in the US: active National Weather Service alerts (public domain) as polygons, and recent USGS
// earthquakes (public domain) as points.
import { cached, getJson, TTL, at4 } from './cache.ts';
import { metres } from './geom.ts';
import { fc, fmtIn, dateIn, type Feature, type Geometry, type LayerOut, type Place } from './types.ts';

export interface AlertSummary { count: number; alerts: { event: string; severity: string; headline: string; onset: string; ends: string; areaDesc: string }[] }
export interface QuakeSummary { count: number; nearest: { mag: number; place: string; km: number; time: string } | null; largest: { mag: number; place: string; km: number; time: string } | null }

const NWS_SEV: Record<string, 'minor' | 'moderate' | 'severe' | 'info'> = { Extreme: 'severe', Severe: 'severe', Moderate: 'moderate', Minor: 'minor', Unknown: 'info' };

/** Zone outlines for alerts that name zones instead of drawing a polygon (most winter and heat products). */
async function zoneGeometry(url: string): Promise<Geometry | null> {
  if (!/^https:\/\/api\.weather\.gov\/zones\//.test(url)) return null;
  const z = await cached(`nwszone-${url.split('/zones/')[1]}`, TTL.permits, () => getJson(url, { headers: { accept: 'application/geo+json' } }));
  return z.data?.geometry ?? null;
}

export async function alertsLayer(p: Place, at: Date): Promise<LayerOut<AlertSummary>> {
  const url = `https://api.weather.gov/alerts/active?point=${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  const got = await cached(`alerts-${at4(p.lat, p.lon)}`, TTL.alerts, () => getJson(url, { headers: { accept: 'application/geo+json' } }));
  const fmt = fmtIn(p.zone), day = dateIn(p.zone);
  const feats: Feature[] = [];
  for (const f of got.data.features ?? []) {
    const a = f.properties ?? {};
    let geometry: Geometry | null = f.geometry ?? null;
    if (!geometry) for (const z of (a.affectedZones ?? []).slice(0, 3)) { geometry = await zoneGeometry(z).catch(() => null); if (geometry) break; }
    const ends = a.ends ?? a.expires;
    feats.push({
      type: 'Feature', geometry,
      properties: {
        layer: 'alerts', kind: 'nws_alert', label: `${a.event}${ends ? ` until ${fmt(new Date(ends))}${new Date(ends).getTime() - at.getTime() > 86_400_000 ? ` ${day(new Date(ends))}` : ''}` : ''}`,
        detail: a.headline ?? '', start: a.onset ?? a.effective, end: ends, active: true, severity: NWS_SEV[a.severity] ?? 'info',
        url: a['@id'] ?? f.id, instruction: String(a.instruction ?? '').slice(0, 400), area: a.areaDesc,
      },
    });
  }
  return {
    geojson: fc(feats),
    summary: { count: feats.length, alerts: (got.data.features ?? []).map((f: any) => ({ event: f.properties.event, severity: f.properties.severity, headline: f.properties.headline, onset: f.properties.onset, ends: f.properties.ends ?? f.properties.expires, areaDesc: f.properties.areaDesc })) },
    sources: [{ layer: 'alerts', name: 'National Weather Service active alerts', url: 'https://www.weather.gov/documentation/services-web-api', license: 'US government work, public domain', fetchedAt: got.fetchedAt, stale: got.stale, error: got.error }],
  };
}

export async function quakesLayer(p: Place): Promise<LayerOut<QuakeSummary>> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}&maxradiuskm=300&starttime=${since}&minmagnitude=1.5&orderby=time&limit=100`;
  const got = await cached(`quakes-${at4(p.lat, p.lon)}`, TTL.quakes, () => getJson(url));
  const day = dateIn(p.zone);
  const feats: Feature[] = (got.data.features ?? []).map((f: any) => {
    const [lon, lat] = f.geometry.coordinates, km = metres(p, { lat, lon }) / 1000, mag = Number(f.properties.mag);
    return {
      type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { layer: 'quakes', kind: 'earthquake', label: `M${mag.toFixed(1)} ${day(new Date(f.properties.time))}`, detail: `${f.properties.place}, ${Math.round(km)} km away`,
        start: new Date(f.properties.time).toISOString(), mag, km: Math.round(km), severity: mag >= 4.5 ? 'severe' : mag >= 3 ? 'moderate' : 'minor', url: f.properties.url },
    } satisfies Feature;
  });
  const pick = (f?: Feature) => f && { mag: Number(f.properties.mag), place: String(f.properties.detail), km: Number(f.properties.km), time: String(f.properties.start) };
  return {
    geojson: fc(feats),
    summary: { count: feats.length, nearest: pick([...feats].sort((a, b) => Number(a.properties.km) - Number(b.properties.km))[0]) ?? null, largest: pick([...feats].sort((a, b) => Number(b.properties.mag) - Number(a.properties.mag))[0]) ?? null },
    sources: [{ layer: 'quakes', name: 'USGS earthquake catalog (ComCat)', url: 'https://earthquake.usgs.gov/fdsnws/event/1/', license: 'US government work, public domain', fetchedAt: got.fetchedAt, stale: got.stale, error: got.error }],
  };
}
