// Generation into the set: words, an image or a photo become a scene_object at real-world scale.
//   text3d   words -> TRELLIS text mode
//   image3d  words -> FLUX.1-dev concept image (single object, plain background) -> Nemotron VL describes it -> TRELLIS
//   photo3d  a photo -> Nemotron VL finds the object (box) and describes it -> TRELLIS
//   flat     an image (generated or uploaded) -> a textured plane GLB: poster, sign, mural, screen or cut-out
// TRELLIS's hosted image mode accepts only its own example images (HTTP 422 "example_id", 2026-11-07), so images reach 3D
// through Nemotron's description of them. Real size: Nemotron gives the object's dimensions in metres and the row's `h`
// param carries the height the studio scales the GLB to (it also snaps the base to the ground). Steps go to agent_step.
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSETS_DIR, MODELS, NVIDIA_BASE, PREVIEWS_DIR, VULTR_INFERENCE_BASE, secret } from './config.ts';
import { chat, parseJson, thinking } from './models.ts';
import { genai, localAsset, trellis } from './props3d.ts';
import { planeGlb } from './glb.ts';
import { ensureLocal, saveImage } from './images.ts';
import { putObject } from './s3.ts';
import { logStep } from './stdb.ts';
import { record } from './ledger.ts';
import { addObject, joinAsCrew, newObject, setContext } from './set.ts';
import { facingBearing, frameToGround, readDims, yawQuat, type Dims } from './setgeo.ts';

export type GenMode = 'auto' | 'text3d' | 'image3d' | 'photo3d' | 'flat';
export type Mount = 'ground' | 'wall' | 'stand' | 'screen';
export type GenIn = {
  sessionId?: bigint; mode?: GenMode; prompt?: string; image?: string; imageUrl?: string; label?: string; place?: boolean;
  frame_x?: number; distance_m?: number; facing?: string | number; mount?: Mount; height_m?: number; width_m?: number; length_m?: number;
};
export type { Dims };
export type GenOut = {
  mode: Exclude<GenMode, 'auto'>; ran: string[]; asset: { id: string; url: string; bytes: number; cached: boolean };
  name: string; dims: Dims; conceptUrl?: string; description?: string; object?: { id: string; name: string }; fallback?: string; ms: number;
};

const key = () => { const k = secret('nvidia_key'); if (!k) throw new Error('NVIDIA key not set'); return k; };
const clampM = (x: unknown, lo: number, hi: number) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : undefined; };

/** Real-world size of an object from Nemotron 3.5 Super (a bicycle is about 1.75 m long and 1.0 m tall). */
export async function realDims(what: string): Promise<Dims> {
  const m = await chat(NVIDIA_BASE, key(), { model: MODELS.agent, ...thinking(false), temperature: 0, max_tokens: 150, messages: [{ role: 'user', content:
    `Typical real-world size of this object in metres, as it normally stands. height_m is the vertical size from the ground to its top (a bicycle: 1.0, an A-frame sign: 1.0, a person: 1.75), not its thickness.
Reply with strict JSON only: {"length_m": <longest horizontal side>, "width_m": <other horizontal side>, "height_m": <vertical height>}.\nObject: ${what}` }] }, 30_000, 'real-world size');
  return readDims(parseJson(String(m.content ?? '')), MODELS.agent);
}
/** An image as JPEG bytes from a data URL or one of our /photo/ or /preview/ URLs. */
async function imageBytes(inp: GenIn): Promise<Buffer | null> {
  if (inp.image) { const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(inp.image); return m ? sharp(Buffer.from(m[2], 'base64')).rotate().jpeg({ quality: 92 }).toBuffer() : null; }
  if (inp.imageUrl) { const f = await ensureLocal(inp.imageUrl); return f ? sharp(f).jpeg({ quality: 92 }).toBuffer() : null; }
  return null;
}

