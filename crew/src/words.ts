// Pure text helpers for the agent: no connection, so the tests can import them.
import { sunWindows, windowWords } from './sun.ts';
import { bearing, compassWord, metres, zoomWords } from './geo.ts';
import type { SolveResult, Spot } from './module_bindings/types.ts';

export function matchSpotByName(text: string, list: { id: string; name: string }[]) {
  const t = text.toLowerCase();
  let best: { id: string; name: string } | undefined, score = 0;
  for (const s of list) {
    const words = new Set(`${s.id.replace(/_/g, ' ')} ${s.name}`.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4));
    const n = [...words].filter(w => t.includes(w)).length;
    if (n > score) { best = s; score = n; }
  }
  return best;
}

export function answerText(spot: Spot | undefined, r: SolveResult): string {
  const name = spot?.name ?? 'this spot';
  if (r.confidence === 'none') {
    const lens = r.lensReadF35 ? ` The lens looks like about ${Math.round(r.lensReadF35)} mm (${zoomWords(r.lensReadF35)} on an iPhone).` : '';
    return `Couldn't place this photo at ${name}. ${r.reason}.${lens}`;
  }
  const p = r.pose, lines = [`${r.confidence === 'check' ? 'Check this' : 'Solid'}: ${name}. ${r.reason}.`];
  const walk = spot ? metres(spot.lat, spot.lon, p.lat, p.lon) : 0;
  lines.push(`Stand at ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` +
    (spot && walk >= 10 ? `, about ${Math.round(walk / 5) * 5} m ${compassWord(bearing(spot.lat, spot.lon, p.lat, p.lon))} of the spot centre.` : ', at the spot centre.'));
  lines.push(`Face ${compassWord(p.heading)} (${Math.round((p.heading + 360) % 360)}°), tilted ${p.pitch >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(p.pitch))}°.`);
  lines.push(`Lens: ${Math.round(p.f35)} mm equivalent, about ${zoomWords(p.f35)} on an iPhone.`);
  const w = sunWindows(p.lat, p.lon, p.heading);
  const light = [windowWords(w.golden, p.lat, p.lon), windowWords(w.blue, p.lat, p.lon)].filter(Boolean);
  if (w.goldenFrontLit && w.goldenFrontLit !== w.golden) light.push(`front-lit: ${windowWords(w.goldenFrontLit, p.lat, p.lon)}`);
  if (light.length) lines.push(`Next good light: ${light.join('; ')}.`);
  return lines.join('\n');
}

const NUM: Record<string, number> = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, couple: 2 };
export function parseFollowUp(text: string) {
  const t = text.toLowerCase();
  const mm = /(\d{2,3})\s*mm\b/.exec(t);
  const ppl = /\b(\d+|one|a|two|three|four|five|couple)\s+(?:of\s+)?(people|persons|friends|person|of us)\b/.exec(t);
  const light = /\b(sunset|sunrise|golden)\b/.test(t) ? 'golden hour' : /\b(blue hour|dusk|twilight)\b/.test(t) ? 'blue hour' : undefined;
  return { f35: mm ? Number(mm[1]) : undefined, people: ppl ? (NUM[ppl[1]] ?? Number(ppl[1])) : 0, light };
}

