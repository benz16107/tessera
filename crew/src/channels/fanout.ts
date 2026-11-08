// Mechanism 1: one live set, everyone on their own channel. Events in the SpacetimeDB set (a finished render, a moved camera,
// a scout reaching the mark, a check-in, the call sheet) go to every channel_link in the session, formatted for that channel.
import sharp from 'sharp';
import { join } from 'node:path';
import { conn } from '../stdb.ts';
import { PREVIEWS_DIR, PUBLIC_URL } from '../config.ts';
import { ensureLocal } from '../images.ts';
import { cropForF35, compassWord } from '../geo.ts';
import { setContext } from '../set.ts';
import { sharedStore } from '../store.ts';
import { isRefusal, photonEnabled } from './api.ts';
import { lensOptions, plan, type Channel, type SetEvent } from './format.ts';
import { run, targetFor, type Link } from './deliver.ts';
import { linksFor } from './people.ts';
import { noteVersionMessages, recordVersion } from './versions.ts';

export type Result = { name: string; channel: Channel; ok: boolean; ids: string[]; error?: string };

/** Spaces a thread handler is answering right now, per session: fan-out leaves them to the handler's threaded reply. */
export const busy = new Map<string, Set<string>>();
export function hold(sessionId: bigint, spaceId: string) {
  const k = String(sessionId), s = busy.get(k) ?? new Set();
  s.add(spaceId); busy.set(k, s);
  return () => { s.delete(spaceId); };
}
/** Preview jobs a thread handler started; fan-out waits for the handler's version instead of recording its own. */
export const owned = new Map<bigint, Promise<{ versionId: bigint; label: string; skip?: string } | null>>();

export const planUrl = (sessionId: bigint) => `${PUBLIC_URL}/p/${conn.db.session.id.find(sessionId)?.code ?? ''}`;

/** Sends one event to everyone in the session. ev may depend on the channel. Each (idem, person) pair sends at most once. */
export async function broadcast(sessionId: bigint, ev: SetEvent | ((l: Link) => SetEvent | null), opts: { idem?: string; skip?: Set<string>; parentFor?: (l: Link) => string | undefined } = {}): Promise<Result[]> {
  if (!photonEnabled()) return [];
  const out: Result[] = [], store = sharedStore(), skip = new Set([...(opts.skip ?? []), ...(busy.get(String(sessionId)) ?? [])]);
  for (const l of linksFor(sessionId)) {
    const e = typeof ev === 'function' ? ev(l) : ev;
    const ops = e ? plan(e, l.channel) : [];
    if (!ops.length) continue;
    const dk = opts.idem ? `${opts.idem}:${l.channel}:${l.address}` : '';
    if (dk && store.get('sent', dk)) continue;
    try {
      const t = await targetFor(l);
      if (skip.has(t.spaceId)) continue;
      const sent = await run(t, ops, { idem: opts.idem, parentMessageId: opts.parentFor?.(l) });
      if (dk) store.put('sent', dk, sent.ids[0] ?? 'sent');
      out.push({ name: l.name, channel: l.channel, ok: true, ids: sent.ids });
    } catch (err) {
      const msg = (err as Error).message;
      // A refused channel (shared line before a first text, a bot never started) is expected; log it quietly.
      console[isRefusal(err) ? 'log' : 'warn'](`fan-out to ${l.name} on ${l.channel}: ${msg}`);
      out.push({ name: l.name, channel: l.channel, ok: false, ids: [], error: msg });
    }
  }
  return out;
}

/** Lens options for Telegram's album: exact centre crops of the render at longer focal lengths, saved next to it. */
async function lensCrops(path: string, baseF35: number): Promise<{ f35: number; path: string }[]> {
  const opts = lensOptions(baseF35);
  if (opts.length < 2) return [];
  const meta = await sharp(path).metadata(), w = meta.width ?? 0, h = meta.height ?? 0, out = [{ f35: opts[0], path }];
  for (const f of opts.slice(1)) {
    const c = cropForF35(w, h, baseF35, f);
    if (!c) continue;
    const file = join(PREVIEWS_DIR, `${path.split('/').pop()!.replace(/\.\w+$/, '')}_${f}mm.jpg`);
    await sharp(path).extract(c).resize({ width: w, height: h }).jpeg({ quality: 88 }).toFile(file);
    out.push({ f35: f, path: file });
  }
  return out;
}

