// Mechanism 5: messages at the moment of the shot. The module's reminder schedule fires inside SpacetimeDB and writes an outbox
// row; the crew turns it into one message per person with their live distance from the scout page ("You're 300 m away, about
// 4 min on foot."). Photon's shared iMessage line can't message first and may refuse a late message into an open thread, so a
// person whose iMessage refuses gets the same alert on their next channel (Telegram, SMS or email).
import { conn } from '../stdb.ts';
import { PUBLIC_URL } from '../config.ts';
import { metres } from '../geo.ts';
import { setContext } from '../set.ts';
import { llOf } from '../setgeo.ts';
import { fmtTime, sunWindows } from '../sun.ts';
import { sharedStore } from '../store.ts';
import { isRefusal, photonEnabled } from './api.ts';
import { run, targetFor, type Link } from './deliver.ts';
import { linksFor } from './people.ts';
import { alertLead, awayWords, conditionsLine } from './marks.ts';
import { conditions } from '../layers/index.ts';
import type { Channel } from './format.ts';
import { people, tryOrder } from './order.ts';
export { FALLBACK, people, tryOrder } from './order.ts';

export const LEAD_MIN = 20;

/** Schedules the next golden-hour alert for a session that has a mark and people on channels. Idempotent. */
export async function ensureAlert(sessionId: bigint, force = false): Promise<{ at: Date; start: Date; kind: string } | null> {
  const ctx = setContext(sessionId);
  if (!ctx || (!force && !linksFor(sessionId).length)) return null;
  const mark = llOf(ctx.origin, ctx.cam.x, ctx.cam.y);
  const w = sunWindows(mark.lat, mark.lon, ctx.cam.heading).golden;
  if (!w) return null;
  const at = new Date(w.start.getTime() - LEAD_MIN * 60_000);
  if (at.getTime() < Date.now() + 60_000 || at.getTime() > Date.now() + 20 * 3600_000) return null;
  const key = String(sessionId), prev = sharedStore().get<{ start: string }>('alerts', key);
  if (!force && prev?.start === w.start.toISOString() && [...conn.db.reminder.sessionId.filter(sessionId)].length) return { at, start: w.start, kind: w.kind };
  await conn.reducers.scheduleReminder({ sessionId, atMicros: BigInt(at.getTime()) * 1000n, text: `Golden hour starts in ${LEAD_MIN} min, at ${fmtTime(w.start, mark.lat, mark.lon)}.` });
  sharedStore().put('alerts', key, { start: w.start.toISOString(), kind: w.kind });
  return { at, start: w.start, kind: w.kind };
}

/** How far this person is from the mark, from their scout page's live position. */
function distanceOf(sessionId: bigint, l: Link): number | undefined {
  const ctx = setContext(sessionId);
  if (!ctx || !l.participantId) return undefined;
  const d = conn.db.devicePose.participantId.find(l.participantId);
  if (!d || Date.now() - Number(d.at.microsSinceUnixEpoch / 1000n) > 30 * 60_000) return undefined;
  const mark = llOf(ctx.origin, ctx.cam.x, ctx.cam.y);
  return metres(d.lat, d.lon, mark.lat, mark.lon);
}

export type AlertResult = { name: string; channel?: Channel; tried: Channel[]; ok: boolean; error?: string };

/** One alert to everyone in the session, personalised, each on the first channel that takes it. */
export async function deliverAlert(sessionId: bigint, baseText: string, idem: string): Promise<AlertResult[]> {
  const out: AlertResult[] = [];
  if (!photonEnabled()) return out;
  const store = sharedStore(), saved = store.get<{ start: string; kind: string }>('alerts', String(sessionId));
  const lead = saved && Math.abs(new Date(saved.start).getTime() - Date.now()) < 3 * 3600_000 ? alertLead(saved.kind, new Date(saved.start)) : baseText;
  const code = conn.db.session.id.find(sessionId)?.code ?? '';
  // The geo thread's shot conditions for the window (sky, colour chance, wind, tide, permits near the mark).
  const at = saved ? new Date(saved.start) : new Date(Date.now() + 20 * 60_000);
  // Sets started from a text thread learn their spot from the solve, so pass it: the geo resolver reads session.spotId first.
  // 8 s cap: a slow geo source never holds up an alert that has to land at its minute.
  const cond = await Promise.race([conditions({ sessionId, spotId: setContext(sessionId)?.spotId, at }).catch(e => { console.warn(`alert conditions: ${(e as Error).message}`); return null; }),
    new Promise<null>(r => setTimeout(() => r(null), 8_000))]);
  const extra = conditionsLine(cond);
  const hasThread = (l: Link) => store.threads().some(t => t.channel === l.channel && !!t.handle && t.sessionId === String(sessionId));
  for (const person of people(linksFor(sessionId))) {
    const order = tryOrder(person, hasThread), d = distanceOf(sessionId, person[0]);
    const text = [lead, awayWords(d) || `Open the scout page to walk to the mark: ${PUBLIC_URL}/s/${code}`, extra].filter(Boolean).join(' ');
    const r: AlertResult = { name: person[0].name, tried: [], ok: false };
    for (const l of order) {
      r.tried.push(l.channel);
      try {
        const t = await targetFor(l);
        await run(t, [{ op: 'text', text, subject: lead }], { idem: `${idem}:${person[0].name}` });
        Object.assign(r, { ok: true, channel: l.channel });
        break;
      } catch (e) {
        r.error = (e as Error).message;
        if (!isRefusal(e)) console.warn(`alert to ${l.name} on ${l.channel}: ${r.error}`);
      }
    }
    if (!order.length) r.error = 'no channel that allows a late message (iMessage needs their text first)';
    out.push(r);
  }
  return out;
}

export function startAlerts() {
  const busy = new Set<bigint>();
  const deliver = async () => {
    for (const o of [...conn.db.outbox.iter()].filter(o => o.state === 'pending' && !busy.has(o.id))) {
      busy.add(o.id);
      let state: 'sent' | 'failed' = 'failed';
      try {
        const res = await deliverAlert(o.sessionId, o.text, `alert:${o.id}`);
        state = res.some(r => r.ok) ? 'sent' : 'failed';
        console.log(`alert ${o.id} (session ${o.sessionId}): ${res.map(r => `${r.name} ${r.ok ? `via ${r.channel}` : `failed after ${r.tried.join(', ') || 'no channel'}`}`).join('; ') || (photonEnabled() ? 'nobody on a channel' : 'Photon is off')}`);
      } catch (e) { console.warn(`alert ${o.id}: ${(e as Error).message}`); }
      await conn.reducers.markOutbox({ id: o.id, state }).catch(e => console.warn(`markOutbox: ${e.message}`));
      busy.delete(o.id);
    }
  };
  const schedule = () => { for (const s of conn.db.session.iter()) void ensureAlert(s.id).catch(e => console.warn(`ensureAlert ${s.id}: ${e.message}`)); };
  conn.db.outbox.onInsert(() => void deliver());
  conn.db.channelLink.onInsert((_c, l) => void ensureAlert(l.sessionId).catch(() => {}));
  setInterval(() => void deliver(), 30_000);
  setInterval(schedule, 10 * 60_000);
  void deliver();
  schedule();
}
