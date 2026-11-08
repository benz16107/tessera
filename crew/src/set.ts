// The virtual set as the crew sees it: the session's shot camera in the local frame, the scene_object rows described the
// way Nemotron reads them (frame position and distance from the shot camera), and crew writes to scene_object.
// Row conventions follow the studio (web/src/studio/scene/objects.ts): people are kind person, assetId mannequin, params
// pose and height; props are kind model with a catalog id; lights aim their local +Y; params carry a uid for undo.
import { conn, until } from './stdb.ts';
import { PROPS } from '../../web/src/studio/catalog/props.ts';
import { bodyById } from '../../web/src/studio/catalog/bodies.ts';
import { aimQuat, bearingTo, camRowHpr, enuOf, fpxOf, frameOf, groundAt, yawOf, yawQuat, type Cam, type Quat, type V3 } from './setgeo.ts';
import type { Photo, SceneObject } from './module_bindings/types.ts';

export const POSES = ['stand', 'walk', 'sit', 'lean', 'point', 'jump', 'talk', 'crouch', 'push'] as const;
export const LIGHT_TYPES = ['point', 'spot', 'area', 'sun'] as const;
export const ASSET_IDS = PROPS.map(p => p.id);

export type SetCtx = { sessionId: bigint; spotId: string; origin: { lat: number; lon: number }; cam: Cam; camSource: string; camObjectId?: bigint; photo?: Photo };

