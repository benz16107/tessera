// A photo texted into a session thread is one of three things. A single object (a jacket, a lamp) becomes a 3D prop in the
// set (the nvidia endpoint /api/props/generate). A photo of the place, in a session that already has a mark, is a scout's
// check-in (mechanism 3): the solver places it and the reply says how to reach the mark. Anything else goes to the locate agent.
import { conn, logStep } from '../stdb.ts';
import { MODELS, NVIDIA_BASE, PORT, secret } from '../config.ts';
import { dataUrl, type Ingested } from '../images.ts';
import { chat, parseJson, thinking } from '../models.ts';
import { callSolver } from '../jobs.ts';
import { fmtParams, parseParams, setContext, sessionObjects, updateObject } from '../set.ts';
import { enuOf, frameOf } from '../setgeo.ts';
import { correction, type Correction } from './marks.ts';
import { propReply } from './format.ts';

export type PhotoKind = { kind: 'object' | 'place'; label: string };

/** Nemotron 3.5 Super VL: is this one object to add, or a place? Defaults to place when the model is not answering. */
export async function classifyPhoto(path: string, text: string): Promise<PhotoKind> {
  if (/\b(new shot|find|where|locate|what lens)\b/i.test(text)) return { kind: 'place', label: '' };
  if (/\b(add|put|use|prop|this thing|in the set|to the set)\b/i.test(text)) {
    const r = await classify(path).catch(() => null);
    return { kind: 'object', label: r?.label || 'your object' };
  }
  return (await classify(path).catch(e => { console.warn(`photo classify: ${e.message}`); return null; })) ?? { kind: 'place', label: '' };
}

async function classify(path: string): Promise<PhotoKind> {
  const key = secret('nvidia_key');
  if (!key) throw new Error('no NVIDIA key');
  const m = await chat(NVIDIA_BASE, key, { model: MODELS.agent, ...thinking(false), temperature: 0, max_tokens: 120, messages: [{ role: 'user', content: [
    { type: 'text', text: 'Is this photo mainly ONE object someone wants to use as a prop (a jacket, a chair, a lamp, a bike, a sign), or a PLACE (a street, a view, a building, a landscape)? Reply with strict JSON only: {"kind": "object" or "place", "label": "a short noun phrase for the object, e.g. a denim jacket"}' },
    { type: 'image_url', image_url: { url: await dataUrl(path, 640) } },
  ] }] }, 30_000, 'photo: place or object');
  const j = parseJson(String(m.content ?? '')) ?? {};
  return { kind: j.kind === 'object' ? 'object' : 'place', label: String(j.label ?? '').slice(0, 60) };
}

const side = (fx: number) => (fx < -0.5 ? 'at the left edge of the frame' : fx < -0.15 ? 'on the left' : fx <= 0.15 ? 'in the centre' : fx <= 0.5 ? 'on the right' : 'at the right edge of the frame');

/** Photo to 3D through the nvidia endpoint, placed in the set; returns the reply line. */
const generate = async (sessionId: bigint, path: string, label: string, extra: object) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/props/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(420_000),
    body: JSON.stringify({ sessionId: String(sessionId), image: await dataUrl(path, 1024), name: label.replace(/^(a|an|the|your)\s+/i, '').slice(0, 60) || 'Prop from photo', ...extra }),
  });
  return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) as any };
};
const flatOf = (j: any) => j.mode === 'flat' && !!j.fallback; // the endpoint fell back to a cut-out because TRELLIS failed

export type PropOut = { text: string; objectId?: string; flat: boolean };

/** Photo to 3D through the nvidia endpoint, placed in the set; says so plainly when it had to fall back to a flat cut-out. */
export async function photoToProp(sessionId: bigint, path: string, label: string): Promise<PropOut> {
  const t0 = Date.now(), { ok, status, j } = await generate(sessionId, path, label, { frame_x: -0.4, distance_m: 5 });
  await logStep(sessionId, 'photo_to_prop', label, ok ? `${j.mode}: ${j.asset?.url}${j.object ? `, object ${j.object.id}` : ''}${j.fallback ? `; ${j.fallback}` : ''}` : `error: ${j.error ?? status}`, Date.now() - t0);
  if (!ok) return { text: `I couldn't turn that photo into a 3D prop: ${String(j.error ?? `HTTP ${status}`).slice(0, 140)}`, flat: false };
  const ctx = setContext(sessionId), o = j.object ? sessionObjects(sessionId).find(x => String(x.id) === String(j.object.id)) : undefined;
  const where = ctx && o ? (() => { const f = frameOf(ctx.cam, o); return f.inFrame ? `${side(f.frameX)}, ${Math.round(f.dist)} m from the camera` : 'just out of frame'; })() : 'in the set';
  return { text: propReply(label, where, flatOf(j)), objectId: j.object?.id, flat: flatOf(j) };
}

