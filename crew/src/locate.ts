// Photos from anywhere: Nemotron 3.5 Super VL reads a photo (signs, landmarks, script, vegetation, architecture) and names
// the place; Nominatim (OpenStreetMap) geocodes that name on the server. Coordinates only ever come from the geocoder or the
// photo's own GPS, never from the model, and the confidence says how sure we are. POST /api/locate.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODELS, NVIDIA_BASE, PUBLIC_URL, REPO, loadSpots, secret } from './config.ts';
import { chat, parseJson, thinking } from './models.ts';
import { nearestSpot } from './geo.ts';
import { record } from './ledger.ts';

export type Confidence = 'high' | 'medium' | 'low';
export type Located = {
  place: string; lat: number | null; lon: number | null; confidence: Confidence; reason: string; headingDeg: number | null;
  source: 'gps' | 'nemotron'; nearestSpot: string | null; query: string; model: string; ms: number;
};
export type Guess = { place: string; query: string; confidence: Confidence; reason: string; headingDeg: number | null };
export type Hit = { lat: number; lon: number; name: string };
export type Deps = { ask: (image: string) => Promise<string>; geocode: (q: string) => Promise<Hit | null>; reverse: (lat: number, lon: number) => Promise<Hit | null> };

const PROMPT = `Where was this photo taken? Read every clue: shop and street signs, landmarks, the language and script, licence plates, architecture, vegetation, road markings.
Name the most specific real place you can (a named landmark, street or neighbourhood, with the city and country).
Reply with strict JSON only: {"place": "<name as people say it>", "query": "<a search string a map can find: landmark or street, city, region, country>",
"confidence": "high|medium|low", "reason": "<one sentence: which clues>", "heading_deg": <the compass direction the camera faces if the photo shows it, else null>}
high: a readable sign or an unmistakable landmark names the place. medium: strong clues point to one city or district. low: a guess. If you cannot tell, use an empty place and low.`;

/** The model's reply, normalised. Anything malformed becomes an empty, low-confidence guess. */
export function readGuess(raw: string): Guess {
  const j = parseJson(raw) ?? {};
  const place = String(j.place ?? '').trim().slice(0, 160), query = String(j.query ?? '').trim().slice(0, 200) || place;
  const confidence: Confidence = ['high', 'medium', 'low'].includes(j.confidence) && place ? j.confidence : 'low';
  const h = Number(j.heading_deg);
  return { place, query, confidence, reason: String(j.reason ?? '').trim().slice(0, 300), headingDeg: j.heading_deg !== null && Number.isFinite(h) ? ((h % 360) + 360) % 360 : null };
}

const near = (lat: number | null, lon: number | null) => (lat === null || lon === null ? null : nearestSpot(loadSpots(), lat, lon)?.id ?? null);

/** Names and places a photo. Geocoder misses make the answer low confidence with no coordinates. */
export async function locatePhoto(image: string, deps: Deps, now = Date.now): Promise<Located> {
  const t0 = now(), g = readGuess(await deps.ask(image));
  const hit = g.query ? (await deps.geocode(g.query)) ?? (g.place && g.place !== g.query ? await deps.geocode(g.place) : null) : null;
  const base = { headingDeg: g.headingDeg, source: 'nemotron' as const, query: g.query, model: MODELS.agent };
  if (!hit) return { ...base, place: g.place, lat: null, lon: null, confidence: 'low', reason: g.place ? `${g.reason} No map match for "${g.query}".`.trim() : g.reason || 'Nemotron could not tell where this is.', nearestSpot: null, ms: now() - t0 };
  return { ...base, place: g.place || hit.name, lat: hit.lat, lon: hit.lon, confidence: g.confidence, reason: g.reason, nearestSpot: near(hit.lat, hit.lon), ms: now() - t0 };
}

/** A photo with GPS: the place name for its coordinates (the coordinates stay the photo's own). */
export async function locateGps(lat: number, lon: number, deps: Deps, now = Date.now): Promise<Located> {
  const t0 = now(), hit = await deps.reverse(lat, lon);
  return { place: hit?.name ?? '', lat, lon, confidence: 'high', reason: "From your photo's GPS.", headingDeg: null, source: 'gps', nearestSpot: near(lat, lon), query: '', model: 'nominatim', ms: now() - t0 };
}

// ---- Nominatim: a User-Agent naming the app, cached, at most one request a second (its usage policy) -----------------

const CACHE_FILE = join(REPO, 'data/geocode.json');
let cache: Record<string, Hit | null> = {};
try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { /* first run */ }
let queue = Promise.resolve(), last = 0;
const UA = `Tessera/1.0 (HackUTD 2026 photo planner; ${PUBLIC_URL})`;

async function nominatim(path: string, key: string, pick: (j: any) => Hit | null): Promise<Hit | null> {
  if (key in cache) return cache[key];
  const run = queue.then(async () => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const t0 = Date.now();
    const r = await fetch(`https://nominatim.openstreetmap.org/${path}`, { headers: { 'user-agent': UA, 'accept-language': 'en' }, signal: AbortSignal.timeout(6_000) });
    record('nominatim', 'OpenStreetMap Nominatim', 'geocode a place name', Date.now() - t0, r.ok);
    if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
    const hit = pick(await r.json());
    cache[key] = hit;
    try { mkdirSync(join(REPO, 'data'), { recursive: true }); writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch { /* the cache is best effort */ }
    return hit;
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
}

const short = (j: any) => {
  const a = j.address ?? {}, city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.county;
  const first = j.name || a.road || a.neighbourhood || a.suburb;
  return [first, city, a.state, a.country].filter((x, i, xs) => x && xs.indexOf(x) === i).join(', ') || String(j.display_name ?? '');
};

export const realDeps = (): Deps => ({
  async ask(image) {
    const key = secret('nvidia_key');
    if (!key) throw new Error('NVIDIA key not set');
    const m = await chat(NVIDIA_BASE, key, { model: MODELS.agent, ...thinking(false), temperature: 0, max_tokens: 400, messages: [{ role: 'user', content: [
      { type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: image } }] }] }, 14_000, 'place a photo from anywhere');
    return String(m.content ?? '');
  },
  geocode: q => nominatim(`search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(q)}`, `q:${q.toLowerCase()}`,
    j => (Array.isArray(j) && j[0] ? { lat: Number(j[0].lat), lon: Number(j[0].lon), name: short(j[0]) } : null)),
  reverse: (lat, lon) => nominatim(`reverse?format=jsonv2&addressdetails=1&zoom=16&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, `r:${lat.toFixed(4)},${lon.toFixed(4)}`,
    j => (j && !j.error ? { lat: Number(j.lat), lon: Number(j.lon), name: short(j) } : null)),
});
