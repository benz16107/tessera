// Claims queued solve and preview jobs and runs them. A worker that dies mid-job simply stops renewing
// its lease; the module's sweep requeues the job. So nothing here turns a dying process into "failed".
import sharp from 'sharp';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { conn, step, logStep } from './stdb.ts';
import { PREVIEWS_DIR, SOLVER_URL, loadSpots } from './config.ts';
import { dataUrl, ensureLocal, forget, saveImage } from './images.ts';
import { safetyCheck, readLens, editImage, solverRange, physicalCheck, FINE_TUNED, LENS_LIMIT_MIN_F35 } from './models.ts';
import { sunWindows, windowWords } from './sun.ts';
import { cropForF35, lightWords, placementWords } from './geo.ts';
import type { SolveJob, PreviewJob } from './module_bindings/types.ts';
import { afterSolve } from './vision.ts';
import { Timestamp } from 'spacetimedb';

const warn = (what: string) => (e: unknown) => console.warn(`${what}: ${(e as Error).message ?? e}`);
const ZERO_POSE = { lat: 0, lon: 0, alt: 0, heading: 0, pitch: 0, roll: 0, f35: 0 };

class SolverDown extends Error {}

export type SolverResult = {
  ok: boolean; error: string; lat: number; lon: number; alt: number; heading: number; pitch: number; roll: number;
  f35: number; fpx: number; width: number; height: number; inliers: number; confidence: string; reason: string;
  nearest_camera_m: number; secs: number;
};

