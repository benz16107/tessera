// Every layer source goes through here: one JSON file per request under data/layers/, reused until its TTL runs out.
// A failed refresh serves the last good copy (marked stale) so an upstream outage never empties a layer.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../config.ts';

export const LAYERS_DIR = join(REPO, 'data/layers');
export const UA = 'Tessera/0.1 (HackUTD 2026; me@thebenzhou.com)'; // api.weather.gov and Overpass ask for a contact

export const MIN = 60_000, HOUR = 60 * MIN;
export const TTL = { weather: 15 * MIN, alerts: 5 * MIN, quakes: 15 * MIN, tides: 6 * HOUR, permits: 24 * HOUR, osm: 24 * HOUR, stations: 7 * 24 * HOUR };

export interface Got<T> { data: T; fetchedAt: number; stale: boolean; error?: string }

const inflight = new Map<string, Promise<Got<unknown>>>();

/** The cached value for `key`, refreshed with `load` when older than `ttl`. Concurrent callers share one fetch. */
export async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<Got<T>> {
  const file = join(LAYERS_DIR, `${key.replace(/[^a-z0-9_.-]/gi, '_')}.json`);
  let old: { fetchedAt: number; data: T } | null = null;
  if (existsSync(file)) try { old = JSON.parse(readFileSync(file, 'utf8')); } catch { old = null; }
  if (old && Date.now() - old.fetchedAt < ttl) return { data: old.data, fetchedAt: old.fetchedAt, stale: false };
  const running = inflight.get(key);
  if (running) return running as Promise<Got<T>>;
  const p = (async (): Promise<Got<T>> => {
    try {
      const data = await load();
      const fetchedAt = Date.now();
      mkdirSync(LAYERS_DIR, { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify({ fetchedAt, data }));
      renameSync(`${file}.tmp`, file);
      return { data, fetchedAt, stale: false };
    } catch (e) {
      const error = (e as Error).message;
      if (old) return { data: old.data, fetchedAt: old.fetchedAt, stale: true, error };
      throw e;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

/** GET (or POST a form) and parse JSON, with our User-Agent and a timeout. */
export async function getJson<T = any>(url: string, opt: { timeoutMs?: number; headers?: Record<string, string>; form?: Record<string, string> } = {}): Promise<T> {
  const r = await fetch(url, {
    method: opt.form ? 'POST' : 'GET',
    headers: { 'user-agent': UA, accept: 'application/json', ...(opt.form && { 'content-type': 'application/x-www-form-urlencoded' }), ...opt.headers },
    body: opt.form ? new URLSearchParams(opt.form).toString() : undefined,
    signal: AbortSignal.timeout(opt.timeoutMs ?? 20_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
  try { return JSON.parse(text) as T; } catch { throw new Error(`${new URL(url).host} returned non-JSON: ${text.slice(0, 80)}`); }
}

/** A cache key part for a point: 4 decimals is about 10 m, so the same spot always hits the same file. */
export const at4 = (lat: number, lon: number) => `${lat.toFixed(4)}_${lon.toFixed(4)}`;