/** Nemotron VL on a photo: the object's box, a modeller's description and its real size, in one call. */
async function findObject(jpeg: Buffer, label?: string) {
  const small = await sharp(jpeg).resize({ width: 1024, height: 1024, fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
  const m = await chat(NVIDIA_BASE, key(), { model: MODELS.agent, ...thinking(false), temperature: 0, max_tokens: 400, messages: [{ role: 'user', content: [
    { type: 'text', text: `Find ${label ? `the ${label}` : 'the main object'} in this photo. Reply with strict JSON only: {"label": "<short name>", "box": [x0, y0, x1, y1] (integers 0 to 1000, x right, y down),
"description": "<one sentence for a 3D modeller: shape, parts, materials, colours, style; the object alone, no background>", "length_m": <real size>, "width_m": <real size>, "height_m": <real size>}` },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}` } }] }] }, 60_000, 'object read for generation');
  const j = parseJson(String(m.content ?? '')) ?? {};
  const b = Array.isArray(j.box) && j.box.length === 4 ? j.box.map(Number) : null;
  return { label: String(j.label ?? label ?? 'object').slice(0, 60), box: b && b.every(Number.isFinite) ? b as number[] : null, description: String(j.description ?? '').slice(0, 300), dims: readDims(j, MODELS.agent) };
}

async function crop(jpeg: Buffer, box: number[] | null): Promise<Buffer> {
  if (!box) return jpeg;
  const { width = 0, height = 0 } = await sharp(jpeg).metadata();
  const s = Math.max(...box) > 1.5 ? 1000 : 1, [x0, y0, x1, y1] = box.map(v => v / s);
  const pad = 0.04, l = Math.max(0, Math.floor((x0 - pad) * width)), t = Math.max(0, Math.floor((y0 - pad) * height));
  const r = Math.min(width, Math.ceil((x1 + pad) * width)), bt = Math.min(height, Math.ceil((y1 + pad) * height));
  return r - l > 16 && bt - t > 16 ? sharp(jpeg).extract({ left: l, top: t, width: r - l, height: bt - t }).jpeg({ quality: 92 }).toBuffer() : jpeg;
}

let conceptFluxDownUntil = 0;

/** A concept image: FLUX.1-dev base mode first, then Qwen-Image on Vultr (named in `model`). */
async function conceptImage(prompt: string, product: boolean): Promise<{ jpeg: Buffer; model: string; fallback?: string }> {
  const p = product ? `Product photo of ${prompt}, a single object, whole object in view, plain light grey background, soft studio light, photorealistic` : prompt;
  try {
    // FLUX base mode has answered 500 or timed out all night: after a failure it is skipped for 10 minutes, so a prop request
    // does not spend 90 s on it every time (a 90 s wait plus TRELLIS is what got cut off by a crew restart as a 502).
    if (Date.now() < conceptFluxDownUntil) throw new Error('skipped: it failed within the last 10 minutes');
    const j = await genai(MODELS.flux, { prompt: p, mode: 'base', cfg_scale: 3.5, width: 1024, height: 1024, seed: 0, steps: 30 }, product ? 'concept image for 3D' : 'image for a flat prop', 1, 45_000)
      .catch(e => { conceptFluxDownUntil = Date.now() + 600_000; throw e; });
    const b64 = j.artifacts?.[0]?.base64;
    if (!b64) throw new Error('no image');
    return { jpeg: await sharp(Buffer.from(b64, 'base64')).jpeg({ quality: 92 }).toBuffer(), model: MODELS.flux };
  } catch (e) {
    const why = `FLUX.1-dev failed: ${(e as Error).message.slice(0, 120)}`;
    const vk = secret('vultr_inference_key');
    if (product || !vk) throw new Error(why);
    const t0 = Date.now();
    const r = await fetch(`${VULTR_INFERENCE_BASE}/images/generations`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${vk}` }, signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ model: MODELS.vultrEdit, prompt: p, size: '1024x1024', n: 1, response_format: 'b64_json' }),
    });
    record(MODELS.vultrEdit, 'Vultr Serverless Inference', 'image for a flat prop (FLUX fallback)', Date.now() - t0, r.ok);
    if (!r.ok) throw new Error(`${why}; ${MODELS.vultrEdit} HTTP ${r.status}`);
    const b64 = ((await r.json()) as any).data?.[0]?.b64_json;
    if (!b64) throw new Error(`${why}; ${MODELS.vultrEdit} returned no image`);
    return { jpeg: await sharp(Buffer.from(b64, 'base64')).jpeg({ quality: 92 }).toBuffer(), model: MODELS.vultrEdit, fallback: why };
  }
}

