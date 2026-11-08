// The chat agent shared by every channel (Photon iMessage, Telegram, voice). One call handles one inbound
// message and returns the reply. State lives in Spacetime rows, so follow-ups find the session's last photo.
import { existsSync, readFileSync } from 'node:fs';
import { conn, step, until } from './stdb.ts';
import { MODELS, NVIDIA_BASE, secret } from './config.ts';
import { dataUrl, ingest, localPath, type Ingested } from './images.ts';
import { chat, readLens, type ChatMsg } from './models.ts';
import { similar } from './similar.ts';
import { previewWarnings } from './jobs.ts';
import { planShootDay } from './shootday.ts';
import { sunAt, sunWindows, windowWords } from './sun.ts';
import { bearing, compassWord, metres, nearestSpot, zoomWords } from './geo.ts';
import { answerText, matchSpotByName, parseFollowUp } from './words.ts';
import type { Photo } from './module_bindings/types.ts';

export type Inbound = { sessionId: bigint; channel: string; threadId: string; text: string; imageUrl?: string; imagePath?: string; upload?: Ingested };
export type Reply = { text: string; imagePath?: string };

type Ctx = Inbound & { photo?: Photo; upload?: Ingested; previewPath?: string; warning?: string };

const spots = () => [...conn.db.spot.iter()];
const spotRow = (id: string) => conn.db.spot.id.find(id) ?? undefined;
const sessionPhotos = (sid: bigint) => [...conn.db.photo.sessionId.filter(sid)].sort((a, b) => Number(b.id - a.id));
const latestJob = (photoId: bigint) => [...conn.db.solveJob.photoId.filter(photoId)].sort((a, b) => Number(b.id - a.id))[0];
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Brings an inbound image into data/photos (or finds it there) so the solver and preview edits can read it. */
async function ensureImage(c: Ctx) {
  if (c.upload) return; // the caller already ingested it (Photon does, to mirror the message with its URL)
  const local = c.imageUrl ? localPath(c.imageUrl) : null;
  if (local && existsSync(local)) {
    c.photo = sessionPhotos(c.sessionId).find(p => p.url === c.imageUrl);
    if (!c.photo) c.upload = await ingest(readFileSync(local));
    return;
  }
  if (c.imagePath) { c.upload = await ingest(readFileSync(c.imagePath)); return; }
  if (c.imageUrl && /^https?:\/\//.test(c.imageUrl)) {
    const r = await fetch(c.imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`could not fetch the image: HTTP ${r.status}`);
    c.upload = await ingest(Buffer.from(await r.arrayBuffer()));
  }
}

/** The photo this message is about: the new one, else the session's latest. */
const currentPhoto = (c: Ctx) => c.photo ?? sessionPhotos(c.sessionId)[0];

// ---- tools ------------------------------------------------------------------------------------------

type Tool = { description: string; parameters: object; run: (c: Ctx, a: any) => Promise<any>; logsItself?: boolean };

