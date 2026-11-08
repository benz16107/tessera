// Geometry of the virtual set, shared by the text-to-set agent, the photo read and the art director. Pure, so the tests import it.
// Frame: metres east (x), north (y), up (z) from the session's spot at ground level, ground at z = 0 (web/src/studio/frame.ts).
// Camera pose angles follow CONTRACTS.md: heading clockwise from north, pitch up positive, roll clockwise as seen by the camera.

export type V3 = { x: number; y: number; z: number };
export type Cam = { x: number; y: number; z: number; heading: number; pitch: number; roll: number; f35: number; w: number; h: number };
export type Quat = { qx: number; qy: number; qz: number; qw: number };

const R = Math.PI / 180;
const EARTH = 6_371_000;
export const DIAG_35 = 43.2666;

/** A lat/lon in the spot's local frame (equirectangular, under 10 cm off within 1 km). */
export const enuOf = (o: { lat: number; lon: number }, lat: number, lon: number) =>
  ({ x: (lon - o.lon) * R * Math.cos(o.lat * R) * EARTH, y: (lat - o.lat) * R * EARTH });
export const llOf = (o: { lat: number; lon: number }, x: number, y: number) =>
  ({ lat: o.lat + y / EARTH / R, lon: o.lon + x / (EARTH * Math.cos(o.lat * R)) / R });

export const fpxOf = (c: Pick<Cam, 'f35' | 'w' | 'h'>) => (c.f35 * Math.hypot(c.w, c.h)) / DIAG_35;
export const hfovOf = (c: Pick<Cam, 'f35' | 'w' | 'h'>) => (2 * Math.atan(c.w / 2 / fpxOf(c))) / R;

const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (a: V3, b: V3, k = 1): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });

/** Camera axes in the ENU frame: forward, right and up of the image. */
export function basis(heading: number, pitch: number, roll: number) {
  const h = heading * R, p = pitch * R, r = roll * R;
  const f = { x: Math.sin(h) * Math.cos(p), y: Math.cos(h) * Math.cos(p), z: Math.sin(p) };
  const r0 = { x: Math.cos(h), y: -Math.sin(h), z: 0 }; // level right
  const u0 = { x: -Math.sin(h) * Math.sin(p), y: -Math.cos(h) * Math.sin(p), z: Math.cos(p) }; // r0 x f
  // Rolling clockwise tips the image's up vector toward the level right.
  return { f, r: add(scale(r0, Math.cos(r)), u0, -Math.sin(r)), u: add(scale(u0, Math.cos(r)), r0, Math.sin(r)) };
}

/** Pixel position of a point (image y down), and its depth along the view axis; null when behind the camera. */
export function project(c: Cam, p: V3): { u: number; v: number; depth: number } | null {
  const { f, r, u } = basis(c.heading, c.pitch, c.roll), d = add(p, c, -1), z = dot(d, f);
  if (z <= 0.05) return null;
  const k = fpxOf(c) / z;
  return { u: c.w / 2 + dot(d, r) * k, v: c.h / 2 - dot(d, u) * k, depth: z };
}

/** Where the ray through a pixel meets the ground (z = 0), or null above the horizon or beyond maxM. */
export function groundAt(c: Cam, px: number, py: number, maxM = 400): { x: number; y: number; dist: number } | null {
  const { f, r, u } = basis(c.heading, c.pitch, c.roll), k = 1 / fpxOf(c);
  const d = add(add(f, r, (px - c.w / 2) * k), u, -(py - c.h / 2) * k);
  if (d.z >= -1e-6 || c.z <= 0) return null;
  const t = -c.z / d.z, x = c.x + d.x * t, y = c.y + d.y * t, dist = Math.hypot(x - c.x, y - c.y);
  return dist <= maxM ? { x, y, dist } : null;
}

/** A ground point at a horizontal frame position (-1 left edge, 0 centre, 1 right edge) and a ground distance from the camera. */
export function frameToGround(c: Cam, frameX: number, distM: number) {
  const half = Math.atan(c.w / 2 / fpxOf(c));
  const az = c.heading * R + Math.atan(Math.max(-1.2, Math.min(1.2, frameX)) * Math.tan(half));
  return { x: c.x + distM * Math.sin(az), y: c.y + distM * Math.cos(az) };
}

