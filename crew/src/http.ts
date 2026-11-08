import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { DB_NAME, MAX_UPLOAD, PORT, PUBLIC_URL, REPO, SPACETIME_HOST, SPOTS_DIR, WEB_DIST, secret } from './config.ts';
import { IMAGE_TYPES, ensureLocal, ingest } from './images.ts';
import { VOICE_TOOLS, toolAuthorized, voiceEnded } from './voice.ts';
import { similar } from './similar.ts';
import { planShootDay } from './shootday.ts';
import { conn, logStep, until } from './stdb.ts';
import { setCommand } from './setagent.ts';
import { SET_TOOLS, runTool, type StepLog } from './settools.ts';
import { callSheet, critique, readPhoto, sessionLight } from './vision.ts';
import { shadowParams, sunFromRead } from './composite.ts';
import { searchAll, searchAssets } from './search.ts';
import { localAsset } from './props3d.ts';
import { generateProp } from './gen.ts';
import { locateGps, locatePhoto, realDeps } from './locate.ts';
import { render } from './render.ts';
import { magpie, transcribe } from './speech.ts';
import { physicalCheck, screenText } from './models.ts';
import { usage } from './ledger.ts';
import { NVIDIA_CATALOG } from './catalog.ts';
import { dataUrl } from './images.ts';
import { setContext } from './set.ts';
import { photonRoute } from './channels/http.ts';
import { layersRoute } from './layers/index.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.txt': 'text/plain; charset=utf-8', '.tsv': 'text/tab-separated-values; charset=utf-8', '.xml': 'application/xml',
};

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

function sendFile(res: ServerResponse, path: string, cache: string) {
  res.writeHead(200, { 'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', 'content-length': statSync(path).size, 'cache-control': cache });
  createReadStream(path).pipe(res);
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > max) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/** A JSON body, or null when it is missing, too big or not JSON. */
async function readJson(req: IncomingMessage, max = 200_000): Promise<any | null> {
  const b = await readBody(req, max);
  if (!b?.length) return null;
  try { return JSON.parse(b.toString('utf8')); } catch { return null; }
}

/** The session a request names, when it exists. */
/** The session a request names, when it exists. A well-formed id that is not in the cache yet (the first seconds after a
 *  crew restart, before the subscription has loaded, or a session created a moment ago) waits up to 8 s for it. */
const sessionOf = async (v: unknown) => {
  const s = String(v ?? '');
  if (!/^\d{1,19}$/.test(s)) return null;
  const id = BigInt(s);
  return (await until(() => conn.db.session.id.find(id), 8_000, 'the session').then(() => id).catch(() => null));
};

/** A stored image this server holds (/photo/ or /preview/), as a data URL for a vision model. */
const imageOf = async (url: unknown) => {
  const f = typeof url === 'string' ? await ensureLocal(url) : null;
  return f ? dataUrl(f, 1024) : null;
};

const SAFE_TOOLS = Object.keys(SET_TOOLS).filter(n => n !== 'plan_shoot_day');

