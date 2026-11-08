// Nemotron 3.5 Super VL reading pictures for the set: what is in the user's photo (with image boxes, placed back into the
// set through the solved camera), how it is lit, an art director's critique of a render, and the session's call sheet.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODELS, NVIDIA_BASE, VISION_DIR, secret } from './config.ts';
import { chat, parseJson, thinking } from './models.ts';
import { conn, logStep, step } from './stdb.ts';
import { dataUrl, ensureLocal } from './images.ts';
import { boxToGround, enuOf, facingBearing, type Cam } from './setgeo.ts';
import { addObject, describeObjects, framingNote, latestSolved, personAt, propAt, sessionObjects, setContext, type SetCtx } from './set.ts';
import { sunWindows, fmtTime } from './sun.ts';
import { bodyById } from '../../web/src/studio/catalog/bodies.ts';

const key = () => { const k = secret('nvidia_key'); if (!k) throw new Error('NVIDIA key not set'); return k; };
const ask = (text: string, image: string) => ({ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] });

export type SceneItem = { label: string; kind: 'person' | 'vehicle' | 'prop'; box: [number, number, number, number]; facing?: string };
export type SceneRead = { items: SceneItem[]; summary: string };
export type LightRead = { sun_side: string; hardness: string; time_look: string; color_temp_k: number; sky: string; summary: string };

const SCENE_PROMPT = `List the people, vehicles and movable props you can see in this photo (benches, bikes, signs, bins, plants, umbrellas; not buildings, roads or trees in the background).
For each give a tight bounding box as [x0, y0, x1, y1] in integers from 0 to 1000 (x right, y down, 0,0 top-left), and which way it faces relative to the camera (toward, away, left, right).
Reply with strict JSON only: {"summary": "<one sentence about the scene>", "items": [{"label": "woman in red coat", "kind": "person|vehicle|prop", "box": [x0,y0,x1,y1], "facing": "toward"}]}. At most 15 items, the most prominent first.`;

const LIGHT_PROMPT = `Read the light in this photo like a cinematographer. Reply with strict JSON only:
{"sun_side": "left|right|front (backlit)|behind (front-lit)|overhead|none (overcast or night)", "hardness": "hard|soft|mixed", "time_look": "sunrise|morning|midday|afternoon|golden hour|blue hour|night|overcast",
"color_temp_k": <number, the overall white balance look>, "sky": "<clear, hazy, cloudy, ...>", "summary": "<one sentence a lighting designer could match>"}`;

export function normBox(b: unknown): [number, number, number, number] | null {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(v => Number.isFinite(Number(v)))) return null;
  let [x0, y0, x1, y1] = b.map(Number);
  const s = Math.max(x0, y0, x1, y1) > 1.5 ? 1000 : 1; // models sometimes answer in fractions
  [x0, y0, x1, y1] = [x0 / s, y0 / s, x1 / s, y1 / s];
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  return x1 - x0 > 0.003 && y1 - y0 > 0.003 ? [x0, y0, x1, y1] : null;
}

export async function readScene(image: string): Promise<SceneRead> {
  const m = await chat(NVIDIA_BASE, key(), { model: MODELS.agent, ...thinking(false), temperature: 0, max_tokens: 1500, messages: [ask(SCENE_PROMPT, image)] }, 90_000, 'photo read (objects and boxes)');
  const j = parseJson(String(m.content ?? '')) ?? {};
  const items = (Array.isArray(j.items) ? j.items : []).map((it: any) => ({
    label: String(it.label ?? it.kind ?? 'object').slice(0, 60),
    kind: (['person', 'vehicle', 'prop'].includes(it.kind) ? it.kind : /person|man|woman|child|people/i.test(it.label) ? 'person' : 'prop') as SceneItem['kind'],
    box: normBox(it.box), facing: it.facing ? String(it.facing) : undefined,
  })).filter((it: any): it is SceneItem => !!it.box).slice(0, 15);
  return { items, summary: String(j.summary ?? '').slice(0, 300) };
}

export async function readLight(image: string): Promise<LightRead> {
  const m = await chat(NVIDIA_BASE, key(), { model: MODELS.agent, ...thinking(false), temperature: 0, max_tokens: 400, messages: [ask(LIGHT_PROMPT, image)] }, 60_000, 'light read');
  const j = parseJson(String(m.content ?? ''));
  if (!j) throw new Error(`light read gave no JSON: ${String(m.content).slice(0, 100)}`);
  return { sun_side: String(j.sun_side ?? ''), hardness: String(j.hardness ?? ''), time_look: String(j.time_look ?? ''), color_temp_k: Number(j.color_temp_k) || 5500, sky: String(j.sky ?? ''), summary: String(j.summary ?? '').slice(0, 300) };
}

