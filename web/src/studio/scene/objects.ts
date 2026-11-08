// scene_object rows as the studio sees them: the reducer argument shape, the `params` key=value list, and new-object defaults.
// Positions are metres east (x), north (y), up (z) from the spot at ground level (see frame.ts).
import { Quaternion, Vector3 } from 'three';
import type { SceneObject } from '../../module_bindings/types.ts';
import { yawQuat, cameraQuat } from '../frame.ts';
import { propById } from '../catalog/props.ts';

export type Kind = 'model' | 'person' | 'light' | 'camera' | 'prop_generated' | 'text';
export type LightType = 'point' | 'spot' | 'area' | 'sun';
export const POSES = ['stand', 'walk', 'sit', 'lean', 'point', 'jump', 'talk', 'crouch', 'push'] as const;
export type PoseName = (typeof POSES)[number];

/** Everything addSceneObject / updateSceneObject take, minus sessionId. */
export interface ObjState {
  kind: Kind; assetId: string; name: string;
  x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; scale: number;
  color: string; intensity: number; lightType: string; params: string; visible: boolean;
}

export const stateOf = (r: SceneObject): ObjState => ({
  kind: r.kind as Kind, assetId: r.assetId, name: r.name, x: r.x, y: r.y, z: r.z, qx: r.qx, qy: r.qy, qz: r.qz, qw: r.qw,
  scale: r.scale, color: r.color, intensity: r.intensity, lightType: r.lightType, params: r.params, visible: r.visible,
});

export function parseParams(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of s.split(';')) {
    const i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  return out;
}
export const fmtParams = (p: Record<string, string | number | boolean | undefined>) =>
  Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${typeof v === 'boolean' ? (v ? 1 : 0) : v}`).join(';');
export const withParams = (s: ObjState, patch: Record<string, string | number | boolean | undefined>): ObjState =>
  ({ ...s, params: fmtParams({ ...parseParams(s.params), ...patch }) });

/** Stable key for undo: the uid this client wrote into params, else the row id (rows other clients made). */
export const keyOf = (r: SceneObject) => parseParams(r.params).uid ?? `id:${r.id}`;
export const newUid = () => Math.random().toString(36).slice(2, 10);

export const num = (p: Record<string, string>, k: string, d: number) => {
  const v = parseFloat(p[k]);
  return Number.isFinite(v) ? v : d;
};

/** Front of a light or camera is its local +Y in the east-north-up frame; this aims it from `from` at `to`. */
export function aimQuat(from: Vector3, to: Vector3) {
  const dir = to.clone().sub(from).normalize();
  return new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
}

const base = (kind: Kind, name: string, at: Vector3, q: Quaternion, extra: Partial<ObjState> = {}): ObjState => ({
  kind, assetId: '', name, x: at.x, y: at.y, z: at.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, scale: 1,
  color: '', intensity: 0, lightType: '', params: '', visible: true, ...extra,
});

export type AddItem =
  | { kind: 'person'; pose: PoseName }
  | { kind: 'model'; propId: string }
  | { kind: 'light'; lightType: LightType }
  | { kind: 'camera' }
  | { kind: 'prop_generated'; url: string; name: string };

/** A new object at `at` (ground point), facing `faceBearing` (people face the camera), lights aimed at `aim`. */
export function makeObject(item: AddItem, at: Vector3, faceBearing: number, aim: Vector3, uid: string): ObjState {
  const yaw = yawQuat(faceBearing);
  switch (item.kind) {
    case 'person':
      return base('person', `Person (${item.pose})`, at, yaw, { assetId: 'mannequin', params: fmtParams({ uid, pose: item.pose, height: 1.75 }) });
    case 'model': {
      const p = propById(item.propId);
      return base('model', p?.name ?? item.propId, at, yaw, { assetId: item.propId, params: fmtParams({ uid }) });
    }
    case 'prop_generated':
      return base('prop_generated', item.name, at, yaw, { assetId: item.url, params: fmtParams({ uid, h: 1 }) });
    case 'camera': {
      const from = at.clone().add(new Vector3(0, 0, 1.6));
      return base('camera', 'Camera', from, camQuatAt(from, aim), { params: fmtParams({ uid }) });
    }
    case 'light': {
      const t = item.lightType;
      const from = t === 'sun' ? at.clone().add(new Vector3(0, 0, 8)) : at.clone().add(new Vector3(0, 0, t === 'point' ? 2.5 : 2.2));
      const q = aimQuat(from, aim.clone().add(new Vector3(0, 0, 1)));
      const name = { point: 'Point light', spot: 'Spot light', area: 'Softbox', sun: 'Key sun' }[t];
      // Candela for point and spot, nits for area, lux for a sun (three.js physical light units).
      const intensity = { point: 800, spot: 4000, area: 3000, sun: 20000 }[t];
      return base('light', name, from, q, { lightType: t, intensity, color: '#ffd9a8', params: fmtParams({ uid, k: 3200, size: t === 'area' ? 1 : 0.3, shadows: 1 }) });
    }
  }
}

/** Camera rows store a three.js camera orientation (looks down local -Z, up +Y), as frame.ts cameraQuat. */
export function camQuatAt(from: Vector3, to: Vector3) {
  const d = to.clone().sub(from).normalize();
  const heading = (Math.atan2(d.x, d.y) * 180) / Math.PI;
  const pitch = (Math.asin(Math.max(-1, Math.min(1, d.z))) * 180) / Math.PI;
  return cameraQuat(heading, pitch, 0);
}
