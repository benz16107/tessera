// Water: NOAA CO-OPS tide predictions (public domain) from the nearest prediction station within 30 km, high and low
// times for the timeline plus an hourly height curve.
import { cached, getJson, TTL } from './cache.ts';
import { metres } from './geom.ts';
import { fc, fmtIn, type LayerOut, type Place } from './types.ts';

export interface TideSummary {
  station: { id: string; name: string; km: number; lat: number; lon: number } | null;
  hilo: { t: string; type: 'H' | 'L'; ft: number }[];
  hourly: { t: string; ft: number }[];
  next: { high: { t: string; ft: number } | null; low: { t: string; ft: number } | null };
  note: string;
}

/** What low water shows at a spot, for the spots where we know. */
const LOW_TIDE_NOTES: Record<string, string> = {
  nyc_dumbo: 'the rocks and Pebble Beach shoreline under the Manhattan Bridge are exposed',
};

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const gmt = (s: string) => new Date(`${s.replace(' ', 'T')}:00Z`).toISOString();

export async function tidesLayer(p: Place, at: Date): Promise<LayerOut<TideSummary>> {
  const list = await cached('noaa-stations', TTL.stations, () => getJson('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions', { timeoutMs: 40_000 }));
  const st = (list.data.stations as any[]).map(s => ({ s, km: metres(p, { lat: s.lat, lon: s.lng }) / 1000 })).sort((a, b) => a.km - b.km)[0];
  const src = { layer: 'tides', name: 'NOAA CO-OPS tide predictions', url: 'https://api.tidesandcurrents.noaa.gov/api/prod/', license: 'US government work, public domain', fetchedAt: list.fetchedAt };
  const empty: TideSummary = { station: null, hilo: [], hourly: [], next: { high: null, low: null }, note: '' };
  if (!st || st.km > 30) return { geojson: fc([]), summary: { ...empty, note: 'No tide station within 30 km.' }, sources: [src] };
  const begin = ymd(new Date(at.getTime() - 86_400_000));
  const base = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&station=${st.s.id}&begin_date=${begin}&range=96&datum=MLLW&time_zone=gmt&units=english&format=json&application=shotmatch`;
  const [hl, hr] = await Promise.all([
    cached(`tides-${st.s.id}-${begin}`, TTL.tides, () => getJson(`${base}&interval=hilo`)),
    cached(`tides-h-${st.s.id}-${begin}`, TTL.tides, () => getJson(`${base}&interval=h`)),
  ]);
  if (hl.data.error) throw new Error(`NOAA: ${hl.data.error.message}`);
  const hilo = (hl.data.predictions ?? []).map((x: any) => ({ t: gmt(x.t), type: x.type === 'H' ? 'H' : 'L', ft: Number(x.v) })) as TideSummary['hilo'];
  const hourly = (hr.data.predictions ?? []).map((x: any) => ({ t: gmt(x.t), ft: Math.round(Number(x.v) * 100) / 100 }));
  const after = hilo.filter(x => Date.parse(x.t) >= at.getTime() - 30 * 60_000);
  const next = { high: after.find(x => x.type === 'H') ?? null, low: after.find(x => x.type === 'L') ?? null };
  const fmt = fmtIn(p.zone);
  const note = next.low ? `Low tide ${fmt(new Date(next.low.t))} (${next.low.ft.toFixed(1)} ft)${LOW_TIDE_NOTES[p.id] ? `: ${LOW_TIDE_NOTES[p.id]}` : ''}` : '';
  return {
    geojson: fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: [st.s.lng, st.s.lat] }, properties: {
      layer: 'tides', kind: 'tide_station', label: `${st.s.name} tide station`, detail: note, km: Math.round(st.km * 100) / 100, url: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${st.s.id}` } }]),
    summary: { station: { id: st.s.id, name: st.s.name, km: Math.round(st.km * 100) / 100, lat: st.s.lat, lon: st.s.lng }, hilo, hourly, next, note },
    sources: [{ ...src, fetchedAt: hl.fetchedAt, stale: hl.stale, error: hl.error }],
  };
}