const TOOLS: Record<string, Tool> = {
  pick_spot: {
    description: 'Pick which mapped spot the photo is from, using its EXIF GPS or a place name the user gave. Returns the spot or the list of mapped spots.',
    parameters: { type: 'object', properties: { place_name: { type: 'string', description: 'Place name from the user, if any' } } },
    async run(c, a) {
      const list = spots();
      const gps = c.upload?.gpsLat != null ? { lat: c.upload.gpsLat, lon: c.upload.gpsLon! } : null;
      const byGps = gps && nearestSpot(list.map(s => ({ ...s, radius_m: s.radiusM })), gps.lat, gps.lon);
      const byName = matchSpotByName(`${a?.place_name ?? ''} ${c.text}`, list);
      const s = byGps ?? byName;
      if (!s) return { found: false, mapped_spots: list.map(x => x.name), hint: gps ? 'photo GPS is not near a mapped spot' : 'photo has no GPS; ask where it is' };
      return { found: true, spot_id: s.id, name: s.name, by: byGps ? 'photo GPS' : 'place name' };
    },
  },
  read_lens: {
    description: 'Estimate the 35 mm-equivalent focal length of the current photo from its pixels.',
    parameters: { type: 'object', properties: {} },
    async run(c) {
      const p = currentPhoto(c), path = c.upload?.path ?? (p && localPath(p.url));
      if (!path) return { error: 'no photo yet' };
      const r = await readLens(await dataUrl(path));
      return r ? { f35: round(r.f35, 1), zoom: zoomWords(r.f35), source: r.source } : { skipped: 'no lens model configured' };
    },
  },
  solve: {
    description: 'Locate the current photo inside a mapped spot: where the photographer stood, heading and lens. Takes about 15-60 s.',
    parameters: { type: 'object', properties: { spot_id: { type: 'string' } }, required: ['spot_id'] },
    logsItself: true, // the job loop logs safety_check, read_lens, solve and sun_windows as it runs them
    async run(c, a) {
      if (!spotRow(a.spot_id)) return { error: `unknown spot ${a.spot_id}` };
      let photo = currentPhoto(c);
      if (c.upload && !c.photo) {
        const u = c.upload;
        await conn.reducers.addPhoto({
          sessionId: c.sessionId, spotId: a.spot_id, url: u.url, thumb: u.thumb, width: u.width, height: u.height,
          pinLat: u.gpsLat ?? undefined, pinLon: u.gpsLon ?? undefined, exifF35: u.exifF35 ?? undefined, source: c.channel.slice(0, 16),
        });
        photo = c.photo = await until(() => sessionPhotos(c.sessionId).find(p => p.url === u.url), 15_000, 'the photo row');
      } else if (photo && !latestJob(photo.id)) {
        await conn.reducers.enqueueSolve({ photoId: photo.id, spotId: a.spot_id, lensHintF35: undefined });
      }
      if (!photo) return { error: 'no photo to solve' };
      const id = photo.id;
      const job = await until(() => { const j = latestJob(id); return j && (j.state === 'done' || j.state === 'failed') && j; }, 6 * 60_000, 'the solve')
        .catch(() => null);
      if (!job) return { pending: true, progress: latestJob(id)?.progress ?? 'queued', note: 'still solving; the result will appear in the live session' };
      if (job.state === 'failed') return { ok: false, error: job.error };
      const r = conn.db.solveResult.photoId.find(id)!;
      return {
        ok: true, confidence: r.confidence, reason: r.reason, lat: round(r.pose.lat, 6), lon: round(r.pose.lon, 6), heading: round(r.pose.heading, 1),
        pitch: round(r.pose.pitch, 1), f35: round(r.pose.f35, 1), lens_read_f35: r.lensReadF35, answer: answerText(spotRow(job.spotId), r),
      };
    },
  },
  sun_windows: {
    description: 'Next golden hour and blue hour at the solved camera position, and whether the sun is behind the camera then.',
    parameters: { type: 'object', properties: {} },
    async run(c) {
      const p = currentPhoto(c), r = p && conn.db.solveResult.photoId.find(p.id);
      if (!r || r.confidence === 'none') return { error: 'no solved photo yet' };
      const w = sunWindows(r.pose.lat, r.pose.lon, r.pose.heading), f = (x: typeof w.golden) => windowWords(x, r.pose.lat, r.pose.lon) || null;
      return { golden: f(w.golden), blue: f(w.blue), golden_front_lit: f(w.goldenFrontLit) };
    },
  },
  make_preview: {
    description: "Make a preview of the user's own photo with a different lens (longer = exact crop), people added, a chosen light, or free-text changes. Labelled AI interpretation.",
    parameters: {
      type: 'object', properties: {
        f35: { type: 'number', description: '35 mm-equivalent focal length wanted' },
        people: { type: 'integer', description: 'how many people to add' },
        light: { type: 'string', enum: ['golden hour', 'blue hour', 'as is'] },
        instruction: { type: 'string', description: 'any other change, in plain words' },
      },
    },
    logsItself: true, // the preview job logs make_preview with what it did
    async run(c, a) {
      const p = currentPhoto(c);
      if (!p) return { error: 'no photo yet' };
      const r = conn.db.solveResult.photoId.find(p.id);
      let sunAzimuth: number | undefined, sunAltitude: number | undefined;
      if (r && r.confidence !== 'none' && (a.light === 'golden hour' || a.light === 'blue hour')) {
        const w = sunWindows(r.pose.lat, r.pose.lon, r.pose.heading)[a.light === 'golden hour' ? 'golden' : 'blue'];
        if (w) ({ az: sunAzimuth, alt: sunAltitude } = sunAt(new Date((w.start.getTime() + w.end.getTime()) / 2), r.pose.lat, r.pose.lon));
      }
      const before = Math.max(0, ...[...conn.db.previewJob.sessionId.filter(c.sessionId)].map(j => Number(j.id)));
      await conn.reducers.requestPreview({
        sessionId: c.sessionId, photoId: p.id, instruction: String(a.instruction ?? '').slice(0, 500),
        f35: typeof a.f35 === 'number' ? a.f35 : undefined, people: Math.max(0, Math.min(10, Number(a.people) || 0)), sunAzimuth, sunAltitude,
      });
      const job = await until(() => [...conn.db.previewJob.sessionId.filter(c.sessionId)]
        .find(j => Number(j.id) > before && j.photoId === p.id && (j.state === 'done' || j.state === 'failed')), 5 * 60_000, 'the preview');
      if (job.state === 'failed') return { ok: false, error: job.error };
      c.previewPath = localPath(job.imageUrl) ?? undefined;
      c.warning = previewWarnings.get(job.id);
      return { ok: true, url: job.imageUrl, note: 'sent with the reply; call it an AI interpretation', ...(c.warning && { warning: c.warning }) };
    },
  },
  set_reminder: {
    description: 'Remind the user in this thread before the next good light for their solved shot (30 minutes before golden or blue hour starts).',
    parameters: { type: 'object', properties: { light: { type: 'string', enum: ['golden hour', 'blue hour'] } } },
    async run(c, a) {
      const p = currentPhoto(c), r = p && conn.db.solveResult.photoId.find(p.id);
      if (!r || r.confidence === 'none') return { error: 'no solved photo yet' };
      const kind = a.light === 'blue hour' ? 'blue' : 'golden';
      const w = sunWindows(r.pose.lat, r.pose.lon, r.pose.heading)[kind];
      if (!w) return { error: `no ${kind} hour in the next days` };
      const spot = conn.db.spot.id.find(conn.db.solveJob.id.find(r.jobId)?.spotId ?? '');
      const at = Math.max(w.start.getTime() - 30 * 60_000, Date.now() + 60_000);
      const text = `In 30 minutes: ${windowWords(w, r.pose.lat, r.pose.lon)}${spot ? ` at ${spot.name}` : ''}. Face ${compassWord(r.pose.heading)}, zoom ${zoomWords(r.pose.f35)}.`;
      await conn.reducers.scheduleReminder({ sessionId: c.sessionId, atMicros: BigInt(at) * 1000n, text: text.slice(0, 300) });
      return { ok: true, remind_at: new Date(at).toISOString(), text };
    },
  },
  find_similar_spots: {
    description: 'Find mapped photos that look like the current photo, or match a description like "moody bridge at sunset", with where each was taken from.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'a description; leave out to use the current photo' } } },
    async run(c, a) {
      const p = currentPhoto(c), path = c.upload?.path ?? (p && localPath(p.url)) ?? undefined;
      const hits = await similar(a.query ? { text: String(a.query), k: 4 } : { imagePath: path, k: 4 });
      return { results: hits.map(h => ({ spot: h.spot, score: h.score, heading: h.pose.heading, f35: h.pose.f35, lat: h.pose.lat, lon: h.pose.lon, credit: h.credit })) };
    },
  },
  plan_shoot_day: {
    description: 'Plan a shoot day: the solved shot plus up to 5 similar viewpoints at the spot, each at its best light, in a walking order solved by NVIDIA cuOpt.',
    parameters: { type: 'object', properties: {} },
    async run(c) { return planShootDay(c.sessionId); },
  },
  scout_status: {
    description: "Where the scouts in this session are relative to the mark (the solved camera position).",
    parameters: { type: 'object', properties: {} },
    async run(c) {
      const cam = conn.db.camera.sessionId.find(c.sessionId);
      const scouts = [...conn.db.devicePose.sessionId.filter(c.sessionId)];
      if (!scouts.length) return { scouts: 0, note: 'no scout has opened the scout page' };
      return {
        scouts: scouts.map(d => ({
          accuracy_m: Math.round(d.accuracyM), seen_s_ago: Math.round((Date.now() - Number(d.at.microsSinceUnixEpoch / 1000n)) / 1000),
          ...(cam && { to_mark_m: Math.round(metres(d.lat, d.lon, cam.pose.lat, cam.pose.lon)), walk: compassWord(bearing(d.lat, d.lon, cam.pose.lat, cam.pose.lon)) }),
        })),
      };
    },
  },
};

