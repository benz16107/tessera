// Sun and light for the studio: the day's sun path, golden and blue hour bands, shadows and a light-quality readout.
// Positions come from suncalc through geo.ts (azimuth clockwise from north, altitude in degrees).
import SunCalc from 'suncalc';
import { sunAt, angleDiff } from '../../geo.ts';
import type { Weather } from '../optics.ts';

export interface SunSample { t: Date; azimuth: number; altitude: number }

/** The solar day around a date: solar noon minus and plus 12 hours, so the timeline never splits a night in two. */
export function solarDay(date: Date, lat: number, lon: number): [Date, Date] {
  let noon = SunCalc.getTimes(date, lat, lon).solarNoon.getTime();
  const H12 = 12 * 3_600_000;
  while (date.getTime() < noon - H12) noon -= 2 * H12; // suncalc picks the calendar day, which can miss `date` by a few hours
  while (date.getTime() > noon + H12) noon += 2 * H12;
  return [new Date(noon - H12), new Date(noon + H12)];
}

export function sunPath(date: Date, lat: number, lon: number, stepMin = 10): SunSample[] {
  const [a, b] = solarDay(date, lat, lon);
  const out: SunSample[] = [];
  for (let t = a.getTime(); t <= b.getTime(); t += stepMin * 60_000) out.push({ t: new Date(t), ...sunAt(new Date(t), lat, lon) });
  return out;
}

export type Phase = 'night' | 'astronomical' | 'nautical' | 'blue' | 'golden' | 'day';

/** Light phase by sun altitude. Blue hour -6 to -4 degrees, golden hour -4 to +6 (the photographers' convention). */
export function phaseOf(altitude: number): Phase {
  if (altitude < -18) return 'night';
  if (altitude < -12) return 'astronomical';
  if (altitude < -6) return 'nautical';
  if (altitude < -4) return 'blue';
  if (altitude < 6) return 'golden';
  return 'day';
}

export interface Band { phase: Phase; start: Date; end: Date }

/** Contiguous phase bands over the solar day, sampled every 2 minutes. */
export function bands(date: Date, lat: number, lon: number): Band[] {
  const out: Band[] = [];
  for (const s of sunPath(date, lat, lon, 2)) {
    const phase = phaseOf(s.altitude);
    const last = out[out.length - 1];
    if (last && last.phase === phase) last.end = s.t;
    else out.push({ phase, start: s.t, end: s.t });
  }
  return out;
}

/** Shadow of an upright object: length h / tan(altitude), pointing away from the sun. */
export function shadow(altitude: number, azimuth: number, heightM = 1.7) {
  if (altitude <= 0.5) return { lengthM: Infinity, bearing: (azimuth + 180) % 360 };
  return { lengthM: heightM / Math.tan((altitude * Math.PI) / 180), bearing: (azimuth + 180) % 360 };
}

export type Direction = 'front' | 'side' | 'back' | 'top' | 'none';

export interface LightQuality { hardness: 'hard' | 'soft' | 'none'; direction: Direction; sunInFrame: boolean; colorK: number; text: string }

/** Rough colour temperature of the light on the subject (an estimate for white balance, not a measurement). */
export function lightColorK(altitude: number, weather: Weather): number {
  if (altitude < -4) return 11000; // blue hour skylight
  if (altitude < 0) return 7000; // civil twilight just after sunset: warm horizon, blue sky above
  if (weather === 'overcast' || weather === 'heavy-overcast') return 6500;
  if (weather === 'open-shade') return 7500;
  if (altitude < 6) return 3500; // golden hour
  if (altitude < 20) return 4500;
  return 5500; // midday daylight
}

