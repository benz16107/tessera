// The thread is the version tree. Every render the crew sends is a shot_version row pointing at a scene_change id; replying
// to a version's message forks the set from it (restoreToVersion), applies the reply, renders, and answers in the thread.
import { join } from 'node:path';
import { conn, logStep, until } from '../stdb.ts';
import { PREVIEWS_DIR } from '../config.ts';
import { ensureLocal } from '../images.ts';
import { setContext, sessionObjects } from '../set.ts';
import { frameOf } from '../setgeo.ts';
import { sunAt, tzFor } from '../sun.ts';
import { sharedStore } from '../store.ts';
import { labelIn, treeText, type V } from './tree.ts';

export const versionsOf = (sessionId: bigint): V[] => [...conn.db.shotVersion.sessionId.filter(sessionId)].map(v => ({
  id: v.id, parentVersionId: v.parentVersionId, label: v.label, channel: v.channel, externalMessageId: v.externalMessageId,
  imageUrl: v.imageUrl, createdAt: v.createdAt.toDate(),
}));

export function versionsText(sessionId: bigint) {
  const ctx = setContext(sessionId);
  return treeText(versionsOf(sessionId), ctx ? tzFor(ctx.origin.lat, ctx.origin.lon) : undefined);
}

const latestChange = (sessionId: bigint) => [...conn.db.sceneChange.sessionId.filter(sessionId)].reduce((m, c) => (c.id > m ? c.id : m), 0n);

/** Records a version (the module numbers it v1, v2, v3) and returns the row once the subscription has it. */
export async function recordVersion(sessionId: bigint, a: { externalMessageId: string; channel: string; imageUrl: string; parentVersionId?: bigint }) {
  const find = () => [...conn.db.shotVersion.sessionId.filter(sessionId)].find(v => v.externalMessageId === a.externalMessageId);
  const old = find();
  if (old) return old;
  await conn.reducers.recordShotVersion({ sessionId, parentVersionId: a.parentVersionId, label: '', externalMessageId: a.externalMessageId.slice(0, 200), channel: a.channel.slice(0, 16), imageUrl: a.imageUrl, sceneChangeId: latestChange(sessionId) || undefined });
  return until(find, 10_000, 'the new shot version');
}

/** Remembers which sent messages carry a version, so a reply to any of them (on any channel) finds it. */
export const noteVersionMessages = (versionId: bigint, ids: string[]) => { for (const id of ids) sharedStore().put('msgVersion', id, String(versionId)); };

/** The version a reply points at: our own map, else the mirrored message's label, else the version's own message id. */
export function versionForMessage(sessionId: bigint, messageId: string) {
  if (!messageId) return undefined;
  const rows = [...conn.db.shotVersion.sessionId.filter(sessionId)];
  const id = sharedStore().get<string>('msgVersion', messageId);
  if (id) { const v = rows.find(r => String(r.id) === id); if (v) return v; }
  const msg = [...conn.db.message.sessionId.filter(sessionId)].find(m => m.externalId === messageId && m.direction === 'out');
  const label = msg && labelIn(msg.text);
  if (label) { const v = rows.find(r => r.label === label); if (v) return v; }
  return rows.find(r => r.externalMessageId === messageId);
}

/** The set in words for an image edit: what is in frame and where, so a text-only render matches the 3D set. */
export function setWords(sessionId: bigint): string {
  const ctx = setContext(sessionId);
  if (!ctx) return '';
  const side = (fx: number) => (fx < -0.5 ? 'at the left edge' : fx < -0.15 ? 'on the left' : fx <= 0.15 ? 'in the centre' : fx <= 0.5 ? 'on the right' : 'at the right edge');
  const items = sessionObjects(sessionId).filter(o => o.visible && o.kind !== 'camera' && o.kind !== 'light').map(o => ({ o, f: frameOf(ctx.cam, o) }))
    .filter(x => x.f.inFrame).slice(0, 8).map(x => `${x.o.name || x.o.assetId} ${side(x.f.frameX)}, ${Math.round(x.f.dist)} m away`);
  return items.length ? `In the shot: ${items.join('; ')}` : '';
}

/** Renders the set for a text thread (an image edit of the session's photo with the set described) and waits for it. */
export async function renderForThread(sessionId: bigint, instruction: string, onOwned?: (jobId: bigint) => void): Promise<{ jobId: bigint; imageUrl: string; path: string } | { error: string }> {
  const ctx = setContext(sessionId);
  if (!ctx?.photo) return { error: 'This set has no photo to render over yet. Send one, or render from the studio.' };
  const t0 = Date.now(), ask = [instruction.trim(), setWords(sessionId)].filter(Boolean).join('. ').slice(0, 480);
  const s = conn.db.session.id.find(sessionId);
  const sun = s?.planTime ? sunAt(new Date(Number(s.planTime.microsSinceUnixEpoch / 1000n)), ctx.origin.lat, ctx.origin.lon) : undefined;
  const people = sessionObjects(sessionId).filter(o => o.kind === 'person' && o.visible).length;
  const before = new Set([...conn.db.previewJob.sessionId.filter(sessionId)].map(j => j.id));
  await conn.reducers.requestPreview({ sessionId, photoId: ctx.photo.id, instruction: ask, f35: ctx.cam.f35, people, sunAzimuth: sun?.az, sunAltitude: sun?.alt });
  const job = await until(() => [...conn.db.previewJob.sessionId.filter(sessionId)].find(j => !before.has(j.id) && j.instruction === ask), 15_000, 'the preview job');
  onOwned?.(job.id);
  const done = await until(() => { const j = conn.db.previewJob.id.find(job.id); return j && (j.state === 'done' || j.state === 'failed') ? j : undefined; }, 300_000, 'the render');
  await logStep(sessionId, 'thread_render', ask, done.state === 'done' ? done.imageUrl : `failed: ${done.error}`, Date.now() - t0);
  if (done.state !== 'done') return { error: `The render failed: ${done.error.slice(0, 160)}` };
  const path = (await ensureLocal(done.imageUrl)) ?? join(PREVIEWS_DIR, done.imageUrl.split('/').pop()!);
  return { jobId: job.id, imageUrl: done.imageUrl, path };
}

/** Fork: put the set back to version v as a new branch (v3 -> v3.1), and return the branch row. */
export async function forkFrom(v: { id: bigint; sessionId: bigint; label: string }, channel: string, inboundId: string) {
  await conn.reducers.restoreToVersion({ versionId: v.id, channel: channel.slice(0, 16), externalMessageId: inboundId });
  return until(() => [...conn.db.shotVersion.sessionId.filter(v.sessionId)].find(x => x.externalMessageId === inboundId && x.parentVersionId === v.id), 10_000, 'the forked version');
}

/** After the branch's edit and render: its snapshot includes the edit, and it carries the image. */
export const finishVersion = (id: bigint, sessionId: bigint, imageUrl: string) =>
  conn.reducers.updateShotVersion({ id, imageUrl, sceneChangeId: latestChange(sessionId) || undefined }).catch(e => console.warn(`updateShotVersion: ${e.message}`));