async function callTool(c: Ctx, name: string, args: any) {
  const t = TOOLS[name];
  if (!t) return { error: `no tool ${name}` };
  const a = JSON.stringify(args ?? {});
  const run = () => t.run(c, args ?? {}).catch((e: Error) => ({ error: e.message }));
  return t.logsItself ? run() : step(c.sessionId, name, a, run, v => JSON.stringify(v));
}

// ---- Nemotron tool loop --------------------------------------------------------------------------------

const SYSTEM = `You are ShotMatch, texting with someone about a photo of a place. You find where the photographer stood, which way they faced and the lens, then help them plan their own version.
Use the tools. With a new photo: pick_spot, then solve with that spot (solve also reads the lens and checks safety). If pick_spot finds nothing, ask where the photo was taken and name the mapped spots.
If they ask to be reminded before good light, call set_reminder. For "show me shots like this" or a described mood, call find_similar_spots. For a plan covering several shots in one outing, call plan_shoot_day.
Follow-ups like "make it 85mm", "add two people" or "what about sunset" mean: call make_preview right away on the session's photo (it works before the photo is solved too). Do not ask where it was taken for these.
When solve returns an "answer", send that answer text as written, adding at most one short line. Write plainly, no markdown, no emojis. Previews are an AI interpretation; say so.
If a photo is refused or cannot be placed, say why in one sentence.`;

