import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PHOTOS_DIR = join(REPO, 'data/photos');
export const PREVIEWS_DIR = join(REPO, 'data/previews');
export const SPOTS_DIR = join(REPO, 'spots');
export const WEB_DIST = join(REPO, 'web/dist');
export const SECRETS = join(homedir(), '.config/shotmatch');

export const PORT = Number(process.env.PORT ?? 8790);
export const SPACETIME_HOST = process.env.SPACETIME_HOST ?? 'wss://maincloud.spacetimedb.com';
export const DB_NAME = process.env.DB_NAME ?? 'shotmatch';
export const PUBLIC_URL = process.env.PUBLIC_URL ?? 'https://linuxbox.<tailnet>.ts.net:10000';
export const SOLVER_URL = process.env.SOLVER_URL ?? 'http://127.0.0.1:8791';
export const MAX_UPLOAD = 25 * 1024 * 1024;

// Every hosted model id lives here, so a renamed endpoint is a one-line change.
export const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';
export const NVIDIA_GENAI_BASE = 'https://ai.api.nvidia.com/v1/genai';
export const MODELS = {
  safety: 'nvidia/nemotron-3.5-content-safety',
  agent: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  lens: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  // Tried in order; the first endpoint the key accepts is kept for the life of the process. Checked 2026-11-07: the
  // free kontext-dev and klein endpoints answer 422 "Expected: example_id" for user images, qwen-image-edit is 404, so OpenAI runs.
  nvidiaEdit: ['black-forest-labs/flux.1-kontext-dev', 'qwen/qwen-image-edit', 'black-forest-labs/flux.2-klein-4b'],
  openaiEdit: 'gpt-image-2',
  // Text and images share one vector space (checked 2026-11-07: both return 2048-d vectors).
  embed: 'nvidia/llama-nemotron-embed-vl-1b-v2',
  // Listed on the key but 404 "function not found" on 2026-11-07; physical_check skips itself while it 404s.
  physical: 'nvidia/cosmos-reason2-8b',
};

/** Reads a secret at use time; null when the file does not exist yet. Never log the value. */
export function secret(name: string): string | null {
  try { return readFileSync(join(SECRETS, name), 'utf8').trim() || null; } catch { return null; }
}

export type Spot = { id: string; name: string; lat: number; lon: number; radius_m: number; cameras: number; model_version: string };

export function loadSpots(): Spot[] {
  if (!existsSync(SPOTS_DIR)) return [];
  const out: Spot[] = [];
  for (const d of readdirSync(SPOTS_DIR)) {
    const f = join(SPOTS_DIR, d, 'spot.json');
    if (!existsSync(f)) continue;
    try { out.push(JSON.parse(readFileSync(f, 'utf8'))); } catch (e) { console.warn(`bad ${f}: ${(e as Error).message}`); }
  }
  return out;
}
