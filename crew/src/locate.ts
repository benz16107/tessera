// Photos from anywhere: Nemotron 3.5 Super VL reads a photo (signs, landmarks, script, vegetation, architecture) and names
// the place; Nominatim (OpenStreetMap) geocodes that name on the server. Coordinates only ever come from the geocoder or the
// photo's own GPS, never from the model, and the confidence says how sure we are. POST /api/locate.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODELS, NVIDIA_BASE, PUBLIC_URL, REPO, loadSpots, secret } from './config.ts';
import { chat, parseJson, thinking } from './models.ts';
import { metres, nearestSpot } from './geo.ts';
import { record } from './ledger.ts';

export type Confidence = 'high' | 'medium' | 'low' | 'area';
export type Area = { lat: number; lon: number; radiusM: number };
export type Hint = { area?: Area; text?: string };
export type Located = {
  place: string; lat: number | null; lon: number | null; confidence: Confidence; reason: string; headingDeg: number | null;
  source: 'gps' | 'nemotron'; nearestSpot: string | null; query: string; model: string; ms: number; area: Area | null;
};
export type Guess = { place: string; query: string; confidence: Exclude<Confidence, 'area'>; reason: string; headingDeg: number | null };
export type Hit = { lat: number; lon: number; name: string };
export type Deps = { ask: (image: string, hint?: string) => Promise<string>; geocode: (q: string, area?: Area) => Promise<Hit | null>; reverse: (lat: number, lon: number) => Promise<Hit | null> };

const PROMPT = `Where was this photo taken? Read every clue: shop and street signs, landmarks, the language and script, licence plates, architecture, vegetation, road markings.
Name the most specific real place you can (a named landmark, street or neighbourhood, with the city and country).
Reply with strict JSON only: {"place": "<name as people say it>", "query": "<a search string a map can find: landmark or street, city, region, country>",
"confidence": "high|medium|low", "reason": "<one sentence: which clues>", "heading_deg": <the compass direction the camera faces if the photo shows it, else null>}
high: a readable sign or an unmistakable landmark names the place. medium: strong clues point to one city or district. low: a guess. If you cannot tell, use an empty place and low.`;

/** The model's reply, normalised. Anything malformed becomes an empty, low-confidence guess. */
export function readGuess(raw: string): Guess {
  const j = parseJson(raw) ?? {};
  const place = String(j.place ?? '').trim().slice(0, 160), query = String(j.query ?? '').trim().slice(0, 200) || place;
  const confidence: Guess['confidence'] = ['high', 'medium', 'low'].includes(j.confidence) && place ? j.confidence : 'low';
  const h = Number(j.heading_deg);
  return { place, query, confidence, reason: String(j.reason ?? '').trim().slice(0, 300), headingDeg: j.heading_deg !== null && Number.isFinite(h) ? ((h % 360) + 360) % 360 : null };
}

const near = (lat: number | null, lon: number | null) => (lat === null || lon === null ? null : nearestSpot(loadSpots(), lat, lon)?.id ?? null);

/** The user's clue, as words for the prompt. */
export function hintWords(hint: Hint | undefined, areaName = ''): string {
  if (!hint) return '';
  const parts: string[] = [];
  if (hint.area) {
    const km = hint.area.radiusM >= 1000 ? `${Math.round(hint.area.radiusM / 100) / 10} km` : `${Math.round(hint.area.radiusM)} m`;
    parts.push(`The user says it was taken within about ${km} of ${areaName || `${hint.area.lat.toFixed(4)}, ${hint.area.lon.toFixed(4)}`}. Name a place inside that area.`);
  }
  if (hint.text?.trim()) parts.push(`The user's note about where it is: "${hint.text.trim().slice(0, 200)}".`);
  return parts.join(' ');
}

/** Names and places a photo. Without an area, a geocoder miss means no coordinates and low confidence. With an area, the
 *  answer is always inside it: a match found within the circle, else its centre with confidence 'area'. */
