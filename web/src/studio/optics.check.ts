// Self-check for optics.ts against hand-worked textbook values: `node src/studio/optics.check.ts`.
import assert from 'node:assert/strict';
import {
  fov, cropFactor, equiv35, hyperfocalM, depthOfField, blurCircleMm, settingsEv100, meterStops, shutterForScene, handheld,
  diffraction, magnification, frameFraction, distanceForFraction, compression, kelvinToRgb, whiteBalanceGains, sceneEv100, fmtShutter,
} from './optics.ts';
import { BODIES, bodyById } from './catalog/bodies.ts';
import { LENSES, maxApertureAt, minFocusAt } from './catalog/lenses.ts';

const near = (a: number, b: number, eps: number, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} vs ${b}`);

// 50 mm on full frame: 39.6 x 27.0, 46.8 diagonal.
const f50 = fov(50, 36, 24);
near(f50.h, 39.6, 0.05, 'hfov'); near(f50.v, 27.0, 0.05, 'vfov'); near(f50.d, 46.8, 0.05, 'dfov');
near(cropFactor(36, 24), 1, 1e-9);
near(cropFactor(23.5, 15.6), 1.534, 0.002, 'APS-C crop');
near(cropFactor(22.3, 14.9), 1.613, 0.002, 'Canon APS-C crop');
near(cropFactor(17.3, 13), 2.0, 0.01, 'MFT crop');
near(cropFactor(43.8, 32.9), 0.79, 0.002, 'GFX crop');
near(equiv35(33, cropFactor(23.5, 15.6)), 50.6, 0.1, '33 mm on APS-C');

// Hyperfocal of 50 mm f/8, c = 0.03: 2500 / 0.24 + 50 = 10466.7 mm.
near(hyperfocalM(50, 8, 0.03), 10.4667, 1e-3, 'hyperfocal');
const d = depthOfField(50, 8, 0.03, 5);
near(d.nearM, 3.389, 0.002, 'near'); near(d.farM, 9.528, 0.002, 'far');
assert.equal(depthOfField(50, 8, 0.03, 20).farM, Infinity);
// Focused at the hyperfocal distance, the near limit is half of it.
near(depthOfField(50, 8, 0.03, hyperfocalM(50, 8, 0.03)).nearM, hyperfocalM(50, 8, 0.03) / 2, 0.01, 'H/2');
// The blur circle at the DOF limits equals the CoC (consistency of the two formulas).
near(blurCircleMm(50, 8, 5, d.nearM), 0.03, 2e-4, 'coc at near'); near(blurCircleMm(50, 8, 5, d.farM), 0.03, 2e-4, 'coc at far');
near(blurCircleMm(50, 8, 5, 5), 0, 1e-12);

// Exposure: f/1 at 1 s = EV 0; sunny 16 at ISO 100 is about 1/125.
near(settingsEv100(1, 1, 100), 0, 1e-12);
near(settingsEv100(16, 1 / 125, 100), 14.97, 0.01);
near(settingsEv100(8, 1 / 125, 400), 12.97 - 2, 0.01, 'ISO 400');
near(meterStops(15, 16, 1 / 125, 100), 0.03, 0.01);
near(meterStops(15, 16, 1 / 60, 100), 1.09, 0.02, 'one stop slower = +1');
assert.equal(shutterForScene(15, 16, 100), 1 / 125);
assert.equal(fmtShutter(1 / 125), '1/125'); assert.equal(fmtShutter(2), '2"');
assert.equal(sceneEv100(45, 'clear'), 15);
assert.equal(sceneEv100(0, 'clear', 'none'), 12);
assert.equal(sceneEv100(-4, 'clear', 'none'), 8);
assert.equal(sceneEv100(-10, 'clear', 'street'), 7);
assert.equal(sceneEv100(45, 'overcast'), 13);

// Reciprocal rule: 1/30 s at 50 mm full frame is borderline; 3 stops of IBIS make it safe.
assert.equal(handheld(1 / 30, 50, 1).risk, 'borderline');
assert.equal(handheld(1 / 30, 50, 1, 3).risk, 'ok');
assert.equal(handheld(1 / 8, 85, 1.5).risk, 'high');

// Diffraction: the a7 IV's 5.1 um pixels reach the 2-pixel Airy limit near f/7.7; f/16 warns.
const a7 = bodyById('sony-a7iv')!;
near(a7.pitchUm, 5.14, 0.01, 'a7 IV pitch');
near(diffraction(8, a7.pitchUm).limitN, 7.66, 0.02, 'limit N');
assert.equal(diffraction(16, a7.pitchUm).warn, true);
assert.equal(diffraction(5.6, a7.pitchUm).warn, false);

// A 1.7 m person at 5 m with 50 mm on full frame fills about 72% of the 24 mm frame height.
near(magnification(50, 5), 0.0101, 1e-4);
near(frameFraction(1.7, 50, 5, 24), 0.7155, 0.001, 'frame fraction');
near(distanceForFraction(1.7, 50, frameFraction(1.7, 50, 5, 24), 24), 5, 1e-9, 'inverse');

// Compression 35 -> 85 mm, subject at 3 m, background 50 m behind: about 2.25x, tending to 2.43x.
const c = compression(35, 85, 3, 50);
near(c.d2M, 7.286, 0.001); near(c.bgRatio, 2.247, 0.002); near(c.limit, 85 / 35, 1e-9);

// Colour: 6600 K is near white; equal light and camera temperature gives unit gains; tungsten light on daylight WB is warm.
const w = kelvinToRgb(6600);
assert.ok(w.every(v => v > 0.95), `6600 K ${w}`);
whiteBalanceGains(5500, 5500).forEach(g => near(g, 1, 1e-9));
const warm = whiteBalanceGains(3200, 5500);
assert.ok(warm[0] > 1 && warm[2] < 1, `warm ${warm}`);
assert.ok(whiteBalanceGains(5500, 1500).every(Number.isFinite));

// Catalog sanity: every body derives sane numbers, every lens has a sane range and aperture.
for (const b of BODIES) assert.ok(b.crop > 0.7 && b.crop < 8 && b.cocMm > 0.003 && b.pitchUm > 0.5 && b.pitchUm < 10, b.id);
near(bodyById('sony-a7iv')!.cocMm, 0.0288, 1e-4, 'FF CoC');
near(bodyById('iphone15pro-main')!.crop * 6.765, 24, 1e-6, 'iPhone main equivalent');
near(bodyById('iphone16pro-tele')!.crop * 15.66, 120, 1e-6, 'iPhone tele equivalent');
assert.ok(LENSES.length >= 40);
for (const l of LENSES) {
  assert.ok(l.focal[0] > 0 && l.focal[1] >= l.focal[0], l.id);
  assert.ok(maxApertureAt(l, l.focal[0]) >= 0.9 && maxApertureAt(l, l.focal[1]) <= 11, l.id);
  if (l.bodies) for (const b of l.bodies) assert.equal(bodyById(b)?.fixedLens, l.id, `${l.id} body link`);
}
assert.equal(new Set(LENSES.map(l => l.id)).size, LENSES.length, 'unique lens ids');
const kit = LENSES.find(l => l.id === 'sony-fe-28-70')!;
assert.equal(maxApertureAt(kit, 28), 3.5); assert.equal(maxApertureAt(kit, 70), 5.6);
assert.ok(maxApertureAt(kit, 50) > 3.5 && maxApertureAt(kit, 50) < 5.6);
near(minFocusAt(kit, 70)!, 0.45, 1e-9);
console.log(`optics ok (${BODIES.length} bodies, ${LENSES.length} lenses)`);

// ---- Physical camera formulas ----
{
  const m = await import('./optics.ts');
  // 1280 x 1707 photo at 51 mm: all 2.19 MP at 35 mm, (51/135)^2 of them at 135 mm.
  near(m.remainingMp(1280, 1707, 51, 35), 2.185, 0.001, 'MP wider');
  near(m.remainingMp(1280, 1707, 51, 135), 2.185 * (51 / 135) ** 2, 0.001, 'MP at 135');
  // 5 m at 35 mm becomes 5 x 85 / 35 = 12.14 m at 85 mm.
  near(m.subjectLockedDistance(5, 35, 85), 12.143, 0.001, 'subject locked');
  assert.equal(m.starSpikes(9), 18); assert.equal(m.starSpikes(8), 8); assert.equal(m.starSpikes(11), 22); assert.equal(m.starSpikes(0), 0);
  near(m.noiseSigma(6400, 1) / m.noiseSigma(100, 1), 8, 1e-9, 'noise grows with sqrt ISO');
  near(m.noiseSigma(100, 7) / m.noiseSigma(100, 1), 7, 1e-9, 'noise grows with crop');
  // Walking 1.4 m/s at 5 m, 1/15 s, fpx 2000: 2000 x 1.4 / 15 / 5 = 37.3 px.
  near(m.motionBlurPx(1.4, 1 / 15, 5, 2000), 37.33, 0.01, 'motion blur');
  // At the safe speed the shake is one circle of confusion: fpx x c / f.
  near(m.shakeBlurPx(1 / 50, 50, 1, 0, 0.03, 2000), 2000 * 0.03 / 50, 1e-9, 'shake at safe speed');
  near(m.shakeBlurPx(1 / 12.5, 50, 1, 0, 0.03, 2000), 4 * 2000 * 0.03 / 50, 1e-9, 'shake 2 stops slow');
  near(m.shakeBlurPx(1 / 12.5, 50, 1, 2, 0.03, 2000), 2000 * 0.03 / 50, 1e-9, 'stabilisation');
  near(m.opticalVignette(1.4, 1.4), 0.35, 1e-9, 'wide open'); near(m.opticalVignette(4, 1.4), 0, 1e-9, '3 stops down');
  // f/16 on a 36 mm wide sensor, 6000 px frame: 2.44 x 0.00055 x 16 x 6000 / 36 = 3.58 px.
  near(m.airyFramePx(16, 36, 6000), 3.579, 0.001, 'airy px');
  near(m.tintGains(0)[1], 1, 1e-9); assert.ok(m.tintGains(30)[1] < 1 && m.tintGains(-30)[1] > 1, 'tint');
  console.log('physical camera formulas ok');
}
