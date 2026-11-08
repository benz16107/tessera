// The conditions summary agents read: one paragraph for the shot time, and the same facts as fields.
// "Sunday 6:35 AM: 40% mid cloud, good colour chance; low tide 6:58 exposes the rocks; film permit on Washington St
//  7 to 11 AM; wind 9 mph."
import type { WeatherSummary, Hour } from './weather.ts';
import type { AlertSummary } from './hazards.ts';
import type { TideSummary } from './tides.ts';
import type { ShadowSummary } from './buildings.ts';
import type { MoonSummary } from './sky.ts';
import type { ColorChance } from './score.ts';
import { dayIn, fmtIn, dateIn, type FC, type Place } from './types.ts';

export interface Conditions {
  at: string; text: string; lines: string[];
  weather: Hour | null; colorChance: (ColorChance & { kind: 'sunrise' | 'sunset'; t: string }) | null; haze: string | null;
  tide: { next: TideSummary['next']; station: string | null; note: string } | null;
  alerts: { event: string; severity: string; ends: string }[];
  blockers: { kind: string; label: string; detail: string; start?: string; end?: string; m: number }[];
  shadow: string | null; moon: string | null;
}

interface Input { layers: Partial<Record<string, FC>>; summary: Partial<Record<string, unknown>> }

export function buildConditions(p: Place, at: Date, r: Input): Conditions {
  const fmt = fmtIn(p.zone), day = dayIn(p.zone), date = dateIn(p.zone);
  const w = r.summary.weather as WeatherSummary | undefined;
  const tides = r.summary.tides as TideSummary | undefined;
  const al = r.summary.alerts as AlertSummary | undefined;
  const sh = r.summary.shadow as ShadowSummary | undefined;
  const moon = r.summary.moon as MoonSummary | undefined;
  const lines: string[] = [];

  const now = w?.now ?? null;
  const ev = w?.events.filter(e => Math.abs(Date.parse(e.t) - at.getTime()) < 3 * 3_600_000).sort((a, b) => Math.abs(Date.parse(a.t) - at.getTime()) - Math.abs(Date.parse(b.t) - at.getTime()))[0];
  if (now) {
    const clouds = [now.low && `${now.low}% low`, now.mid && `${now.mid}% mid`, now.high && `${now.high}% high`].filter(Boolean).join(', ');
    lines.push(`${clouds ? `${clouds} cloud` : 'clear sky'}${now.rainPct >= 20 ? `, ${now.rainPct}% chance of rain` : ''}${now.visKm < 5 ? `, visibility ${now.visKm} km` : ''}`);
  }
  if (ev) lines.push(`${ev.kind} ${fmt(new Date(ev.t))}: ${ev.chance.label} colour chance (${ev.chance.score}; ${ev.chance.why})`);
  if (tides?.station) {
    const near = [tides.next.low, tides.next.high].filter((x): x is { t: string; ft: number } => !!x).sort((a, b) => Date.parse(a.t) - Date.parse(b.t))[0];
    if (tides.next.low && near === tides.next.low) lines.push(tides.note.replace(/^Low tide/, 'low tide'));
    else if (tides.next.high) lines.push(`high tide ${fmt(new Date(tides.next.high.t))} (${tides.next.high.ft.toFixed(1)} ft)${tides.next.low ? `, then low ${fmt(new Date(tides.next.low.t))}` : ''}`);
  }
  for (const a of al?.alerts ?? []) lines.push(`NWS ${a.event}${a.ends ? ` until ${fmt(new Date(a.ends))}` : ''}`);
  // Permits that could be in the frame: within 250 m, in force at the shot time (or within the next three days).
  const blockers: Conditions['blockers'] = [];
  for (const id of ['film', 'closures', 'construction'] as const)
    for (const f of r.layers[id]?.features ?? []) {
      if (!f.properties.active || Number(f.properties.m ?? 0) > 250) continue;
      blockers.push({ kind: f.properties.kind, label: f.properties.label, detail: f.properties.detail ?? '', start: f.properties.start, end: f.properties.end, m: Number(f.properties.m ?? 0) });
    }
  blockers.sort((a, b) => a.m - b.m);
  const near = blockers.slice(0, 3);
  for (const b of near) lines.push(b.kind === 'film_permit' || b.kind === 'event_permit' ? `${b.label} on ${b.detail.split(':')[0]}`
    : b.kind === 'street_closure' ? `${b.label} (${b.m} m away)` : `${b.label.charAt(0).toLowerCase()}${b.label.slice(1)}, ${b.m} m away (${b.detail})`);
  if (blockers.length > near.length) lines.push(`${blockers.length - near.length} more permits within 250 m`);
  if (sh?.readout) lines.push(sh.readout.charAt(0).toLowerCase() + sh.readout.slice(1));
  if (now) lines.push(`wind ${now.windMph} mph${now.gustMph >= now.windMph + 8 ? ` gusting ${now.gustMph}` : ''}, ${now.tempF}°F`);
  if (w?.haze) lines.push(`${w.haze.label} (${w.haze.detail.split(':')[0]})`);
  const moonLine = moon ? `${moon.phaseName}, ${moon.illumination}% lit${moon.rise ? `, rises ${fmt(new Date(moon.rise))}` : ''}${moon.set ? `, sets ${fmt(new Date(moon.set))}` : ''}` : null;
  const night = moon && moon.sunset && moon.sunrise && (at.getTime() > Date.parse(moon.sunset) || at.getTime() < Date.parse(moon.sunrise));
  if (moonLine && (night || (moon && moon.at.alt > 0 && moon.illumination > 30))) lines.push(`moon: ${moonLine}${moon!.at.alt > 0 ? ` (up, ${Math.round(moon!.at.alt)}°)` : ''}`);

  const when = `${day(at)} ${date(at)}, ${fmt(at)}`;
  return {
    at: at.toISOString(), text: `${when}: ${lines.join('; ')}.`, lines,
    weather: now, colorChance: ev ? { ...ev.chance, kind: ev.kind, t: ev.t } : null, haze: w?.haze ? `${w.haze.label}: ${w.haze.detail}` : null,
    tide: tides?.station ? { next: tides.next, station: tides.station.name, note: tides.note } : null,
    alerts: (al?.alerts ?? []).map(a => ({ event: a.event, severity: a.severity, ends: a.ends })),
    blockers, shadow: sh?.readout ?? null, moon: moonLine,
  };
}