/** How the camera sees a point: frame position (-1..1 both ways, y up), ground distance, and whether it is in frame. */
export function frameOf(c: Cam, p: V3) {
  const dist = Math.hypot(p.x - c.x, p.y - c.y), pr = project(c, p);
  if (!pr) return { frameX: NaN, frameY: NaN, dist, inFrame: false };
  const frameX = (pr.u - c.w / 2) / (c.w / 2), frameY = -(pr.v - c.h / 2) / (c.h / 2);
  return { frameX, frameY, dist, inFrame: Math.abs(frameX) <= 1 && Math.abs(frameY) <= 1 };
}

/** Degrees clockwise from north, from a to b. */
export const bearingTo = (a: { x: number; y: number }, b: { x: number; y: number }) => ((Math.atan2(b.x - a.x, b.y - a.y) / R) + 360) % 360;

/** Yaw for an object standing on the ground whose front faces `bearing` (frame.ts yawQuat: rotate -bearing about up). */
export const yawQuat = (bearing: number): Quat => ({ qx: 0, qy: 0, qz: Math.sin((-bearing * R) / 2), qw: Math.cos((-bearing * R) / 2) });
export const yawOf = (q: Quat) => ((-2 * Math.atan2(q.qz, q.qw)) / R + 720) % 360;

/** Rotation taking local +Y (a light's front, studio objects.ts aimQuat) onto the direction from `from` to `to`. */
export function aimQuat(from: V3, to: V3): Quat {
  const d = add(to, from, -1), n = Math.hypot(d.x, d.y, d.z) || 1, v = scale(d, 1 / n);
  const w = 1 + v.y; // dot((0,1,0), v)
  if (w < 1e-6) return { qx: 0, qy: 0, qz: 1, qw: 0 }; // straight down -Y: half turn about up
  const q = { qx: v.z, qy: 0, qz: -v.x, qw: w }; // axis = (0,1,0) x v
  const m = Math.hypot(q.qx, q.qy, q.qz, q.qw);
  return { qx: q.qx / m, qy: 0, qz: q.qz / m, qw: q.qw / m };
}

/** Facing words or a number to a bearing for an object at p, given the camera. */
export function facingBearing(facing: unknown, p: { x: number; y: number }, c: Cam): number {
  if (typeof facing === 'number' && Number.isFinite(facing)) return ((facing % 360) + 360) % 360;
  const toCam = bearingTo(p, c);
  const s = String(facing ?? 'camera').toLowerCase();
  if (/away|back/.test(s)) return (toCam + 180) % 360;
  if (/left/.test(s)) return (c.heading + 270) % 360; // the frame's left as the camera sees it
  if (/right/.test(s)) return (c.heading + 90) % 360;
  if (/each other|inward|center|centre/.test(s)) return toCam; // callers pair people up themselves
  const n = Number(s);
  return Number.isFinite(n) && s.trim() !== '' ? ((n % 360) + 360) % 360 : toCam;
}