/** "try 3D again": regenerate the model and swap it onto the same object, wherever it has been moved since. */
export async function retry3d(sessionId: bigint, path: string, label: string, objectId: string): Promise<string> {
  const o = sessionObjects(sessionId).find(x => String(x.id) === objectId);
  if (!o) return 'That cut-out is no longer in the set, so there is nothing to upgrade.';
  const t0 = Date.now(), { ok, status, j } = await generate(sessionId, path, label, { mode: 'photo3d', place: false });
  const flat = !ok || flatOf(j) || !j.asset?.url;
  await logStep(sessionId, 'retry_3d', `${label}, object ${objectId}`, flat ? `still no 3D model: ${j.fallback ?? j.error ?? status}` : `${j.mode}: ${j.asset.url}`, Date.now() - t0);
  if (flat) return "The 3D model generator still didn't answer, so the flat cut-out stays. Reply 'try 3D again' in a few minutes.";
  const p = parseParams(o.params);
  await updateObject(o, { assetId: j.asset.url, params: fmtParams({ ...p, gen: j.mode, h: j.dims?.height_m ?? p.h, len: j.dims?.length_m ?? p.len }) });
  return `${label.replace(/^(a|an)\s+/i, 'Your ').replace(/^your/i, 'Your')} is now a 3D model, in the same place in the set.`;
}

export type CheckinOut = { text: string; correction?: Correction; at?: { x: number; y: number; heading: number } };

/** Mechanism 3: solve the scout's photo against the session's spot and compare it with the shot camera. */
export async function checkIn(sessionId: bigint, upload: Ingested, who: { participantId: bigint; name: string }): Promise<CheckinOut> {
  const ctx = setContext(sessionId);
  if (!ctx) return { text: 'This set has no mark yet, so there is nothing to check in against.' };
  const t0 = Date.now();
  let r;
  try { r = await callSolver({ photo_path: upload.path, spot_id: ctx.spotId, ...(upload.exifF35 && { exif_f35: upload.exifF35 }) }, () => {}); }
  catch (e) {
    await logStep(sessionId, 'checkin', who.name, `solver error: ${(e as Error).message}`, Date.now() - t0);
    return { text: `I couldn't run the check-in: ${(e as Error).message.slice(0, 120)}` };
  }
  if (!r.ok || r.confidence === 'none') {
    await logStep(sessionId, 'checkin', who.name, `couldn't place: ${r.reason || r.error}`, Date.now() - t0);
    return { text: `I couldn't place that photo (${r.reason || r.error}). Point the phone at the subject with more of the scene in view, and send another.` };
  }
  const e = enuOf(ctx.origin, r.lat, r.lon), at = { x: e.x, y: e.y, heading: r.heading };
  const c = correction({ x: ctx.cam.x, y: ctx.cam.y, heading: ctx.cam.heading }, at);
  await conn.reducers.recordCheckin({
    sessionId, participantId: who.participantId, photoId: 0n, distanceM: c.distanceM, headingErrDeg: c.headingErrDeg, verdict: c.verdict,
    x: at.x, y: at.y, heading: at.heading, imageUrl: upload.url, name: who.participantId ? undefined : who.name.slice(0, 40),
  }).catch(err => console.warn(`recordCheckin: ${err.message}`));
  await logStep(sessionId, 'checkin', `${who.name}: ${upload.url}`, `${c.verdict}: ${c.distanceM.toFixed(1)} m, heading ${c.headingErrDeg.toFixed(0)}° (${r.inliers} matches, ${r.confidence}). ${c.words}`, Date.now() - t0);
  return { text: c.words, correction: c, at };
}
