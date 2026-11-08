// Semantic search with Nemotron: text embeddings (nemotron-3.5-embed-1b) over the studio's asset library, the session's
// messages and the mapped spots, then the Nemotron VL reranker reorders the top hits. Catalog vectors are cached in data/embeddings.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { MODELS, NVIDIA_BASE, NVIDIA_RETRIEVAL_BASE, REPO, secret } from './config.ts';
import { timed } from './ledger.ts';
import { PROPS } from '../../web/src/studio/catalog/props.ts';
import { POSES } from './set.ts';
import { conn } from './stdb.ts';

const CACHE = join(REPO, 'data/embeddings/text.json');
const unit = (v: number[]) => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

let cache: { model: string; vecs: Record<string, number[]> } = { model: MODELS.embedText, vecs: {} };
try { const c = JSON.parse(readFileSync(CACHE, 'utf8')); if (c.model === MODELS.embedText) cache = c; } catch { /* first run */ }
const save = () => { mkdirSync(join(REPO, 'data/embeddings'), { recursive: true }); writeFileSync(CACHE, JSON.stringify(cache)); };

async function embed(texts: string[], role: 'passage' | 'query'): Promise<number[][]> {
  const key = secret('nvidia_key');
  if (!key) throw new Error('NVIDIA key not set');
  return timed(MODELS.embedText, 'NVIDIA API Catalog', role === 'query' ? 'search query embedding' : 'library embedding', async () => {
    const r = await fetch(`${NVIDIA_BASE}/embeddings`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODELS.embedText, input: texts, input_type: role, encoding_format: 'float', truncate: 'END' }), signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`${MODELS.embedText} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return ((await r.json()) as any).data.sort((a: any, b: any) => a.index - b.index).map((d: any) => unit(d.embedding));
  });
}

/** Passage vectors, embedding only texts not cached yet. One text per request, six at a time: on 2026-11-07 the hosted
 *  endpoint returned HTTP 500 for any batch holding texts of different lengths, while single texts always worked. */
async function passages(texts: string[]): Promise<number[][]> {
  const todo = [...new Set(texts.filter(t => !cache.vecs[hash(t)]))];
  for (let i = 0; i < todo.length; i += 6) {
    const batch = todo.slice(i, i + 6);
    const v = await Promise.all(batch.map(t => embed([t], 'passage').then(r => r[0])));
    batch.forEach((t, j) => (cache.vecs[hash(t)] = v[j]));
  }
  if (todo.length) save();
  return texts.map(t => cache.vecs[hash(t)]);
}

/** Nemotron VL reranker logits for passages against a query, in the passages' order. */
export async function rerank(query: string, docs: string[]): Promise<number[]> {
  const key = secret('nvidia_key');
  if (!key || !docs.length) throw new Error('rerank needs the NVIDIA key and passages');
  return timed(MODELS.rerank, 'NVIDIA API Catalog', 'rerank', async () => {
    const r = await fetch(`${NVIDIA_RETRIEVAL_BASE}/${MODELS.rerank}/reranking`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODELS.rerank, query: { text: query }, passages: docs.map(text => ({ text })), truncate: 'END' }), signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`${MODELS.rerank} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const out = new Array(docs.length).fill(-Infinity);
    for (const x of ((await r.json()) as any).rankings ?? []) out[x.index] = x.logit;
    return out;
  });
}

export type Asset = { id: string; kind: 'model' | 'person' | 'light' | 'prop_generated'; name: string; text: string; pose?: string; lightType?: string; url?: string };

