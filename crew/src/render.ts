// The AI render pass, built so placed objects look like they belong in the user's real photo. The studio renders ONLY the
// user's objects and lights from the shot camera (beauty RGBA, depth, object mask, and a shadow-only pass cast on the real
// ground and walls), with its 3D sun set from Nemotron's light read. Here:
//   1. composite: shadow pass multiplied into the photo (softened to the photo's shadow hardness), then the beauty layer,
//      its exposure, white balance and grain matched to the photo around it (composite.ts);
//   2. harmonize: FLUX.1-dev (depth or canny, conditioned on the composite) renders the frame, and its pixels are blended in
//      only over the objects and their contact areas at a low strength, so lighting, colour, grain and contact change and the
//      scene stays put. Fallback generators (Vultr Qwen-Image edit, then OpenAI) are blended the same way, and named;
//   3. verify: Nemotron 3.5 Super VL checks each placed object's light direction, shadow direction, scale and colour against
//      the scene (Cosmos Reason2, or Nemotron Nano Omni while Cosmos is down, checks physics alongside). On a fail the crew
//      changes the strength or prompt and renders once more, and names the sun angle the studio should fix.
// Google tile pixels and depth never reach this file.
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { MODELS, NVIDIA_BASE, PREVIEWS_DIR, secret } from './config.ts';
import { conn, logStep, until } from './stdb.ts';
import { ensureLocal, saveImage } from './images.ts';
import { chat, editImage, parseJson, physicalCheck, thinking } from './models.ts';
import { genai } from './props3d.ts';
import { sunAt } from './sun.ts';
import { normBox, sessionLight, type LightRead } from './vision.ts';
import { fluxSize, placeholderPrompt, renderPrompt, whenWords, type Placeholder } from './prompts.ts';
export { fluxSize, lensWords, renderPrompt } from './prompts.ts';
import { describeObjects, parseParams, setContext, sessionObjects } from './set.ts';
import { bearingTo, frameOf } from './setgeo.ts';
import { relativeAngle } from './geo.ts';
import { alphaOf, applyShadow, azDiff, blendMasked, blur1, contactMask, harmonizeBeauty, jpeg, maskBox, matchParams, objectMasks, over, pasteCrop, rawRgb, changedRegion, toneToBorder, rawRgba, ringOf, shadowParams, strengthMap, sunFromRead } from './composite.ts';

export type RenderIn = {
  sessionId: bigint; photoId: bigint; beauty: Buffer; shadow?: Buffer; text?: string; f35?: number; aperture?: number; focusM?: number; iso?: number;
  sun?: { az: number; alt: number }; mode?: 'depth' | 'canny' | 'composite'; strength?: number;
  mask?: Buffer; legend?: { id: string; name: string; kind: string; color: string }[]; // the studio's object-ID layer
};
export type Check = { round: number; pass: boolean; summary: string; objects: { name: string; light: boolean; shadow: boolean; scale: boolean; color: boolean; note: string }[]; placeholders: string[];
  strength: 'up' | 'down' | 'same'; promptAdd: string; sunFix?: { azimuth: number; altitude: number; why: string }; model: string; ms: number };
export type RenderOut = {
  url: string; compositeUrl: string; model: string; fallback?: string; prompt: string; label: string; ms: number; jobId?: string; placeholders: number;
  strength: number; checks: Check[]; sunFix?: { azimuth: number; altitude: number; why: string }; rerendered: boolean;
};

const editSize = (w: number, h: number) => { const s = 1536 / Math.max(w, h), r = (x: number) => Math.max(256, Math.round((x * s) / 32) * 32); return `${r(w)}x${r(h)}`; };

// FLUX.1-dev answered 500 for hours on 2026-11-07; after a failure the render skips it for 10 minutes instead of waiting on it again.
let fluxDownUntil = 0, fluxLastError = '';

