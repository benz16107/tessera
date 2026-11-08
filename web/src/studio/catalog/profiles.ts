// Measured lens profiles from lensfun (scripts/lensfun.ts writes lensfun.json; CC BY-SA 3.0, see CREDITS.md).
// Lensfun conventions (libs/lensfun/modifier.cpp): distortion radius 1 = half the shorter side of the calibration
// frame; vignetting ("pa") radius 1 = the frame corner. The calibration frame is 43.27 / cropfactor mm on the diagonal at
// the stated aspect ratio. We measure radii in millimetres on the image plane, so a profile applies to any sensor size.
import raw from './lensfun.json?raw';
import { DIAG_35 } from '../optics.ts';

interface RawDistortion { model: 'ptlens' | 'poly3' | 'poly5'; focal: number; a?: number; b?: number; c?: number; k1?: number; k2?: number }
interface RawVignetting { focal: number; aperture: number; distance: number; k1: number; k2: number; k3: number }
interface RawTca { model: 'linear' | 'poly3'; focal: number; kr?: number; kb?: number; vr?: number; vb?: number; cr?: number; cb?: number; br?: number; bb?: number }
export interface Profile { file: string; maker: string; model: string; mount: string; crop: number; aspect: number; distortion: RawDistortion[]; vignetting: RawVignetting[]; tca?: RawTca[] }

const data = JSON.parse(raw) as { source: string; license: string; dbTimestamp: number | string; fetched: string; profiles: Record<string, Profile> };
const PROFILES = data.profiles;
export const LENSFUN_META = { source: data.source, license: data.license, dbTimestamp: data.dbTimestamp, fetched: data.fetched };
export const profileFor = (lensId: string): Profile | undefined => PROFILES[lensId];

/** Rd = Ru * (c0 + c1 Ru + c2 Ru^2 + c3 Ru^3 + c4 Ru^4), the common form of lensfun's ptlens, poly3 and poly5 models. */
export type Poly = [number, number, number, number, number];
const IDENTITY: Poly = [1, 0, 0, 0, 0];

function toPoly(d: RawDistortion): Poly {
  if (d.model === 'ptlens') { const a = d.a ?? 0, b = d.b ?? 0, c = d.c ?? 0; return [1 - a - b - c, c, b, a, 0]; } // Rd = Ru(a Ru^3 + b Ru^2 + c Ru + 1 - a - b - c)
  if (d.model === 'poly3') { const k = d.k1 ?? 0; return [1 - k, 0, k, 0, 0]; } // Rd = Ru(1 - k1 + k1 Ru^2)
  return [1, 0, d.k1 ?? 0, 0, d.k2 ?? 0]; // poly5: Rd = Ru(1 + k1 Ru^2 + k2 Ru^4)
}

/** Bracket a sorted list by focal and blend linearly (lensfun interpolates coefficients between calibrated focals too). */
function byFocal<T extends { focal: number }>(xs: T[], focal: number, blend: (a: T, b: T, t: number) => T): T | undefined {
  if (!xs.length) return undefined;
  const lo = [...xs].reverse().find(x => x.focal <= focal) ?? xs[0];
  const hi = xs.find(x => x.focal >= focal) ?? xs[xs.length - 1];
  if (lo.focal === hi.focal) return lo;
  return blend(lo, hi, (focal - lo.focal) / (hi.focal - lo.focal));
}

export function distortionPoly(p: Profile | undefined, focal: number): Poly {
  if (!p) return IDENTITY;
  const polys = p.distortion.map(d => ({ focal: d.focal, poly: toPoly(d) }));
  const hit = byFocal(polys, focal, (a, b, t) => ({ focal, poly: a.poly.map((v, i) => v + (b.poly[i] - v) * t) as Poly }));
  return hit?.poly ?? IDENTITY;
}

export interface Vig { k1: number; k2: number; k3: number }