/** Everything the studio can place, with a sentence each for the embedding. */
export function assetLibrary(sessionId?: bigint): Asset[] {
  const out: Asset[] = PROPS.map(p => ({ id: p.id, kind: 'model' as const, name: p.name, text: `${p.name}. ${p.category} prop, about ${p.fit[1]} m ${p.fit[0]}.` }));
  for (const pose of POSES) out.push({ id: `person:${pose}`, kind: 'person', name: `Person (${pose})`, pose, text: `A person, ${pose === 'stand' ? 'standing' : pose === 'walk' ? 'walking' : pose === 'sit' ? 'sitting' : `${pose} pose`}. People, friends, model, subject.` });
  out.push(
    { id: 'light:point', kind: 'light', lightType: 'point', name: 'Point light', text: 'Point light: a bare bulb, lamp, string lights, fairy lights, lantern, practical light.' },
    { id: 'light:spot', kind: 'light', lightType: 'spot', name: 'Spot light', text: 'Spot light: a focused beam, key light, rim light, flashlight, street lamp beam.' },
    { id: 'light:area', kind: 'light', lightType: 'area', name: 'Softbox', text: 'Area light: softbox, diffused key light, window light, LED panel, soft fill.' },
    { id: 'light:sun', kind: 'light', lightType: 'sun', name: 'Key sun', text: 'Sun: directional daylight, hard sunlight, golden hour sun.' },
  );
  // Props generated with TRELLIS earlier in this session are reusable too.
  if (sessionId !== undefined)
    for (const o of conn.db.sceneObject.sessionId.filter(sessionId))
      if (o.kind === 'prop_generated' && !out.some(a => a.url === o.assetId)) out.push({ id: `gen:${o.id}`, kind: 'prop_generated', name: o.name, url: o.assetId, text: `${o.name}. A generated 3D prop.` });
  return out;
}

export type Hit<T> = T & { score: number; rerank?: number };

/** Embedding search, then the reranker over the top 12 (kept in embedding order when the reranker fails). */
async function search<T>(q: string, items: T[], text: (t: T) => string, k: number): Promise<{ hits: Hit<T>[]; reranked: boolean }> {
  if (!items.length || !q.trim()) return { hits: [], reranked: false };
  const [qv] = await embed([q], 'query');
  const vecs = await passages(items.map(text));
  const top = items.map((t, i) => ({ ...t, score: Math.round(cos(qv, vecs[i]) * 1000) / 1000 })).sort((a, b) => b.score - a.score).slice(0, 12);
  try {
    const logits = await rerank(q, top.map(text));
    return { hits: top.map((t, i) => ({ ...t, rerank: Math.round(logits[i] * 100) / 100 })).sort((a, b) => b.rerank! - a.rerank!).slice(0, k), reranked: true };
  } catch (e) { console.warn(`rerank: ${(e as Error).message}`); return { hits: top.slice(0, k), reranked: false }; }
}

export const searchAssets = (q: string, sessionId?: bigint, k = 5) => search(q, assetLibrary(sessionId), a => a.text, k);

/** Search across the asset library, the session's messages and the mapped spots. */
export async function searchAll(q: string, sessionId?: bigint, k = 5) {
  const msgs = sessionId === undefined ? [] : [...conn.db.message.sessionId.filter(sessionId)].filter(m => m.text.trim())
    .map(m => ({ id: String(m.id), channel: m.channel, direction: m.direction, author: m.author, text: m.text.slice(0, 600), at: new Date(Number(m.createdAt.microsSinceUnixEpoch / 1000n)).toISOString() }));
  const spots = [...conn.db.spot.iter()].map(s => ({ id: s.id, name: s.name, text: `${s.name} (${s.id.replace(/_/g, ' ')}), a mapped photo spot with ${s.cameras} registered photos.` }));
  const [assets, messages, spotHits] = await Promise.all([searchAssets(q, sessionId, k), search(q, msgs, m => m.text, k), search(q, spots, s => s.text, Math.min(k, 3))]);
  return { query: q, model: MODELS.embedText, reranker: assets.reranked ? MODELS.rerank : null, assets: assets.hits, messages: messages.hits, spots: spotHits.hits };
}

/** Embeds the catalog once at start so the first search is fast. */
export async function warmAssets() {
  if (!secret('nvidia_key')) return;
  try { await passages(assetLibrary().map(a => a.text)); console.log(`asset library embedded with ${MODELS.embedText}`); }
  catch (e) { console.warn(`asset embeddings: ${(e as Error).message}`); }
}
