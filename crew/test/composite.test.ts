import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyShadow, azDiff, blendMasked, contactMask, harmonizeBeauty, matchParams, over, ringOf, shadowParams, sunFromRead } from '../src/composite.ts';

const W = 40, H = 30, N = W * H;
const fill = (ch: number, f: (i: number) => number[]) => Buffer.from(Array.from({ length: N }, (_, i) => f(i)).flat().slice(0, N * ch));
const inBox = (i: number) => { const x = i % W, y = Math.floor(i / W); return x >= 15 && x < 25 && y >= 10 && y < 25; };

test('shadow hardness sets softness and darkness', () => {
  const hard = shadowParams('hard', 1000), soft = shadowParams('soft', 1000);
  assert.ok(hard.sigma < soft.sigma && hard.darkness > soft.darkness);
});

test('shadow darkens only under its alpha, red more than blue', () => {
  const photo = fill(3, () => [200, 200, 200]), a = Buffer.from(Array.from({ length: N }, (_, i) => (i < 10 ? 255 : 0)));
  const out = applyShadow(photo, a, 0.5);
  assert.ok(out[0] < 120 && out[2] > out[0]);
  assert.deepEqual([...out.subarray(30, 33)], [200, 200, 200]);
});

test('colour match moves a too-bright, too-blue object toward a warm scene and keeps it unchanged outside', async () => {
  const photo = fill(3, () => [180, 140, 100]);
  const beauty = fill(4, i => (inBox(i) ? [120, 160, 240, 255] : [0, 0, 0, 0]));
  const a = Buffer.from(Array.from({ length: N }, (_, i) => beauty[i * 4 + 3]));
  const ring = await ringOf(a, W, H);
  const m = matchParams(beauty, photo, ring, W, H);
  assert.ok(m.wb[0] > 1 && m.wb[2] < 1, `wb ${m.wb}`);
  const hb = await harmonizeBeauty(beauty, W, H, m, 0);
  const i = 20 * W + 20;
  assert.ok(hb[i * 4] > beauty[i * 4] && hb[i * 4 + 2] < beauty[i * 4 + 2]);
  assert.equal(hb[3], 0, 'transparent stays transparent');
  const comp = over(photo, hb);
  assert.deepEqual([...comp.subarray(0, 3)], [180, 140, 100]);
});

test('generator output only lands on objects and contact areas', async () => {
  const base = fill(3, () => [100, 100, 100]), gen = fill(3, () => [200, 0, 0]);
  const a = Buffer.from(Array.from({ length: N }, (_, i) => (inBox(i) ? 255 : 0)));
  const mask = await contactMask(a, null, W, H);
  const out = blendMasked(base, gen, mask, 0.5);
  const c = (20 * W + 20) * 3;
  assert.ok(out[c] > 140 && out[c] < 160, `centre ${out[c]}`);
  assert.deepEqual([...out.subarray(0, 3)], [100, 100, 100], 'far corner untouched');
});

test('sun from the light read', () => {
  assert.deepEqual(sunFromRead({ sun_side: 'left', time_look: 'golden hour' }, 10), { azimuth: 280, altitude: 8 });
  assert.equal(sunFromRead({ sun_side: 'behind (front-lit)', time_look: 'afternoon' }, 0)?.azimuth, 180);
  assert.equal(sunFromRead({ sun_side: 'none (overcast or night)' }, 0), null);
  assert.equal(azDiff(350, 10), 20);
});
