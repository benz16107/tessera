// Small helpers shared by the Simple screens: upload, plain-word labels, photo credits and the session's camera.
import { useEffect, useState } from 'react';
import type { Photo, SolveResult } from '../module_bindings/types.ts';

export interface Upload { url: string; width: number; height: number; thumb: string; exifF35: number | null; gpsLat: number | null; gpsLon: number | null; nearestSpot: string | null }

const MAX = 25 * 1024 * 1024;

/** Checks the file, then POSTs it to the crew (CONTRACTS.md: raw body, HEIC is converted there). */
export async function uploadPhoto(file: Blob, name = ''): Promise<Upload> {
  const type = file.type || (/\.hei[cf]$/i.test(name) ? 'image/heic' : '');
  if (!type.startsWith('image/')) throw new Error('That file is not a photo. Pick a JPG, HEIC or PNG.');
  if (file.size > MAX) throw new Error('Photos up to 25 MB.');
  let r: Response;
  try { r = await fetch('/api/upload', { method: 'POST', body: file, headers: { 'Content-Type': type } }); }
  catch { throw new Error('Could not reach Tessera. Check the connection and try again.'); }
  if (!r.ok) {
    const j = await r.json().catch(() => ({} as { error?: string }));
    throw new Error(r.status >= 502 ? 'Tessera is not taking photos right now. Try again in a minute.' : j.error ?? `Upload failed (${r.status}).`);
  }
  return r.json();
}

/** A pasted link to a photo. Many sites refuse to share their images with other pages, so say that plainly. */
export async function fetchLinkedPhoto(link: string): Promise<Blob> {
  let u: URL;
  try { u = new URL(link.trim()); } catch { throw new Error('That is not a link. Paste a link that starts with https://'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Paste a link that starts with https://');
  let r: Response;
  try { r = await fetch(u.href, { mode: 'cors' }); }
  catch { throw new Error('That site does not let other pages load its photos. Save the photo, then drop it here.'); }
  if (!r.ok) throw new Error(`That link answered with an error (${r.status}).`);
  const b = await r.blob();
  if (!b.type.startsWith('image/')) throw new Error('That link is a page, not a photo. Open the photo itself and copy its link.');
  return b;
}

export const CONFIDENCE: Record<string, { word: string; tone: 'good' | 'warn' | 'bad' }> = {
  solid: { word: 'Solid match', tone: 'good' },
  check: { word: 'Likely match, check it', tone: 'warn' },
  none: { word: "Couldn't place this photo", tone: 'bad' },
};

export const resultLine = (r: SolveResult) => {
  const reason = r.reason || `${r.inliers} matches`;
  return `${reason.replace(/, /g, ' · ')} · solved in ${Math.round(r.secs)} s`;
};

// shortcut: photo rows carry no credit yet, so the one Commons photo we ship as the example is recognised by its exact size
// and spot. Replace with the photo's own credit once the module stores one (asked of the studio thread too).
export function photoCredit(photo: Pick<Photo, 'width' | 'height'> | undefined, spotId: string, owner?: string) {
  if (photo && spotId === 'nyc_dumbo' && photo.width === 1280 && photo.height === 1707) return 'Photo: Shah Ronak S, CC BY-SA 4.0';
  return owner ? `Photo: uploaded by ${owner}` : 'Photo: your upload';
}

export const fmtDistance = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`);

/** Phone zoom in the words people use: 2.2× on an iPhone's main camera (24 mm), 0.5× for the ultra wide. */
export function iphoneZoom(f35: number) {
  if (f35 < 18) return '0.5×';
  const z = f35 / 24;
  return `${Math.abs(z - 1) < 0.05 ? '1' : z.toFixed(1)}×`;
}

export function useNow(ms: number, on = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

export const initials = (name: string) => (name.trim()[0] ?? '?').toUpperCase();

/** POST /api/locate (docs/NVIDIA.md, "Nemotron places photos from anywhere"): names the place from the photo's GPS, or
 *  from its pixels when it has none. Coordinates come from the GPS or Nominatim, never from the model. Null on any failure. */
export interface Located {
  place: string; lat: number | null; lon: number | null; confidence: 'high' | 'medium' | 'low'; reason: string;
  headingDeg: number | null; source: 'gps' | 'nemotron'; nearestSpot: string | null;
}
export async function locate(photoUrl: string, gps?: { lat: number; lon: number }): Promise<Located | null> {
  try {
    const r = await fetch('/api/locate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({ photoUrl, ...(gps ?? {}) }),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** A free-location shoot: spot id 'geo:<lat>,<lon>,<ground height above sea level>' (the same form Studio reads). */
export const parseGeo = (spotId: string) => {
  const m = spotId.match(/^geo:(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/);
  return m ? { lat: +m[1], lon: +m[2], height: +m[3] } : null;
};
export const geoSpotId = (lat: number, lon: number, height: number) => `geo:${lat.toFixed(6)},${lon.toFixed(6)},${height.toFixed(1)}`;

// shortcut: sea-level elevation from Open-Meteo stands in for height above the ellipsoid (the geoid differs by up to about
// 100 m); the tiles' own ground alignment absorbs that. Use a geoid-corrected height if alignment ever misses.
export async function groundHeight(lat: number, lon: number): Promise<number> {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, { signal: AbortSignal.timeout(4000) });
    const h = (await r.json())?.elevation?.[0];
    return Number.isFinite(h) ? h : 0;
  } catch { return 0; }
}

// shortcut: a free location's zone is its longitude's whole-hour offset (no daylight saving), as in Studio; use a zone lookup when one ships.
export const lonZone = (lon: number) => { const h = Math.round(lon / 15); return h === 0 ? 'UTC' : `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}`; };

/** Where a dropped photo's shoot lives: a mapped spot (solve it), or a free location at a pin (no solve; nothing to match). */
export type Placement = { kind: 'spot'; spotId: string } | { kind: 'pin'; lat: number; lon: number; place: string; guessed: boolean };
export function decidePlace(u: Pick<Upload, 'nearestSpot' | 'gpsLat' | 'gpsLon'>, loc: Located | null, onlySpot: string, knownSpot = ''): Placement {
  const spotId = knownSpot || u.nearestSpot || loc?.nearestSpot;
  if (spotId) return { kind: 'spot', spotId };
  // GPS far from every mapped spot: plan at the photo's own location.
  if (u.gpsLat != null && u.gpsLon != null) return { kind: 'pin', lat: u.gpsLat, lon: u.gpsLon, place: loc?.place ?? '', guessed: false };
  // No GPS: Nemotron's guess, when it is not unsure and the map found the name.
  if (loc && loc.lat != null && loc.lon != null && loc.confidence !== 'low') return { kind: 'pin', lat: loc.lat, lon: loc.lon, place: loc.place, guessed: true };
  return { kind: 'spot', spotId: onlySpot }; // unsure: solve against the mapped spot, as before
}