/** The NVIDIA set, prop, render, search and voice endpoints. Returns false when the path is not one of them. */
async function nvidiaRoute(p: string, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const post = req.method === 'POST';
  const fail = (code: number, e: unknown) => json(res, code, { error: (e as Error)?.message ?? String(e) });

  if (p === '/api/nvidia/models' && req.method === 'GET') { json(res, 200, { models: NVIDIA_CATALOG, usage: usage() }); return true; }

  // Photos from anywhere: Nemotron names the place, Nominatim geocodes it (contract in docs/NVIDIA.md).
  if (p === '/api/locate' && post) {
    const b = await readJson(req);
    const file = typeof b?.photoUrl === 'string' ? await ensureLocal(b.photoUrl) : null;
    if (!file) { json(res, 400, { error: 'give {photoUrl: "/photo/<file>.jpg"} from /api/upload' }); return true; }
    const lat = Number(b.lat), lon = Number(b.lon), gps = b.lat != null && b.lon != null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    try {
      const deps = realDeps();
      // The user's clue: a circle ("somewhere around here") and/or their own words; GPS still wins over it.
      const a = b.hint?.area, area = a && [a.lat, a.lon, a.radiusM].every((v: unknown) => Number.isFinite(Number(v))) && Math.abs(Number(a.lat)) <= 90 && Math.abs(Number(a.lon)) <= 180
        ? { lat: Number(a.lat), lon: Number(a.lon), radiusM: Math.max(50, Math.min(200_000, Number(a.radiusM))) } : undefined;
      const hint = area || typeof b.hint?.text === 'string' ? { area, text: typeof b.hint?.text === 'string' ? b.hint.text.slice(0, 200) : undefined } : undefined;
      const r = gps ? await locateGps(lat, lon, deps) : await locatePhoto(await dataUrl(file, 1024), deps, Date.now, hint);
      console.log(`locate ${b.photoUrl}${hint ? ' (with a hint)' : ''}: ${r.source} "${r.place}" ${r.confidence} ${r.lat?.toFixed(4) ?? '-'},${r.lon?.toFixed(4) ?? '-'} ${r.ms} ms`);
      json(res, 200, r);
    } catch (e) { fail(503, e); }
    return true;
  }

  if (p === '/api/set/command' && post) {
    const b = await readJson(req), sid = await sessionOf(b?.sessionId);
    if (!sid || typeof b.text !== 'string') { json(res, 400, { error: 'give {sessionId, text}' }); return true; }
    try { json(res, 200, await setCommand(sid, b.text, { offline: b.offline === true, channel: 'studio' })); } catch (e) { fail(502, e); }
    return true;
  }

  if (p === '/api/set/apply' && post) {
    const b = await readJson(req), sid = await sessionOf(b?.sessionId);
    if (!sid || !Array.isArray(b.steps)) { json(res, 400, { error: 'give {sessionId, steps: [{tool, args}]}' }); return true; }
    const steps: StepLog[] = [], results = [];
    for (const st of b.steps.slice(0, 12)) {
      if (!SAFE_TOOLS.includes(st?.tool)) { results.push({ error: `tool ${st?.tool} is not allowed here` }); continue; }
      results.push(await runTool(sid, st.tool, st.args ?? {}, steps));
    }
    json(res, 200, { results, steps });
    return true;
  }

  if ((p === '/api/set/rebuild' || p === '/api/set/read') && post) {
    const b = await readJson(req), sid = await sessionOf(b?.sessionId);
    if (!sid) { json(res, 400, { error: 'give {sessionId}' }); return true; }
    try {
      if (p === '/api/set/rebuild') json(res, 200, await runTool(sid, 'rebuild_from_photo', { replace: b.replace === true }));
      else {
        const photoId = b.photoId ? BigInt(b.photoId) : setContext(sid)?.photo?.id;
        if (!photoId) { json(res, 404, { error: 'no photo in this session' }); return true; }
        json(res, 200, await readPhoto(sid, photoId, b.force === true));
      }
    } catch (e) { fail(502, e); }
    return true;
  }

  // The light Nemotron read from the session's photo, and the 3D sun that reproduces it (for the studio's sun).
  if (p === '/api/set/light' && req.method === 'GET') {
    const sid = await sessionOf(url.searchParams.get('session'));
    if (!sid) { json(res, 400, { error: 'give ?session=<id>' }); return true; }
    const ctx = setContext(sid), light = sessionLight(sid);
    json(res, 200, { light: light ?? null, sun: ctx ? sunFromRead(light, ctx.cam.heading) : null, shadow: light ? shadowParams(light.hardness, 1000) : null, model: light ? 'nvidia/nemotron-3.5-super-vl-120b-a12b' : null });
    return true;
  }

  if (p === '/api/set/critique' && post) {
    const b = await readJson(req), sid = await sessionOf(b?.sessionId), img = await imageOf(b?.imageUrl);
    if (!sid || !img) { json(res, 400, { error: 'give {sessionId, imageUrl: /preview/<file>}' }); return true; }
    const t0 = Date.now();
    try {
      const c = await critique(sid, img);
      await logStep(sid, 'art_director', b.imageUrl, `${c.summary} Fixes: ${c.fixes.map(f => f.title).join('; ')}`, Date.now() - t0);
      json(res, 200, c);
    } catch (e) { fail(502, e); }
    return true;
  }

  if (p === '/api/set/check' && post) {
    const b = await readJson(req), sid = await sessionOf(b?.sessionId), img = await imageOf(b?.imageUrl);
    if (!sid || !img) { json(res, 400, { error: 'give {sessionId, imageUrl}' }); return true; }
    try { json(res, 200, await physicalCheck(img)); } catch (e) { fail(502, e); }
    return true;
  }

  if (p === '/api/set/callsheet' && post) {
    const b = await readJson(req), sid = await sessionOf(b?.sessionId);
    if (!sid) { json(res, 400, { error: 'give {sessionId}' }); return true; }
    try { json(res, 200, await callSheet(sid)); } catch (e) { fail(502, e); }
    return true;
  }

  if ((p === '/api/search' || p === '/api/assets/search') && req.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').slice(0, 300), sid = await sessionOf(url.searchParams.get('session')) ?? undefined;
    if (!q.trim()) { json(res, 400, { error: 'give ?q=<words>' }); return true; }
    try { json(res, 200, p === '/api/search' ? await searchAll(q, sid) : await searchAssets(q, sid, 8)); } catch (e) { fail(503, e); }
    return true;
  }

  // Generation into the set (contract in docs/NVIDIA.md): words, a generated image or a photo become a scene object at real size.
  if (p === '/api/props/generate' && post) {
    const b = await readJson(req, 16_000_000), sid = b?.sessionId !== undefined && b?.sessionId !== null ? await sessionOf(b.sessionId) : undefined;
    if (!b || sid === null) { json(res, 400, { error: 'give {prompt} or {image | imageUrl}, optional sessionId, mode, mount, frame_x, distance_m' }); return true; }
    const mode = ['auto', 'text3d', 'image3d', 'photo3d', 'flat'].includes(b.mode) ? b.mode : 'auto';
    const mount = ['ground', 'wall', 'stand', 'screen'].includes(b.mount) ? b.mount : undefined;
    if (typeof b.prompt !== 'string' && typeof b.image !== 'string' && typeof b.imageUrl !== 'string') { json(res, 400, { error: 'give a prompt, an image data URL or an imageUrl' }); return true; }
    try {
      const words = [b.prompt, b.label].filter(x => typeof x === 'string').join(' ');
      if (words.trim()) { const s = await screenText(words); if (!s.safe) { json(res, 422, { error: 'that request was refused by the safety check' }); return true; } }
      json(res, 200, await generateProp({
        sessionId: sid ?? undefined, mode, prompt: typeof b.prompt === 'string' ? b.prompt : undefined, image: typeof b.image === 'string' ? b.image : undefined,
        imageUrl: typeof b.imageUrl === 'string' ? b.imageUrl : undefined, label: typeof (b.label ?? b.name) === 'string' ? String(b.label ?? b.name).slice(0, 60) : undefined, place: b.place !== false,
        frame_x: Number.isFinite(Number(b.frame_x)) ? Number(b.frame_x) : undefined, distance_m: Number(b.distance_m) || undefined, facing: b.facing, mount,
        height_m: Number(b.height_m) || undefined, width_m: Number(b.width_m) || undefined,
      }));
    } catch (e) { fail(502, e); }
    return true;
  }

  if (p === '/api/render' && post) {
    const ct = String(req.headers['content-type'] ?? '');
    if (!ct.startsWith('multipart/form-data')) { json(res, 415, { error: 'send multipart/form-data with beauty, sessionId, photoId' }); return true; }
    const body = await readBody(req, 60 * 1024 * 1024);
    if (!body) { json(res, 413, { error: 'layers larger than 60 MB' }); return true; }
    let form: FormData;
    try { form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': ct }, body }).formData(); } catch { json(res, 400, { error: 'bad multipart body' }); return true; }
    const sid = await sessionOf(form.get('sessionId')), beauty = form.get('beauty'), shadow = form.get('shadow'), mask = form.get('mask'), photoId = String(form.get('photoId') ?? '');
    let legend: { id: string; name: string; kind: string; color: string }[] | undefined;
    try {
      const l = JSON.parse(String(form.get('legend') ?? '[]'));
      legend = Array.isArray(l) ? l.filter(x => x && /^\d+$/.test(String(x.id)) && /^#[0-9a-f]{6}$/i.test(String(x.color))).slice(0, 300)
        .map(x => ({ id: String(x.id), name: String(x.name ?? '').slice(0, 80), kind: String(x.kind ?? ''), color: String(x.color) })) : undefined;
    } catch { /* no legend: no per-object strength */ }
    if (!sid || !(beauty instanceof Blob) || !/^\d+$/.test(photoId)) { json(res, 400, { error: 'need sessionId, photoId and a beauty PNG' }); return true; }
    // Fields come flat, or inside the studio's `settings` JSON (shot settings plus f35 and the timeline's sun).
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(String(form.get('settings') ?? '{}')) ?? {}; } catch { /* flat fields only */ }
    const raw = (k: string) => form.get(k) ?? settings[k];
    const num = (k: string) => { const v = Number(raw(k)); return Number.isFinite(v) && v > 0 ? v : undefined; };
    const az = Number(raw('sunAzimuth')), alt = Number(raw('sunAltitude'));
    const sun = Number.isFinite(az) && Number.isFinite(alt) && raw('sunAzimuth') !== undefined ? { az, alt } : undefined;
    const text = String(form.get('text') ?? settings.text ?? '').slice(0, 500);
    if (text) { const s = await screenText(text); if (!s.safe) { json(res, 422, { error: 'that instruction was refused by the safety check' }); return true; } }
    const mode = raw('mode') === 'canny' ? 'canny' : raw('mode') === 'composite' ? 'composite' : 'depth';
    // The studio's physical camera (settings.camera) and scene depth, baked into the final image; numbers clamped here.
    const c = (settings.camera && typeof settings.camera === 'object' ? settings.camera : null) as Record<string, any> | null;
    const fin = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : undefined; };
    const nums = (v: unknown, n: number, lo: number, hi: number) => Array.isArray(v) && v.length === n && v.every(x => Number.isFinite(Number(x))) ? v.map(x => Math.max(lo, Math.min(hi, Number(x)))) : undefined;
    const camera = c ? {
      exposureStops: fin(c.exposureStops, -6, 6), wbGains: nums(c.wbGains, 3, 0.2, 5) as [number, number, number] | undefined, noiseSigma: fin(c.noiseSigma, 0, 0.2),
      sensorMm: nums(c.sensorMm, 2, 1, 100) as [number, number] | undefined, blades: fin(c.blades, 0, 20), airyPx: fin(c.airyPx, 0, 50), vignette: c.vignette === true,
      distortionPoly: (nums(c.distortionPoly, 5, -5, 5) as [number, number, number, number, number] | undefined) ?? null, unitMm: fin(c.unitMm, 1, 100),
      tca: c.tca && nums(c.tca.r, 3, 0.9, 1.1) && nums(c.tca.b, 3, 0.9, 1.1) ? { r: nums(c.tca.r, 3, 0.9, 1.1) as [number, number, number], b: nums(c.tca.b, 3, 0.9, 1.1) as [number, number, number] } : null,
      shakePx: fin(c.shakePx, 0, 40), photoF35: fin(c.photoF35, 5, 2000) ?? null,
      vig: c.vig && [c.vig.k1, c.vig.k2, c.vig.k3].every(v => Number.isFinite(Number(v))) ? { k1: fin(c.vig.k1, -5, 5)!, k2: fin(c.vig.k2, -5, 5)!, k3: fin(c.vig.k3, -5, 5)! } : null,
      vigUnitMm: fin(c.vigUnitMm, 1, 100), optVig: fin(c.optVig, 0, 1), shakeDir: nums(c.shakeDir, 2, -1e3, 1e3) as [number, number] | undefined,
      polyAmt: fin(c.polyAmt, 0, 1), catEye: fin(c.catEye, 0, 0.5), spikes: fin(c.spikes, 0, 22), starAmt: fin(c.starAmt, 0, 1),
      lights: Array.isArray(c.lights) ? c.lights.slice(0, 8).filter((l: any) => [l?.x, l?.y, l?.strength].every(v => Number.isFinite(Number(v))))
        .map((l: any) => ({ x: Number(l.x), y: Number(l.y), strength: fin(l.strength, 0, 50)! })) : undefined,
    } : undefined;
    const focalMm = num('focalMm'), sd = form.get('sceneDepth');
    const optic = camera && focalMm ? { focalMm, aperture: num('aperture') ?? 4, focusM: num('focusM') ?? 10, f35: num('f35') } : undefined;
    const sceneDepth = sd instanceof Blob && optic ? { png: Buffer.from(await sd.arrayBuffer()), nearM: fin(raw('sceneNearM'), 0.05, 100) ?? 0.5, farM: fin(raw('sceneFarM'), 1, 100000) ?? 500 } : undefined;
    const input = { sessionId: sid, photoId: BigInt(photoId), beauty: Buffer.from(await beauty.arrayBuffer()), shadow: shadow instanceof Blob ? Buffer.from(await shadow.arrayBuffer()) : undefined,
      mask: mask instanceof Blob ? Buffer.from(await mask.arrayBuffer()) : undefined, legend,
      text, f35: num('f35'), aperture: num('aperture'), focusM: num('focusM'), iso: num('iso'), strength: num('strength'), sun, mode, camera, optic, sceneDepth } as const;
    // The composite alone takes under a second, so it answers directly. A render takes 30 to 90 s (placeholder edits, checks,
    // a second round), longer than browsers and proxies keep a request open: it answers 202 at once and runs in the background.
    // Poll GET /api/render/<requestId>; the preview_job row (kind 'render') gets the image too.
    if (mode === 'composite') {
      try { json(res, 200, await render(input)); } catch (e) { fail(502, e); }
      return true;
    }
    const requestId = randomUUID().replace(/-/g, '').slice(0, 16);
    renders.set(requestId, { state: 'running', startedAt: Date.now(), sessionId: String(sid) });
    rendersRunning++;
    // The finished state is also written to data/renders, so a poll that reaches the next process after a restart still finds it.
    const keep = (v: NonNullable<ReturnType<typeof renders.get>>) => {
      renders.set(requestId, v);
      try { mkdirSync(RENDERS_DIR, { recursive: true }); writeFileSync(join(RENDERS_DIR, `${requestId}.json`), JSON.stringify(v)); } catch (e) { console.warn(`render state: ${(e as Error).message}`); }
    };
    const startedAt = Date.now();
    render({ ...input, id: requestId })
      .then(r => keep({ state: 'done', startedAt, sessionId: String(sid), result: r }))
      .catch(e => keep({ state: 'failed', startedAt, sessionId: String(sid), error: (e as Error).message }))
      .finally(() => { rendersRunning--; setTimeout(() => renders.delete(requestId), 3_600_000).unref(); });
    json(res, 202, { requestId, state: 'running', poll: `/api/render/${requestId}` });
    return true;
  }

  const poll = /^\/api\/render\/([a-f0-9]{16})$/.exec(p);
  if (poll && req.method === 'GET') {
    let r = renders.get(poll[1]);
    if (!r) try { r = JSON.parse(readFileSync(join(RENDERS_DIR, `${poll[1]}.json`), 'utf8')); } catch { /* not finished on this box */ }
    if (!r) { json(res, 404, { error: 'no such render (renders are kept for an hour; a crew restart forgets them, the preview_job row keeps the image)' }); return true; }
    json(res, 200, { requestId: poll[1], ...r, seconds: Math.round((Date.now() - r!.startedAt) / 1000) });
    return true;
  }

  if (p === '/api/voice/transcribe' && post) {
    const body = await readBody(req, 15 * 1024 * 1024);
    if (!body?.length) { json(res, 400, { error: 'POST the recorded audio as the body' }); return true; }
    try {
      const heard = await transcribe(body);
      if (!heard) { json(res, 503, { error: 'no speech model configured' }); return true; }
      const sid = await sessionOf(url.searchParams.get('session'));
      if (!sid || url.searchParams.get('run') !== '1' || !heard.text) { json(res, 200, heard); return true; }
      const r = await setCommand(sid, heard.text, { channel: 'voice' });
      const speak = url.searchParams.get('speak') === '1' ? (await magpie(r.reply).catch(() => null))?.toString('base64') : undefined;
      json(res, 200, { ...heard, heard: heard.text, ...r, ...(speak && { audio: `data:audio/wav;base64,${speak}` }) });
    } catch (e) { fail(502, e); }
    return true;
  }

  if (p === '/api/voice/speak' && post) {
    const b = await readJson(req);
    if (typeof b?.text !== 'string' || !b.text.trim()) { json(res, 400, { error: 'give {text}' }); return true; }
    try { const wav = await magpie(b.text.slice(0, 600)); res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'cache-control': 'no-store' }); res.end(wav); }
    catch (e) { fail(502, e); }
    return true;
  }

  // Gaussian splats of each spot (the gpu worker trains them): /splat/<spot>.<ext> -> data/splats/<spot>/<spot>.<ext>.
  const splat = /^\/splat\/([a-z0-9_]+)\.(ply|compressed\.ply|splat|spz)$/.exec(p);
  if (splat && (req.method === 'GET' || req.method === 'HEAD')) {
    const f = join(REPO, 'data/splats', splat[1], `${splat[1]}.${splat[2]}`);
    if (!existsSync(f)) json(res, 404, { error: 'not found' });
    else { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(f).size, 'cache-control': 'public, max-age=300' }); if (req.method === 'HEAD') res.end(); else createReadStream(f).pipe(res); }
    return true;
  }

  const asset = /^\/asset\/([a-f0-9]{16})\.glb$/.exec(p);
  if (asset && (req.method === 'GET' || req.method === 'HEAD')) {
    const f = await localAsset(asset[1]);
    if (!f) json(res, 404, { error: 'not found' }); else sendFile(res, f, 'public, max-age=31536000, immutable');
    return true;
  }
  return false;
}

