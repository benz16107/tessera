// Pure math shared by the planner and the scout. Conventions are CONTRACTS.md's.
import SunCalc from 'suncalc';

const DIAG_35 = 43.2666;
const R = Math.PI / 180;

/** Cesium frustum values for an image w x h shot at f35 (CONTRACTS.md, "f35"). */
export function frustumFor(f35: number, w: number, h: number) {
  const fpx = (f35 * Math.hypot(w, h)) / DIAG_35;
  const hfov = 2 * Math.atan(w / (2 * fpx));
  const vfov = 2 * Math.atan(h / (2 * fpx));
  return { fov: w >= h ? hfov : vfov, aspectRatio: w / h, hfov, vfov };
}

/** Horizontal field of view in degrees. */
export const hfovDeg = (f35: number, w: number, h: number) => frustumFor(f35, w, h).hfov / R;

export function metersBetween(aLat: number, aLon: number, bLat: number, bLon: number) {
  const x = (bLon - aLon) * R * Math.cos(((aLat + bLat) / 2) * R);
  const y = (bLat - aLat) * R;
  return Math.hypot(x, y) * 6_371_000;
}

/** Initial bearing from a to b, degrees clockwise from true north. */
export function bearing(aLat: number, aLon: number, bLat: number, bLon: number) {
  const p1 = aLat * R, p2 = bLat * R, dl = (bLon - aLon) * R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(Math.atan2(y, x) / R);
}

/** Point d metres from (lat, lon) along heading (small distances). */
export function offset(lat: number, lon: number, headingDeg: number, d: number) {
  const dn = d * Math.cos(headingDeg * R), de = d * Math.sin(headingDeg * R);
  return { lat: lat + dn / 111_320, lon: lon + de / (111_320 * Math.cos(lat * R)) };
}

export const norm360 = (d: number) => ((d % 360) + 360) % 360;
/** Signed difference a - b in (-180, 180]. */
export const angleDiff = (a: number, b: number) => {
  const d = norm360(a - b);
  return d > 180 ? d - 360 : d;
};

const WORDS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compassWord = (deg: number) => WORDS[Math.round(norm360(deg) / 22.5) % 16];

/** Phone equivalent of a 35 mm focal length on an iPhone (main camera is 24 mm, ultrawide 0.5x). */
export function phoneZoom(f35: number) {
  if (f35 < 18) return { zoom: 0.5, text: '0.5x ultrawide' };
  const zoom = f35 / 24;
  return { zoom, text: `${zoom < 1.05 && zoom > 0.95 ? '1' : zoom.toFixed(1)}x on an iPhone main camera` };
}

/** Sun position in compass terms: azimuth degrees clockwise from north, altitude degrees. */
export function sunAt(date: Date, lat: number, lon: number) {
  const p = SunCalc.getPosition(date, lat, lon);
  return { azimuth: norm360(p.azimuth / R + 180), altitude: p.altitude / R };
}

export type LightKind = 'Golden hour' | 'Blue hour';
export type Relation = 'in frame' | 'behind you' | 'from your left' | 'from your right' | 'below the horizon';

/** Where the sun sits relative to a camera looking along heading with the given horizontal FOV. */
export function sunRelation(sunAz: number, sunAlt: number, heading: number, hfov: number): Relation {
  if (sunAlt < -1) return 'below the horizon';
  const d = angleDiff(sunAz, heading);
  if (Math.abs(d) <= hfov / 2 + 5) return 'in frame';
  if (Math.abs(d) >= 120) return 'behind you';
  return d < 0 ? 'from your left' : 'from your right';
}

export interface LightWindow { kind: LightKind; start: Date; end: Date; mid: Date; sunAz: number; sunAlt: number; relation: Relation }

/** Golden and blue hour windows over the next `days`, from `from`, for a camera at (lat, lon) facing heading. */
export function lightWindows(from: Date, lat: number, lon: number, heading: number, hfov: number, days = 3): LightWindow[] {
  const out: LightWindow[] = [];
  for (let i = 0; i <= days; i++) {
    const t = SunCalc.getTimes(new Date(from.getTime() + i * 86_400_000), lat, lon);
    const pairs: [LightKind, Date, Date][] = [
      ['Blue hour', t.dawn, t.sunrise],
      ['Golden hour', t.sunrise, t.goldenHourEnd],
      ['Golden hour', t.goldenHour, t.sunset],
      ['Blue hour', t.sunset, t.dusk],
    ];
    for (const [kind, start, end] of pairs) {
      if (!(start instanceof Date) || isNaN(start.getTime()) || end.getTime() <= from.getTime()) continue;
      const mid = new Date((start.getTime() + end.getTime()) / 2);
      // Blue hour glow sits where the sun meets the horizon (sunrise or sunset), so judge direction there.
      const s = sunAt(kind === 'Golden hour' ? mid : start === t.dawn ? end : start, lat, lon);
      out.push({ kind, start, end, mid, sunAz: s.azimuth, sunAlt: s.altitude, relation: sunRelation(s.azimuth, Math.max(s.altitude, 0), heading, hfov) });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Rough IANA zone for a spot, so times read as local at the spot. */
export function spotZone(spotId: string, lon: number) {
  if (spotId.startsWith('nyc_')) return 'America/New_York';
  if (spotId.startsWith('utd_') || spotId.startsWith('dal_')) return 'America/Chicago';
  // shortcut: falls back to the browser zone for anything else; add a prefix above when a new region lands.
  void lon;
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export const fmtTime = (d: Date, zone: string, withDay = false) =>
  new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', ...(withDay ? { weekday: 'short' } : {}) }).format(d);
