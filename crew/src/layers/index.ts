// GET /api/layers?session=<id> | spot=<id> | lat=&lon=  [&layers=a,b] [&at=<ISO time>]
// GET /api/layers/conditions?(same)  -> the one-paragraph conditions summary the agents use (docs/GEODATA.md).
// Every layer is a GeoJSON FeatureCollection in WGS84 plus a summary; one slow or failing source never blocks the rest.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { conn } from '../stdb.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSpots, SPOTS_DIR } from '../config.ts';
import { tzFor } from '../sun.ts';
import { setContext } from '../set.ts';
import { buildLayers, LAYER_IDS, type LayerId, type LayersResponse } from './build.ts';
import type { Conditions } from './conditions.ts';
import type { Place } from './types.ts';
import type { XY } from './geom.ts';

export { buildLayers, LAYER_IDS, type LayerId, type LayersResponse };

export interface Query { sessionId?: bigint; spotId?: string; lat?: number; lon?: number; at?: Date }

/** The spot (or point) and time a query names. Session time defaults to the set's shared clock, session.planTime. */
export function resolve(q: Query): { place: Place; at: Date; sessionId?: bigint } | null {
  let spotId = q.spotId, at = q.at;
  if (q.sessionId !== undefined) {
    const s = conn.db.session.id.find(q.sessionId);
    if (!s) return null;
    spotId = s.spotId || spotId;
    at ??= s.planTime?.toDate();
  }
  at ??= new Date();
  if (spotId) {
    const row = conn.db.spot.id.find(spotId), file = loadSpots().find(s => s.id === spotId);
    const lat = row?.lat ?? file?.lat, lon = row?.lon ?? file?.lon;
    if (lat === undefined || lon === undefined) return null;
    return { place: { id: spotId, name: row?.name ?? file?.name ?? spotId, lat, lon, radiusM: Math.min(row?.radiusM ?? file?.radius_m ?? 500, 800), zone: tzFor(lat, lon) }, at, sessionId: q.sessionId };
  }
  if (q.lat === undefined || q.lon === undefined || Math.abs(q.lat) > 90 || Math.abs(q.lon) > 180) return null;
  return { place: { id: 'point', name: `${q.lat.toFixed(4)}, ${q.lon.toFixed(4)}`, lat: q.lat, lon: q.lon, radiusM: 500, zone: tzFor(q.lat, q.lon) }, at };
}

/** Where to test for building shadow: the middle of the street at the mark (spots/<id>/geometry.json, from our own SfM
 *  model) or the mark itself, and 10 m in front of the session's shot camera when there is one. */
function probes(spotId: string, sessionId?: bigint): { label: string; xy: XY }[] {
  const g = join(SPOTS_DIR, spotId, 'geometry.json');
  const centre = existsSync(g) ? (JSON.parse(readFileSync(g, 'utf8')).street?.centre as number[] | undefined) : undefined;
  const pts: { label: string; xy: XY }[] = [{ label: centre ? 'The middle of the street at the mark' : 'The street at the mark', xy: centre ? [centre[0], centre[1]] : [0, 0] }];
  const ctx = sessionId !== undefined ? setContext(sessionId) : null;
  if (ctx) {
    const h = (ctx.cam.heading * Math.PI) / 180;
    pts.push({ label: 'Your subject spot (10 m in front of the camera)', xy: [ctx.cam.x + 10 * Math.sin(h), ctx.cam.y + 10 * Math.cos(h)] });
  }
  return pts;
}

/** The conditions summary for an agent tool: `conditions({ sessionId })` or `conditions({ spotId, at })`. */
export async function conditions(q: Query): Promise<Conditions & { place: Place; errors: LayersResponse['errors'] }> {
  const r = resolve(q);
  if (!r) throw new Error('no such session or spot, or no lat/lon');
  const res = await buildLayers(r.place, r.at, ['weather', 'alerts', 'film', 'closures', 'construction', 'tides', 'shadow', 'moon'], probes(r.place.id, r.sessionId), true);
  return { ...res.conditions!, place: res.place, errors: res.errors };
}

const json = (res: ServerResponse, code: number, body: unknown, cache = 'no-store') => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': cache, 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

function queryOf(url: URL): Query | string {
  const g = (k: string) => url.searchParams.get(k);
  const q: Query = {};
  if (g('session')) { if (!/^\d{1,19}$/.test(g('session')!)) return 'session must be a number'; q.sessionId = BigInt(g('session')!); }
  if (g('spot')) { if (!/^[a-z0-9_]{1,40}$/.test(g('spot')!)) return 'bad spot id'; q.spotId = g('spot')!; }
  if (g('lat') && g('lon')) { q.lat = Number(g('lat')); q.lon = Number(g('lon')); if (!Number.isFinite(q.lat) || !Number.isFinite(q.lon)) return 'lat and lon must be numbers'; }
  if (g('at')) { const d = new Date(g('at')!); if (isNaN(d.getTime())) return 'at must be an ISO time'; q.at = d; }
  if (q.sessionId === undefined && !q.spotId && q.lat === undefined) return 'give ?session=<id>, ?spot=<id> or ?lat=&lon=';
  return q;
}

/** Mounted from crew/src/http.ts. Returns false when the path is not ours. */
export async function layersRoute(p: string, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (p !== '/api/layers' && p !== '/api/layers/conditions') return false;
  if (req.method !== 'GET') { json(res, 405, { error: 'GET only' }); return true; }
  const q = queryOf(url);
  if (typeof q === 'string') { json(res, 400, { error: q }); return true; }
  const r = resolve(q);
  if (!r) { json(res, 404, { error: 'no such session or spot' }); return true; }
  try {
    if (p === '/api/layers/conditions') { json(res, 200, await conditions(q)); return true; }
    const asked = (url.searchParams.get('layers') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const bad = asked.filter(a => !(LAYER_IDS as readonly string[]).includes(a));
    if (bad.length) { json(res, 400, { error: `unknown layers: ${bad.join(', ')}; known: ${LAYER_IDS.join(', ')}` }); return true; }
    const ids = (asked.length ? asked : [...LAYER_IDS]) as LayerId[];
    json(res, 200, await buildLayers(r.place, r.at, ids, probes(r.place.id, r.sessionId), url.searchParams.get('conditions') !== '0'), q.sessionId === undefined && q.at ? 'public, max-age=60' : 'no-store');
  } catch (e) { json(res, 502, { error: (e as Error).message }); }
  return true;
}