async function agentLoop(c: Ctx, key: string): Promise<string> {
  const content: any[] = [{ type: 'text', text: c.text || '(photo with no text)' }];
  const path = c.upload?.path ?? (c.photo && localPath(c.photo.url));
  if (path && (c.upload || c.photo)) content.push({ type: 'image_url', image_url: { url: await dataUrl(path, 640) } });
  const last = currentPhoto(c), solved = last && conn.db.solveResult.photoId.find(last.id);
  const state = c.upload ? `A new photo came with this message${c.upload.gpsLat != null ? ' (it has GPS)' : ' (no GPS)'}.`
    : solved ? `The session's photo is solved: ${solved.confidence}, ${Math.round(solved.pose.f35)} mm, heading ${Math.round(solved.pose.heading)}.`
    : last ? 'The session has a photo that is not solved yet.' : 'The session has no photo yet.';
  const messages: ChatMsg[] = [{ role: 'system', content: `${SYSTEM}\n${state}` }, { role: 'user', content }];
  const tools = Object.entries(TOOLS).map(([name, t]) => ({ type: 'function', function: { name, description: t.description, parameters: t.parameters } }));
  for (let i = 0; i < 8; i++) {
    const m = await chat(NVIDIA_BASE, key, { model: MODELS.agent, messages, tools, tool_choice: 'auto', temperature: 0.2, max_tokens: 900 }, 120_000);
    if (!m.tool_calls?.length) return String(m.content ?? '').trim();
    messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls });
    for (const tc of m.tool_calls) {
      let args: any = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* model sent bad JSON; run with no args */ }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(await callTool(c, tc.function.name, args)) });
    }
  }
  return 'That took more steps than expected. The live session has everything found so far.';
}

// ---- deterministic path (no NVIDIA key, or the model call failed) -----------------------------------

async function fallback(c: Ctx): Promise<string> {
  const photo = currentPhoto(c);
  const unsolved = c.upload || (photo && !latestJob(photo.id));
  if (unsolved) {
    const pick = await callTool(c, 'pick_spot', {});
    if (!pick.found) return `Where was this taken? I have these spots mapped: ${pick.mapped_spots.join(', ') || 'none yet'}.`;
    const r = await callTool(c, 'solve', { spot_id: pick.spot_id });
    return r.answer ?? r.note ?? `Couldn't solve it: ${r.error}`;
  }
  if (photo && /\bremind\b/i.test(c.text)) {
    const r = await callTool(c, 'set_reminder', { light: /blue/i.test(c.text) ? 'blue hour' : 'golden hour' });
    return r.ok ? `Done. I'll text you 30 minutes before: ${r.text}` : `Couldn't set it: ${r.error}`;
  }
  const f = parseFollowUp(c.text);
  if (photo && (f.f35 || f.people || f.light)) {
    const r = await callTool(c, 'make_preview', { ...f, instruction: '' });
    return r.ok ? 'Here is an AI interpretation of your version.' : `Couldn't make the preview: ${r.error}`;
  }
  if (photo && /\b(light|sun|when)\b/i.test(c.text)) {
    const w = await callTool(c, 'sun_windows', {});
    return w.error ?? [w.golden, w.blue, w.golden_front_lit && `front-lit: ${w.golden_front_lit}`].filter(Boolean).join('\n');
  }
  return 'Send me a photo of a place and I will find where it was taken from, which way to face and what lens to use. Then try "make it 85mm", "add two people" or "at sunset".';
}

export async function handleInbound(msg: Inbound): Promise<Reply> {
  const c: Ctx = { ...msg };
  await ensureImage(c);
  const key = secret('nvidia_key');
  let text: string | undefined;
  if (key) {
    try { text = await agentLoop(c, key); }
    catch (e) { console.warn(`agent model failed, using the fixed path: ${(e as Error).message}`); }
  }
  text ||= await fallback(c);
  if (c.warning && !text.includes(c.warning)) text += `\n${c.warning}`;
  return { text, imagePath: c.previewPath };
}
