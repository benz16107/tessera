// Tools the text-to-set agent calls. Positions are given the way a director talks (where in the frame, how far from the
// camera) and turned into east-north-up metres through the shot camera; every call is logged to agent_step.
import { Timestamp } from 'spacetimedb';
import { conn, logStep } from './stdb.ts';
import { propById } from '../../web/src/studio/catalog/props.ts';
import { cameraQuat, facingBearing, frameOf, frameToGround, kelvinHex, rowAcross, yawQuat } from './setgeo.ts';
import { ASSET_IDS, LIGHT_TYPES, POSES, addObject, deleteObject, lightAt, parseParams, personAt, propAt, sessionObjects, setContext, updateObject, type SetCtx } from './set.ts';
import { searchAssets } from './search.ts';
import { generateProp } from './gen.ts';
import { sunWindows } from './sun.ts';
import { planShootDay } from './shootday.ts';
import { planWindow } from './route.ts';
import { conditions } from './layers/index.ts';

/** The geo thread's live conditions (crew/src/layers), trimmed for a model. Slow sources land in `unavailable`, never an error. */
export async function conditionsFor(sid: bigint, at?: Date) {
  const c = await conditions({ sessionId: sid, at });
  return { at: c.at, text: c.text, color_chance: c.colorChance, alerts: c.alerts, blockers: (c.blockers ?? []).slice(0, 6), ...(Object.keys(c.errors ?? {}).length && { unavailable: c.errors }) };
}