type Reads = { photoId: string; scene?: SceneRead; light?: LightRead; at: string };
const readsFile = (photoId: bigint) => join(VISION_DIR, `${photoId}.json`);
export function readsFor(photoId: bigint): Reads | null {
  try { return JSON.parse(readFileSync(readsFile(photoId), 'utf8')); } catch { return null; }
}
const saveReads = (r: Reads) => { mkdirSync(VISION_DIR, { recursive: true }); writeFileSync(readsFile(BigInt(r.photoId)), JSON.stringify(r)); };

/** Reads one photo (objects and light) once, logging both as agent steps; cached in data/vision. */
export async function readPhoto(sessionId: bigint, photoId: bigint, force = false): Promise<Reads> {
  const have = readsFor(photoId);
  if (have?.scene && have.light && !force) return have;
  const p = conn.db.photo.id.find(photoId);
  const path = p && (await ensureLocal(p.url));
  if (!path) throw new Error('the photo is not on this crew box or in the bucket');
  const img = await dataUrl(path, 1024);
  const [scene, light] = await Promise.all([
    step(sessionId, 'read_photo', `photo ${photoId}, ${MODELS.agent}`, () => readScene(img),
      v => `${v.items.length} found: ${v.items.map(i => i.label).join(', ').slice(0, 300)}. ${v.summary}`).catch(() => undefined),
    step(sessionId, 'light_read', `photo ${photoId}, ${MODELS.agent}`, () => readLight(img),
      v => `sun ${v.sun_side}, ${v.hardness} light, looks like ${v.time_look}, about ${Math.round(v.color_temp_k)} K. ${v.summary}`).catch(() => undefined),
  ]);
  const r: Reads = { photoId: String(photoId), scene: scene ?? have?.scene, light: light ?? have?.light, at: new Date().toISOString() };
  saveReads(r);
  return r;
}

const VEHICLE = (label: string) => /bike|bicycle|cycl/i.test(label) ? 'bike' : /taxi|cab/i.test(label) ? 'taxi' : /suv|truck|van|jeep/i.test(label) ? 'suv' : 'car';
const PROP = (label: string): string | null => {
  const t = label.toLowerCase();
  for (const [re, id] of [[/bench/, 'bench'], [/chair/, 'chair'], [/table/, 'table'], [/umbrella|parasol/, 'parasol'], [/flower/, 'flowers'], [/plant|pot/, 'potted-plant'],
    [/street ?light|lamp ?post|lamp/, 'streetlight'], [/traffic light|signal/, 'traffic-light'], [/cone/, 'cone'], [/hydrant/, 'hydrant'], [/trash|bin|garbage/, 'trash-can'], [/arrow/, 'arrow-sign'], [/sign/, 'town-sign']] as const)
    if (re.test(t)) return id;
  return null;
};

/** Puts a stand-in for everything Nemotron saw where it stood: each box bottom back-projected through the solved camera to the ground. */
export async function placeStandIns(ctx: SetCtx, read: SceneRead): Promise<{ placed: string[]; skipped: string[] }> {
  // Photo boxes live in the photo's own camera; use the solve (not a camera the user has since moved) for the back-projection.
  const solved = latestSolved(ctx.sessionId);
  const pose = solved?.r?.pose;
  const cam: Cam = pose ? { ...enuOf(ctx.origin, pose.lat, pose.lon), z: Math.max(0.3, pose.alt), heading: pose.heading, pitch: pose.pitch, roll: pose.roll, f35: pose.f35, w: solved!.p.width, h: solved!.p.height } : ctx.cam;
  const placed: string[] = [], skipped: string[] = [];
  let n = 0;
  for (const it of read.items) {
    const g = boxToGround(cam, it.box);
    if (!g || g.dist < 0.8) { skipped.push(`${it.label} (no ground under it)`); continue; }
    const facing = facingBearing(/toward/i.test(it.facing ?? '') ? 'camera' : it.facing ?? 'camera', g, cam);
    const name = `From photo: ${it.label}`.slice(0, 80);
    let s;
    if (it.kind === 'person') {
      const h = Number.isFinite(g.heightM) ? Math.max(1.1, Math.min(2.05, g.heightM)) : 1.7;
      s = personAt(name, g, facing, g.heightM < 1.35 ? 'sit' : 'stand', h);
    } else {
      const asset = it.kind === 'vehicle' ? VEHICLE(it.label) : PROP(it.label);
      if (!asset) { skipped.push(`${it.label} (no library prop)`); continue; }
      s = propAt(asset, name, g, facing);
    }
    s.params += ';from=photo';
    await addObject(ctx.sessionId, s);
    placed.push(`${it.label} at ${Math.round(g.dist)} m`);
    if (++n >= 12) break;
  }
  return { placed, skipped };
}

