import SunCalc from 'suncalc';
import { relativeAngle } from './geo.ts';

const deg = (r: number) => (r * 180) / Math.PI;
/** suncalc azimuth is radians from south, westward; this returns degrees clockwise from north. */
export const sunAt = (when: Date, lat: number, lon: number) => {
  const p = SunCalc.getPosition(when, lat, lon);
  return { az: (deg(p.azimuth) + 180 + 360) % 360, alt: deg(p.altitude) };
};

export type Window = { kind: 'golden hour' | 'blue hour'; start: Date; end: Date; sunAz: number; sunRel: number; sunBehind: boolean };

/** The next golden and blue hour windows (morning or evening) after `now`, with where the sun sits relative to the camera. */
export function sunWindows(lat: number, lon: number, heading: number, now = new Date()) {
  const all: Window[] = [];
  for (let day = 0; day < 3; day++) {
    const t = SunCalc.getTimes(new Date(now.getTime() + day * 86_400_000), lat, lon);
    const add = (kind: Window['kind'], start: Date, end: Date) => {
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= now) return;
      const az = sunAt(new Date((start.getTime() + end.getTime()) / 2), lat, lon).az, rel = relativeAngle(az, heading);
      all.push({ kind, start, end, sunAz: Math.round(az), sunRel: Math.round(rel), sunBehind: Math.abs(rel) > 120 });
    };
    add('blue hour', t.dawn, t.sunrise);
    add('golden hour', t.sunrise, t.goldenHourEnd);
    add('golden hour', t.goldenHour, t.sunset);
    add('blue hour', t.sunset, t.dusk);
  }
  all.sort((a, b) => a.start.getTime() - b.start.getTime());
  return {
    golden: all.find(w => w.kind === 'golden hour') ?? null,
    blue: all.find(w => w.kind === 'blue hour') ?? null,
    // The next golden hour with the sun behind the photographer, lighting the subject.
    goldenFrontLit: all.find(w => w.kind === 'golden hour' && w.sunBehind) ?? null,
  };
}

// shortcut: time zone guessed from longitude for US spots, UTC offset elsewhere; add a tz field to spot.json if spots leave the US.
export function tzFor(lat: number, lon: number): string {
  if (lat > 24 && lat < 50 && lon > -125 && lon < -66)
    return lon > -87 ? 'America/New_York' : lon > -101 ? 'America/Chicago' : lon > -114 ? 'America/Denver' : 'America/Los_Angeles';
  const off = Math.round(lon / 15);
  return off === 0 ? 'UTC' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`;
}

export const fmtTime = (d: Date, lat: number, lon: number) =>
  d.toLocaleString('en-US', { timeZone: tzFor(lat, lon), weekday: 'short', hour: 'numeric', minute: '2-digit' });

export function windowWords(w: Window | null, lat: number, lon: number): string {
  if (!w) return '';
  const where = w.sunBehind ? 'sun behind you' : Math.abs(w.sunRel) < 60 ? 'sun in frame' : `sun to your ${w.sunRel < 0 ? 'left' : 'right'}`;
  return `${w.kind} ${fmtTime(w.start, lat, lon)} to ${fmtTime(w.end, lat, lon).split(' ').slice(1).join(' ')}, ${where}`;
}
