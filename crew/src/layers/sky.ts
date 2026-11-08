// Sun and moon for the shot day, from suncalc (computed, no source to credit beyond the library).
import SunCalc from 'suncalc';
import { fc, type LayerOut, type Place } from './types.ts';

export interface MoonSummary {
  rise: string | null; set: string | null; phase: number; phaseName: string; illumination: number;
  at: { az: number; alt: number }; sunrise: string | null; sunset: string | null;
}

const deg = (r: number) => (r * 180) / Math.PI;
const moonAt = (t: Date, p: Place) => { const m = SunCalc.getMoonPosition(t, p.lat, p.lon); return { az: (deg(m.azimuth) + 180 + 360) % 360, alt: deg(m.altitude) }; };

export function phaseName(f: number) {
  const names = ['new moon', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full moon', 'waning gibbous', 'last quarter', 'waning crescent'];
  return names[Math.round(f * 8) % 8];
}

/** Midnight of `at`'s day in the spot's time zone. */
export function localMidnight(at: Date, zone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at).map(x => [x.type, x.value]));
  return new Date(at.getTime() - ((+p.hour * 60 + +p.minute) * 60 + +p.second) * 1000 - (at.getTime() % 1000));
}

/** Moonrise and moonset found by stepping the moon's altitude through the spot's local day (suncalc's own search
 *  starts at the server's midnight, which is not the spot's). */
export function moonLayer(p: Place, at: Date): LayerOut<MoonSummary> {
  const d0 = localMidnight(at, p.zone);
  let rise: Date | null = null, set: Date | null = null;
  let prev = moonAt(d0, p).alt;
  for (let t = d0.getTime() + 5 * 60_000; t <= d0.getTime() + 86_400_000; t += 5 * 60_000) {
    const a = moonAt(new Date(t), p).alt;
    const cross = new Date(t - (5 * 60_000 * a) / (a - prev || 1));
    if (prev < 0 && a >= 0 && !rise) rise = cross;
    if (prev >= 0 && a < 0 && !set) set = cross;
    prev = a;
  }
  const m = SunCalc.getMoonIllumination(at);
  const times = SunCalc.getTimes(new Date(d0.getTime() + 12 * 3_600_000), p.lat, p.lon);
  const now = moonAt(at, p);
  const summary: MoonSummary = {
    rise: rise?.toISOString() ?? null, set: set?.toISOString() ?? null, phase: Math.round(m.phase * 1000) / 1000, phaseName: phaseName(m.phase),
    illumination: Math.round(m.fraction * 100), at: { az: Math.round(now.az), alt: Math.round(now.alt * 10) / 10 },
    sunrise: isNaN(times.sunrise.getTime()) ? null : times.sunrise.toISOString(), sunset: isNaN(times.sunset.getTime()) ? null : times.sunset.toISOString(),
  };
  return { geojson: fc([]), summary, sources: [{ layer: 'moon', name: 'suncalc (Vladimir Agafonkin)', url: 'https://github.com/mourner/suncalc', license: 'BSD 2-Clause', fetchedAt: null }] };
}
