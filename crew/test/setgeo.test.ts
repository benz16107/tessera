import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aimQuat, basis, bearingTo, boxToGround, enuOf, facingBearing, frameOf, frameToGround, groundAt, kelvinHex, llOf, project, yawOf, yawQuat, type Cam } from '../src/setgeo.ts';

const cam: Cam = { x: 3, y: -20, z: 1.6, heading: 30, pitch: -4, roll: 2, f35: 35, w: 3000, h: 2000 };
const near = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);

test('basis is orthonormal and right-handed', () => {
  const { f, r, u } = basis(cam.heading, cam.pitch, cam.roll);
  const dot = (a: any, b: any) => a.x * b.x + a.y * b.y + a.z * b.z;
  for (const v of [f, r, u]) near(dot(v, v), 1, 1e-9);
  near(dot(f, r), 0, 1e-9); near(dot(f, u), 0, 1e-9); near(dot(r, u), 0, 1e-9);
  // right x forward = up
  near(r.y * f.z - r.z * f.y, u.x, 1e-9);
});

test('level camera facing north sees east on the right', () => {
  const c: Cam = { ...cam, x: 0, y: 0, heading: 0, pitch: 0, roll: 0 };
  const p = project(c, { x: 1, y: 10, z: 1.6 })!;
  assert.ok(p.u > c.w / 2);
  near(p.v, c.h / 2, 1e-6);
});

test('ground back-projection inverts projection', () => {
  for (const pt of [{ x: 0, y: 0 }, { x: 8, y: -5 }, { x: -4, y: 10 }]) {
    const p = project(cam, { ...pt, z: 0 })!;
    const g = groundAt(cam, p.u, p.v)!;
    near(g.x, pt.x, 1e-6, 'x'); near(g.y, pt.y, 1e-6, 'y');
  }
  assert.equal(groundAt(cam, cam.w / 2, 0), null, 'top of a near-level frame is sky');
});

test('frame placement lands where frameOf says', () => {
  // frameToGround ignores pitch, so a tilted camera sees the point slightly off; within 2% of the half frame.
  const g = frameToGround({ ...cam, roll: 0 }, -0.5, 12);
  const f = frameOf({ ...cam, roll: 0 }, { ...g, z: 0 });
  near(f.frameX, -0.5, 0.02); near(f.dist, 12, 1e-6);
  assert.ok(f.inFrame);
});

test('box bottom lands on the ground with a sane height', () => {
  const c: Cam = { ...cam, roll: 0 };
  const foot = project(c, { x: 8, y: -11.34, z: 0 })!, head = project(c, { x: 8, y: -11.34, z: 1.75 })!;
  const b = boxToGround(c, [(foot.u - 40) / c.w, head.v / c.h, (foot.u + 40) / c.w, foot.v / c.h])!;
  near(b.x, 8, 0.01); near(b.y, -11.34, 0.01); near(b.heightM, 1.75, 0.1);
});

test('quaternions: yaw round trip and aim', () => {
  for (const b of [0, 45, 190, 359]) near(yawOf(yawQuat(b)), b, 1e-9);
  const q = aimQuat({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  // rotate local +Y by q: should point east
  const { qx, qy, qz, qw } = q;
  const ex = 2 * (qx * qy - qz * qw);
  near(ex, 1, 1e-9);
});

test('facing words and bearings', () => {
  const p = { x: 3, y: -10 };
  near(facingBearing('camera', p, cam), bearingTo(p, cam), 1e-9);
  near(facingBearing('away', p, cam), (bearingTo(p, cam) + 180) % 360, 1e-9);
  near(facingBearing(90, p, cam), 90, 1e-9);
});

test('local frame round trip and kelvin colours', () => {
  const o = { lat: 32.98, lon: -96.75 };
  const e = enuOf(o, 32.981, -96.749), ll = llOf(o, e.x, e.y);
  near(ll.lat, 32.981, 1e-9); near(ll.lon, -96.749, 1e-9);
  near(e.y, 111.19, 0.1);
  assert.equal(kelvinHex(6600), '#ffffff');
  assert.match(kelvinHex(2700), /^#ff[a-f0-9]{4}$/);
});

test('camera quaternion round trip through camRowHpr', async () => {
  const { cameraQuat, camRowHpr } = await import('../src/setgeo.ts');
  for (const [h, p, r] of [[0, 0, 0], [30, -4, 2], [200, 10, -5]]) {
    const o = camRowHpr(cameraQuat(h, p, r));
    near(o.heading, h, 1e-6); near(o.pitch, p, 1e-6); near(o.roll, r, 1e-6);
  }
});

test('rows run across the view', async () => {
  const { rowAcross } = await import('../src/setgeo.ts');
  const r = rowAcross({ heading: 0 }, { x: 0, y: 10 }, 3, 1);
  near(r[0].x, -1, 1e-9); near(r[2].x, 1, 1e-9); near(r[1].y, 10, 1e-9);
});

test('real size: thickness given as height is turned upright', async () => {
  const { readDims } = await import('../src/setgeo.ts');
  const d = readDims({ length_m: 1.5, width_m: 0.5, height_m: 0.05 }, 'test');
  assert.ok(d.height_m >= 0.5 && d.width_m <= 0.1, JSON.stringify(d));
  assert.equal(readDims({ length_m: 1.75, width_m: 0.6, height_m: 1.0 }, 't').height_m, 1);
});