const MOUNT_Z: Record<Mount, number> = { ground: 0, stand: 0, wall: 1.0, screen: 1.3 };
const FLAT_SIZE: Record<Mount, number> = { ground: 1.2, stand: 1.8, wall: 0.9, screen: 0.9 }; // default height in metres

/** Runs one generation and places it. Every stage is an agent_step row when a session is given. */
export async function generateProp(inp: GenIn): Promise<GenOut> {
  const t0 = Date.now(), sid = inp.sessionId, ran: string[] = [];
  if (sid !== undefined) void joinAsCrew(sid);
  const log = (tool: string, args: string, result: string, ms: number) => { ran.push(`${tool}: ${result.slice(0, 80)}`); return sid !== undefined ? logStep(sid, tool, args, result, ms) : Promise.resolve(); };
  const photo = await imageBytes(inp);
  if ((inp.image || inp.imageUrl) && !photo) throw new Error('image must be a PNG, JPEG or WebP data URL, or a /photo/ or /preview/ URL on this server');
  const prompt = (inp.prompt ?? '').trim().slice(0, 300);
  let mode: Exclude<GenMode, 'auto'> = inp.mode && inp.mode !== 'auto' ? inp.mode : photo ? 'photo3d' : 'image3d';
  if ((mode === 'photo3d') && !photo) throw new Error('photo3d needs an image');
  if (!photo && !prompt) throw new Error('give a prompt or an image');
  let fallback: string | undefined, conceptUrl: string | undefined, description: string | undefined, dims: Dims | undefined, name = prompt || inp.label || 'Prop';
  let asset: GenOut['asset'];

  if (mode === 'flat') {
    let img = photo;
    if (!img) {
      const s = Date.now(), c = await conceptImage(prompt, false);
      img = c.jpeg; fallback = c.fallback;
      await log('concept_image', prompt, `${c.model}${c.fallback ? ` (${c.fallback})` : ''}`, Date.now() - s);
    } else if (inp.label) {
      const s = Date.now(), f = await findObject(img, inp.label);
      img = await crop(img, f.box); name = f.label;
      await log('object_read', inp.label, `cropped to ${f.label}`, Date.now() - s);
    }
    const { width = 1, height = 1 } = await sharp(img).metadata();
    const mount = inp.mount ?? 'wall';
    const hM = clampM(inp.height_m, 0.05, 30) ?? (clampM(inp.width_m, 0.05, 60) ? clampM(inp.width_m, 0.05, 60)! * (height / width) : FLAT_SIZE[mount]);
    const wM = clampM(inp.width_m, 0.05, 60) ?? hM * (width / height);
    dims = { length_m: Math.round(wM * 100) / 100, width_m: 0.01, height_m: Math.round(hM * 100) / 100, source: inp.height_m || inp.width_m ? 'given' : `default ${mount} size, image aspect` };
    const small = await sharp(img).resize({ width: 1536, height: 1536, fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
    const glb = planeGlb(small, 'image/jpeg', wM, hM);
    const id = createHash('sha256').update(glb).digest('hex').slice(0, 16);
    if (!(await localAsset(id))) {
      mkdirSync(ASSETS_DIR, { recursive: true });
      writeFileSync(join(ASSETS_DIR, `${id}.glb`), glb);
      await putObject(`asset/${id}.glb`, glb, 'model/gltf-binary').catch(e => console.warn(`${(e as Error).message}; GLB kept on disk only`));
    }
    asset = { id, url: `/asset/${id}.glb`, bytes: glb.length, cached: false };
    await log('flat_prop', `${mount}, ${wM.toFixed(2)} x ${hM.toFixed(2)} m`, `image plane GLB ${Math.round(glb.length / 1024)} KB`, 0);
  } else {
    let text = prompt;
    if (mode === 'photo3d') {
      const s = Date.now(), f = await findObject(photo!, inp.label);
      description = f.description; name = inp.label || f.label; text = f.description || f.label;
      const c = await crop(photo!, f.box), file = `${randomUUID().replace(/-/g, '').slice(0, 16)}.jpg`;
      await saveImage(`/preview/${file}`, join(PREVIEWS_DIR, file), c);
      conceptUrl = `/preview/${file}`;
      await log('object_read', inp.label ?? 'main object', `${f.label}: ${f.description} (${f.dims.length_m} x ${f.dims.width_m} x ${f.dims.height_m} m)`, Date.now() - s);
    } else if (mode === 'image3d') {
      const s = Date.now();
      try {
        const c = await conceptImage(prompt, true), file = `${randomUUID().replace(/-/g, '').slice(0, 16)}.jpg`;
        await saveImage(`/preview/${file}`, join(PREVIEWS_DIR, file), c.jpeg);
        conceptUrl = `/preview/${file}`;
        await log('concept_image', prompt, `${c.model}: ${conceptUrl}`, Date.now() - s);
        const s2 = Date.now(), f = await findObject(c.jpeg, prompt);
        description = f.description; text = f.description || prompt;
        await log('object_read', 'concept image', `${f.description} (${f.dims.length_m} x ${f.dims.width_m} x ${f.dims.height_m} m)`, Date.now() - s2);
      } catch (e) {
        mode = 'text3d';
        fallback = `${(e as Error).message.slice(0, 140)}; TRELLIS text mode ran instead`;
        await log('concept_image', prompt, `error: ${fallback}`, Date.now() - s);
      }
    }
    const s = Date.now();
    try {
      const g = await trellis({ prompt: text });
      asset = { id: g.id, url: g.url, bytes: g.bytes, cached: g.cached };
      await log('trellis', text.slice(0, 200), `${g.model} text mode${g.cached ? ' (cached)' : ''}: ${g.url}, ${Math.round(g.bytes / 1024)} KB`, Date.now() - s);
    } catch (e) {
      // TRELLIS is flaky tonight (HTTP 500s). A photo or a concept image still becomes a prop: a flat cut-out at real size.
      await log('trellis', text.slice(0, 200), `error: ${(e as Error).message.slice(0, 160)}`, Date.now() - s);
      const img = conceptUrl ? await ensureLocal(conceptUrl) : null;
      if (!img) throw e;
      const d = dims ?? await realDims(description ? `${name}: ${description}` : name).catch(() => undefined);
      const out = await generateProp({ ...inp, mode: 'flat', prompt: name, image: undefined, imageUrl: conceptUrl, label: undefined, mount: 'stand', height_m: d?.height_m ?? inp.height_m });
      return { ...out, name, description, conceptUrl, ran: [...ran, ...out.ran], fallback: `TRELLIS failed (${(e as Error).message.slice(0, 100)}); placed the ${mode === 'photo3d' ? 'photo' : 'concept image'} as a flat cut-out at real size`, ms: Date.now() - t0 };
    }
  }

  // Size from text, not from pixels: Super VL sizing a patio umbrella from the photo said 0.2 m tall.
  if (!dims) { const s = Date.now(); dims = await realDims(description ? `${name}: ${description}` : name).catch(() => readDims({}, 'default')); await log('real_scale', name, `${dims.length_m} x ${dims.width_m} x ${dims.height_m} m (${dims.source})`, Date.now() - s); }
  else await log('real_scale', name, `${dims.length_m} x ${dims.width_m} x ${dims.height_m} m (${dims.source}); the studio scales the GLB to ${dims.height_m} m tall and stands it on the ground`, 0);
  if (inp.height_m && mode !== 'flat') dims = { ...dims, height_m: clampM(inp.height_m, 0.02, 60)!, source: 'given' };

  let object: GenOut['object'];
  if (sid !== undefined && inp.place !== false) {
    const ctx = setContext(sid);
    const at = ctx ? frameToGround(ctx.cam, Number(inp.frame_x ?? 0) || 0, Number(inp.distance_m ?? 6) || 6) : { x: 0, y: 0 };
    const mount = inp.mount ?? (mode === 'flat' ? 'wall' : 'ground');
    const face = ctx ? facingBearing(inp.facing ?? 'camera', at, ctx.cam) : 0;
    const row = await addObject(sid, newObject('prop_generated', name.replace(/^an? /i, '').slice(0, 60), { ...at, z: MOUNT_Z[mount] }, yawQuat(face), { assetId: asset.url },
      { h: dims.height_m, len: dims.length_m, gen: mode, mount, prompt: (description ?? prompt).slice(0, 120).replace(/[;=]/g, ' ') }));
    object = { id: String(row.id), name: row.name };
    await log('place', name, `id ${row.id}, ${mount}, ${dims.height_m} m tall`, 0);
  }
  return { mode, ran, asset, name, dims, conceptUrl, description, object, fallback, ms: Date.now() - t0 };
}
