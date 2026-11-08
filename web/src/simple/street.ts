// The mark in walking words: "Washington St at Water St" or "Washington St, 40 m south of Water St". Measured from the
// street corners stored with each spot (spots/<id>/streets.json, from OpenStreetMap), never guessed.
import { bearing, metersBetween, norm360 } from '../geo.ts';

export interface Streets { street: string; credit: string; corners: { cross: string; lat: number; lon: number }[] }

const DIRS = ['north', 'east', 'south', 'west'];
const AT_CORNER_M = 10; // closer than this, the corner itself is the answer
const ON_STREET_M = 15; // within this of the line through the corners, the mark is on the street
const FAR_M = 250; // farther than this from every corner, street words would mislead

/** Metres from a point to the polyline through the corners, in a local flat frame (fine over a few hundred metres). */
function toLine(s: Streets, lat: number, lon: number) {
  const k = Math.cos((lat * Math.PI) / 180) * 111_320, xy = (a: number, b: number) => [(b - lon) * k, (a - lat) * 110_540];
  let best = Infinity;
  for (let i = 1; i < s.corners.length; i++) {
    const [ax, ay] = xy(s.corners[i - 1].lat, s.corners[i - 1].lon), [bx, by] = xy(s.corners[i].lat, s.corners[i].lon);
    const t = Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
    best = Math.min(best, Math.hypot(ax + t * (bx - ax), ay + t * (by - ay)));
  }
  return best;
}

export function describeMark(s: Streets | undefined, lat: number, lon: number): string | null {
  if (!s?.corners.length) return null;
  const near = s.corners.map(c => ({ c, d: metersBetween(c.lat, c.lon, lat, lon) })).sort((a, b) => a.d - b.d)[0];
  if (near.d > FAR_M) return null;
  if (near.d < AT_CORNER_M) return `${s.street} at ${near.c.cross}`;
  const dir = DIRS[Math.round(norm360(bearing(near.c.lat, near.c.lon, lat, lon)) / 90) % 4];
  const m = Math.round(near.d);
  return s.corners.length > 1 && toLine(s, lat, lon) <= ON_STREET_M
    ? `${s.street}, ${m} m ${dir} of ${near.c.cross}`
    : `${m} m ${dir} of ${s.street} and ${near.c.cross}`;
}
