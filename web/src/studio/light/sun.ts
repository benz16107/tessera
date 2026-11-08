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

/** Relative sun strength for the viewport's directional light (0 at the horizon, about 1 at midday). */
export const sunStrength = (altitude: number) => (altitude <= 0 ? 0 : Math.min(1, Math.sin((altitude * Math.PI) / 180) * 1.25));

/** Unit vector toward the sun in the scene's east-north-up frame. */
export function sunVector(azimuth: number, altitude: number): [number, number, number] {
  const az = (azimuth * Math.PI) / 180, el = (altitude * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
}