/** Hard or soft and front, side or back light relative to where the camera points. */
export function lightQuality(sun: { azimuth: number; altitude: number }, cameraHeading: number, hfovDeg: number, weather: Weather): LightQuality {
  const colorK = lightColorK(sun.altitude, weather);
  if (sun.altitude < -4) return { hardness: 'none', direction: 'none', sunInFrame: false, colorK, text: 'No direct sun: soft, blue skylight' };
  const diffuse = weather === 'overcast' || weather === 'heavy-overcast' || weather === 'open-shade' || sun.altitude < 0;
  const d = Math.abs(angleDiff(sun.azimuth, cameraHeading)); // 0 = sun ahead of the camera
  const direction: Direction = sun.altitude > 65 ? 'top' : d <= 45 ? 'back' : d < 135 ? 'side' : 'front';
  const sunInFrame = !diffuse && d <= hfovDeg / 2 && sun.altitude > -1;
  const hardness = diffuse ? 'soft' : 'hard';
  const dirText = { front: 'front light (sun behind you)', side: 'side light', back: 'back light (sun ahead of you)', top: 'top light', none: '' }[direction];
  const note = diffuse ? 'soft, low contrast' : sun.altitude < 6 ? 'hard but warm, long shadows' : sun.altitude > 50 ? 'hard, short shadows, deep eye sockets' : 'hard, crisp shadows';
  return { hardness, direction, sunInFrame, colorK, text: `${note}; ${dirText}${sunInFrame ? '; sun in frame, expect flare' : ''}` };
}

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp3 = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t) as [number, number, number];

/** Relative strength of direct sun on a surface facing it (0 below the horizon, 1 at midday). Low sun stays strong
 *  through golden hour, as in photos: shadows there are long and deep, not washed out. */
export const sunStrength = (altitude: number) =>
  altitude <= -0.5 ? 0 : ss(-0.5, 2.5, altitude) * (0.8 + 0.2 * Math.min(1, Math.sin((Math.max(0, altitude) * Math.PI) / 180) / 0.5));

/** The light as the eye adapts, for the World and Through Cam A: skylight level (1 by day, about 0.12 on a moonlit night, smooth through civil
 *  and nautical twilight), its colour (neutral by day, deep blue at night), how many stars show (0 to 1), and how much
 *  further the sky dims than the street (skyDim). */
export function daylight(altitude: number): { level: number; tint: [number, number, number]; stars: number; skyDim: number } {
  const pts: [number, number][] = [[-12, 0.12], [-6, 0.17], [-3, 0.22], [0, 0.26], [6, 0.5], [20, 1]];
  let level = altitude <= pts[0][0] ? pts[0][1] : 1;
  for (let i = 1; i < pts.length; i++) if (altitude < pts[i][0]) { const [a, la] = pts[i - 1], [b, lb] = pts[i]; level = la + (lb - la) * ss(0, 1, (altitude - a) / (b - a)); break; }
  return { level, tint: lerp3([0.42, 0.58, 1.0], [1, 1, 1], ss(-7, 3, altitude)), stars: 1 - ss(-10, -4, altitude), skyDim: 0.3 + 0.7 * ss(-8, 0, altitude) };
}

/** Through Cam A's preview grade for the photo (the render relights it for real): warmer at golden hour, bluer and
 *  less saturated after sunset. Colour only, with luminance kept: the camera's exposure already makes night dark. */
export function previewGrade(altitude: number): { rgb: [number, number, number]; desat: number } {
  const golden: [number, number, number] = [1.1, 0.98, 0.8], blue: [number, number, number] = [0.74, 0.86, 1.18], night: [number, number, number] = [0.66, 0.8, 1.3];
  let rgb: [number, number, number] = [1, 1, 1];
  if (altitude >= 0) rgb = lerp3(golden, [1, 1, 1], ss(3, 12, altitude));
  else rgb = lerp3(night, lerp3(blue, golden, ss(-3, 0, altitude)), ss(-12, -6, altitude));
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return { rgb: rgb.map(v => v / l) as [number, number, number], desat: 0.35 * (1 - ss(-12, -4, altitude)) };
}

/** The instant with the same clock time as `at` in `zone`, on another day (year, month 1-12, day). Uses the zone's offset
 *  on the new day, so a date across a daylight-saving change keeps the clock time, not the UTC time. */
export function setDayInZone(at: Date, zone: string, y: number, m: number, d: number): Date {
  const parts = (t: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(t).filter(p => p.type !== 'literal').map(p => [p.type, +p.value]));
  const p = parts(at);
  const want = Date.UTC(y, m - 1, d, p.hour, p.minute, p.second);
  const offset = (t: number) => { const q = parts(new Date(t)); return Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - t; };
  let t = want - offset(want);
  t = want - offset(t); // second pass settles a daylight-saving boundary
  return new Date(t + (at.getTime() % 1000));
}

/** Unit vector toward the sun in the scene's east-north-up frame. */
export function sunVector(azimuth: number, altitude: number): [number, number, number] {
  const az = (azimuth * Math.PI) / 180, el = (altitude * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
}
