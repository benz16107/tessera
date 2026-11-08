// Text or photo to a 3D prop with TRELLIS (hosted on NVIDIA's API catalog). The GLB is cached by prompt, kept on disk
// and in the bucket, served at /asset/<id>.glb, and added to the set as a prop_generated scene_object.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSETS_DIR, MODELS, NVIDIA_GENAI_BASE, secret } from './config.ts';
import { timed } from './ledger.ts';
import { getObject, putObject } from './s3.ts';

export const assetFile = (id: string) => /^[a-f0-9]{16}$/.test(id) ? join(ASSETS_DIR, `${id}.glb`) : null;

/** A cached GLB on disk, pulled from the bucket when another box made it. */
export async function localAsset(id: string): Promise<string | null> {
  const f = assetFile(id);
  if (!f) return null;
  if (existsSync(f)) return f;
  const data = await getObject(`asset/${id}.glb`).catch(() => null);
  if (!data) return null;
  mkdirSync(ASSETS_DIR, { recursive: true });
  writeFileSync(f, data);
  return f;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** POST to a hosted NVIDIA genai model, retrying 500s and timeouts (both seen on 2026-11-07) with backoff. */
export async function genai(model: string, body: object, role: string, attempts = 3, timeoutMs = 120_000): Promise<any> {
  const key = secret('nvidia_key');
  if (!key) throw new Error('NVIDIA key not set');
  let last = '';
  for (let i = 0; i < attempts; i++) {
    try {
      return await timed(model, 'NVIDIA API Catalog', role, async () => {
        const r = await fetch(`${NVIDIA_GENAI_BASE}/${model}`, {
          method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
        });
        if (!r.ok) throw Object.assign(new Error(`${model} HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`), { status: r.status });
        return r.json();
      });
    } catch (e: any) {
      last = e.message;
      if (e.status && e.status < 500 && e.status !== 429) throw e; // a bad request will not get better
      if (i < attempts - 1) await sleep(2000 * 2 ** i);
    }
  }
  throw new Error(`${model} failed ${attempts} times: ${last}`);
}

export type Prop3d = { id: string; url: string; bytes: number; ms: number; cached: boolean; model: string };

/** TRELLIS text-to-3D (mode text) or image-to-3D (mode image, a data URL). Same prompt and seed = same cached GLB. */
export async function trellis(input: { prompt?: string; image?: string }, seed = 0): Promise<Prop3d> {
  const mode = input.image ? 'image' : 'text';
  const what = input.image ?? (input.prompt ?? '').trim().toLowerCase();
  if (!what) throw new Error('give a prompt or an image');
  const id = createHash('sha256').update(`${MODELS.trellis}|${mode}|${seed}|${what}`).digest('hex').slice(0, 16);
  const hit = await localAsset(id);
  if (hit) return { id, url: `/asset/${id}.glb`, bytes: readFileSync(hit).length, ms: 0, cached: true, model: MODELS.trellis };
  const t0 = Date.now();
  const body = mode === 'text' ? { prompt: input.prompt, mode, seed } : { image: input.image, mode, seed };
  const j = await genai(MODELS.trellis, body, mode === 'text' ? 'text to 3D prop' : 'photo to 3D prop', 2, 100_000);
  const b64 = j.artifacts?.[0]?.base64 ?? j.artifacts?.[0]?.glb ?? j.glb;
  if (!b64) throw new Error(`TRELLIS returned no model: ${JSON.stringify(j).slice(0, 160)}`);
  const glb = Buffer.from(String(b64).replace(/^data:[^,]+,/, ''), 'base64');
  if (glb.toString('ascii', 0, 4) !== 'glTF') throw new Error('TRELLIS output is not a GLB');
  mkdirSync(ASSETS_DIR, { recursive: true });
  writeFileSync(assetFile(id)!, glb);
  await putObject(`asset/${id}.glb`, glb, 'model/gltf-binary').catch(e => console.warn(`${(e as Error).message}; GLB kept on disk only`));
  return { id, url: `/asset/${id}.glb`, bytes: glb.length, ms: Date.now() - t0, cached: false, model: MODELS.trellis };
}
