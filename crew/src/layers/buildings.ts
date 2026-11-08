// Real building shadows: footprints with heights (NYC's own footprints in NYC, OpenStreetMap elsewhere) become shadow
// casters, and the street points that matter (the mark, the subject in front of the shot camera) get the times they sit
// in building shadow. The 3D set extrudes the same footprints as invisible casters for its sun light.
import SunCalc from 'suncalc';
import { pointInRing, toXY, toLonLat, type LonLat, type XY } from './geom.ts';
import { shadowBands, shadowReadout, shadowAt, type Caster, type Band } from './score.ts';
import { fc, fmtIn, type Feature, type LayerOut, type Place } from './types.ts';
import { localMidnight } from './sky.ts';

export interface Building { name: string; h: number; ring: LonLat[]; estimated?: boolean; source: 'nyc' | 'osm' }

export function buildingFeatures(list: Building[]): Feature[] {
  return list.map(b => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [b.ring] }, properties: {
    layer: 'buildings', kind: 'building', label: b.name || `${Math.round(b.h)} m building`, height_m: b.h, estimated: !!b.estimated, src: b.source } }));
}

/** Convex hull (monotone chain) of points in XY. */
function hull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: XY[] = [], up: XY[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** Each building's shadow on flat ground at one sun position, for the 2D map.
 *  shortcut: the hull of the footprint and its shifted copy, exact for convex footprints; an L-shaped building's shadow
 *  is drawn a little too full. Fine for a map overlay; the 3D set uses real shadow mapping. */
export function shadowPolygons(o: Place, casters: Caster[], az: number, alt: number): Feature[] {
  if (alt <= 0.5) return [];
  const r = (az * Math.PI) / 180, len = (h: number) => Math.min(400, h / Math.tan((alt * Math.PI) / 180));
  return casters.map(c => {
    const L = len(c.h), dx = -Math.sin(r) * L, dy = -Math.cos(r) * L;
    const ring = hull([...c.ring, ...c.ring.map(([x, y]) => [x + dx, y + dy] as XY)]);
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]].map(q => toLonLat(o, q))] }, properties: { layer: 'shadow', kind: 'building_shadow', label: '' } } as Feature;
  });
}

export interface Probe { label: string; lat: number; lon: number; bands: { start: string; end: string; by: string }[]; readout: string; now: { shadow: boolean; by: string | null } }
export interface ShadowSummary { probes: Probe[]; readout: string; sun: { az: number; alt: number }; casters: number }

const sunAt = (p: Place) => (t: Date) => { const s = SunCalc.getPosition(t, p.lat, p.lon); return { az: ((s.azimuth * 180) / Math.PI + 180 + 360) % 360, alt: (s.altitude * 180) / Math.PI }; };

/** Shadow bands through the spot's local day for each probe point (metres east and north of the spot). */
export function shadowLayer(p: Place, at: Date, buildings: Building[], points: { label: string; xy: XY }[]): LayerOut<ShadowSummary> {
  const casters: Caster[] = buildings.map(b => ({ ring: b.ring.map(c => toXY(p, c)), h: b.h, name: b.name || undefined }));
  const sun = sunAt(p), fmt = fmtIn(p.zone);
  const d0 = localMidnight(at, p.zone), times = SunCalc.getTimes(new Date(d0.getTime() + 12 * 3_600_000), p.lat, p.lon);
  const rise = times.sunrise, setT = times.sunset;
  const probes: Probe[] = [];
  for (const pt of points) {
    if (casters.some(c => c.ring.length > 2 && pointInRing(pt.xy, c.ring))) continue; // inside a footprint: not a street point
    const bands: Band[] = isNaN(rise.getTime()) ? [] : shadowBands(pt.xy, casters, rise, setT, sun, 5);
    const s = sun(at), by = shadowAt(pt.xy, casters, s.az, s.alt);
    const [lon, lat] = toLonLat(p, pt.xy);
    probes.push({ label: pt.label, lat, lon, bands: bands.map(b => ({ start: b.start.toISOString(), end: b.end.toISOString(), by: b.by })),
      readout: isNaN(rise.getTime()) ? '' : `${pt.label} is ${shadowReadout(bands, rise, setT, fmt)}`, now: { shadow: !!by, by: by?.name ?? (by ? 'a building' : null) } });
  }
  const s = sun(at);
  const feats: Feature[] = [
    ...shadowPolygons(p, casters, s.az, s.alt),
    ...probes.map(pr => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [pr.lon, pr.lat] }, properties: {
      layer: 'shadow', kind: 'shadow_probe', label: pr.now.shadow ? 'In building shadow now' : s.alt > 0 ? 'In sun now' : 'Sun down', detail: pr.readout } }) as Feature),
  ];
  return { geojson: fc(feats), summary: { probes, readout: probes[probes.length - 1]?.readout ?? '', sun: { az: Math.round(s.az), alt: Math.round(s.alt * 10) / 10 }, casters: casters.length }, sources: [] };
}

