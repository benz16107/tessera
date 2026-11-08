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
  assert.ok(out[(7 * W + 20) * 3] < 105, 'nothing above the object');
  assert.ok(out[(25 * W + 20) * 3] > 105, 'contact band under the object');
});

test('sun from the light read', () => {
  assert.deepEqual(sunFromRead({ sun_side: 'left', time_look: 'golden hour' }, 10), { azimuth: 280, altitude: 8 });
  assert.equal(sunFromRead({ sun_side: 'behind (front-lit)', time_look: 'afternoon' }, 0)?.azimuth, 180);
  assert.equal(sunFromRead({ sun_side: 'none (overcast or night)' }, 0), null);
  assert.equal(azDiff(350, 10), 20);
});

test('object masks from the ID layer, in sRGB or linear, and strength inside a mannequin', async () => {
  const { objectMasks, strengthMap, maskBox } = await import('../src/composite.ts');
  const legend = [{ id: '7', color: '#e61a8c' }, { id: '8', color: '#1ae64d' }];
  const lin = (c: number) => Math.round(255 * ((c / 255) <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
  const rgb = fill(3, i => (inBox(i) ? [0xe6, 0x1a, 0x8c] : i === 0 ? [lin(0x1a), lin(0xe6), lin(0x4d)] : [0, 0, 0]));
  const m = objectMasks(rgb, W, H, legend);
  assert.equal(m.get('7')![20 * W + 20], 255);
  assert.equal(m.get('7')![0], 0);
  assert.equal(m.get('8')![0], 255, 'linear-encoded colour still matches');
  const s = await strengthMap(Buffer.alloc(N), 0.45, [{ mask: m.get('7')!, strength: 0.9 }], W, H);
  assert.ok(s[20 * W + 20] >= 225 && s[W * H - 1] === 0);
  assert.deepEqual(maskBox(m.get('7')!, W, H, 0), { left: 15, top: 10, width: 10, height: 15 });
});

test('an edited crop replaces the placeholder and what changed near it, solid, tone-matched; redrawn background stays original', async () => {
  const { pasteCrop, toneToBorder, changedRegion } = await import('../src/composite.ts');
  const frame = fill(3, () => [100, 100, 100]);
  const box = { left: 10, top: 5, width: 20, height: 20 };
  // The edit: a red person where the mannequin was, background lifted to 130 (a tone drift the border match removes).
  const crop = Buffer.from(Array.from({ length: 400 }, (_, i) => { const x = i % 20, y = (i / 20) | 0; return x > 6 && x < 13 && y > 4 && y < 16 ? [220, 40, 40] : [130, 130, 130]; }).flat());
  const obj = Buffer.from(Array.from({ length: 400 }, (_, i) => { const x = i % 20, y = (i / 20) | 0; return x > 7 && x < 12 && y > 5 && y < 15 ? 255 : 0; }));
  const toned = toneToBorder(frame, W, crop, box);
  const region = await changedRegion(frame, W, toned, box, obj, 4, 0.5);
  const out = pasteCrop(frame, W, toned, box, 3, region);
  const at = (x: number, y: number) => [...out.subarray((y * W + x) * 3, (y * W + x) * 3 + 3)];
  const mid = at(20, 15);
  assert.ok(mid[0] > 150 && mid[1] < 80, `person solid: ${mid}`);
  assert.ok(Math.abs(at(12, 7)[0] - 100) <= 3, `background near the box edge stays the frame's: ${at(12, 7)}`);
  assert.deepEqual(at(5, 5), [100, 100, 100], 'outside the box untouched');
});
