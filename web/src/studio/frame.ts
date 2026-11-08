// The studio's world frame, shared with the module's scene_object rows: metres east (x), north (y) and up (z) from
// the session's spot, ground at z = 0. The three.js scene itself stays Y-up (OrbitControls, WebXR and drei assume it):
// one <group rotation-x={-90 degrees}> (ENU_TO_THREE) holds the tiles and every object, so inside it x = east,
// y = north, z = up, and in three.js world space east = +X, up = +Y, north = -Z.
import { Matrix4, Quaternion, Vector3, Euler } from 'three';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer';

const R = Math.PI / 180;

/** Rotation of the east-north-up group inside the Y-up three.js scene. */
export const ENU_TO_THREE: [number, number, number] = [-Math.PI / 2, 0, 0];
/** An east-north-up point in three.js world coordinates, and back. */
export const enuToThree = (v: { x: number; y: number; z: number }) => new Vector3(v.x, v.z, -v.y);
export const threeToEnu = (v: Vector3) => new Vector3(v.x, -v.z, v.y);

export interface Origin { lat: number; lon: number; height: number } // degrees, degrees, metres above the WGS84 ellipsoid

/** ENU -> ECEF for the origin (east = +x, north = +y, up = +z). */
export const enuFrame = (o: Origin, m = new Matrix4()) => WGS84_ELLIPSOID.getEastNorthUpFrame(o.lat * R, o.lon * R, o.height, m);

/** A geodetic point in the origin's ENU frame. */
export function llhToEnu(o: Origin, lat: number, lon: number, height: number, out = new Vector3()) {
  WGS84_ELLIPSOID.getCartographicToPosition(lat * R, lon * R, height, out);
  return out.applyMatrix4(enuFrame(o).invert());
}

export function enuToLlh(o: Origin, p: Vector3) {
  const ecef = p.clone().applyMatrix4(enuFrame(o));
  const c = { lat: 0, lon: 0, height: 0 };
  WGS84_ELLIPSOID.getPositionToCartographic(ecef, c);
  return { lat: c.lat / R, lon: c.lon / R, height: c.height };
}

const X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1);

/** Orientation of a three.js camera (looks down local -Z, up +Y) for a CONTRACTS.md pose: heading clockwise from
 *  north, pitch up positive, roll clockwise as seen by the camera. Level and facing north is a +90 degree turn about x. */
export function cameraQuat(headingDeg: number, pitchDeg: number, rollDeg: number, out = new Quaternion()) {
  const h = new Quaternion().setFromAxisAngle(Z, -headingDeg * R);
  const p = new Quaternion().setFromAxisAngle(X, (90 + pitchDeg) * R);
  const r = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -rollDeg * R); // local view axis
  return out.copy(h).multiply(p).multiply(r);
}

/** Inverse of cameraQuat. */
export function cameraHpr(q: Quaternion) {
  const fwd = new Vector3(0, 0, -1).applyQuaternion(q), up = new Vector3(0, 1, 0).applyQuaternion(q);
  const heading = ((Math.atan2(fwd.x, fwd.y) / R) + 360) % 360;
  const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.z))) / R;
  // roll: angle from the level up vector (fwd x (z x fwd)) to the camera's up, clockwise positive
  const levelRight = new Vector3().crossVectors(fwd, Z).normalize();
  const levelUp = new Vector3().crossVectors(levelRight, fwd).normalize();
  const roll = levelRight.lengthSq() < 1e-9 ? 0 : Math.atan2(up.dot(levelRight), up.dot(levelUp)) / R;
  return { heading, pitch, roll };
}

/** Yaw-only orientation for objects standing on the ground: their front faces `bearingDeg` (clockwise from north). */
export const yawQuat = (bearingDeg: number, out = new Quaternion()) => out.setFromAxisAngle(Z, -bearingDeg * R);

/** Euler angles in degrees (Z-up, XYZ order) for the inspector. */
export const toEulerDeg = (q: Quaternion) => {
  const e = new Euler().setFromQuaternion(q, 'ZXY');
  return { x: e.x / R, y: e.y / R, z: e.z / R };
};
export const fromEulerDeg = (x: number, y: number, z: number) => new Quaternion().setFromEuler(new Euler(x * R, y * R, z * R, 'ZXY'));

/** glTF assets are Y-up with +Z forward; this stands them up in the Z-up world, front facing north. */
export const GLTF_UPRIGHT = new Quaternion().setFromAxisAngle(Z, Math.PI).multiply(new Quaternion().setFromAxisAngle(X, Math.PI / 2));