/** A generated frame at w x h (raw RGB) and which model made it: FLUX.1-dev first, then the image-edit fallbacks. */
async function generate(composite: Buffer, w: number, h: number, prompt: string, mode: 'depth' | 'canny'): Promise<{ rgb: Buffer; model: string; fallback?: string } | { error: string }> {
  let fallback: string | undefined;
  if (Date.now() >= fluxDownUntil) {
    try {
      const size = fluxSize(w, h), small = await sharp(composite).resize({ ...size, fit: 'fill' }).jpeg({ quality: 90 }).toBuffer();
      const j = await genai(MODELS.flux, { prompt, mode, image: `data:image/jpeg;base64,${small.toString('base64')}`, cfg_scale: 3.5, ...size, seed: 0, steps: 30 }, `AI render (${mode})`, 2, 90_000);
      const b64 = j.artifacts?.[0]?.base64 ?? j.image;
      if (!b64 || j.artifacts?.[0]?.finishReason === 'CONTENT_FILTERED') throw new Error(`no image (${j.artifacts?.[0]?.finishReason ?? 'empty'})`);
      return { rgb: await rawRgb(Buffer.from(String(b64).replace(/^data:[^,]+,/, ''), 'base64'), w, h), model: `${MODELS.flux} (${mode})` };
    } catch (e) {
      fluxDownUntil = Date.now() + 600_000; fluxLastError = (e as Error).message.slice(0, 140);
      fallback = `FLUX.1-dev failed (${fluxLastError}); skipped for 10 minutes`;
    }
  } else fallback = `FLUX.1-dev skipped: it failed within the last 10 minutes (${fluxLastError})`;
  try {
    const r = await editImage(composite, `${prompt}. Keep every object, person and building exactly where it is.`, editSize(w, h));
    return { rgb: await rawRgb(r.image, w, h), model: r.model, fallback };
  } catch (e) { return { error: `${fallback}; image-edit fallback failed too: ${(e as Error).message.slice(0, 140)}` }; }
}

const CHECK = (objs: string, light: string, sun: string) => `This frame is a real photo with 3D objects placed into it by a planning tool. Placed objects (frame_x -1 left to 1 right):
${objs}
The real photo's light: ${light}
The 3D sun the objects were lit with: ${sun}
For each placed object, judge against the real scene: is its lighting direction the same as the scene's, do its shadows fall the same way and with the same softness as real shadows, is its scale right next to doors, cars and people, and do its colour, white balance and grain match?
Also: does any person still look like a grey mannequin, a statue or a 3D model, is any person or object see-through, ghosted or smeared (every person must be fully opaque, no transparency or ghosting), or does any prop look like a toy, a clay or plastic model or a low-poly game asset? List their ids in "placeholders"; any id there fails the frame.
Reply with strict JSON only: {"pass": true|false, "summary": "<one sentence>", "placeholders": [<ids>], "objects": [{"name": "...", "light": true, "shadow": true, "scale": true, "color": true, "note": "..."}],
"strength": "up|down|same" (up = objects still look pasted on and need more blending, down = the scene itself changed too much), "prompt_add": "<words to add to the render prompt, or empty>",
"sun_fix": null or {"azimuth": <deg from north>, "altitude": <deg>, "why": "..."} when the 3D sun is on the wrong side or at the wrong height}`;

/** Higher is better: a pass, fewer placeholders still flagged, fewer light/shadow/scale/colour faults. */
export const checkScore = (c: Pick<Check, 'pass' | 'placeholders' | 'objects'>) =>
  (c.pass ? 100 : 0) - 10 * c.placeholders.length - c.objects.reduce((n, o) => n + [o.light, o.shadow, o.scale, o.color].filter(x => !x).length, 0);