/** Correlated colour temperature (K) to an sRGB hex colour (Tanner Helland's fit, 1000 to 40000 K). */
export function kelvinHex(k: number): string {
  const t = Math.max(1000, Math.min(40000, k)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Image box (fractions 0..1, x0 y0 x1 y1, y down) to a ground position and a height estimate, through the camera. */
export function boxToGround(c: Cam, box: [number, number, number, number]) {
  const [x0, y0, x1, y1] = box.map(v => Math.max(0, Math.min(1, v)));
  const g = groundAt(c, ((x0 + x1) / 2) * c.w, y1 * c.h);
  if (!g) return null;
  // The box's pixel height at the foot point's depth is roughly the object's height.
  const pr = project(c, { x: g.x, y: g.y, z: 0 });
  const heightM = pr ? ((y1 - y0) * c.h * pr.depth) / fpxOf(c) : NaN;
  const widthM = pr ? ((x1 - x0) * c.w * pr.depth) / fpxOf(c) : NaN;
  return { ...g, heightM, widthM };
}

const qmul = (a: Quat, b: Quat): Quat => ({
  qx: a.qw * b.qx + a.qx * b.qw + a.qy * b.qz - a.qz * b.qy,
  qy: a.qw * b.qy - a.qx * b.qz + a.qy * b.qw + a.qz * b.qx,
  qz: a.qw * b.qz + a.qx * b.qy - a.qy * b.qx + a.qz * b.qw,
  qw: a.qw * b.qw - a.qx * b.qx - a.qy * b.qy - a.qz * b.qz,
});
const axis = (x: number, y: number, z: number, deg: number): Quat => { const s = Math.sin((deg * R) / 2); return { qx: x * s, qy: y * s, qz: z * s, qw: Math.cos((deg * R) / 2) }; };

/** A camera row's orientation (three.js camera: looks down local -Z, up +Y), as studio frame.ts cameraQuat. */
export const cameraQuat = (heading: number, pitch: number, roll: number): Quat =>
  qmul(qmul(axis(0, 0, 1, -heading), axis(1, 0, 0, 90 + pitch)), axis(0, 0, 1, -roll));

/** Ground positions for `count` objects side by side across the camera's view, centred on `at`, `spacing` metres apart. */
export function rowAcross(c: Pick<Cam, 'heading'>, at: { x: number; y: number }, count: number, spacing: number) {
  const rx = Math.cos(c.heading * R), ry = -Math.sin(c.heading * R);
  return Array.from({ length: count }, (_, i) => { const k = (i - (count - 1) / 2) * spacing; return { x: at.x + rx * k, y: at.y + ry * k }; });
}

/** Rotate v by the unit quaternion q. */
export const rot = (q: Quat, v: V3): V3 => {
  const { qx: x, qy: y, qz: z, qw: w } = q;
  const ix = w * v.x + y * v.z - z * v.y, iy = w * v.y + z * v.x - x * v.z, iz = w * v.z + x * v.y - y * v.x, iw = -x * v.x - y * v.y - z * v.z;
  return { x: ix * w + iw * -x + iy * -z - iz * -y, y: iy * w + iw * -y + iz * -x - ix * -z, z: iz * w + iw * -z + ix * -y - iy * -x };
};
/** Heading/pitch/roll of a camera row (three.js camera: looks down local -Z, up +Y), as studio frame.ts cameraHpr. */
export function camRowHpr(q: Quat) {
  const f = rot(q, { x: 0, y: 0, z: -1 }), up = rot(q, { x: 0, y: 1, z: 0 });
  const heading = ((Math.atan2(f.x, f.y) * 180) / Math.PI + 360) % 360, pitch = (Math.asin(Math.max(-1, Math.min(1, f.z))) * 180) / Math.PI;
  const lr = { x: f.y, y: -f.x, z: 0 }, n = Math.hypot(lr.x, lr.y);
  if (n < 1e-9) return { heading, pitch, roll: 0 };
  const r = { x: lr.x / n, y: lr.y / n, z: 0 }, lu = { x: r.y * f.z, y: -r.x * f.z, z: r.x * f.y - r.y * f.x };
  return { heading, pitch, roll: (Math.atan2(up.x * r.x + up.y * r.y, up.x * lu.x + up.y * lu.y + up.z * lu.z) * 180) / Math.PI };
}


export type Dims = { length_m: number; width_m: number; height_m: number; source: string };
const clampM = (x: unknown, lo: number, hi: number) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : undefined; };

/** Real-world dimensions from a model's JSON, sane and rounded to centimetres. */
export function readDims(j: any, source: string): Dims {
  // A free-standing object is rarely under a tenth of its length tall; when it is, the model gave thickness as height.
  if (Number(j?.height_m) < 0.1 && Number(j?.length_m) > 0.5) j = { ...j, height_m: j.width_m > 0.3 ? j.width_m : j.length_m * 0.6, width_m: j.height_m };
  const h = clampM(j?.height_m, 0.02, 60) ?? 1, l = clampM(j?.length_m, 0.02, 80) ?? h, w = clampM(j?.width_m, 0.01, 80) ?? Math.min(l, h);
  return { length_m: Math.round(l * 100) / 100, width_m: Math.round(w * 100) / 100, height_m: Math.round(h * 100) / 100, source };
}

