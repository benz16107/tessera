// Where photographers stand: the geotagged Wikimedia Commons photos we already hold for a spot (the spot model's
// train and test photos, and the lens dataset), each with its compass heading when the camera recorded one.
// Our own data, so it is free to draw anywhere; each photo keeps its author and license for the credits.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, SPOTS_DIR } from '../config.ts';
import { LAYERS_DIR } from './cache.ts';
import { metres, toXY } from './geom.ts';
import { fc, type Feature, type LayerOut, type Place } from './types.ts';

interface Shot { lat: number; lon: number; heading: number | null; f35: number | null; author: string; license: string; page: string; from: string }

function readShots(p: Place): Shot[] {
  const out = new Map<string, Shot>();
  const add = (s: Shot) => { if (Number.isFinite(s.lat) && Number.isFinite(s.lon) && metres(p, s) <= p.radiusM) out.set(s.page || `${s.lat},${s.lon}`, out.get(s.page) ?? s); };
  for (const f of ['train_meta.json', 'test_meta.json']) {
    const path = join(SPOTS_DIR, p.id, f);
    if (!existsSync(path)) continue;
    for (const x of JSON.parse(readFileSync(path, 'utf8'))) {
      if (x.lat == null) continue;
      add({ lat: x.lat, lon: x.lon, heading: x.heading ?? null, f35: x.f35 ?? null, author: x.author ?? '', license: x.license ?? '', page: x.page ?? '', from: 'spot model' });
    }
  }
  const lens = join(REPO, 'data/lens/meta.jsonl');
  if (existsSync(lens)) for (const line of readFileSync(lens, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const x = JSON.parse(line);
    if (x.lat == null) continue;
    add({ lat: x.lat, lon: x.lon, heading: x.heading_deg ?? null, f35: x.f35 ?? null, author: x.author ?? '', license: x.license ?? '', page: x.page_url ?? '', from: 'lens dataset' });
  }
  return [...out.values()];
}

/** The photos within the spot's radius. Built from the raw files where they exist (linuxbox) and saved as a small
 *  extract under data/layers/, which is what a box without the lens dataset (the Vultr VM) reads. */
function shotsFor(p: Place): Shot[] {
  const extract = join(LAYERS_DIR, `photographers-${p.id}.json`);
  const fresh = readShots(p);
  if (existsSync(join(REPO, 'data/lens/meta.jsonl'))) { mkdirSync(LAYERS_DIR, { recursive: true }); writeFileSync(extract, JSON.stringify(fresh)); return fresh; }
  const saved: Shot[] = existsSync(extract) ? JSON.parse(readFileSync(extract, 'utf8')) : [];
  return saved.length >= fresh.length ? saved : fresh; // never shrink to the spot photos alone
}

/** Circular mean of compass headings, in degrees. */
export function meanHeading(hs: number[]) {
  const s = hs.reduce((a, h) => a + Math.sin((h * Math.PI) / 180), 0), c = hs.reduce((a, h) => a + Math.cos((h * Math.PI) / 180), 0);
  return ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360;
}

const WORDS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export const compass = (h: number) => WORDS[Math.round(((h % 360) + 360) % 360 / 45) % 8];

export interface PhotographerSummary { count: number; withHeading: number; hotspots: { lat: number; lon: number; n: number; heading: number | null; text: string }[] }

export async function photographersLayer(p: Place): Promise<LayerOut<PhotographerSummary>> {
  const shots = shotsFor(p);
  const feats: Feature[] = shots.map(s => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: {
    layer: 'photographers', kind: 'photo', label: s.author ? `Photo by ${s.author}` : 'Photo', detail: [s.license, s.f35 && `${Math.round(s.f35)} mm`, s.from].filter(Boolean).join(', '),
    heading: s.heading ?? undefined, f35: s.f35 ?? undefined, url: s.page || undefined } }));
  // Hot spots: 20 m cells with the most photos, and which way people point from there.
  const cells = new Map<string, Shot[]>();
  for (const s of shots) { const [x, y] = toXY(p, [s.lon, s.lat]); const k = `${Math.round(x / 20)},${Math.round(y / 20)}`; cells.set(k, [...(cells.get(k) ?? []), s]); }
  const hotspots = [...cells.values()].sort((a, b) => b.length - a.length).slice(0, 3).filter(c => c.length >= 3).map(c => {
    const hs = c.map(s => s.heading).filter((h): h is number => h !== null);
    const heading = hs.length >= 2 ? Math.round(meanHeading(hs)) : null;
    const lat = c.reduce((a, s) => a + s.lat, 0) / c.length, lon = c.reduce((a, s) => a + s.lon, 0) / c.length;
    return { lat, lon, n: c.length, heading, text: `${c.length} photos from ${Math.round(metres(p, { lat, lon }))} m ${compass(Math.atan2(...toXY(p, [lon, lat])) * 180 / Math.PI)} of the mark${heading !== null ? `, facing ${compass(heading)} (${heading}°)` : ''}` };
  });
  return {
    geojson: fc(feats),
    summary: { count: shots.length, withHeading: shots.filter(s => s.heading !== null).length, hotspots },
    sources: [{ layer: 'photographers', name: 'Geotagged Wikimedia Commons photos (spot model and lens dataset)', url: '/credits', license: 'Each photo under its own CC license, listed on the credits page', fetchedAt: null }],
  };
}

/** Shots around the world for the map's zoomed-out view: every geotagged photo in the lens dataset (37 landmarks),
 *  trimmed to what a pin and its card need. Built from data/lens/meta.jsonl where it exists, else the saved extract. */
export function worldPhotos() {
  const lens = join(REPO, 'data/lens/meta.jsonl'), extract = join(LAYERS_DIR, 'world-photos.json');
  if (!existsSync(lens)) return existsSync(extract) ? JSON.parse(readFileSync(extract, 'utf8')) : fc([]);
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const feats: Feature[] = [];
  for (const line of readFileSync(lens, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const x = JSON.parse(line), lat = num(x.lat), lon = num(x.lon);
    if (lat === null || lon === null) continue;
    const h = num(x.heading_deg), f = num(x.f35);
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] }, properties: {
      layer: 'world', kind: 'commons_photo', label: String(x.title ?? '').replace(/^File:/, ''), group: x.group ?? '',
      heading: h === null ? undefined : Math.round(h), f35: f === null ? undefined : Math.round(f), author: x.author ?? '', license: x.license ?? '' } });
  }
  const out = fc(feats);
  mkdirSync(LAYERS_DIR, { recursive: true });
  writeFileSync(extract, JSON.stringify(out));
  return out;
}