/** After a solve: read the photo, and rebuild the scene from it when the set is still empty. Never throws. */
export async function afterSolve(sessionId: bigint, photoId: bigint) {
  if (!secret('nvidia_key')) return;
  try {
    const reads = await readPhoto(sessionId, photoId);
    const ctx = setContext(sessionId);
    if (ctx && reads.scene?.items.length && !sessionObjects(sessionId).length) {
      const t0 = Date.now(), r = await placeStandIns(ctx, reads.scene);
      await logStep(sessionId, 'rebuild_from_photo', `photo ${photoId}`, `placed ${r.placed.length}: ${r.placed.join(', ')}${r.skipped.length ? `; skipped ${r.skipped.join(', ')}` : ''}`, Date.now() - t0);
    }
  } catch (e) { console.warn(`after solve ${photoId}: ${(e as Error).message}`); }
}

/** The latest light read in the session, for render prompts. */
export function sessionLight(sessionId: bigint): LightRead | undefined {
  for (const p of [...conn.db.photo.sessionId.filter(sessionId)].sort((a, b) => Number(b.id - a.id))) {
    const r = readsFor(p.id);
    if (r?.light) return r.light;
  }
  return undefined;
}

/** The live conditions paragraph for a session (geo layers), or '' when it is unavailable. Waits at most 15 s (a cold call). */
async function liveConditions(sessionId: bigint, at?: Date): Promise<string> {
  const { conditions } = await import('./layers/index.ts');
  const c = await Promise.race([conditions({ sessionId, at }).catch(e => { console.warn(`conditions: ${e.message}`); return null; }), new Promise<null>(r => setTimeout(() => r(null), 15_000))]);
  if (c?.text) await logStep(sessionId, 'conditions', at ? at.toISOString() : 'plan time', c.text.slice(0, 3800), 0);
  return c?.text ?? '';
}

/** Super with reasoning on for a plan that must come back as JSON; when the reply is cut off or incomplete, once more with reasoning off. */
async function planJson(messages: any[], role: string, ok: (v: any) => boolean, temperature: number): Promise<any> {
  let last = '';
  for (const think of [true, false]) {
    const m = await chat(NVIDIA_BASE, key(), { model: MODELS.agent, ...thinking(think), temperature, max_tokens: think ? 16000 : 4000, messages }, 150_000, `${role}${think ? ' (reasoning on)' : ''}`).catch(e => ({ content: '', error: e.message }));
    const v = parseJson(String(m.content ?? ''));
    if (v && ok(v)) return v;
    last = String(m.content || (m as any).error || '').slice(0, 120);
  }
  throw new Error(`${role} gave no usable JSON: ${last}`);
}

export type Fix = { title: string; why: string; steps: { tool: string; args: Record<string, unknown> }[] };
export type Critique = { summary: string; strengths: string[]; fixes: Fix[]; model: string };

const CRITIQUE_TOOLS = `move_object {id, frame_x?, distance_m?, right_m?, forward_m?, facing?}, delete_object {id}, add_people {count, pose, frame_x, distance_m, facing},
set_camera {focal_mm?, aperture?, pan_deg?, tilt_deg?, level?} (pan and tilt are relative turns: pan +5 turns 5 deg right, tilt -3 lowers 3 deg; level true removes roll)`;