const NOT_BUILT = '<!doctype html><meta charset="utf-8"><title>Tessera</title><p style="font:16px system-ui;margin:3rem">The web app is not built yet. Run <code>npm run build</code> in <code>web/</code>.</p>';

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = decodeURIComponent(url.pathname);

  if (p === '/api/config' && req.method === 'GET')
    return json(res, 200, { spacetimeHost: SPACETIME_HOST, dbName: DB_NAME, mapsKey: secret('maps_key') ?? '', publicUrl: PUBLIC_URL });

  if (p === '/api/upload') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST an image' });
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.includes(type)) return json(res, 415, { error: `content type must be one of ${IMAGE_TYPES.join(', ')}` });
    if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD) return json(res, 413, { error: 'photo is larger than 25 MB' });
    const body = await readBody(req, MAX_UPLOAD);
    if (!body) return json(res, 413, { error: 'photo is larger than 25 MB' });
    if (!body.length) return json(res, 400, { error: 'empty body' });
    try { return json(res, 200, await ingest(body)); }
    catch (e) { return json(res, 400, { error: `could not read that image: ${(e as Error).message}` }); }
  }

  if (p === '/api/similar' && req.method === 'GET') {
    const photo = url.searchParams.get('photo'), q = url.searchParams.get('q')?.slice(0, 300), k = Math.min(Math.max(Number(url.searchParams.get('k')) || 6, 1), 24);
    const path = photo ? await ensureLocal(photo) : null;
    if (photo && !path) return json(res, 404, { error: 'photo must be a /photo/ or /preview/ URL on this server' });
    if (!path && !q) return json(res, 400, { error: 'give ?photo=/photo/<file> or ?q=<words>' });
    try { return json(res, 200, { results: await similar({ imagePath: path ?? undefined, text: q, k, spot: url.searchParams.get('spot') ?? undefined }) }); }
    catch (e) { return json(res, 503, { error: (e as Error).message }); }
  }

  if (p === '/api/route' && req.method === 'GET') {
    const sid = url.searchParams.get('session') ?? '';
    if (!/^\d+$/.test(sid)) return json(res, 400, { error: 'give ?session=<id>' });
    const shots = url.searchParams.get('shots')?.split(',').map(s => s.trim()).filter(s => /^([a-z0-9_]+\/)?[A-Za-z0-9_.-]+$/i.test(s));
    try { return json(res, 200, await planShootDay(BigInt(sid), shots)); }
    catch (e) { return json(res, 502, { error: (e as Error).message }); }
  }

  const tool = /^\/api\/tools\/([a-z_]+)$/.exec(p);
  if (tool && req.method === 'POST') {
    if (!toolAuthorized(req.headers['x-shotmatch-tool-secret'])) return json(res, 401, { error: 'bad tool secret' });
    const fn = VOICE_TOOLS[tool[1]];
    if (!fn) return json(res, 404, { error: 'no such tool' });
    const body = await readBody(req, 64_000);
    let args: any = {};
    try { args = body?.length ? JSON.parse(body.toString('utf8')) : {}; } catch { return json(res, 400, { error: 'bad JSON' }); }
    const out = await fn(args);
    console.log(`voice tool ${tool[1]} -> ${JSON.stringify(out).slice(0, 160)}`);
    return json(res, 200, out);
  }

  if (p === '/api/voice/ended' && req.method === 'POST') {
    const body = await readBody(req, 5_000_000);
    if (!body) return json(res, 413, { error: 'too large' });
    const sig = req.headers['elevenlabs-signature'];
    return json(res, await voiceEnded(body.toString('utf8'), typeof sig === 'string' ? sig : undefined), {});
  }

  if (await layersRoute(p, req, res, url)) return; // geodata layers (crew/src/layers, geo thread)
  if (await photonRoute(p, req, res, url)) return;
  if (await nvidiaRoute(p, req, res, url)) return;
  if (p.startsWith('/api/')) return json(res, 404, { error: 'no such endpoint' });

  if (p.startsWith('/photo/') || p.startsWith('/preview/')) {
    const f = await ensureLocal(p);
    if (!f) return json(res, 404, { error: 'not found' });
    return sendFile(res, f, 'public, max-age=31536000, immutable');
  }

  // Spot training photos for the similar-photo results (credited on /credits and in each result).
  const sp = /^\/spot-photo\/([a-z0-9_]+)\/([A-Za-z0-9_.-]+\.(?:jpg|jpeg|png))$/i.exec(p);
  if (sp) {
    const f = await ensureLocal(p, join(SPOTS_DIR, sp[1], 'images', sp[2]));
    if (!f) return json(res, 404, { error: 'not found' });
    return sendFile(res, f, 'public, max-age=86400');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
  const index = join(WEB_DIST, 'index.html');
  if (!existsSync(index)) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(NOT_BUILT); }
  const f = normalize(join(WEB_DIST, p));
  if (f.startsWith(WEB_DIST + '/') && existsSync(f) && statSync(f).isFile())
    return sendFile(res, f, p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (extname(p) && !p.endsWith('.html')) return json(res, 404, { error: 'not found' }); // a missing asset is not a route
  return sendFile(res, index, 'no-cache');
}