/** Vignetting at a focal, aperture and focus distance: nearest calibrated distance, log-aperture and linear-focal blends. */
export function vignetting(p: Profile | undefined, focal: number, aperture: number, distanceM: number): Vig | undefined {
  if (!p || !p.vignetting.length) return undefined;
  const dists = [...new Set(p.vignetting.map(v => v.distance))];
  const dist = dists.reduce((b, d) => (Math.abs(Math.log(d / distanceM)) < Math.abs(Math.log(b / distanceM)) ? d : b), dists[0]);
  const rows = p.vignetting.filter(v => v.distance === dist);
  const focals = [...new Set(rows.map(r => r.focal))].sort((a, b) => a - b);
  const atFocal = (f: number): Vig => {
    const rs = rows.filter(r => r.focal === f).sort((a, b) => a.aperture - b.aperture);
    if (aperture <= rs[0].aperture) return rs[0];
    if (aperture >= rs[rs.length - 1].aperture) return rs[rs.length - 1];
    const i = rs.findIndex(r => r.aperture >= aperture), a = rs[i - 1], b = rs[i];
    const t = Math.log(aperture / a.aperture) / Math.log(b.aperture / a.aperture);
    return { k1: a.k1 + (b.k1 - a.k1) * t, k2: a.k2 + (b.k2 - a.k2) * t, k3: a.k3 + (b.k3 - a.k3) * t };
  };
  const hit = byFocal(focals.map(f => ({ focal: f, v: atFocal(f) })), focal, (a, b, t) => ({
    focal, v: { k1: a.v.k1 + (b.v.k1 - a.v.k1) * t, k2: a.v.k2 + (b.v.k2 - a.v.k2) * t, k3: a.v.k3 + (b.v.k3 - a.v.k3) * t },
  }));
  return hit?.v;
}

/** Millimetres on the image plane that lensfun calls radius 1: [distortion unit, vignetting unit]. */
export function radiusUnitsMm(p: Profile): [number, number] {
  const diag = DIAG_35 / p.crop, a = Math.max(p.aspect, 1 / p.aspect);
  const short = diag / Math.hypot(1, a);
  return [short / 2, diag / 2];
}

export const distort = (poly: Poly, ru: number) => ru * (poly[0] + ru * (poly[1] + ru * (poly[2] + ru * (poly[3] + ru * poly[4]))));

/** Invert Rd = f(Ru) with Newton's method (lensfun's undistort callbacks do the same, 6 iterations). */
export function undistort(poly: Poly, rd: number): number {
  let ru = rd;
  for (let i = 0; i < 8; i++) {
    const f = distort(poly, ru) - rd;
    const df = poly[0] + ru * (2 * poly[1] + ru * (3 * poly[2] + ru * (4 * poly[3] + ru * 5 * poly[4])));
    if (Math.abs(df) < 1e-9) break;
    ru -= f / df;
  }
  return ru;
}

/** How much wider than the sensor the undistorted render must be so barrel distortion never samples outside it. */
export function overscanFor(poly: Poly, sensorW: number, sensorH: number, unitMm: number): number {
  let k = 1;
  for (const [x, y] of [[sensorW / 2, sensorH / 2], [sensorW / 2, 0], [0, sensorH / 2]]) {
    const rd = Math.hypot(x, y) / unitMm;
    k = Math.max(k, undistort(poly, rd) / rd);
  }
  return k * 1.01;
}

/** Map a point in the distorted output frame (-0.5..0.5 of the sensor) to the undistorted render (-0.5..0.5 of the overscanned frame). */
export function outputToRender(poly: Poly, ux: number, uy: number, sensorW: number, sensorH: number, unitMm: number, overscan: number) {
  const x = ux * sensorW, y = uy * sensorH, rd = Math.hypot(x, y) / unitMm;
  const s = rd > 1e-9 ? undistort(poly, rd) / rd : 1;
  return [(x * s) / (sensorW * overscan), (y * s) / (sensorH * overscan)];
}

/** Lateral chromatic aberration (lensfun TCA, radius unit as distortion): red and blue sample at r x (v + c r + b r^2)
 *  relative to green. Linear profiles have only v (kr, kb). Blended between calibrated focals like the others. */
export interface Tca { r: [number, number, number]; b: [number, number, number] }
export function tcaAt(p: Profile | undefined, focal: number): Tca | undefined {
  if (!p?.tca?.length) return undefined;
  const rows = p.tca.map(t => ({ focal: t.focal, v: t.model === 'linear'
    ? { r: [t.kr ?? 1, 0, 0], b: [t.kb ?? 1, 0, 0] } as Tca
    : { r: [t.vr ?? 1, t.cr ?? 0, t.br ?? 0], b: [t.vb ?? 1, t.cb ?? 0, t.bb ?? 0] } as Tca }));
  const mix = (a: [number, number, number], b: [number, number, number], t: number) => a.map((v, i) => v + (b[i] - v) * t) as [number, number, number];
  return byFocal(rows, focal, (a, b, t) => ({ focal, v: { r: mix(a.v.r, b.v.r, t), b: mix(a.v.b, b.v.b, t) } }))?.v;
}
