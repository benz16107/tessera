// Pure geometry and words for being at the mark: photo check-ins, turn-by-turn voice guidance and golden-hour distance lines.
// Positions are metres east (x) and north (y) of the spot, the scene_object frame. Headings are degrees clockwise from north.
import { compassWord } from '../geo.ts';

export const PACE_M = 0.75;
export const WALK_M_PER_MIN = 80; // about 1.3 m/s
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export type Mark = { x: number; y: number; heading: number };
export type Correction = { distanceM: number; aheadM: number; rightM: number; headingErrDeg: number; verdict: 'on the mark' | 'close' | 'off the mark'; words: string };

const paces = (m: number) => { const n = Math.max(1, Math.round(Math.abs(m) / PACE_M)); return n === 1 ? 'one pace' : n === 2 ? 'two paces' : n === 3 ? 'three paces' : `${n} paces`; };
const metresWords = (m: number) => (m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`);

/** How the scout's solved photo differs from the shot camera, and what to do about it. */
export function correction(mark: Mark, at: Mark): Correction {
  const dx = at.x - mark.x, dy = at.y - mark.y, h = (mark.heading * Math.PI) / 180;
  const aheadM = dx * Math.sin(h) + dy * Math.cos(h); // + means the scout stands in front of the mark (toward the subject)
  const rightM = dx * Math.cos(h) - dy * Math.sin(h); // + means right of the mark, as the camera faces
  const distanceM = Math.hypot(dx, dy), headingErrDeg = wrap(at.heading - mark.heading); // + means facing too far right
  const verdict = distanceM <= 1.5 && Math.abs(headingErrDeg) <= 8 ? 'on the mark' : distanceM <= 6 && Math.abs(headingErrDeg) <= 25 ? 'close' : 'off the mark';
  if (verdict === 'on the mark') return { distanceM, aheadM, rightM, headingErrDeg, verdict, words: "You're on the mark. Take the shot." };
  const where = distanceM > 1.5 ? `${metresWords(distanceM)} ${compassWord((Math.atan2(dx, dy) * 180) / Math.PI)} of the mark` : 'on the mark';
  const facing = Math.abs(headingErrDeg) > 8 ? ` and facing ${Math.round(Math.abs(headingErrDeg))} degrees too far ${headingErrDeg > 0 ? 'right' : 'left'}` : '';
  const moves: string[] = [];
  if (distanceM > 1.5) {
    if (Math.abs(aheadM) >= 0.6) moves.push(`step ${aheadM > 0 ? 'back' : 'forward'} ${paces(aheadM)}`);
    if (Math.abs(rightM) >= 0.6) moves.push(`${paces(rightM)} to your ${rightM > 0 ? 'left' : 'right'}`);
  }
  if (Math.abs(headingErrDeg) > 8) moves.push(`turn ${headingErrDeg > 0 ? 'left' : 'right'} ${Math.round(Math.abs(headingErrDeg))} degrees`);
  const todo = moves.length ? ` ${moves.join(', then ')}.` : '';
  return { distanceM, aheadM, rightM, headingErrDeg, verdict, words: `You're ${where}${facing}.${todo.replace(/^ (\w)/, (_, c) => ` ${c.toUpperCase()}`)}` };
}

/** One turn-by-turn instruction from a live phone position and compass to the mark ("Walk 12 m north, then turn left 26 degrees."). */
export function guide(from: { x: number; y: number; heading?: number }, mark: Mark): string {
  const dx = mark.x - from.x, dy = mark.y - from.y, d = Math.hypot(dx, dy);
  if (d < 2) {
    if (from.heading === undefined) return `You're on the mark. Face ${compassWord(mark.heading)}.`;
    const t = wrap(mark.heading - from.heading);
    return Math.abs(t) <= 8 ? "You're on the mark and facing the right way. Take the shot." : `You're on the mark. Turn ${t < 0 ? 'left' : 'right'} ${Math.round(Math.abs(t))} degrees.`;
  }
  const bearing = (((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360;
  const walk = `Walk ${d < 20 ? Math.round(d) : Math.round(d / 5) * 5} m ${compassWord(bearing)}`;
  if (from.heading === undefined) return `${walk}.`;
  const t = wrap(bearing - from.heading);
  return Math.abs(t) <= 10 ? `${walk}, straight ahead.` : Math.abs(t) >= 165 ? `Turn around, then ${walk.toLowerCase()}.` : `Turn ${t < 0 ? 'left' : 'right'} ${Math.round(Math.abs(t))} degrees, then ${walk.toLowerCase()}.`;
}

/** "You're 300 m away, about 4 min on foot." for an alert; empty when we don't know where they are. */
export function awayWords(distanceM: number | undefined): string {
  if (distanceM === undefined || !Number.isFinite(distanceM)) return '';
  if (distanceM < 15) return "You're at the mark.";
  const m = distanceM < 100 ? Math.round(distanceM / 5) * 5 : distanceM < 1000 ? Math.round(distanceM / 10) * 10 : Math.round(distanceM / 100) * 100;
  const dist = m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
  return `You're ${dist} away, about ${Math.max(1, Math.round(distanceM / WALK_M_PER_MIN))} min on foot.`;
}

/** The light alert line: "Golden hour starts in 20 min." */
export function alertLead(kind: string, start: Date, now = new Date()): string {
  const min = Math.round((start.getTime() - now.getTime()) / 60_000);
  return min > 1 ? `${kind[0].toUpperCase()}${kind.slice(1)} starts in ${min} min.` : `${kind[0].toUpperCase()}${kind.slice(1)} is starting now.`;
}