const LONG = /^\/api\/(locate|render|props\/generate|set\/(command|critique|callsheet|rebuild|read|apply|check)|voice\/transcribe)$/;
let draining = false, inFlight = 0, rendersRunning = 0;
const RENDERS_DIR = join(REPO, 'data/renders');
/** Background renders by request id, for GET /api/render/<id>. */
const renders = new Map<string, { state: 'running' | 'done' | 'failed'; startedAt: number; sessionId: string; result?: unknown; error?: string }>();
/** For a graceful restart: refuse new long requests and report how many are still running. */
export const stopAccepting = () => { draining = true; };
export const longRequests = () => inFlight + rendersRunning;

export function startHttp() {
  createServer((req, res) => {
    // Long model calls: refused with 503 while the crew drains for a restart, counted while they run so the drain can wait.
    if (req.method === 'POST' && LONG.test((req.url ?? '').split('?')[0])) {
      if (draining) { res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '30' }); res.end(JSON.stringify({ error: 'the crew is restarting; try again in 30 s' })); return; }
      inFlight++;
      res.once('close', () => inFlight--);
    }
    handle(req, res).catch(e => {
      console.error('http error:', e);
      if (!res.headersSent) json(res, 500, { error: 'internal error' }); else res.end();
    });
  }).listen(PORT, '127.0.0.1', () => console.log(`crew http on 127.0.0.1:${PORT}`));
}