export async function locatePhoto(image: string, deps: Deps, now = Date.now, hint?: Hint): Promise<Located> {
  const t0 = now(), area = hint?.area ?? null;
  const areaName = area ? (await deps.reverse(area.lat, area.lon).catch(() => null))?.name ?? '' : '';
  // With a circle there is always an answer: if the model fails or times out, the pin goes at the centre (no dead end).
  const g = readGuess(await deps.ask(image, hintWords(hint, areaName) || undefined).catch(e => {
    if (!area) throw e;
    return JSON.stringify({ place: '', confidence: 'low', reason: `Nemotron did not answer (${(e as Error).message.slice(0, 60)}).` });
  }));
  const inside = (h: Hit | null) => (h && (!area || metres(area.lat, area.lon, h.lat, h.lon) <= area.radiusM * 1.05) ? h : null);
  const find = async (q: string) => (q ? inside(await deps.geocode(q, area ?? undefined)) : null);
  const hit = (await find(g.query)) ?? (g.place && g.place !== g.query ? await find(g.place) : null);
  const base = { headingDeg: g.headingDeg, source: 'nemotron' as const, query: g.query, model: MODELS.agent, area };
  if (hit) return { ...base, place: g.place || hit.name, lat: hit.lat, lon: hit.lon, confidence: g.confidence, reason: g.reason, nearestSpot: near(hit.lat, hit.lon), ms: now() - t0 };
  if (area) return {
    ...base, place: areaName || `${area.lat.toFixed(4)}, ${area.lon.toFixed(4)}`, lat: area.lat, lon: area.lon, confidence: 'area',
    reason: `${g.reason} ${g.place ? `Nothing named "${g.place}" inside your circle, so the pin is at its centre.` : 'Planning at the centre of your circle.'}`.trim(),
    nearestSpot: near(area.lat, area.lon), ms: now() - t0,
  };
  return { ...base, place: g.place, lat: null, lon: null, confidence: 'low', reason: g.place ? `${g.reason} No map match for "${g.query}".`.trim() : g.reason || 'Nemotron could not tell where this is.', nearestSpot: null, ms: now() - t0 };
}

/** A photo with GPS: the place name for its coordinates (the coordinates stay the photo's own). */
export async function locateGps(lat: number, lon: number, deps: Deps, now = Date.now): Promise<Located> {
  const t0 = now(), hit = await deps.reverse(lat, lon);
  return { place: hit?.name ?? '', lat, lon, confidence: 'high', reason: "From your photo's GPS.", headingDeg: null, source: 'gps', nearestSpot: near(lat, lon), query: '', model: 'nominatim', ms: now() - t0, area: null };
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

const viewbox = (a: Area) => {
  const dLat = a.radiusM / 111_195, dLon = a.radiusM / (111_195 * Math.max(0.05, Math.cos((a.lat * Math.PI) / 180)));
  return `&bounded=1&viewbox=${(a.lon - dLon).toFixed(5)},${(a.lat + dLat).toFixed(5)},${(a.lon + dLon).toFixed(5)},${(a.lat - dLat).toFixed(5)}`;
};

const short = (j: any) => {
  const a = j.address ?? {}, city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.county;
  const first = j.name || a.road || a.neighbourhood || a.suburb;
  return [first, city, a.state, a.country].filter((x, i, xs) => x && xs.indexOf(x) === i).join(', ') || String(j.display_name ?? '');
};

export const realDeps = (): Deps => ({
  async ask(image, hint) {
    const key = secret('nvidia_key');
    if (!key) throw new Error('NVIDIA key not set');
    const m = await chat(NVIDIA_BASE, key, { model: MODELS.agent, ...thinking(false), temperature: 0, max_tokens: 400, messages: [{ role: 'user', content: [
      { type: 'text', text: hint ? `${PROMPT}\n${hint}` : PROMPT }, { type: 'image_url', image_url: { url: image } }] }] }, 14_000, 'place a photo from anywhere');
    return String(m.content ?? '');
  },
  // With an area: Nominatim's viewbox around the circle with bounded=1 (only results inside the box); locatePhoto then keeps
  // only what is inside the circle itself.
  geocode: (q, area) => nominatim(`search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(q)}${area ? viewbox(area) : ''}`,
    `q:${q.toLowerCase()}${area ? `@${area.lat.toFixed(3)},${area.lon.toFixed(3)},${Math.round(area.radiusM)}` : ''}`,
    j => (Array.isArray(j) && j[0] ? { lat: Number(j[0].lat), lon: Number(j[0].lon), name: short(j[0]) } : null)),
  reverse: (lat, lon) => nominatim(`reverse?format=jsonv2&addressdetails=1&zoom=16&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, `r:${lat.toFixed(4)},${lon.toFixed(4)}`,
    j => (j && !j.error ? { lat: Number(j.lat), lon: Number(j.lon), name: short(j) } : null)),
});