/** Art director: composition critique of a render (thirds, leading lines, subject placement, horizon) with 2-3 fixes as scene edits. */
export async function critique(sessionId: bigint, image: string): Promise<Critique> {
  const ctx = setContext(sessionId);
  if (!ctx) throw new Error('the session has no shot camera yet');
  const s = conn.db.shotSettings.sessionId.find(sessionId);
  const cond = await liveConditions(sessionId);
  const text = `You are an art director reviewing a still from a photo shoot plan. The image is the planned frame.
The shot camera: ${Math.round(ctx.cam.f35)} mm equivalent, pitch ${Math.round(ctx.cam.pitch)} deg, roll ${ctx.cam.roll.toFixed(1)} deg${s ? `, f/${s.aperture}` : ''}.
${framingNote(ctx.cam)}
Objects in the set (frame_x -1 left edge to 1 right edge, frame_y -1 bottom to 1 top; thirds lines at +-0.33):
${describeObjects(ctx)}
${cond ? `Real-world conditions at the planned time (live data): ${cond}\nIf scaffolding, a closure, building shadow or the weather would change this frame, say so and make one fix address it.\n` : ''}Critique the composition: rule of thirds, leading lines, subject placement and separation, horizon level and height, balance, negative space.
Then give 2 or 3 concrete fixes. Each fix must be a list of tool calls on the set using only these tools and existing ids: ${CRITIQUE_TOOLS}.
Reply with strict JSON only: {"summary": "<two sentences>", "strengths": ["..."], "fixes": [{"title": "<6 words>", "why": "<one sentence>", "steps": [{"tool": "move_object", "args": {"id": 12, "frame_x": -0.33}}]}]}`;
  const j = await planJson([ask(text, image)], 'art director', v => Array.isArray(v?.fixes), 0.3);
  const fixes: Fix[] = (Array.isArray(j.fixes) ? j.fixes : []).slice(0, 3).map((f: any) => ({
    title: String(f.title ?? 'Fix').slice(0, 60), why: String(f.why ?? '').slice(0, 240),
    steps: (Array.isArray(f.steps) ? f.steps : []).filter((x: any) => x && typeof x.tool === 'string').slice(0, 6).map((x: any) => ({ tool: x.tool, args: x.args ?? {} })),
  })).filter((f: Fix) => f.steps.length);
  return { summary: String(j.summary ?? '').slice(0, 500), strengths: (j.strengths ?? []).map(String).slice(0, 4), fixes, model: MODELS.agent };
}

/** A call sheet for the session: shots, lenses, call times from the sun windows, and the people in the set. */
export async function callSheet(sessionId: bigint) {
  const ctx = setContext(sessionId);
  if (!ctx) throw new Error('the session has no shot camera yet');
  const spot = conn.db.spot.id.find(ctx.spotId);
  const ll = { lat: ctx.origin.lat, lon: ctx.origin.lon };
  const w = sunWindows(ll.lat, ll.lon, ctx.cam.heading);
  const win = (x: typeof w.golden) => x ? `${x.kind} ${fmtTime(x.start, ll.lat, ll.lon)} to ${fmtTime(x.end, ll.lat, ll.lon)}, sun ${x.sunBehind ? 'behind the camera' : Math.abs(x.sunRel) < 60 ? 'in frame' : x.sunRel < 0 ? 'left' : 'right'}` : 'none in the next days';
  const s = conn.db.shotSettings.sessionId.find(sessionId);
  const body = s ? bodyById(s.bodyId) : undefined;
  const people = sessionObjects(sessionId).filter(o => o.kind === 'person').map(o => o.name);
  const light = sessionLight(sessionId);
  const planTime = conn.db.session.id.find(sessionId)?.planTime;
  // Conditions at the plan time, else at the next golden hour (the geo thread's live layers).
  const cond = await liveConditions(sessionId, planTime ? undefined : w.golden?.start);
  const text = `Write a call sheet for a photo shoot at ${spot?.name ?? ctx.spotId}.
Hero shot: camera facing ${Math.round(ctx.cam.heading)} deg, ${Math.round(ctx.cam.f35)} mm equivalent${body ? ` on a ${body.name}` : ''}${s ? `, f/${s.aperture}, 1/${Math.round(1 / s.shutterS)} s, ISO ${s.iso}` : ''}.
Light windows: ${win(w.golden)}; ${win(w.blue)}; front-lit golden hour: ${win(w.goldenFrontLit)}.
${planTime ? `The crew planned ${fmtTime(new Date(Number(planTime.microsSinceUnixEpoch / 1000n)), ll.lat, ll.lon)}.` : ''}
The original photo's light: ${light?.summary ?? 'not read yet'}.
People in the set: ${people.length ? people.join(', ') : 'none placed yet'}.
Set: ${describeObjects(ctx)}
${cond ? `Real-world conditions (live data): ${cond}\n` : ''}Plan 4 to 6 shots that build on the hero shot (variations in lens, framing, people, light). Times must fall inside the light windows above.
Use the conditions: favour the window with the better colour chance, plan around tides, alerts, permits, scaffolding and building shadow, and say so in each shot's notes.
Reply with strict JSON only: {"title": "...", "date": "...", "call_time": "...", "wrap_time": "...", "location": "...",
"shots": [{"n": 1, "name": "...", "time": "...", "lens_mm": 35, "aperture": 2.8, "shutter": "1/250", "framing": "...", "people": "...", "light": "...", "notes": "..."}],
"crew_notes": ["..."]}`;
  const j = await planJson([{ role: 'user', content: text }], 'call sheet', v => Array.isArray(v?.shots), 0.4);
  return { ...j, model: MODELS.agent, windows: { golden: win(w.golden), blue: win(w.blue), front_lit: win(w.goldenFrontLit) }, conditions: cond };
}