/** Spot ids the solver has loaded, or null when it is not answering. */
async function solverSpots(): Promise<Set<string> | null> {
  try {
    const r = await fetch(`${SOLVER_URL}/spots`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const j: any = await r.json();
    const ids = Array.isArray(j) ? j : j.spots ?? j.ids ?? [];
    return new Set(ids.map((x: any) => (typeof x === 'string' ? x : x.id)));
  } catch { return null; }
}

/** POST /solve and read the NDJSON stream, calling onProgress for each progress line. */
export async function callSolver(body: object, onProgress: (p: string) => void): Promise<SolverResult> {
  let r: Response;
  try {
    r = await fetch(`${SOLVER_URL}/solve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(600_000) });
  } catch (e) { throw new SolverDown(`solver unreachable: ${(e as Error).message}`); }
  if (!r.ok || !r.body) throw new Error(`solver HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const dec = new TextDecoder();
  let buf = '';
  try {
    for await (const chunk of r.body as any as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        const o = JSON.parse(line);
        if (o.progress) onProgress(String(o.progress));
        if (o.result) return o.result;
      }
    }
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(`solver sent a bad line: ${e.message}`);
    throw new SolverDown(`solver stream broke: ${(e as Error).message}`);
  }
  const last = buf.trim() ? JSON.parse(buf) : null;
  if (last?.result) return last.result;
  throw new SolverDown('solver closed the stream without a result');
}

/** Cosmos Reason warnings per preview job, read by the agent when it sends the preview into a text thread. */
export const previewWarnings = new Map<bigint, string>();

let solving = false, previewing = false, solverDownLogged = false;

async function pumpSolve() {
  if (solving) return;
  const queued = [...conn.db.solveJob.iter()].filter(j => j.state === 'queued').sort((a, b) => Number(a.id - b.id));
  if (!queued.length) return;
  solving = true;
  try {
    const loaded = await solverSpots();
    if (!loaded) {
      if (!solverDownLogged) console.log(`solver not answering at ${SOLVER_URL}; ${queued.length} solve job(s) waiting`);
      solverDownLogged = true;
      return;
    }
    solverDownLogged = false;
    const known = new Set(loadSpots().map(s => s.id));
    for (const j of queued) {
      // A spot whose model is still building waits; a spot nobody is building fails with a clear message.
      if (!loaded.has(j.spotId) && known.has(j.spotId)) continue;
      try { await conn.reducers.claimJob({ jobId: j.id }); } catch { continue; }
      await runSolve(j, loaded.has(j.spotId));
      break;
    }
  } finally { solving = false; }
}

async function runSolve(j: SolveJob, spotLoaded: boolean) {
  const sid = j.sessionId, jobId = j.id, t0 = Date.now();
  let progress = 'claimed', lastSent = 0, abandoned = false;
  const send = () => conn.reducers.reportProgress({ jobId, progress }).catch(warn('reportProgress'));
  const report = (p: string, force = false) => {
    progress = p.slice(0, 200);
    if (force || Date.now() - lastSent > 2000) { lastSent = Date.now(); void send(); }
  };
  const heartbeat = setInterval(() => { if (!abandoned) { lastSent = Date.now(); void send(); } }, 15_000);
  const finish = (ok: boolean, error: string, r?: SolverResult, lensReadF35?: number) =>
    conn.reducers.finishJob({
      jobId, ok, error: error.slice(0, 480),
      pose: r ? { lat: r.lat, lon: r.lon, alt: r.alt, heading: r.heading, pitch: r.pitch, roll: r.roll, f35: r.f35 } : ZERO_POSE,
      inliers: r?.inliers ?? 0, confidence: r?.confidence ?? 'none', reason: (r?.reason ?? '').slice(0, 290),
      lensReadF35, secs: r?.secs ?? (Date.now() - t0) / 1000,
    });

  try {
    if (!spotLoaded) return await finish(false, `We haven't mapped the spot "${j.spotId}" yet, so this photo can't be placed.`);
    const photo = conn.db.photo.id.find(j.photoId);
    const path = photo && (await ensureLocal(photo.url));
    if (!path) return await finish(false, 'The original photo is not on this crew box or in the bucket.');
    const img = await dataUrl(path);

    report('safety check', true);
    const safety = await step(sid, 'safety_check', `photo ${j.photoId}`, () => safetyCheck(img),
      v => (v === null ? 'skipped: NVIDIA key not set yet' : `${v.safe ? 'safe' : 'refused'} (${v.model}): ${v.detail}`));
    if (safety && !safety.safe) {
      // Keep no exact location for refused uploads: fail the job (so clients get the toast), then drop the file and every row.
      await finish(false, 'Refused by the safety check. ShotMatch only places photos of public places, not homes or photos aimed at a person.');
      await forget(photo!.url);
      await conn.reducers.deletePhoto({ photoId: j.photoId }).catch(warn('deletePhoto'));
      return;
    }

    report('reading the lens', true);
    let lens: Awaited<ReturnType<typeof readLens>> = null;
    try {
      lens = await step(sid, 'read_lens', `photo ${j.photoId}`, () => readLens(img),
        v => (v ? `about ${Math.round(v.f35)} mm (${v.source}${v.source === FINE_TUNED && v.f35 >= LENS_LIMIT_MIN_F35 ? ', limits the focal search' : ', advisory only'})` : 'skipped: no lens model (LENS_URL or NVIDIA key)'));
    } catch { /* logged by step; the solver runs without a focal range */ }
    const f35Range = solverRange(j.lensHintF35, lens);

    report('solving', true);
    const body = { photo_path: path, spot_id: j.spotId, ...(f35Range && { f35_range: f35Range }), ...(photo!.exifF35 !== undefined && { exif_f35: photo!.exifF35 }) };
    const r = await step(sid, 'solve', JSON.stringify({ spot_id: j.spotId, f35_range: f35Range, exif_f35: photo!.exifF35 }),
      () => callSolver(body, p => report(p)),
      v => (v.ok ? `${v.confidence}: ${v.inliers} inliers, ${v.f35?.toFixed(1)} mm, ${v.secs?.toFixed(1)} s. ${v.reason}` : `solver error: ${v.error}`));
    if (!r.ok) return await finish(false, r.error || 'solver error');

    if (r.confidence !== 'none') {
      const t1 = Date.now(), w = sunWindows(r.lat, r.lon, r.heading);
      await logStep(sid, 'sun_windows', `heading ${Math.round(r.heading)}`,
        [windowWords(w.golden, r.lat, r.lon), windowWords(w.blue, r.lat, r.lon), w.goldenFrontLit && w.goldenFrontLit !== w.golden ? `front-lit: ${windowWords(w.goldenFrontLit, r.lat, r.lon)}` : '']
          .filter(Boolean).join('; '), Date.now() - t1);
    }
    await finish(true, '', r, lens?.f35);
    // Nemotron reads the photo (objects with boxes, light) and rebuilds an empty set from it; in the background.
    if (r.confidence !== 'none') void afterSolve(sid, j.photoId);
    // A new shoot would otherwise open at the current time (often night), so presets and renders looked dark.
    if (r.confidence !== 'none' && !conn.db.session.id.find(sid)?.planTime) {
      const g = sunWindows(r.lat, r.lon, r.heading).golden;
      if (g) await conn.reducers.setPlanTime({ sessionId: sid, at: new Timestamp(BigInt(Math.round((g.start.getTime() + g.end.getTime()) / 2)) * 1000n) })
        .then(() => logStep(sid, 'set_time', 'first solve, no plan time', `the middle of the next golden hour: ${windowWords(g, r.lat, r.lon)}`, 0)).catch(warn('setPlanTime'));
    }
  } catch (e) {
    if (e instanceof SolverDown) {
      // Stop renewing so the module's sweep hands the job to the next healthy worker.
      abandoned = true;
      console.warn(`job ${jobId}: ${e.message}; leaving it to the lease sweep`);
      return;
    }
    console.error(`job ${jobId} failed:`, e);
    await finish(false, (e as Error).message).catch(warn('finishJob'));
  } finally { clearInterval(heartbeat); }
}

// gpt-image sizes must be multiples of 16; keep the photo's aspect so the edit lines up with the original.
const editSize = (w: number, h: number) => {
  const s = 1536 / Math.max(w, h), r16 = (x: number) => Math.max(256, Math.round((x * s) / 32) * 32);
  return `${r16(w)}x${r16(h)}`;
};

async function pumpPreview() {
  if (previewing) return;
  const j = [...conn.db.previewJob.iter()].filter(p => p.state === 'queued').sort((a, b) => Number(a.id - b.id))[0];
  if (!j) return;
  previewing = true;
  try {
    try { await conn.reducers.claimPreview({ jobId: j.id }); } catch { return; }
    await runPreview(j);
  } finally { previewing = false; }
}

export function previewInstruction(j: Pick<PreviewJob, 'people' | 'sunAzimuth' | 'sunAltitude' | 'instruction'>, heading?: number, placed: string[] = []): string {
  const parts: string[] = [];
  if (placed.length) parts.push(`Add ${placed.length === 1 ? 'one person' : `${placed.length} people`} standing naturally at a realistic scale, posing for the photo: ${placed.join('; ')}`);
  else if (j.people > 0) parts.push(`Add ${j.people === 1 ? 'one person' : `${j.people} people`} standing naturally in the scene at a realistic scale, posing for the photo`);
  if (j.sunAzimuth !== undefined && j.sunAltitude !== undefined && heading !== undefined) parts.push(`Relight the scene: ${lightWords(j.sunAzimuth, j.sunAltitude, heading)}`);
  if (j.instruction.trim()) parts.push(j.instruction.trim());
  return parts.join('. ');
}

async function runPreview(j: PreviewJob) {
  const t0 = Date.now(), jobId = j.id;
  const fail = (error: string) => conn.reducers.finishPreview({ jobId, ok: false, imageUrl: '', error: error.slice(0, 480) });
  try {
    const photo = conn.db.photo.id.find(j.photoId);
    const path = photo && (await ensureLocal(photo.url));
    if (!path) return await fail('The original photo is not on this crew box or in the bucket.');
    const solved = conn.db.solveResult.photoId.find(j.photoId);
    const baseF35 = solved && solved.confidence !== 'none' ? solved.pose.f35 : photo!.exifF35;
    const heading = solved && solved.confidence !== 'none' ? solved.pose.heading : undefined;

    let img = sharp(path);
    const { width = 0, height = 0 } = await img.metadata();
    const crop = j.f35 !== undefined && baseF35 ? cropForF35(width, height, baseF35, j.f35) : null;
    if (crop) img = img.extract(crop);
    let out = await img.jpeg({ quality: 90 }).toBuffer();
    const w = crop?.width ?? width, h = crop?.height ?? height;

    // People placed in the 3D scene become words relative to the solved camera, so the edit puts them roughly there.
    const placed = solved && solved.confidence !== 'none' && j.people > 0
      ? placementWords([...conn.db.person.sessionId.filter(j.sessionId)], solved.pose, width, height) : [];
    const ask = previewInstruction(j, heading, placed);
    let model = 'crop only';
    if (ask) {
      // The ask goes first: Qwen-Image ignores the edit when the prompt opens with "keep everything the same" (tested 2026-11-07).
      const prompt = `${ask}. Keep the same camera position, framing, perspective, lens and buildings. Photorealistic, no text or watermark.`;
      const renew = setInterval(() => conn.reducers.renewPreview({ jobId }).catch(warn('renewPreview')), 60_000);
      const r = await editImage(out, prompt, editSize(w, h)).finally(() => clearInterval(renew));
      model = r.model;
      out = await sharp(r.image).resize({ width: w, height: h, fit: 'fill' }).jpeg({ quality: 88 }).toBuffer();
    }
    const file = `${randomUUID().replace(/-/g, '').slice(0, 16)}.jpg`;
    await saveImage(`/preview/${file}`, join(PREVIEWS_DIR, file), out);
    await logStep(j.sessionId, 'make_preview',
      JSON.stringify({ f35: j.f35, people: j.people, sun: j.sunAzimuth !== undefined ? [Math.round(j.sunAzimuth), Math.round(j.sunAltitude ?? 0)] : null, text: j.instruction.slice(0, 80) }),
      `${crop ? `cropped ${Math.round(baseF35!)} to ${Math.round(j.f35!)} mm; ` : ''}${model}`, Date.now() - t0);
    if (j.people > 0 && model !== 'crop only') {
      const t1 = Date.now();
      const v = await physicalCheck(await dataUrl(join(PREVIEWS_DIR, file), 768)).catch(e => ({ ok: true, verdict: `error: ${e.message}` }));
      if (v) {
        await logStep(j.sessionId, 'physical_check', `preview ${jobId}`, v.verdict, Date.now() - t1);
        if (!v.ok) previewWarnings.set(jobId, `Heads up: the people in this preview may look off (${v.verdict.replace(/^IMPLAUSIBLE[:.,\s-]*/i, '')}).`);
      }
    }
    await conn.reducers.finishPreview({ jobId, ok: true, imageUrl: `/preview/${basename(file)}`, error: '' });
  } catch (e) {
    console.error(`preview ${jobId} failed:`, e);
    await logStep(j.sessionId, 'make_preview', `job ${jobId}`, `error: ${(e as Error).message}`, Date.now() - t0);
    await fail((e as Error).message).catch(warn('finishPreview'));
  }
}

export function startJobLoops() {
  const kick = () => { void pumpSolve().catch(warn('solve loop')); void pumpPreview().catch(warn('preview loop')); };
  conn.db.solveJob.onInsert(kick);
  conn.db.solveJob.onUpdate(kick);
  conn.db.previewJob.onInsert(kick);
  conn.db.previewJob.onUpdate(kick);
  setInterval(kick, 3000);
  kick();
}
