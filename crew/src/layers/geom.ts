// Small plane geometry for the layers, in metres east (x) and north (y) of an origin. A local equirectangular projection
// is within 1 cm of the WGS84 east-north-up frame (web/src/studio/frame.ts) over the 1 km the layers cover.
// GeoJSON order everywhere: [lon, lat].
export type LonLat = [number, number];
export type XY = [number, number];
export interface Origin { lat: number; lon: number }

const R = 6371008.8, D = Math.PI / 180;

export const toXY = (o: Origin, [lon, lat]: LonLat): XY => [(lon - o.lon) * D * R * Math.cos(o.lat * D), (lat - o.lat) * D * R];
export const toLonLat = (o: Origin, [x, y]: XY): LonLat => [o.lon + x / (D * R * Math.cos(o.lat * D)), o.lat + y / (D * R)];

export function metres(a: Origin, b: Origin) {
  const dLat = (b.lat - a.lat) * D, dLon = (b.lon - a.lon) * D;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A closed ring of `n` points `r` metres around a point. */
export function circle(c: LonLat, r: number, n = 24): LonLat[] {
  const o = { lon: c[0], lat: c[1] };
  const ring: LonLat[] = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * 2 * Math.PI; ring.push(toLonLat(o, [r * Math.cos(a), r * Math.sin(a)])); }
  return ring;
}

/** One rectangle per segment, `half` metres either side of the line: a street closure drawn as an area. */
export function bufferLine(line: LonLat[], half: number): LonLat[][] {
  if (line.length < 2) return [];
  const o = { lon: line[0][0], lat: line[0][1] };
  const out: LonLat[][] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = toXY(o, line[i]), [bx, by] = toXY(o, line[i + 1]);
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.5) continue;
    const nx = (-(by - ay) / len) * half, ny = ((bx - ax) / len) * half;
    const ex = ((bx - ax) / len) * half * 0.5, ey = ((by - ay) / len) * half * 0.5; // a little past each end so pieces join
    const q: XY[] = [[ax - ex + nx, ay - ey + ny], [bx + ex + nx, by + ey + ny], [bx + ex - nx, by + ey - ny], [ax - ex - nx, ay - ey - ny]];
    out.push([...q, q[0]].map(p => toLonLat(o, p)));
  }
  return out;
}

export function pointInRing([x, y]: XY, ring: XY[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distances along a ray (from p, unit direction d) at which it crosses the ring's edges. */
export function rayCrossings([px, py]: XY, [dx, dy]: XY, ring: XY[]) {
  const hits: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const ex = bx - ax, ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - px) * ey - (ay - py) * ex) / den; // along the ray
    const s = ((ax - px) * dy - (ay - py) * dx) / den; // along the edge
    if (t > 0 && s >= 0 && s <= 1) hits.push(t);
  }
  return hits;
}

/** Closest point on a polyline (in XY) to p, with its distance. */
export function nearestOnLine(p: XY, line: XY[]) {
  let best = { d: Infinity, q: line[0] ?? p };
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1];
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * ex + (p[1] - ay) * ey) / l2)) : 0;
    const q: XY = [ax + t * ex, ay + t * ey];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { d, q };
  }
  return best;
}

/** Street names as NYC writes them in permits ("WEST   11 STREET") and in its centreline ("W 11 ST"), and as OSM does
 *  ("West 11th Street"), reduced to one form. */
const ABBR: Record<string, string> = {
  STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', PLACE: 'PL', PLAZA: 'PLZ', BOULEVARD: 'BLVD', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', COURT: 'CT',
  TERRACE: 'TER', HEIGHTS: 'HTS', BRIDGE: 'BRG', ALLEY: 'ALY', EXPRESSWAY: 'EXPY', PARKWAY: 'PKWY', SQUARE: 'SQ', SLIP: 'SLIP',
  EAST: 'E', WEST: 'W', NORTH: 'N', SOUTH: 'S', SAINT: 'ST',
};
export const streetKey = (s: string) => s.toUpperCase().replace(/[.,']/g, '').replace(/\b(\d+)(ST|ND|RD|TH)\b/g, '$1')
  .split(/\s+/).filter(Boolean).map(w => ABBR[w] ?? w).join(' ');