export function parseParams(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of s.split(';')) { const i = kv.indexOf('='); if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
  return out;
}
export const fmtParams = (p: Record<string, string | number | undefined>) =>
  Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`).join(';');

const joined = new Set<bigint>();
/** The crew joins a session as the participant "Nemotron" the first time it edits it, so it shows in everyone's presence. Never throws. */
export async function joinAsCrew(sessionId: bigint) {
  if (joined.has(sessionId)) return;
  joined.add(sessionId);
  try { await conn.reducers.joinSessionAsCrew({ sessionId, name: 'Nemotron' }); } catch (e) { console.warn(`joinSessionAsCrew: ${(e as Error).message}`); }
}

export const sessionObjects = (sid: bigint) => [...conn.db.sceneObject.sessionId.filter(sid)].sort((a, b) => Number(a.id - b.id));
export const latestSolved = (sid: bigint) => [...conn.db.photo.sessionId.filter(sid)].sort((a, b) => Number(b.id - a.id))
  .map(p => ({ p, r: conn.db.solveResult.photoId.find(p.id) })).find(x => x.r && x.r.confidence !== 'none');

/** The session's shot camera: the camera object marked shot=1, else the first camera object, else the shared camera row, else the solve. */
export function setContext(sessionId: bigint): SetCtx | null {
  const s = conn.db.session.id.find(sessionId);
  if (!s) return null;
  const solved = latestSolved(sessionId);
  const spotId = s.spotId || (solved ? conn.db.solveJob.id.find(solved.r!.jobId)?.spotId ?? '' : '');
  const spot = conn.db.spot.id.find(spotId);
  if (!spot) return null;
  const origin = { lat: spot.lat, lon: spot.lon };
  const photo = solved?.p ?? [...conn.db.photo.sessionId.filter(sessionId)].sort((a, b) => Number(b.id - a.id))[0];
  const w = photo?.width || 3000, h = photo?.height || 2000;
  const settings = conn.db.shotSettings.sessionId.find(sessionId);
  const crop = settings ? bodyById(settings.bodyId)?.crop ?? 1 : 1;
  const cams = sessionObjects(sessionId).filter(o => o.kind === 'camera');
  const shotObj = cams.find(o => parseParams(o.params).shot === '1') ?? cams[0];
  let cam: Cam, camSource: string;
  const poseF35 = solved?.r?.pose.f35 ?? 35;
  if (shotObj) {
    const hpr = camRowHpr(shotObj);
    cam = { x: shotObj.x, y: shotObj.y, z: shotObj.z, ...hpr, f35: settings ? settings.focalMm * crop : Number(parseParams(shotObj.params).f35) || poseF35, w, h };
    camSource = `camera object ${shotObj.id}`;
  } else {
    const pose = conn.db.camera.sessionId.find(sessionId)?.pose ?? solved?.r?.pose;
    if (!pose) return null;
    const e = enuOf(origin, pose.lat, pose.lon);
    cam = { x: e.x, y: e.y, z: Math.max(0.3, pose.alt), heading: pose.heading, pitch: pose.pitch, roll: pose.roll, f35: settings ? settings.focalMm * crop : pose.f35, w, h };
    camSource = conn.db.camera.sessionId.find(sessionId) ? 'shared camera row' : 'solved photo';
  }
  return { sessionId, spotId, origin, cam, camSource, camObjectId: shotObj?.id, photo };
}

/** Where the ground enters the bottom of the frame, and the distance band for full-body people, in words for a prompt. */
export function framingNote(c: Cam): string {
  const near = groundAt(c, c.w / 2, c.h * 0.97)?.dist, full = (1.75 * fpxOf(c)) / (c.h * 0.66);
  return `${near ? `The ground enters the bottom of the frame ${near.toFixed(1)} m from the camera; anything standing closer has its feet cut off. ` : ''}` +
    `A standing person fills two thirds of the frame height at about ${full.toFixed(1)} m, so full-body people usually go between ${Math.max(near ?? 0, full).toFixed(0)} and ${(full * 2.5).toFixed(0)} m.`;
}

const r1 = (x: number) => Math.round(x * 10) / 10, r2 = (x: number) => Math.round(x * 100) / 100;
const facingWords = (o: SceneObject, c: Cam) => {
  const yaw = yawOf(o), toCam = bearingTo(o, c), d = Math.abs(((yaw - toCam + 540) % 360) - 180);
  return d < 35 ? 'faces the camera' : d > 145 ? 'faces away' : `faces ${Math.round(yaw)} deg`;
};

/** One line per object, the way the agent reasons about the set. */
export function describeObjects(ctx: SetCtx, rows = sessionObjects(ctx.sessionId)): string {
  if (!rows.length) return '(the set is empty)';
  return rows.map(o => {
    const p = parseParams(o.params), f = frameOf(ctx.cam, o);
    const what = o.kind === 'person' ? `person pose=${p.pose ?? 'stand'} height=${p.height ?? '1.75'}` : o.kind === 'light' ? `light ${o.lightType} ${p.k ?? ''}K` : `${o.kind} ${o.assetId.startsWith('/asset/') ? 'generated' : o.assetId}`;
    const where = Number.isFinite(f.frameX) ? `frame_x ${r2(f.frameX)}, frame_y ${r2(f.frameY)}, ${r1(f.dist)} m${f.inFrame ? '' : ' (out of frame)'}` : `behind the camera, ${r1(f.dist)} m`;
    return `- id ${o.id}: ${what} "${o.name}", ${where}, z ${r1(o.z)} m${o.kind === 'person' || o.kind === 'model' ? `, ${facingWords(o, ctx.cam)}` : ''}${o.visible ? '' : ', hidden'}`;
  }).join('\n');
}

export type ObjState = Omit<SceneObject, 'id' | 'sessionId' | 'lockedBy' | 'updatedBy' | 'updatedAt'>;

const uid = () => `nv${Math.random().toString(36).slice(2, 9)}`;
export function newObject(kind: string, name: string, at: V3, q: Quat, extra: Partial<ObjState> = {}, params: Record<string, string | number | undefined> = {}): ObjState {
  return {
    kind, assetId: '', name: name.slice(0, 80), x: at.x, y: at.y, z: at.z, ...q, scale: 1, color: '', intensity: 0, lightType: '', visible: true,
    ...extra, params: fmtParams({ uid: uid(), by: 'nemotron', ...params }),
  };
}

/** Adds a row as the crew identity and returns it once the subscription shows it. */
export async function addObject(sessionId: bigint, s: ObjState): Promise<SceneObject> {
  await conn.reducers.addSceneObject({ sessionId, ...s });
  const key = parseParams(s.params).uid;
  return until(() => sessionObjects(sessionId).find(o => parseParams(o.params).uid === key), 10_000, 'the new scene object');
}

export async function updateObject(o: SceneObject, patch: Partial<ObjState>) {
  const { id, sessionId, lockedBy: _l, updatedBy: _u, updatedAt: _t, ...cur } = o;
  await conn.reducers.updateSceneObject({ id, sessionId, ...cur, ...patch });
}

export const deleteObject = (id: bigint) => conn.reducers.deleteSceneObject({ id });

export const personAt = (name: string, at: { x: number; y: number }, facing: number, pose: string, heightM: number) =>
  newObject('person', name, { ...at, z: 0 }, yawQuat(facing), { assetId: 'mannequin' }, { pose, height: r2(heightM) });

export const propAt = (asset: string, name: string, at: { x: number; y: number }, facing: number, color = '') =>
  newObject('model', name, { ...at, z: 0 }, yawQuat(facing), { assetId: asset, color });

export function lightAt(type: string, name: string, at: V3, aim: V3, kelvin: number, intensity: number, color: string, extra: Record<string, number> = {}) {
  return newObject('light', name, at, aimQuat(at, aim), { lightType: type, intensity, color }, { k: Math.round(kelvin), size: type === 'area' ? 1 : 0.3, shadows: 1, ...extra });
}