const clamp = (x: unknown, lo: number, hi: number, d: number) => { const n = Number(x); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const COLORS: Record<string, string> = { red: '#b3261e', blue: '#1f4fa3', green: '#2e7d32', yellow: '#e8b923', black: '#1a1a1a', white: '#f2f2f2', orange: '#e0661b', pink: '#e27396', purple: '#6a3d9a', brown: '#6d4c2f', grey: '#8a8a8a', gray: '#8a8a8a', silver: '#c0c0c0', teal: '#1c8c8c', cream: '#efe6d2' };
export const colorHex = (c: unknown) => { const s = String(c ?? '').trim().toLowerCase(); return /^#[0-9a-f]{6}$/.test(s) ? s : COLORS[s.split(/\s+/).pop() ?? ''] ?? ''; };

const need = (sid: bigint) => { const c = setContext(sid); if (!c) throw new Error('this session has no shot camera yet: solve a photo or add a camera first'); return c; };
const findObj = (sid: bigint, id: unknown) => sessionObjects(sid).find(o => String(o.id) === String(id));
const where = (ctx: SetCtx, p: { x: number; y: number; z?: number }) => {
  const f = frameOf(ctx.cam, { x: p.x, y: p.y, z: p.z ?? 0 });
  return `frame_x ${Number.isFinite(f.frameX) ? f.frameX.toFixed(2) : 'n/a'}, ${f.dist.toFixed(1)} m`;
};

type Tool = { description: string; parameters: object; run: (sid: bigint, a: any) => Promise<object> };

const FRAME = {
  frame_x: { type: 'number', description: 'horizontal place in the shot: -1 left edge, -0.33 left third, 0 centre, 0.33 right third, 1 right edge' },
  distance_m: { type: 'number', description: 'metres from the camera along the ground (people usually 3 to 15)' },
  facing: { type: 'string', description: 'camera, away, left, right, or a compass bearing in degrees' },
};

export const SET_TOOLS: Record<string, Tool> = {
  add_people: {
    description: 'Place people (mannequins with a pose) in the set, side by side across the frame.',
    parameters: { type: 'object', properties: {
      count: { type: 'integer', description: '1 to 8' }, pose: { type: 'string', enum: [...POSES] }, ...FRAME,
      spacing_m: { type: 'number', description: 'gap between people, default 0.9' }, height_m: { type: 'number' },
      names: { type: 'array', items: { type: 'string' } },
    }, required: ['count', 'pose', 'frame_x', 'distance_m'] },
    async run(sid, a) {
      const ctx = need(sid), count = Math.round(clamp(a.count, 1, 8, 1)), pose = POSES.includes(a.pose) ? a.pose : 'stand';
      const centre = frameToGround(ctx.cam, clamp(a.frame_x, -1.1, 1.1, 0), clamp(a.distance_m, 1, 200, 6));
      const spots = rowAcross(ctx.cam, centre, count, clamp(a.spacing_m, 0.3, 10, 0.9));
      const before = sessionObjects(sid).filter(o => o.kind === 'person').length;
      const heights = [1.72, 1.8, 1.66, 1.77, 1.69, 1.84, 1.63, 1.75];
      const out = [];
      for (const [i, p] of spots.entries()) {
        const face = /each other/i.test(String(a.facing)) && count === 2 ? (ctx.cam.heading + (i === 0 ? 90 : 270)) % 360 : facingBearing(a.facing, p, ctx.cam);
        const name = String(a.names?.[i] ?? `Person ${before + i + 1}`);
        const row = await addObject(sid, personAt(name, p, face, pose, clamp(a.height_m, 0.9, 2.2, heights[i])));
        out.push({ id: String(row.id), name, at: where(ctx, p) });
      }
      return { added: out, pose };
    },
  },
  add_prop: {
    description: `Place a library prop. Library ids: ${ASSET_IDS.join(', ')}. For anything else call search_assets or generate_prop.`,
    parameters: { type: 'object', properties: { asset_id: { type: 'string', enum: ASSET_IDS }, ...FRAME, color: { type: 'string', description: 'hex like #b3261e or a colour name' }, name: { type: 'string' }, scale: { type: 'number' } }, required: ['asset_id', 'frame_x', 'distance_m'] },
    async run(sid, a) {
      const ctx = need(sid), spec = propById(String(a.asset_id));
      if (!spec) return { error: `no library prop "${a.asset_id}"`, try: 'search_assets or generate_prop' };
      const p = frameToGround(ctx.cam, clamp(a.frame_x, -1.1, 1.1, 0), clamp(a.distance_m, 0.5, 300, 6));
      const s = propAt(spec.id, String(a.name ?? spec.name), p, facingBearing(a.facing ?? 'camera', p, ctx.cam), colorHex(a.color));
      s.scale = clamp(a.scale, 0.1, 20, 1);
      const row = await addObject(sid, s);
      return { added: { id: String(row.id), name: row.name, at: where(ctx, p), color: s.color || 'model colours' } };
    },
  },
  add_lights: {
    description: 'Add lights. One light, or a row of them (string lights: type point, count 8 to 20, frame_x to frame_x_to). Warm is 2700 K, daylight 5600 K.',
    parameters: { type: 'object', properties: {
      type: { type: 'string', enum: [...LIGHT_TYPES] }, count: { type: 'integer' }, kelvin: { type: 'number' }, intensity: { type: 'number', description: 'candela (point, spot), nits (area), lux (sun)' },
      frame_x: FRAME.frame_x, frame_x_to: { type: 'number', description: 'end of a row of lights' }, distance_m: FRAME.distance_m, distance_to_m: { type: 'number' },
      height_m: { type: 'number' }, aim: { type: 'string', description: 'subject (the nearest person), camera, or an object id' }, name: { type: 'string' },
    }, required: ['type', 'frame_x', 'distance_m'] },
    async run(sid, a) {
      const ctx = need(sid), type = LIGHT_TYPES.includes(a.type) ? a.type : 'point', count = Math.round(clamp(a.count, 1, 30, 1));
      const k = clamp(a.kelvin, 1500, 12000, type === 'point' ? 2700 : type === 'sun' ? 5200 : 3200);
      const string = type === 'point' && count > 1;
      const intensity = clamp(a.intensity, 0.1, 200000, string ? 60 : { point: 800, spot: 4000, area: 3000, sun: 20000 }[type as 'point']);
      const h = clamp(a.height_m, 0.2, 60, type === 'sun' ? 30 : string ? 2.8 : 2.2);
      const fx0 = clamp(a.frame_x, -1.2, 1.2, 0), fx1 = clamp(a.frame_x_to, -1.2, 1.2, fx0);
      const d0 = clamp(a.distance_m, 0.5, 300, 6), d1 = clamp(a.distance_to_m, 0.5, 300, d0);
      const people = sessionObjects(sid).filter(o => o.kind === 'person');
      const target = findObj(sid, a.aim) ?? (String(a.aim ?? 'subject') === 'camera' ? null : people.sort((x, y) => frameOf(ctx.cam, x).dist - frameOf(ctx.cam, y).dist)[0]);
      const out = [];
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : i / (count - 1);
        const g = frameToGround(ctx.cam, fx0 + (fx1 - fx0) * t, d0 + (d1 - d0) * t);
        // String lights sag a little between the ends.
        const at = { ...g, z: h - (string ? 0.25 * Math.sin(Math.PI * t) : 0) };
        const aimAt = target ? { x: target.x, y: target.y, z: 1.3 } : String(a.aim) === 'camera' ? { x: ctx.cam.x, y: ctx.cam.y, z: ctx.cam.z } : { ...g, z: 0 };
        const name = String(a.name ?? (string ? 'String light' : type === 'area' ? 'Softbox' : type === 'spot' ? 'Spot light' : type === 'sun' ? 'Key sun' : 'Point light')) + (count > 1 ? ` ${i + 1}` : '');
        const row = await addObject(sid, lightAt(type, name, at, aimAt, k, intensity, kelvinHex(k), string ? { shadows: 0, size: 0.05 } : {}));
        out.push(String(row.id));
      }
      return { added: out.length, ids: out, type, kelvin: k, intensity, aimed_at: target?.name ?? (a.aim ?? 'the ground under it') };
    },
  },
  generate_prop: {
    description: 'Make a new 3D prop when nothing in the library fits: FLUX makes a concept image, Nemotron describes it, TRELLIS builds the 3D model (10 to 90 s), scaled to its real size and placed.',
    parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'the object alone, e.g. "a red vintage bicycle with a wicker basket"' }, ...FRAME, height_m: { type: 'number', description: 'real-world height, if known' } }, required: ['prompt', 'frame_x', 'distance_m'] },
    async run(sid, a) {
      const ctx = need(sid), prompt = String(a.prompt ?? '').slice(0, 300);
      try {
        const g = await generateProp({ sessionId: sid, mode: 'image3d', prompt, frame_x: clamp(a.frame_x, -1.1, 1.1, 0), distance_m: clamp(a.distance_m, 0.5, 300, 6), facing: a.facing, height_m: a.height_m });
        return { added: { id: g.object?.id, name: g.name, url: g.asset.url, height_m: g.dims.height_m }, mode: g.mode, ...(g.fallback && { note: g.fallback }) };
      } catch (e) {
        // TRELLIS is down: place the closest library prop instead, and say so.
        const p = frameToGround(ctx.cam, clamp(a.frame_x, -1.1, 1.1, 0), clamp(a.distance_m, 0.5, 300, 6));
        const best = (await searchAssets(prompt, sid, 1).catch(() => ({ hits: [] as any[] }))).hits.find((h: any) => h.kind === 'model');
        if (!best) return { error: `generation failed (${(e as Error).message.slice(0, 120)}) and no library prop fits` };
        const row = await addObject(sid, propAt(best.id, `${best.name} (stand-in for ${prompt.slice(0, 40)})`, p, facingBearing(a.facing ?? 'camera', p, ctx.cam)));
        return { fallback: `generation failed (${(e as Error).message.slice(0, 100)}); placed the closest library prop`, added: { id: String(row.id), asset: best.id, at: where(ctx, p) } };
      }
    },
  },
  add_image: {
    description: 'Put an image in the set as a flat object: a poster or mural on a wall, a sign on a stand, a screen. The image is generated from words (FLUX) or is a photo already in this session.',
    parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'what the image shows' }, image_url: { type: 'string', description: 'a /photo/ or /preview/ URL instead of a prompt' },
      mount: { type: 'string', enum: ['wall', 'stand', 'screen', 'ground'] }, ...FRAME, width_m: { type: 'number' }, height_m: { type: 'number' } }, required: ['frame_x', 'distance_m'] },
    async run(sid, a) {
      const g = await generateProp({ sessionId: sid, mode: 'flat', prompt: a.prompt ? String(a.prompt).slice(0, 300) : undefined, imageUrl: a.image_url, mount: a.mount,
        frame_x: clamp(a.frame_x, -1.1, 1.1, 0), distance_m: clamp(a.distance_m, 0.5, 300, 6), facing: a.facing, width_m: a.width_m, height_m: a.height_m });
      return { added: { id: g.object?.id, name: g.name, size_m: `${g.dims.length_m} x ${g.dims.height_m}` }, ...(g.fallback && { note: g.fallback }) };
    },
  },
  move_object: {
    description: 'Change an existing object by id: move it (frame_x and/or distance_m, or right_m/forward_m/up_m relative to the camera view), turn it (facing), rescale, recolour (color), change a light (kelvin, intensity), a person\'s pose, or show/hide it.',
    parameters: { type: 'object', properties: { id: { type: 'integer' }, ...FRAME, right_m: { type: 'number' }, forward_m: { type: 'number' }, up_m: { type: 'number' }, scale: { type: 'number' }, visible: { type: 'boolean' },
      pose: { type: 'string', enum: [...POSES] }, color: { type: 'string', description: 'hex like #1f4fa3 or a colour name' }, kelvin: { type: 'number', description: 'lights only' }, intensity: { type: 'number', description: 'lights only' } }, required: ['id'] },
    async run(sid, a) {
      const ctx = need(sid), o = findObj(sid, a.id);
      if (!o) return { error: `no object ${a.id} in this set` };
      let { x, y, z } = o;
      const f = frameOf(ctx.cam, o);
      if (a.frame_x !== undefined || a.distance_m !== undefined) {
        ({ x, y } = frameToGround(ctx.cam, clamp(a.frame_x, -1.2, 1.2, Number.isFinite(f.frameX) ? f.frameX : 0), clamp(a.distance_m, 0.5, 300, f.dist)));
      }
      const h = (ctx.cam.heading * Math.PI) / 180, right = clamp(a.right_m, -100, 100, 0), fwd = clamp(a.forward_m, -100, 100, 0);
      x += right * Math.cos(h) + fwd * Math.sin(h); y += -right * Math.sin(h) + fwd * Math.cos(h); z = Math.max(0, z + clamp(a.up_m, -50, 50, 0));
      const patch: any = { x, y, z };
      if (a.facing !== undefined && o.kind !== 'light' && o.kind !== 'camera') Object.assign(patch, yawQuat(facingBearing(a.facing, { x, y }, ctx.cam)));
      if (a.scale !== undefined) patch.scale = clamp(a.scale, 0.05, 50, o.scale);
      if (typeof a.visible === 'boolean') patch.visible = a.visible;
      const changed: string[] = [];
      if (a.pose && o.kind === 'person' && POSES.includes(a.pose)) { patch.params = o.params.replace(/(^|;)pose=[^;]*/, `$1pose=${a.pose}`); changed.push(`pose ${a.pose}`); }
      if (a.color !== undefined) {
        const hex = colorHex(a.color);
        if (!hex) return { error: `could not read the colour "${a.color}"; give a hex like #1f4fa3` };
        patch.color = hex; changed.push(`colour ${hex}`);
      }
      if (o.kind === 'light' && a.kelvin !== undefined) {
        const k = clamp(a.kelvin, 1500, 12000, 3200);
        patch.params = (patch.params ?? o.params).replace(/(^|;)k=[^;]*/, `$1k=${Math.round(k)}`); patch.color = kelvinHex(k); changed.push(`${Math.round(k)} K`);
      }
      if (o.kind === 'light' && a.intensity !== undefined) { patch.intensity = clamp(a.intensity, 0.1, 200000, o.intensity); changed.push(`intensity ${patch.intensity}`); }
      await updateObject(o, patch);
      return { moved: String(o.id), name: o.name, now: where(ctx, { x, y, z }), ...(changed.length && { changed }) };
    },
  },
  delete_object: {
    description: 'Remove objects from the set by id.',
    parameters: { type: 'object', properties: { id: { type: 'integer' }, ids: { type: 'array', items: { type: 'integer' } } } },
    async run(sid, a) {
      const ids = [...(Array.isArray(a.ids) ? a.ids : []), ...(a.id !== undefined ? [a.id] : [])].map(String);
      const gone: string[] = [];
      for (const id of ids) { const o = findObj(sid, id); if (o) { await deleteObject(o.id); gone.push(`${id} ${o.name}`); } }
      return gone.length ? { deleted: gone } : { error: 'none of those ids are in this set' };
    },
  },
  set_camera: {
    description: 'Change the shot camera: focal length (mm on this body), aperture, focus distance, aim (relative turns: pan right positive, tilt up positive), level (true removes roll), or dolly forward/right in metres.',
    parameters: { type: 'object', properties: { focal_mm: { type: 'number' }, aperture: { type: 'number' }, focus_m: { type: 'number' }, pan_deg: { type: 'number' }, tilt_deg: { type: 'number' }, level: { type: 'boolean' }, forward_m: { type: 'number' }, right_m: { type: 'number' } } },
    async run(sid, a) {
      const ctx = need(sid), done: string[] = [];
      const s = conn.db.shotSettings.sessionId.find(sid);
      if (a.focal_mm !== undefined || a.aperture !== undefined || a.focus_m !== undefined) {
        if (!s) done.push('lens settings skipped: open the studio once so the session has camera settings');
        else {
          const row = { sessionId: sid, bodyId: s.bodyId, lensId: s.lensId, focalMm: clamp(a.focal_mm, 2, 1999, s.focalMm), aperture: clamp(a.aperture, 0.7, 64, s.aperture),
            shutterS: s.shutterS, iso: s.iso, whiteBalanceK: s.whiteBalanceK, focusM: clamp(a.focus_m, 0.1, 10000, s.focusM), aspect: s.aspect, overlays: s.overlays, distortion: s.distortion };
          await conn.reducers.setShotSettings(row);
          done.push(`lens ${row.focalMm} mm f/${row.aperture}, focus ${row.focusM} m`);
        }
      }
      const pan = clamp(a.pan_deg, -180, 180, 0), tilt = clamp(a.tilt_deg, -60, 60, 0), fwd = clamp(a.forward_m, -50, 50, 0), right = clamp(a.right_m, -50, 50, 0);
      if (pan || tilt || fwd || right || a.level === true) {
        const c = ctx.cam, heading = (c.heading + pan + 360) % 360, pitch = Math.max(-80, Math.min(80, c.pitch + tilt)), h = (c.heading * Math.PI) / 180;
        const x = c.x + fwd * Math.sin(h) + right * Math.cos(h), y = c.y + fwd * Math.cos(h) - right * Math.sin(h);
        const cam = ctx.camObjectId !== undefined ? findObj(sid, ctx.camObjectId) : undefined;
        const roll = a.level === true ? 0 : c.roll;
        if (cam) await updateObject(cam, { x, y, ...cameraQuat(heading, pitch, roll) });
        else {
          const pose = conn.db.camera.sessionId.find(sid)?.pose;
          if (!pose) return { error: 'no shot camera to aim' };
          const m = 111_195, lat = pose.lat + (y - c.y) / m, lon = pose.lon + (x - c.x) / (m * Math.cos((pose.lat * Math.PI) / 180));
          await conn.reducers.moveCamera({ sessionId: sid, pose: { ...pose, lat, lon, heading, pitch, roll } });
        }
        done.push(`camera now faces ${Math.round(heading)} deg, pitch ${pitch.toFixed(1)}, roll ${roll.toFixed(1)}`);
      }
      return { done };
    },
  },
  set_time: {
    description: 'Set the plan time, which drives the sun in the set. Pass the user\'s words: "sunset", "dusk" or "golden hour this evening" pick the evening window; "sunrise", "dawn" or "morning" the morning one; a bare "golden hour" or "blue hour" the next one from now; or an ISO time.',
    parameters: { type: 'object', properties: { when: { type: 'string', description: 'the user\'s words for the time, e.g. "sunset", or an ISO time' } }, required: ['when'] },
    async run(sid, a) {
      const ctx = need(sid), s = String(a.when ?? '');
      const win = planWindow(s, ctx.origin.lat, ctx.origin.lon);
      const at = win?.at ?? (/front/i.test(s) ? sunWindows(ctx.origin.lat, ctx.origin.lon, ctx.cam.heading).goldenFrontLit?.start : !Number.isNaN(Date.parse(s)) ? new Date(s) : undefined);
      if (!at) return { error: `could not read the time "${a.when}"` };
      await conn.reducers.setPlanTime({ sessionId: sid, at: new Timestamp(BigInt(at.getTime()) * 1000n) });
      return { plan_time: at.toISOString(), ...(win && { window: `${win.period} ${win.kind} hour, ${win.start.toISOString()} to ${win.end.toISOString()}` }) };
    },
  },
  search_assets: {
    description: 'Semantic search of the asset library (props, people poses, light types, props generated earlier) with Nemotron embeddings and the Nemotron reranker.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run(sid, a) {
      const r = await searchAssets(String(a.query ?? ''), sid, 5);
      return { results: r.hits.map(h => ({ id: h.id, kind: h.kind, name: h.name, score: h.rerank ?? h.score })), reranked: r.reranked };
    },
  },
  rebuild_from_photo: {
    description: "Rebuild the set from the user's photo: Nemotron finds the people, vehicles and props in it and places stand-ins where they stood.",
    parameters: { type: 'object', properties: { replace: { type: 'boolean', description: 'remove stand-ins placed from the photo before' } } },
    async run(sid, a) {
      const { readPhoto, placeStandIns } = await import('./vision.ts');
      const ctx = need(sid);
      if (!ctx.photo) return { error: 'no photo in this session' };
      if (a.replace) for (const o of sessionObjects(sid)) if (parseParams(o.params).from === 'photo') await deleteObject(o.id);
      const reads = await readPhoto(sid, ctx.photo.id);
      if (!reads.scene?.items.length) return { placed: [], note: 'Nemotron found no people, vehicles or props in the photo' };
      return placeStandIns(ctx, reads.scene);
    },
  },
  conditions: {
    description: 'Weather, sunrise/sunset colour chance, tide, NWS alerts, permits and scaffolding that block the shot, building shadow on the street, and the moon, for this session at a time',
    parameters: { type: 'object', properties: { time: { type: 'string', description: 'ISO time; default the set clock' } } },
    async run(sid, a) { return conditionsFor(sid, typeof a.time === 'string' && !Number.isNaN(Date.parse(a.time)) ? new Date(a.time) : undefined); },
  },
  plan_shoot_day: {
    description: 'Plan the shoot day: this shot plus similar viewpoints at the spot, each at its best light, in a walking order solved by NVIDIA cuOpt.',
    parameters: { type: 'object', properties: {} },
    async run(sid) { return planShootDay(sid); },
  },
};

export const toolSpecs = (names = Object.keys(SET_TOOLS)) =>
  names.map(name => ({ type: 'function', function: { name, description: SET_TOOLS[name].description, parameters: SET_TOOLS[name].parameters } }));

export type StepLog = { tool: string; args: string; result: string; ms: number };

/** Runs one tool as the crew and logs it to agent_step; errors come back as { error } so the model can recover. */
export async function runTool(sid: bigint, name: string, args: any, log?: StepLog[]): Promise<any> {
  const t = SET_TOOLS[name];
  const t0 = Date.now(), a = JSON.stringify(args ?? {});
  const out = t ? await t.run(sid, args ?? {}).catch((e: Error) => ({ error: e.message })) : { error: `no tool ${name}` };
  const res = JSON.stringify(out);
  await logStep(sid, name, a, res, Date.now() - t0);
  log?.push({ tool: name, args: a.slice(0, 400), result: res.slice(0, 600), ms: Date.now() - t0 });
  return out;
}
