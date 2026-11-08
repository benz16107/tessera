// Similar-photo search over each spot's registered training photos, with Nemotron VL embeddings (text and image share a space).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODELS, NVIDIA_BASE, REPO, SPOTS_DIR, loadSpots, secret } from './config.ts';
import { dataUrl } from './images.ts';

const DIR = join(REPO, 'data/embeddings');
const PY = join(REPO, 'solver/.venv/bin/python');
type Pose = { lat: number; lon: number; heading: number; pitch: number; roll: number; f35: number };
type Index = { spot: string; names: string[]; vecs: number[][]; poses: Record<string, Pose>; credits: Record<string, string> };
const indexes = new Map<string, Index>();

const unit = (v: number[]) => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
export const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0); // inputs are unit vectors

async function embed(inputs: string[], kind: 'image' | 'text', role: 'passage' | 'query'): Promise<number[][]> {
  const key = secret('nvidia_key');
  if (!key) throw new Error('NVIDIA key not set');
  const r = await fetch(`${NVIDIA_BASE}/embeddings`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODELS.embed, input: inputs, input_type: role, modality: inputs.map(() => kind), encoding_format: 'float' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`${MODELS.embed} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as any).data.sort((a: any, b: any) => a.index - b.index).map((d: any) => unit(d.embedding));
}

function credits(spot: string): Record<string, string> {
  const f = join(SPOTS_DIR, spot, 'CREDITS.tsv');
  if (!existsSync(f)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(f, 'utf8').split('\n').slice(1)) {
    const [file, , title, author, license, page] = line.split('\t');
    if (file) out[file] = `${title?.replace(/^File:/, '') ?? file} by ${author || 'unknown'}, ${license || 'license unknown'}, ${page ?? ''}`.trim();
  }
  return out;
}

/** Builds (or loads from data/embeddings) the index for one spot. Embeds each registered photo once. */
export async function buildIndex(spot: string): Promise<Index> {
  mkdirSync(DIR, { recursive: true });
  const posesFile = join(DIR, `${spot}.poses.json`), vecFile = join(DIR, `${spot}.vectors.json`);
  const modelDir = join(SPOTS_DIR, spot, 'model');
  if (!existsSync(posesFile)) {
    if (!existsSync(PY) || !existsSync(modelDir)) throw new Error(`no model or solver venv for ${spot}`);
    const { stdout } = await promisify(execFile)(PY, ['-I', join(REPO, 'crew/scripts/spot_poses.py'), join(SPOTS_DIR, spot)], { maxBuffer: 20e6 });
    writeFileSync(posesFile, stdout);
  }
  const poses: Record<string, Pose> = JSON.parse(readFileSync(posesFile, 'utf8'));
  let cache: { model: string; vecs: Record<string, number[]> } = { model: MODELS.embed, vecs: {} };
  try { const c = JSON.parse(readFileSync(vecFile, 'utf8')); if (c.model === MODELS.embed) cache = c; } catch { /* first build */ }
  const todo = Object.keys(poses).filter(n => !cache.vecs[n] && existsSync(join(SPOTS_DIR, spot, 'images', n)));
  for (let i = 0; i < todo.length; i += 8) {
    const batch = todo.slice(i, i + 8);
    const vecs = await embed(await Promise.all(batch.map(n => dataUrl(join(SPOTS_DIR, spot, 'images', n), 512))), 'image', 'passage');
    batch.forEach((n, j) => (cache.vecs[n] = vecs[j]));
    writeFileSync(vecFile, JSON.stringify(cache));
  }
  const names = Object.keys(cache.vecs).filter(n => poses[n]);
  const idx = { spot, names, vecs: names.map(n => cache.vecs[n]), poses, credits: credits(spot) };
  indexes.set(spot, idx);
  return idx;
}

/** Builds every spot's index in the background at start; failures are logged and retried on the next query. */
export async function buildAll() {
  if (!secret('nvidia_key')) return console.log('similar-photo search off: NVIDIA key not set');
  for (const s of loadSpots()) {
    try { const i = await buildIndex(s.id); console.log(`similar-photo index ${s.id}: ${i.names.length} photos`); }
    catch (e) { console.warn(`similar-photo index ${s.id}: ${(e as Error).message}`); }
  }
}

export type Hit = { spot: string; file: string; url: string; score: number; pose: Pose; credit: string };

/** Nearest training photos to an image (path) or a text query, across all spots or one. */
export async function similar(q: { imagePath?: string; text?: string; spot?: string; k?: number }): Promise<Hit[]> {
  // Image queries embed as passages: the model accepts images only on the passage side.
  const v = q.imagePath ? (await embed([await dataUrl(q.imagePath, 512)], 'image', 'passage'))[0]
    : q.text ? (await embed([q.text], 'text', 'query'))[0] : null;
  if (!v) throw new Error('give a photo or a text query');
  const spots = q.spot ? [q.spot] : loadSpots().map(s => s.id);
  const hits: Hit[] = [];
  for (const s of spots) {
    const idx = indexes.get(s) ?? (await buildIndex(s).catch(() => null));
    if (!idx) continue;
    idx.names.forEach((n, i) => hits.push({ spot: s, file: n, url: `/spot-photo/${s}/${n}`, score: Math.round(cosine(v, idx.vecs[i]) * 1000) / 1000, pose: idx.poses[n], credit: idx.credits[n] ?? '' }));
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(q.k ?? 6, 1));
}

/** One training photo as a hit (pose and credit), for routes built from photos the user picked. */
export async function spotPhoto(spot: string, file: string): Promise<Hit | null> {
  const idx = indexes.get(spot) ?? (await buildIndex(spot).catch(() => null));
  if (!idx?.poses[file]) return null;
  return { spot, file, url: `/spot-photo/${spot}/${file}`, score: 1, pose: idx.poses[file], credit: idx.credits[file] ?? '' };
}
