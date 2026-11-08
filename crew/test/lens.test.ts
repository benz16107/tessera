import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { bakeCamera, blurCircleMm } from '../src/lens.ts';

const W = 64, H = 48;
const png = (f: (x: number, y: number) => number[]) => sharp(Buffer.from(Array.from({ length: W * H }, (_, i) => f(i % W, (i / W) | 0)).flat()), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
const pixel = async (jpeg: Buffer, x: number, y: number) => { const r = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true }); const o = (y * r.info.width + x) * 3; return [r.data[o], r.data[o + 1], r.data[o + 2]]; };
const optic = { focalMm: 50, aperture: 1.8, focusM: 3, f35: 50 };

test('blur circle: zero at the focus distance, growing away from it', () => {
  assert.ok(blurCircleMm(50, 1.8, 3, 3) < 1e-9);
  assert.ok(blurCircleMm(50, 1.8, 3, 30) > blurCircleMm(50, 1.8, 3, 6));
  assert.ok(blurCircleMm(50, 8, 3, 30) < blurCircleMm(50, 1.8, 3, 30), 'stopping down shrinks it');
});

test('exposure and white balance act in linear light; nothing set changes nothing', async () => {
  const flat = await png(() => [128, 128, 128]);
  const same = await bakeCamera(flat, {}, optic);
  assert.ok(Math.abs((await pixel(same.jpeg, 10, 10))[0] - 128) <= 2);
  const up = await bakeCamera(flat, { exposureStops: 1, wbGains: [1, 1, 0.5] }, optic);
  const [r, , b] = await pixel(up.jpeg, 10, 10);
  assert.ok(r > 165 && r < 185, `+1 EV of sRGB 128 is about 175: ${r}`);
  assert.ok(b < r - 30, 'blue gain halved');
});

test('depth of field blurs the far stripes and keeps the in-focus ones', async () => {
  const stripes = await png(x => (x % 4 < 2 ? [255, 255, 255] : [0, 0, 0]));
  // Left half 3 m (in focus), right half 200 m: inverse depth, white = 0.5 m, black = 500 m.
  const inv = (z: number) => Math.round(255 * ((1 / z - 1 / 500) / (1 / 0.5 - 1 / 500)));
  const depth = await sharp(Buffer.from(Array.from({ length: W * H }, (_, i) => (i % W < W / 2 ? inv(3) : inv(200)))), { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
  const out = await bakeCamera(stripes, { sensorMm: [3.6, 2.4], blades: 9 }, optic, { png: depth, nearM: 0.5, farM: 500 });
  const spread = async (x0: number) => { const v = []; for (let x = x0; x < x0 + 4; x++) v.push((await pixel(out.jpeg, x, 24))[0]); return Math.max(...v) - Math.min(...v); };
  assert.ok(await spread(8) > 200, 'near half stays sharp');
  assert.ok(await spread(48) < 80, 'far half is blurred');
  assert.match(out.applied.join(' '), /depth of field/);
});

test('a longer lens than the photo is a centre crop', async () => {
  const out = await bakeCamera(await png(() => [90, 90, 90]), { photoF35: 50 }, { ...optic, f35: 100 });
  const m = await sharp(out.jpeg).metadata();
  assert.equal(m.width, 32); assert.equal(m.height, 24);
});