/** Nemotron 3.5 Super VL checks the render's physics, object by object. */
async function verify(sid: bigint, img: Buffer, round: number, light: LightRead | undefined, sun: { az: number; alt: number } | undefined, heading: number | undefined): Promise<Check | null> {
  const key = secret('nvidia_key');
  const ctx = setContext(sid);
  if (!key || !ctx) return null;
  const t0 = Date.now();
  const objs = describeObjects(ctx, sessionObjects(sid).filter(o => o.visible && o.kind !== 'camera' && o.kind !== 'light')).split('\n').slice(0, 14).join('\n');
  const sunWords = sun ? `azimuth ${Math.round(sun.az)} deg, altitude ${Math.round(sun.alt)} deg${heading !== undefined ? ` (${Math.round(relativeAngle(sun.az, heading))} deg from where the camera points)` : ''}` : 'not given';
  const lightWordsRead = light ? `sun ${light.sun_side}, ${light.hardness} light, looks like ${light.time_look}, ${Math.round(light.color_temp_k)} K` : 'not read';
  const small = await sharp(img).resize({ width: 1024, height: 1024, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
  const ask = (think: boolean) => chat(NVIDIA_BASE, key, {
    model: MODELS.agent, ...thinking(think), temperature: 0, max_tokens: think ? 8000 : 1500,
    messages: [{ role: 'user', content: [{ type: 'text', text: CHECK(objs, lightWordsRead, sunWords) }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}` } }] }],
  }, 120_000, think ? 'render physics check (reasoning on)' : 'render physics check');
  // Reasoning off answers in about 3 s with the same verdicts on our test frames (reasoning on took 25 to 60 s and once ran out
  // of budget mid-JSON); reasoning on is the retry when the quick answer is unusable. A verdict must carry "pass".
  const verdict = (m: any) => { const v = parseJson(String(m?.content ?? '')); return v && typeof v === 'object' && 'pass' in v ? v : null; };
  let j = verdict(await ask(false).catch(() => null));
  if (!j) j = verdict(await ask(true).catch(() => null));
  if (!j) { await logStep(sid, 'render_check', `round ${round}, ${MODELS.agent}`, 'no verdict: the model returned no JSON', Date.now() - t0); return null; }
  const objects = (Array.isArray(j.objects) ? j.objects : []).slice(0, 14).map((o: any) => ({ name: String(o.name ?? ''), light: o.light !== false, shadow: o.shadow !== false, scale: o.scale !== false, color: o.color !== false, note: String(o.note ?? '').slice(0, 160) }));
  const sf = j.sun_fix && Number.isFinite(Number(j.sun_fix.azimuth)) ? { azimuth: Math.round(Number(j.sun_fix.azimuth)), altitude: Math.round(Number(j.sun_fix.altitude) || 20), why: String(j.sun_fix.why ?? '').slice(0, 160) } : undefined;
  const placeholders = (Array.isArray(j.placeholders) ? j.placeholders : []).map((x: unknown) => String(x).replace(/\D/g, '')).filter(Boolean).slice(0, 8);
  const check: Check = { round, pass: j.pass === true && !placeholders.length && objects.every((o: Check['objects'][number]) => o.light && o.shadow && o.scale && o.color), summary: String(j.summary ?? '').slice(0, 300), objects, placeholders,
    strength: ['up', 'down'].includes(j.strength) ? j.strength : 'same', promptAdd: String(j.prompt_add ?? '').slice(0, 200), sunFix: sf, model: MODELS.agent, ms: Date.now() - t0 };
  const bad = objects.filter((o: Check['objects'][number]) => !(o.light && o.shadow && o.scale && o.color)).map((o: Check['objects'][number]) => `${o.name}: ${[!o.light && 'light', !o.shadow && 'shadow', !o.scale && 'scale', !o.color && 'colour'].filter(Boolean).join(', ')}`);
  await logStep(sid, 'render_check', `round ${round}, ${MODELS.agent}`, `${check.pass ? 'pass' : 'fail'}: ${check.summary}${bad.length ? ` Off: ${bad.join('; ')}.` : ''}${placeholders.length ? ` Still look like mannequins or models: ids ${placeholders.join(', ')}.` : ''}${sf ? ` Sun fix: azimuth ${sf.azimuth}, altitude ${sf.altitude} (${sf.why}).` : ''}${check.strength !== 'same' ? ` Strength ${check.strength}.` : ''}`, check.ms);
  return check;
}

export async function render(inp: RenderIn): Promise<RenderOut> {
  const t0 = Date.now(), sid = inp.sessionId;
  const photo = conn.db.photo.id.find(inp.photoId);
  if (!photo || photo.sessionId !== sid) throw new Error('that photo is not in this session');
  const path = await ensureLocal(photo.url);
  if (!path) throw new Error('the original photo is not on this crew box or in the bucket');
  const meta = await sharp(inp.beauty).metadata();
  const w = meta.width ?? photo.width, h = meta.height ?? photo.height;
  if (!w || !h || w > 8192 || h > 8192) throw new Error('beauty layer has a bad size');
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  const ctx = setContext(sid), light = sessionLight(sid), settings = conn.db.shotSettings.sessionId.find(sid);

  // 1. Composite: shadows into the photo, then the colour-matched beauty layer.
  const photoRgb = await rawRgb(path, w, h), beauty = await rawRgba(inp.beauty, w, h);
  const beautyA = Buffer.alloc(w * h);
  for (let i = 0; i < beautyA.length; i++) beautyA[i] = beauty[i * 4 + 3];
  const sp = shadowParams(light?.hardness, Math.hypot(w, h));
  let shadowA: Buffer | null = null, base = photoRgb;
  if (inp.shadow) {
    shadowA = await blur1(await alphaOf(inp.shadow, w, h), w, h, sp.sigma);
    base = applyShadow(photoRgb, shadowA, sp.darkness);
  }
  const match = matchParams(beauty, photoRgb, await ringOf(beautyA, w, h), w, h);
  const grain = 1.5 + Math.min(4, (inp.iso ?? settings?.iso ?? 100) / 800);
  const composite = await jpeg(over(base, await harmonizeBeauty(beauty, w, h, match, grain)), w, h);
  await saveImage(`/preview/${id}c.jpg`, join(PREVIEWS_DIR, `${id}c.jpg`), composite);
  const compositeUrl = `/preview/${id}c.jpg`;
  await logStep(sid, 'composite', `photo ${inp.photoId}, ${w}x${h}`, `${inp.shadow ? `shadow pass multiplied in (${light?.hardness || 'mixed'} light: blur ${sp.sigma.toFixed(1)} px, darkness ${sp.darkness})` : 'no shadow pass sent'}; objects exposure x${match.gain.toFixed(2)}, white balance ${match.wb.map(x => x.toFixed(2)).join('/')}, grain ${grain.toFixed(1)}`, Date.now() - t0);

  // The studio's sun against Nemotron's light read: a mismatch is a sun fix to send back, whatever the checks say.
  const planTime = conn.db.session.id.find(sid)?.planTime;
  const sun = inp.sun ?? (planTime && ctx ? sunAt(new Date(Number(planTime.microsSinceUnixEpoch / 1000n)), ctx.origin.lat, ctx.origin.lon) : undefined);
  const want = ctx ? sunFromRead(light, ctx.cam.heading) : null;
  let sunFix = want && sun && azDiff(want.azimuth, sun.az) > 60 ? { ...want, why: `the photo's light comes from the ${light?.sun_side}; the 3D sun is ${Math.round(azDiff(want.azimuth, sun.az))} deg away from that` } : undefined;

  if (inp.mode === 'composite') {
    return { url: compositeUrl, compositeUrl, model: 'composite only (no AI)', prompt: '', label: 'Composite', ms: Date.now() - t0, strength: 0, checks: [], sunFix, rerendered: false, placeholders: 0 };
  }

  // 2. The prompt and the render row (preview_job kind 'render', created running by the crew).
  const objs = sessionObjects(sid).filter(o => o.visible && o.kind !== 'camera' && o.kind !== 'light');
  const people = objs.filter(o => o.kind === 'person').length;
  const names = [...(people ? [`${people === 1 ? 'one person' : `${people} people`}`] : []), ...objs.filter(o => o.kind !== 'person').map(o => o.name.replace(/^From photo: /, '').toLowerCase())];
  // Mannequins and stand-in props are placeholders: each gets its own mask (from the studio's ID layer) and its own words.
  const masks = inp.mask && inp.legend?.length ? objectMasks(await rawRgb(inp.mask, w, h), w, h, inp.legend) : new Map<string, Buffer>();
  const when = whenWords(planTime ? new Date(Number(planTime.microsSinceUnixEpoch / 1000n)) : new Date(), sun?.alt, light?.sky);
  const lightFor = light ? `${light.hardness} ${light.time_look} light${/none/.test(light.sun_side) ? '' : `, sun ${light.sun_side}`}` : 'the scene\'s light';
  const placeholders: (Placeholder & { mask: Buffer; prompt: string; strength: number })[] = [];
  for (const l of inp.legend ?? []) {
    const row = objs.find(o => String(o.id) === l.id), m = masks.get(l.id);
    if (!row || !m || !['person', 'model', 'prop_generated'].includes(row.kind) || m.reduce((n, v) => n + (v ? 1 : 0), 0) < 40) continue;
    const prm = parseParams(row.params), f = ctx ? frameOf(ctx.cam, row) : { frameX: 0, dist: 8 };
    const toCam = ctx ? bearingTo(row, ctx.cam) : 0, yaw = ((-2 * Math.atan2(row.qz, row.qw) * 180) / Math.PI + 720) % 360, off = Math.abs(((yaw - toCam + 540) % 360) - 180);
    const ph: Placeholder = { id: l.id, kind: row.kind, name: row.name, asset: row.assetId, pose: prm.pose, heightM: Number(prm.height) || undefined, frameX: Number.isFinite(f.frameX) ? f.frameX : 0, dist: f.dist,
      facing: off < 45 ? 'the camera' : off > 135 ? 'away from the camera' : 'sideways' };
    placeholders.push({ ...ph, mask: m, prompt: placeholderPrompt(ph, when, lightFor), strength: row.kind === 'person' ? 0.9 : 0.8 });
  }
  let prompt = renderPrompt({
    light, f35: inp.f35 ?? ctx?.cam.f35 ?? 35, aperture: inp.aperture ?? settings?.aperture, focusM: inp.focusM ?? settings?.focusM,
    sun, heading: ctx?.cam.heading, objects: [...new Set(names)], people,
    text: [placeholders.length ? `Turn every placeholder into the real thing: ${placeholders.map(p => p.prompt).join('; ')}` : '', inp.text].filter(Boolean).join('. '),
    place: ctx ? conn.db.spot.id.find(ctx.spotId)?.name : undefined,
  }).slice(0, 2400);
  let jobId: bigint | undefined;
  try {
    await conn.reducers.startRender({ sessionId: sid, photoId: inp.photoId, requestId: id, instruction: (inp.text || prompt).slice(0, 500), f35: inp.f35 ?? ctx?.cam.f35, people, sunAzimuth: sun?.az, sunAltitude: sun?.alt });
    jobId = (await until(() => [...conn.db.previewJob.sessionId.filter(sid)].find(j => j.requestId === id), 10_000, 'the render row')).id;
  } catch (e) { console.warn(`startRender: ${(e as Error).message}; rendering without a row`); }
  const renew = jobId !== undefined ? setInterval(() => conn.reducers.renewPreview({ jobId: jobId! }).catch(() => {}), 60_000) : undefined;

  try {
    // 3. Placeholders (mannequins, stand-in props): each gets its own crop edit, pasted back fully opaque. Without an ID layer
    //    (older clients), the whole-frame generator is blended over objects and the contact band under them at a low strength.
    const compRgb = await rawRgb(composite, w, h), contact = await contactMask(beautyA, shadowA, w, h), mode = inp.mode === 'canny' ? 'canny' : 'depth';
    let strength = Math.max(0.1, Math.min(0.9, inp.strength ?? 0.45));
    const patchPath = placeholders.length > 0, used = new Set<string>();
    let gen: Awaited<ReturnType<typeof generate>> | null = patchPath ? null : await generate(composite, w, h, prompt, mode);
    let patched = compRgb;
    if (patchPath) for (const p of placeholders) { const r = await realify(sid, patched, composite, base, p, w, h, 1); patched = r.rgb; if (r.model) used.add(r.model); }
    const checks: Check[] = [];
    const finalize = async (round: number) => {
      const map = gen && 'rgb' in gen ? await strengthMap(contact, strength, [], w, h) : null;
      const rgb = patchPath ? patched : gen && 'rgb' in gen ? blendMasked(compRgb, gen.rgb, map!, 1) : compRgb;
      const file = round === 1 ? `${id}.jpg` : `${id}r${round}.jpg`, img = await jpeg(rgb, w, h, 90);
      await saveImage(`/preview/${file}`, join(PREVIEWS_DIR, file), img);
      await logStep(sid, 'render', `round ${round}${patchPath ? '' : `, strength ${strength.toFixed(2)}`}`, patchPath
        ? `${placeholders.length} placeholder${placeholders.length > 1 ? 's' : ''} replaced by focused crop edits (${[...used].join(', ') || 'no edit model answered'}), pasted fully opaque; the rest of the photo is untouched`
        : gen && 'rgb' in gen ? `${gen.model}${gen.fallback ? ` (${gen.fallback})` : ''}, blended over objects and the contact band under them` : `no generator answered (${gen && 'error' in gen ? gen.error : ''}); harmonized composite only`, Date.now() - t0);
      return { url: `/preview/${file}`, img };
    };
    let out = await finalize(1);
    const [c1] = await Promise.all([verify(sid, out.img, 1, light, sun, ctx?.cam.heading).catch(e => { console.warn(`render check: ${e.message}`); return null; }), secondOpinion(sid, out.img, id)]);
    if (c1) checks.push(c1);
    let rerendered = false;
    if (c1 && !c1.pass) {
      // A placeholder that still looks like a mannequin, a model or a ghost gets one more focused edit with a firmer prompt.
      const stuck = patchPath ? placeholders.filter(p => c1.placeholders.includes(p.id)).slice(0, 3) : [];
      for (const p of stuck) { const r = await realify(sid, patched, composite, base, p, w, h, 2); patched = r.rgb; if (r.model) used.add(r.model); }
      if (gen && 'rgb' in gen) {
        if (c1.strength === 'up') strength = Math.min(0.85, strength + 0.25);
        if (c1.strength === 'down') strength = Math.max(0.15, strength - 0.2);
        // New words in the prompt need a new generation; a strength change only needs a new blend.
        if (c1.promptAdd && gen.model.startsWith(MODELS.flux)) { prompt = `${prompt}. ${c1.promptAdd}`.slice(0, 1900); gen = await generate(composite, w, h, prompt, mode); }
      }
      if (stuck.length || (!patchPath && (c1.strength !== 'same' || c1.promptAdd))) {
        rerendered = true;
        const first = out;
        out = await finalize(2);
        const c2 = await verify(sid, out.img, 2, light, sun, ctx?.cam.heading).catch(() => null);
        if (c2) checks.push(c2);
        // The second try is not always better (it sometimes fades a person into the road): keep whichever round scored higher.
        if (c2 && checkScore(c2) < checkScore(c1)) { out = first; rerendered = false; await logStep(sid, 'render', 'kept round 1', `round 2 scored lower (${checkScore(c2)} vs ${checkScore(c1)})`, 0); }
      }
    }
    sunFix = checks.map(c => c.sunFix).filter(Boolean).pop() ?? sunFix;
    const model = patchPath ? `${[...used].join(' + ') || 'none'} (crop edits per placeholder)` : gen && 'rgb' in gen ? gen.model : 'harmonized composite (no generator answered)';
    if (jobId !== undefined) await conn.reducers.finishPreview({ jobId, ok: true, imageUrl: out.url, error: '' }).catch(e => console.warn(`finishPreview: ${e.message}`));
    return { url: out.url, compositeUrl, model, fallback: patchPath ? (used.size ? undefined : 'no image-edit model answered; the placeholders are still mannequins') : gen && 'rgb' in gen ? gen.fallback : gen && 'error' in gen ? gen.error : undefined, prompt, label: 'AI interpretation', ms: Date.now() - t0, jobId: jobId?.toString(), strength, checks, sunFix, rerendered, placeholders: placeholders.length };
  } catch (e) {
    if (jobId !== undefined) await conn.reducers.finishPreview({ jobId, ok: false, imageUrl: '', error: (e as Error).message.slice(0, 480) }).catch(() => {});
    await logStep(sid, 'render', `photo ${inp.photoId}`, `error: ${(e as Error).message}`, Date.now() - t0);
    throw e;
  } finally { if (renew) clearInterval(renew); }
}

/** The subject's silhouette in an edited crop: the edit model repaints everything but the subject flat green (#00FF00) and
 *  the green is keyed out. Null when the key looks wrong (too small, too big, or mostly outside the subject's box). */
async function keyedSubject(rgb: Buffer, bw: number, bh: number, what: string, inside: number[]): Promise<Buffer | null> {
  const img = await sharp(rgb, { raw: { width: bw, height: bh, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  const r = await editImage(img, `Keep the ${what} exactly as it is, same pose, size and position, pixel for pixel. Replace everything else (background, ground, buildings, cars, shadows) with flat pure green #00FF00. No other change.`, editSize(bw, bh));
  const g = await rawRgb(r.image, bw, bh), m = Buffer.alloc(bw * bh);
  for (let i = 0, p = 0; i < m.length; i++, p += 3) m[i] = g[p + 1] > 140 && g[p + 1] - Math.max(g[p], g[p + 2]) > 70 ? 0 : 255;
  const soft = await blur1(m, bw, bh, 2);
  let n = 0, out = 0;
  for (let i = 0; i < m.length; i++) {
    m[i] = soft[i] > 128 ? 255 : 0;
    if (!m[i]) continue;
    n++;
    const x = i % bw, y = (i / bw) | 0;
    if (x < inside[0] || x > inside[2] || y < inside[1] || y > inside[3]) out++;
  }
  return n > 0.02 * m.length && n < 0.6 * m.length && out < 0.15 * n ? m : null;
}

/** Super VL's box (fractions 0..1) around the one person or object in an edited crop, or null. */
async function subjectBox(rgb: Buffer, bw: number, bh: number, what: string): Promise<[number, number, number, number] | null> {
  const key = secret('nvidia_key');
  if (!key) return null;
  const img = await sharp(rgb, { raw: { width: bw, height: bh, channels: 3 } }).jpeg({ quality: 88 }).toBuffer();
  const m = await chat(NVIDIA_BASE, key, { model: MODELS.agent, ...thinking(false), temperature: 0, max_tokens: 120, messages: [{ role: 'user', content: [
    { type: 'text', text: `Give the tight bounding box of the ${what} in this image, head to feet (or top to bottom), as strict JSON only: {"box": [x0, y0, x1, y1]} with integers 0 to 1000, x right, y down.` },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}` } }] }] }, 30_000, 'subject box for the paste');
  return normBox(parseJson(String(m.content ?? ''))?.box);
}

/** Share of the placeholder's pixels the edit left as they were in the composite (the mannequin is still standing). */
export function residue(comp: Buffer, w: number, crop: Buffer, box: { left: number; top: number; width: number; height: number }, objLocal: Buffer): number {
  let n = 0, same = 0;
  for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
    const i = y * box.width + x;
    if (!objLocal[i]) continue;
    const o = ((box.top + y) * w + box.left + x) * 3, e = i * 3;
    n++;
    if (Math.max(Math.abs(comp[o] - crop[e]), Math.abs(comp[o + 1] - crop[e + 1]), Math.abs(comp[o + 2] - crop[e + 2])) < 24) same++;
  }
  return n ? same / n : 0;
}

/** One placeholder's padded crop of the composite, edited on its own into the real thing, pasted into the frame fully opaque
 *  (only the outer few px feathered, tone matched at the border). Attempt 2 uses a firmer prompt. */
async function realify(sid: bigint, frame: Buffer, composite: Buffer, backplate: Buffer, p: { id: string; name: string; kind: string; mask: Buffer; prompt: string }, w: number, h: number, attempt: number): Promise<{ rgb: Buffer; model?: string }> {
  const box = maskBox(p.mask, w, h, 0.4);
  if (!box || box.width < 16 || box.height < 16) return { rgb: frame };
  const t0 = Date.now(), what = p.kind === 'person' ? 'person' : 'object';
  const ask = `Photorealistic photo. ${p.prompt.replace(/^the /, 'The ')}. Replace the grey mannequin or toy-like model with the real ${what} at exactly the same place and size, standing on the same ground, solid and fully opaque. Keep the background, the framing and the perspective exactly the same. No text.` +
    (attempt > 1 ? ` The ${what} must be completely real: nothing grey, see-through, ghosted or doll-like remains.` : '');
  try {
    const crop = await sharp(composite).extract(box).jpeg({ quality: 92 }).toBuffer(), compRaw = await rawRgb(composite, w, h);
    const local = Buffer.alloc(box.width * box.height);
    for (let y = 0; y < box.height; y++) p.mask.copy(local, y * box.width, (box.top + y) * w + box.left, (box.top + y) * w + box.left + box.width);
    // The edit model sometimes draws a person in front of the mannequin and leaves it standing: when over 35% of the
    // mannequin's pixels come back unchanged, it edits once more (each call gives a different result).
    let r = await editImage(crop, ask, editSize(box.width, box.height)), patch = await rawRgb(r.image, box.width, box.height);
    let toned = toneToBorder(frame, w, patch, box), left = residue(compRaw, w, toned, box, local);
    if (left > 0.35) {
      await logStep(sid, 'realify', `object ${p.id} ${p.name}`, `${Math.round(left * 100)}% of the mannequin is still there; editing again`, Date.now() - t0);
      const r2 = await editImage(crop, `${ask} Remove the grey figure entirely.`, editSize(box.width, box.height)), patch2 = await rawRgb(r2.image, box.width, box.height);
      const toned2 = toneToBorder(frame, w, patch2, box), left2 = residue(compRaw, w, toned2, box, local);
      if (left2 < left) { r = r2; toned = toned2; left = left2; }
    }
    await logStep(sid, 'realify', `object ${p.id} ${p.name}, crop ${box.width}x${box.height}${attempt > 1 ? ', second try' : ''}`, `${r.model}, ${Math.round(left * 100)}% of the mannequin left: ${p.prompt}`.slice(0, 600), Date.now() - t0);
    // The photo is a clean backplate (the mannequin was never in it): put it back wherever the mannequin stood, then paste only
    // what the edit made that the photo does not have, the new person and their shadow. No redrawn background remains.
    const cleared = Buffer.from(frame), grown = await blur1(local, box.width, box.height, 1.5);
    for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
      if (!grown[y * box.width + x]) continue;
      const o = ((box.top + y) * w + box.left + x) * 3;
      backplate.copy(cleared, o, o, o + 3);
    }
    const region = await changedRegion(backplate, w, toned, box, local, Math.max(4, box.height * 0.03), 2, false, 44);
    // Inside the old silhouette the model's redrawn background differs from the photo as much as the person does, so Super VL
    // boxes the new person and only changes inside that box (a little extra below the feet for the contact shadow) are kept.
    const pb = await subjectBox(toned, box.width, box.height, what).catch(() => null);
    let how = 'no box; pasted what changed';
    if (pb) {
      const bw = box.width, bh = box.height;
      const [x0, y0, x1, y1] = [pb[0] - 0.04, pb[1] - 0.02, pb[2] + 0.04, pb[3] + 0.03].map((v, i) => Math.max(0, Math.min(1, v)) * (i % 2 ? bh : bw));
      // The person's own silhouette: the edit model turns everything but the person flat green, and the green is keyed out.
      const keyed = await keyedSubject(patch, bw, bh, what, [x0, y0, x1, y1]).catch(() => null);
      const footY = pb[3] * bh - 0.03 * bh;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const i = y * bw + x, inBox = x >= x0 && x <= x1 && y >= y0 && y <= y1;
        // With a key: the person, plus what changed under their feet (contact shadow). Without: what changed inside the box.
        region[i] = !inBox ? 0 : keyed ? (keyed[i] ? 255 : y >= footY ? region[i] : 0) : region[i];
      }
      region.set(await blur1(region, bw, bh, 1.5));
      how = `new ${what} boxed by Nemotron at ${pb.map(v => v.toFixed(2)).join(', ')}${keyed ? ', silhouette keyed from a green-screen edit' : ''}; the rest of the old silhouette restored from the photo`;
    }
    await logStep(sid, 'realify', `object ${p.id} paste`, how, 0);
    return { rgb: pasteCrop(cleared, w, toned, box, 3, region), model: r.model };
  } catch (e) {
    await logStep(sid, 'realify', `object ${p.id} ${p.name}`, `error: ${(e as Error).message.slice(0, 200)}`, Date.now() - t0);
    return { rgb: frame };
  }
}

/** Cosmos Reason2 (or Nemotron Nano Omni while Cosmos 404s) as the second physics checker; logs its own step. */
async function secondOpinion(sid: bigint, img: Buffer, id: string) {
  const t1 = Date.now();
  const v = await physicalCheck(`data:image/jpeg;base64,${(await sharp(img).resize({ width: 768, height: 768, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer()).toString('base64')}`)
    .catch(e => ({ ok: true, verdict: `error: ${e.message}`, model: '' }));
  if (v) await logStep(sid, 'physical_check', `render ${id}, ${v.model}`, v.verdict, Date.now() - t1);
}