/** A finished render or preview: record it as a version (unless a thread handler owns it), then send it to everyone. */
export async function onRender(jobId: bigint) {
  const j = conn.db.previewJob.id.find(jobId);
  if (!j || j.state !== 'done' || !j.imageUrl) return;
  const path = await ensureLocal(j.imageUrl);
  if (!path) return;
  const mine = owned.get(jobId);
  // A handler that crashed never settles its promise; after 10 minutes the fan-out records the version itself.
  const v = mine ? await Promise.race([mine, new Promise<null>(r => setTimeout(() => r(null), 600_000))]) : null;
  const row = v ? conn.db.shotVersion.id.find(v.versionId) : await recordVersion(j.sessionId, { externalMessageId: `render:${jobId}`, channel: j.kind === 'render' ? 'studio' : 'web', imageUrl: j.imageUrl });
  if (!row) return;
  const ctx = setContext(j.sessionId), f35 = j.f35 ?? ctx?.cam.f35 ?? 35;
  const lenses = linksFor(j.sessionId).some(l => l.channel === 'telegram') ? await lensCrops(path, f35).catch(() => []) : [];
  const caption = j.instruction ? j.instruction.split('. In the shot:')[0] : `${Math.round(f35)} mm, facing ${compassWord(ctx?.cam.heading ?? 0)}`;
  const res = await broadcast(j.sessionId, { kind: 'render', label: row.label, caption, image: path, imageUrl: `${PUBLIC_URL}${j.imageUrl}`, lenses, planUrl: planUrl(j.sessionId), title: conn.db.session.id.find(j.sessionId)?.title ?? 'your shot' },
    { idem: `render:${jobId}`, skip: v?.skip ? new Set([v.skip]) : undefined });
  owned.delete(jobId);
  noteVersionMessages(row.id, res.flatMap(r => r.ids));
  // Telegram: the one progress message is edited to say the render is done (format.ts adds that op to the render).
}

// Camera moves arrive as many small updates while someone drags; announce once it rests and has really moved.
const camLast = new Map<string, { x: number; y: number; heading: number; f35: number }>(), camTimer = new Map<string, NodeJS.Timeout>();
function onCameraMaybeMoved(sessionId: bigint, who: string) {
  const k = String(sessionId);
  clearTimeout(camTimer.get(k));
  camTimer.set(k, setTimeout(async () => {
    const ctx = setContext(sessionId);
    if (!ctx) return;
    const c = ctx.cam, prev = camLast.get(k);
    camLast.set(k, { x: c.x, y: c.y, heading: c.heading, f35: c.f35 });
    if (!prev) return; // the first sighting is the baseline, not a move
    const moved = Math.hypot(c.x - prev.x, c.y - prev.y), turned = Math.abs(((c.heading - prev.heading + 540) % 360) - 180), zoomed = Math.abs(c.f35 - prev.f35);
    if (moved < 2 && turned < 10 && zoomed < 5) return;
    const what = [moved >= 2 && `moved it ${Math.round(moved)} m`, turned >= 10 && `turned it to face ${compassWord(c.heading)}`, zoomed >= 5 && `changed the lens to ${Math.round(c.f35)} mm`].filter(Boolean).join(', ');
    await broadcast(sessionId, { kind: 'note', text: `${who} ${what}. The mark is now ${Math.round(Math.hypot(c.x, c.y))} m ${compassWord(Math.atan2(c.x, c.y) * 180 / Math.PI)} of the spot centre, facing ${compassWord(c.heading)}, ${Math.round(c.f35)} mm.`, planUrl: planUrl(sessionId) });
  }, 15_000));
}

const nameOfIdentity = (sessionId: bigint, hex: string) =>
  [...conn.db.participant.sessionId.filter(sessionId)].find(p => p.identity.toHexString() === hex)?.name ?? 'Someone';

export function startFanout() {
  conn.db.previewJob.onUpdate((_c, old, j) => {
    if (old.state !== 'done' && j.state === 'done') void onRender(j.id).catch(e => console.warn(`fan-out render ${j.id}: ${e.message}`));
    // Telegram: one message per render, edited in place while it runs.
    if (old.state !== 'running' && j.state === 'running' && j.kind === 'render')
      void broadcast(j.sessionId, { kind: 'progress', key: `job:${j.id}`, text: 'Rendering the set…' }, { idem: `progress:${j.id}` }).catch(() => {});
  });
  const crew = () => conn.identity?.toHexString();
  conn.db.sceneObject.onUpdate((_c, _o, n) => { if (n.kind === 'camera' && n.updatedBy.toHexString() !== crew()) onCameraMaybeMoved(n.sessionId, nameOfIdentity(n.sessionId, n.updatedBy.toHexString())); });
  conn.db.camera.onUpdate((_c, _o, n) => { if (n.updatedBy.toHexString() !== crew()) onCameraMaybeMoved(n.sessionId, nameOfIdentity(n.sessionId, n.updatedBy.toHexString())); });
  // Toasts reach the crew as its own copy (one row per recipient). Arrivals and check-ins go to everyone's channel.
  conn.db.toast.onInsert((_c, t) => {
    if (t.kind === 'scout_arrived' || t.kind === 'checkin' || t.kind === 'version_forked')
      void broadcast(t.sessionId, { kind: 'note', text: t.text, planUrl: planUrl(t.sessionId) }).catch(() => {});
  });
  for (const s of conn.db.session.iter()) { const c = setContext(s.id)?.cam; if (c) camLast.set(String(s.id), { x: c.x, y: c.y, heading: c.heading, f35: c.f35 }); }
}
