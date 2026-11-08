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


/** A short version for a phone call: no coordinates, just walk, face, zoom. */
export function spokenPlan(spot: Spot | undefined, r: SolveResult): string {
  if (r.confidence === 'none') return `I couldn't place that photo at ${spot?.name ?? 'the spot'}.`;
  const p = r.pose, walk = spot ? metres(spot.lat, spot.lon, p.lat, p.lon) : 0;
  const where = spot && walk >= 10 ? `about ${Math.round(walk / 5) * 5} metres ${compassWord(bearing(spot.lat, spot.lon, p.lat, p.lon))} of the centre of ${spot.name}` : `at ${spot?.name ?? 'the spot'}`;
  return `The mark is ${where}. Face ${compassWord(p.heading)} and zoom to ${zoomWords(p.f35).replace(' (ultrawide)', ', the ultrawide')}.`;
}

/** Walking directions for a scout: distance, which way to walk, and how far to turn from where their phone points. */
export function walkWords(fromLat: number, fromLon: number, phoneHeading: number | undefined, markLat: number, markLon: number, markHeading: number): string {
  const d = metres(fromLat, fromLon, markLat, markLon);
  if (d < 6) return `You're on the mark. Now face ${compassWord(markHeading)}.`;
  const b = bearing(fromLat, fromLon, markLat, markLon);
  let turn = '';
  if (phoneHeading !== undefined) {
    const rel = ((b - phoneHeading + 540) % 360) - 180;
    turn = Math.abs(rel) < 20 ? ' It is straight ahead.' : Math.abs(rel) > 160 ? ' Turn around.' : ` Turn ${rel < 0 ? 'left' : 'right'} about ${Math.round(Math.abs(rel) / 10) * 10} degrees.`;
  }
  return `Walk about ${d < 50 ? Math.round(d) : Math.round(d / 10) * 10} metres ${compassWord(b)}.${turn}`;
}

/** Chat platforms show plain text: drop markdown the model may add, cap the length, and label previews. */
export function replyText(text: string, opts: { hasPreview: boolean; links?: { plan: string; scout: string } }): string {
  let t = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').replace(/`([^`]+)`/g, '$1').trim();
  if (opts.hasPreview && !/ai interpretation/i.test(t)) t += '\nThe picture is an AI interpretation of your version, made from your photo.';
  if (opts.links) t += `\nLive plan: ${opts.links.plan}\nScout at the spot: ${opts.links.scout}`;
  return t.length > 1900 ? `${t.slice(0, 1890)}…` : t;
}
