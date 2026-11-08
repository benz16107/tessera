// Which NVIDIA model did what, and how long it took: every model call records here. The studio's "Powered by NVIDIA"
// list reads it from GET /api/nvidia/models, and docs/NVIDIA.md quotes its numbers. Saved to data/ so restarts keep it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO } from './config.ts';

export type Use = { model: string; provider: string; roles: string[]; calls: number; errors: number; ms: number[]; lastAt: number; lastError?: string };

const FILE = join(REPO, 'data/nvidia-usage.json');
const uses = new Map<string, Use>();
try { for (const u of JSON.parse(readFileSync(FILE, 'utf8')) as Use[]) uses.set(`${u.provider}|${u.model}`, u); } catch { /* first run */ }

let dirty = false;
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify([...uses.values()])); } catch (e) { console.warn(`ledger save: ${(e as Error).message}`); }
}, 10_000).unref();

export const providerOf = (base: string) =>
  base.includes('vultrinference') ? 'Vultr Serverless Inference' : base.includes('11434') || base.includes('ollama') ? 'Ollama on the Vultr VM (CPU)'
    : base.includes('nvcf') ? 'NVIDIA NVCF (Riva gRPC)' : 'NVIDIA API Catalog';

export function record(model: string, provider: string, role: string, ms: number, ok: boolean, error?: string) {
  const k = `${provider}|${model}`;
  const u = uses.get(k) ?? { model, provider, roles: [], calls: 0, errors: 0, ms: [], lastAt: 0 };
  if (role && !u.roles.includes(role)) u.roles.push(role);
  u.calls++;
  if (ok) { u.ms.push(Math.round(ms)); if (u.ms.length > 50) u.ms.shift(); } else { u.errors++; u.lastError = (error ?? '').slice(0, 160); }
  u.lastAt = Date.now();
  uses.set(k, u);
  dirty = true;
}

/** Runs fn and records its latency and outcome. */
export async function timed<T>(model: string, provider: string, role: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try { const v = await fn(); record(model, provider, role, Date.now() - t0, true); return v; }
  catch (e) { record(model, provider, role, Date.now() - t0, false, (e as Error).message); throw e; }
}

export const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** The ledger for the UI: newest first, with median and last latency. */
export const usage = () => [...uses.values()].sort((a, b) => b.lastAt - a.lastAt).map(u => ({
  model: u.model, provider: u.provider, roles: u.roles, calls: u.calls, errors: u.errors,
  medianMs: median(u.ms), lastMs: u.ms[u.ms.length - 1] ?? null, lastAt: new Date(u.lastAt).toISOString(), ...(u.lastError && { lastError: u.lastError }),
}));
