// The scoring rules behind the layers, with no I/O, so the crew, the web and the tests share one copy
// (web/src/layers imports this file). Each rule says where its numbers come from.
import { pointInRing, rayCrossings, type XY } from './geom.ts';

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export interface CloudHour { low: number; mid: number; high: number; precip?: number; aod?: number }
export interface ColorChance { score: number; label: 'good' | 'fair' | 'poor'; why: string }

/**
 * Sunrise or sunset colour chance, 0 to 100, from Open-Meteo's cloud cover by layer (percent) at the hour of the sun event.
 * Physics, from Corfidi (NOAA Storm Prediction Center, "The Colors of Sunset and Twilight"): the colour is sunlight reddened
 * along a long path through clean air, and it shows best on mid and high cloud that the low sun still lights from below.
 * Low cloud near the horizon blocks that light, and haze mutes it. The thresholds are Tessera's own:
 * - canvas = the sky's mid or high cover, 1 - (1 - mid)(1 - high). Under 5% scores 20 (a clean glow, little sky colour);
 *   it rises to 90 at 30%, holds 100 from 30% to 70%, and falls to 45 at 100% (a solid deck catches less light).
 * - low cloud over 15% scales that down, to a tenth at 80% and above (the light never reaches the canvas).
 * - rain chance over 50% scales it by 0.7; aerosol optical depth over 0.35 takes up to 30% off.
 * Good is 65 or more, fair 35 to 64, poor below 35.
 */
export function colorChance({ low, mid, high, precip = 0, aod = 0 }: CloudHour): ColorChance {
  const canvas = 100 * (1 - (1 - clamp(mid / 100)) * (1 - clamp(high / 100)));
  const base = canvas < 5 ? 20 : canvas < 30 ? 20 + ((canvas - 5) / 25) * 70 : canvas <= 70 ? 100 : 100 - ((canvas - 70) / 30) * 55;
  const lowF = 1 - 0.9 * clamp((low - 15) / 65);
  const rainF = precip > 50 ? 0.7 : 1;
  const hazeF = 1 - clamp(aod - 0.35, 0, 0.3);
  const score = Math.round(base * lowF * rainF * hazeF);
  const label = score >= 65 ? 'good' : score >= 35 ? 'fair' : 'poor';
  const why = [
    canvas < 5 ? (low > 15 ? 'no mid or high cloud to catch the light' : 'a clear sky gives a clean glow but little colour') : `${Math.round(canvas)}% mid and high cloud to catch the light`,
    low > 15 ? `${Math.round(low)}% low cloud in the way` : 'no low cloud in the way',
    ...(precip > 50 ? [`${Math.round(precip)}% chance of rain`] : []),
    ...(aod > 0.35 ? [`haze (AOD ${aod.toFixed(2)})`] : []),
  ].join(', ');
  return { score, label, why };
}

export interface Haze { label: 'clear air' | 'light haze' | 'hazy' | 'heavy haze'; detail: string }

/** Haze from PM2.5 (EPA's 2024 AQI breakpoints: good to 9.0, moderate to 35.4, sensitive groups to 55.4 ug/m3) and
 *  aerosol optical depth at 550 nm (about 0.1 is clean, 0.3 visibly hazy, 0.6 thick). The worse of the two names it. */
export function hazeReading(pm25: number | null, aod: number | null): Haze {
  const p = pm25 ?? 0, a = aod ?? 0;
  const level = Math.max(p <= 9 ? 0 : p <= 35.4 ? 1 : p <= 55.4 ? 2 : 3, a < 0.15 ? 0 : a < 0.3 ? 1 : a < 0.6 ? 2 : 3);
  const label = (['clear air', 'light haze', 'hazy', 'heavy haze'] as const)[level];
  const effect = ['distant skylines stay crisp', 'far buildings soften a little', 'far buildings wash out; long lenses lose contrast', 'the far skyline may vanish'][level];
  const aqi = p <= 9 ? 'good' : p <= 35.4 ? 'moderate' : p <= 55.4 ? 'unhealthy for sensitive groups' : 'unhealthy';
  const parts = [pm25 !== null ? `PM2.5 ${pm25.toFixed(0)} ug/m3 (EPA ${aqi})` : '', aod !== null ? `AOD ${aod.toFixed(2)}` : ''].filter(Boolean);
  return { label, detail: `${parts.join(', ')}: ${effect}` };
}

/** A building as a shadow caster: footprint in metres east and north of the spot, flat roof `h` metres above the street. */
export interface Caster { ring: XY[]; h: number; name?: string }

/** The building that blocks the sun at point p (on the street), or null when p is in sun or the sun is down.
 *  The sun's ray leaves p toward azimuth `az` (clockwise from north) rising at `alt`; it is blocked when it enters a
 *  footprint below that building's roof. */
export function shadowAt(p: XY, casters: Caster[], az: number, alt: number): Caster | null {
  if (alt <= 0) return null;
  const r = (az * Math.PI) / 180, d: XY = [Math.sin(r), Math.cos(r)], tanA = Math.tan((alt * Math.PI) / 180);
  for (const c of casters) {
    if (pointInRing(p, c.ring)) continue; // a point inside a footprint is a bad probe, not a shadow
    const hits = rayCrossings(p, d, c.ring);
    if (hits.length && c.h > Math.min(...hits) * tanA) return c;
  }
  return null;
}

export interface Band { start: Date; end: Date; by: string }

/** Times between `from` and `to` when p is in building shadow while the sun is up, sampled every `stepMin` minutes. */
export function shadowBands(p: XY, casters: Caster[], from: Date, to: Date, sun: (t: Date) => { az: number; alt: number }, stepMin = 5): Band[] {
  const out: Band[] = [];
  let cur: Band | null = null;
  for (let t = from.getTime(); t <= to.getTime(); t += stepMin * 60_000) {
    const at = new Date(t), s = sun(at), c = s.alt > 0 ? shadowAt(p, casters, s.az, s.alt) : null;
    if (c && !cur) cur = { start: at, end: at, by: c.name ?? 'a building' };
    else if (c && cur) cur.end = at;
    else if (!c && cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

/** One line for the readout: "in building shadow from 2:05 PM to sunset", "sunlit from 8:10 AM", or "in sun all day". */
export function shadowReadout(bands: Band[], sunrise: Date, sunset: Date, fmt: (d: Date) => string) {
  // Within 15 minutes of sunrise or sunset counts as "from sunrise" or "to sunset": the sun is a degree or two up then,
  // and buildings beyond the casters we load would block it anyway.
  const near = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) <= 15 * 60_000;
  if (!bands.length) return 'in sun from sunrise to sunset';
  return bands.map(b => {
    const fromRise = near(b.start, sunrise), toSet = near(b.end, sunset);
    if (fromRise && toSet) return 'in building shadow all day';
    if (fromRise) return `in shadow until ${fmt(b.end)}, then sunlit`;
    if (toSet) return `in building shadow from ${fmt(b.start)} to sunset`;
    return `in shadow ${fmt(b.start)} to ${fmt(b.end)}`;
  }).join('; ');
}
