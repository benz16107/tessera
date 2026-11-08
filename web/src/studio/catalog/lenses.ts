// Real lenses: the makers' published focal range, maximum aperture, minimum focus distance and aperture blades,
// typed by hand. Variable-aperture zooms list the two published end points; between them the aperture steps in
// third stops (interpolated, see maxApertureAt). `lensfun` is the exact <model> string in the lensfun database
// that scripts/lensfun.ts matches to pull the measured distortion and vignetting; null means lensfun has no entry.
import type { Mount } from './bodies.ts';

export interface LensSpec {
  id: string;
  name: string;
  maker: string;
  mount: Mount;
  apsc?: boolean; // image circle only covers APS-C
  focal: [number, number]; // real focal range in mm (min = max for primes)
  maxAperture: [number, number][]; // [focal mm, f-number], one entry for primes and constant zooms
  minFocusM: [number, number][] | null; // [focal mm, metres from the sensor plane]; null when not published
  blades: number; // 0 = fixed aperture (phones)
  ois?: boolean;
  bodies?: string[]; // fixed lenses: the bodies they belong to
  lensfun: string | null;
}

const P = (id: string, name: string, maker: string, mount: Mount, f: number, n: number, mfd: number | null, blades: number, lensfun: string | null, extra: Partial<LensSpec> = {}): LensSpec =>
  ({ id, name, maker, mount, focal: [f, f], maxAperture: [[f, n]], minFocusM: mfd === null ? null : [[f, mfd]], blades, lensfun, ...extra });
const Z = (id: string, name: string, maker: string, mount: Mount, f: [number, number], n: [number, number], mfd: [number, number], blades: number, lensfun: string | null, extra: Partial<LensSpec> = {}): LensSpec =>
  ({ id, name, maker, mount, focal: f, maxAperture: n[0] === n[1] ? [[f[0], n[0]]] : [[f[0], n[0]], [f[1], n[1]]], minFocusM: [[f[0], mfd[0]], [f[1], mfd[1]]], blades, lensfun, ...extra });

export const LENSES: LensSpec[] = [
  // Sony E (FE = full frame)
  Z('sony-fe-12-24-f4-g', 'Sony FE 12-24mm F4 G', 'Sony', 'sony-e', [12, 24], [4, 4], [0.28, 0.28], 7, 'FE 12-24mm f/4 G'),
  Z('sony-fe-16-35-f28-gm', 'Sony FE 16-35mm F2.8 GM', 'Sony', 'sony-e', [16, 35], [2.8, 2.8], [0.28, 0.28], 11, 'FE 16-35mm f/2.8 GM'),
  Z('sony-fe-24-70-f28-gm2', 'Sony FE 24-70mm F2.8 GM II', 'Sony', 'sony-e', [24, 70], [2.8, 2.8], [0.21, 0.3], 11, 'FE 24-70mm f/2.8 GM II'),
  Z('sony-fe-24-105-f4-g', 'Sony FE 24-105mm F4 G OSS', 'Sony', 'sony-e', [24, 105], [4, 4], [0.38, 0.38], 9, 'FE 24-105mm f/4 G OSS', { ois: true }),
  Z('sony-fe-28-70', 'Sony FE 28-70mm F3.5-5.6 OSS', 'Sony', 'sony-e', [28, 70], [3.5, 5.6], [0.3, 0.45], 7, 'FE 28-70mm f/3.5-5.6 OSS', { ois: true }),
  Z('sony-fe-70-200-f28-gm', 'Sony FE 70-200mm F2.8 GM OSS', 'Sony', 'sony-e', [70, 200], [2.8, 2.8], [0.96, 0.96], 11, 'FE 70-200mm f/2.8 GM OSS', { ois: true }),
  Z('sony-fe-200-600', 'Sony FE 200-600mm F5.6-6.3 G OSS', 'Sony', 'sony-e', [200, 600], [5.6, 6.3], [2.4, 2.4], 11, 'FE 200-600mm f/5.6-6.3 G OSS', { ois: true }),
  P('sony-fe-20-f18-g', 'Sony FE 20mm F1.8 G', 'Sony', 'sony-e', 20, 1.8, 0.18, 9, 'FE 20mm f/1.8 G'),
  P('sony-fe-24-f14-gm', 'Sony FE 24mm F1.4 GM', 'Sony', 'sony-e', 24, 1.4, 0.24, 11, 'FE 24mm f/1.4 GM'),
  P('sony-fe-35-f14-gm', 'Sony FE 35mm F1.4 GM', 'Sony', 'sony-e', 35, 1.4, 0.27, 11, 'FE 35mm f/1.4 GM (SEL35F14GM)'),
  P('sony-fe-50-f18', 'Sony FE 50mm F1.8', 'Sony', 'sony-e', 50, 1.8, 0.45, 7, 'FE 50mm f/1.8'),
  P('sony-fe-50-f12-gm', 'Sony FE 50mm F1.2 GM', 'Sony', 'sony-e', 50, 1.2, 0.4, 11, 'FE 50mm f/1.2 GM'),
  P('sony-fe-85-f14-gm', 'Sony FE 85mm F1.4 GM', 'Sony', 'sony-e', 85, 1.4, 0.8, 11, 'FE 85mm f/1.4 GM'),
  P('sony-fe-90-f28-macro', 'Sony FE 90mm F2.8 Macro G OSS', 'Sony', 'sony-e', 90, 2.8, 0.28, 9, 'FE 90mm f/2.8 Macro G OSS', { ois: true }),
  P('sony-fe-135-f18-gm', 'Sony FE 135mm F1.8 GM', 'Sony', 'sony-e', 135, 1.8, 0.7, 11, null),
  Z('sony-e-16-55-f28-g', 'Sony E 16-55mm F2.8 G', 'Sony', 'sony-e', [16, 55], [2.8, 2.8], [0.33, 0.42], 9, 'E 16-55mm f/2.8 G', { apsc: true }),
  Z('sigma-24-70-f28-dgdn-art', 'Sigma 24-70mm F2.8 DG DN Art (E)', 'Sigma', 'sony-e', [24, 70], [2.8, 2.8], [0.18, 0.38], 11, '24-70mm F2.8 DG DN | Art 019'),
  Z('tamron-28-75-f28-g2', 'Tamron 28-75mm F2.8 Di III VXD G2 (E)', 'Tamron', 'sony-e', [28, 75], [2.8, 2.8], [0.18, 0.38], 9, 'Tamron E 28-75mm F/2.8 Di III VXD G2 A063Z'),
  // Canon RF
  Z('canon-rf-15-35-f28l', 'Canon RF 15-35mm F2.8L IS USM', 'Canon', 'canon-rf', [15, 35], [2.8, 2.8], [0.28, 0.28], 9, 'Canon RF 15-35mm F2.8L IS USM', { ois: true }),
  Z('canon-rf-24-70-f28l', 'Canon RF 24-70mm F2.8L IS USM', 'Canon', 'canon-rf', [24, 70], [2.8, 2.8], [0.21, 0.38], 9, 'Canon RF 24-70mm F2.8L IS USM', { ois: true }),
  Z('canon-rf-24-105-f4l', 'Canon RF 24-105mm F4L IS USM', 'Canon', 'canon-rf', [24, 105], [4, 4], [0.45, 0.45], 10, 'Canon RF 24-105mm F4L IS USM', { ois: true }),
  Z('canon-rf-28-70-f2l', 'Canon RF 28-70mm F2L USM', 'Canon', 'canon-rf', [28, 70], [2, 2], [0.39, 0.39], 9, 'Canon RF 28-70mm F2 L USM'),
  Z('canon-rf-70-200-f28l', 'Canon RF 70-200mm F2.8L IS USM', 'Canon', 'canon-rf', [70, 200], [2.8, 2.8], [0.7, 0.7], 9, 'Canon RF 70-200mm F2.8L IS USM', { ois: true }),
  Z('canon-rf-100-500', 'Canon RF 100-500mm F4.5-7.1L IS USM', 'Canon', 'canon-rf', [100, 500], [4.5, 7.1], [0.9, 1.2], 9, 'Canon RF 100-500mm F4.5-7.1L IS USM', { ois: true }),
  P('canon-rf-35-f18', 'Canon RF 35mm F1.8 Macro IS STM', 'Canon', 'canon-rf', 35, 1.8, 0.17, 9, 'Canon RF 35mm F1.8 MACRO IS STM', { ois: true }),
  P('canon-rf-50-f18', 'Canon RF 50mm F1.8 STM', 'Canon', 'canon-rf', 50, 1.8, 0.3, 7, 'Canon RF 50mm F1.8 STM'),
  P('canon-rf-50-f12l', 'Canon RF 50mm F1.2L USM', 'Canon', 'canon-rf', 50, 1.2, 0.4, 10, 'Canon RF 50mm F1.2 L USM'),
  P('canon-rf-85-f12l', 'Canon RF 85mm F1.2L USM', 'Canon', 'canon-rf', 85, 1.2, 0.85, 9, 'Canon RF 85mm F1.2L USM'),
  P('canon-rf-135-f18l', 'Canon RF 135mm F1.8L IS USM', 'Canon', 'canon-rf', 135, 1.8, 0.7, 9, 'Canon RF 135mm F1.8L IS USM', { ois: true }),
  Z('canon-rfs-18-150', 'Canon RF-S 18-150mm F3.5-6.3 IS STM', 'Canon', 'canon-rf', [18, 150], [3.5, 6.3], [0.17, 0.44], 7, 'Canon RF-S 18-150mm F3.5-6.3 IS STM', { apsc: true, ois: true }),
  // Nikon Z
  Z('nikon-z-14-24-f28', 'Nikon Z 14-24mm f/2.8 S', 'Nikon', 'nikon-z', [14, 24], [2.8, 2.8], [0.28, 0.28], 9, 'Nikkor Z 14-24mm f/2.8 S'),
  Z('nikon-z-24-70-f28', 'Nikon Z 24-70mm f/2.8 S', 'Nikon', 'nikon-z', [24, 70], [2.8, 2.8], [0.38, 0.38], 9, 'Nikkor Z 24-70mm f/2.8 S'),
  Z('nikon-z-24-70-f4', 'Nikon Z 24-70mm f/4 S', 'Nikon', 'nikon-z', [24, 70], [4, 4], [0.3, 0.3], 7, 'Nikkor Z 24-70mm f/4 S'),
  Z('nikon-z-24-120-f4', 'Nikon Z 24-120mm f/4 S', 'Nikon', 'nikon-z', [24, 120], [4, 4], [0.35, 0.35], 9, 'Nikkor Z 24-120mm f/4 S'),
  Z('nikon-z-70-200-f28', 'Nikon Z 70-200mm f/2.8 VR S', 'Nikon', 'nikon-z', [70, 200], [2.8, 2.8], [0.5, 1.0], 9, 'Nikkor Z 70-200mm f/2.8 VR S', { ois: true }),
  P('nikon-z-35-f18', 'Nikon Z 35mm f/1.8 S', 'Nikon', 'nikon-z', 35, 1.8, 0.25, 9, 'Nikkor Z 35mm f/1.8 S'),
  P('nikon-z-40-f2', 'Nikon Z 40mm f/2', 'Nikon', 'nikon-z', 40, 2, 0.29, 9, 'Nikkor Z 40mm f/2'),
  P('nikon-z-50-f18', 'Nikon Z 50mm f/1.8 S', 'Nikon', 'nikon-z', 50, 1.8, 0.4, 9, 'Nikkor Z 50mm f/1.8 S'),
  P('nikon-z-50-f12', 'Nikon Z 50mm f/1.2 S', 'Nikon', 'nikon-z', 50, 1.2, 0.45, 9, 'Nikkor Z 50mm f/1.2 S'),
  P('nikon-z-85-f18', 'Nikon Z 85mm f/1.8 S', 'Nikon', 'nikon-z', 85, 1.8, 0.8, 9, 'Nikkor Z 85mm f/1.8 S'),
  P('nikon-z-105-f28-mc', 'Nikon Z MC 105mm f/2.8 VR S', 'Nikon', 'nikon-z', 105, 2.8, 0.29, 9, 'Nikkor Z MC 105mm f/2.8 VR S', { ois: true }),
  Z('nikon-z-dx-16-50', 'Nikon Z DX 16-50mm f/3.5-6.3 VR', 'Nikon', 'nikon-z', [16, 50], [3.5, 6.3], [0.25, 0.3], 7, 'Nikkor Z DX 16-50mm f/3.5-6.3 VR', { apsc: true, ois: true }),
  // Fujifilm X (APS-C mount)
  Z('fuji-xf-10-24-f4-wr', 'Fujifilm XF10-24mm F4 R OIS WR', 'Fujifilm', 'fuji-x', [10, 24], [4, 4], [0.24, 0.24], 7, 'XF10-24mmF4 R OIS WR', { apsc: true, ois: true }),
  Z('fuji-xf-16-55-f28', 'Fujifilm XF16-55mm F2.8 R LM WR', 'Fujifilm', 'fuji-x', [16, 55], [2.8, 2.8], [0.3, 0.4], 9, 'XF16-55mmF2.8 R LM WR', { apsc: true }),
  Z('fuji-xf-18-55', 'Fujifilm XF18-55mm F2.8-4 R LM OIS', 'Fujifilm', 'fuji-x', [18, 55], [2.8, 4], [0.3, 0.4], 7, 'XF18-55mmF2.8-4 R LM OIS', { apsc: true, ois: true }),
  Z('fuji-xf-50-140-f28', 'Fujifilm XF50-140mm F2.8 R LM OIS WR', 'Fujifilm', 'fuji-x', [50, 140], [2.8, 2.8], [1.0, 1.0], 7, 'XF50-140mmF2.8 R LM OIS WR', { apsc: true, ois: true }),
  P('fuji-xf-23-f14-lm', 'Fujifilm XF23mm F1.4 R LM WR', 'Fujifilm', 'fuji-x', 23, 1.4, 0.19, 11, 'XF23mmF1.4 R LM WR', { apsc: true }),
  P('fuji-xf-27-f28-wr', 'Fujifilm XF27mm F2.8 R WR', 'Fujifilm', 'fuji-x', 27, 2.8, 0.34, 7, 'XF27mmF2.8 R WR', { apsc: true }),
  P('fuji-xf-33-f14', 'Fujifilm XF33mm F1.4 R LM WR', 'Fujifilm', 'fuji-x', 33, 1.4, 0.3, 9, 'XF33mmF1.4 R LM WR', { apsc: true }),
  P('fuji-xf-35-f14', 'Fujifilm XF35mm F1.4 R', 'Fujifilm', 'fuji-x', 35, 1.4, 0.28, 7, 'XF35mmF1.4 R', { apsc: true }),
  P('fuji-xf-56-f12-wr', 'Fujifilm XF56mm F1.2 R WR', 'Fujifilm', 'fuji-x', 56, 1.2, 0.5, 11, 'XF56mmF1.2 R WR', { apsc: true }),
  P('fuji-xf-90-f2', 'Fujifilm XF90mm F2 R LM WR', 'Fujifilm', 'fuji-x', 90, 2, 0.6, 7, 'XF90mmF2 R LM WR', { apsc: true }),
  // Fujifilm GF (medium format)
  P('fuji-gf-23-f4', 'Fujifilm GF23mm F4 R LM WR', 'Fujifilm', 'fuji-gf', 23, 4, 0.38, 9, 'GF23mmF4 R LM WR'),
  Z('fuji-gf-32-64-f4', 'Fujifilm GF32-64mm F4 R LM WR', 'Fujifilm', 'fuji-gf', [32, 64], [4, 4], [0.5, 0.5], 9, null),
  P('fuji-gf-45-f28', 'Fujifilm GF45mm F2.8 R WR', 'Fujifilm', 'fuji-gf', 45, 2.8, 0.45, 9, 'GF45mmF2.8 R WR'),
  P('fuji-gf-63-f28', 'Fujifilm GF63mm F2.8 R WR', 'Fujifilm', 'fuji-gf', 63, 2.8, 0.5, 9, 'GF63mmF2.8 R WR'),
  P('fuji-gf-110-f2', 'Fujifilm GF110mm F2 R LM WR', 'Fujifilm', 'fuji-gf', 110, 2, 0.9, 9, 'GF110mmF2 R LM WR'),
  // Micro Four Thirds
  Z('olympus-12-40-f28-pro', 'Olympus M.Zuiko 12-40mm F2.8 PRO', 'Olympus', 'mft', [12, 40], [2.8, 2.8], [0.2, 0.2], 7, 'Olympus M.Zuiko Digital ED 12-40mm f/2.8 Pro'),
  P('panasonic-25-f17', 'Panasonic Lumix G 25mm F1.7', 'Panasonic', 'mft', 25, 1.7, 0.25, 7, 'Lumix G 25mm f/1.7 Asph.'),
  P('olympus-45-f18', 'Olympus M.Zuiko 45mm F1.8', 'Olympus', 'mft', 45, 1.8, 0.5, 7, 'Olympus M.Zuiko Digital 45mm f/1.8'),
  // Fixed lenses
  Z('sony-rx100vii-lens', 'Sony RX100 VII 9-72mm F2.8-4.5 (24-200 equiv.)', 'Sony', 'fixed', [9, 72], [2.8, 4.5], [0.08, 1.0], 7, 'DSC-RX100 VI & compatibles', { bodies: ['sony-rx100vii'] }),
  P('iphone15pro-main-lens', 'iPhone 15 Pro main 6.765mm f/1.78', 'Apple', 'fixed', 6.765, 1.78, null, 0, null, { bodies: ['iphone15pro-main'], ois: true }),
  P('iphone15pro-ultra-lens', 'iPhone 15 Pro ultrawide 2.22mm f/2.2', 'Apple', 'fixed', 2.22, 2.2, null, 0, null, { bodies: ['iphone15pro-ultra'] }),
  P('iphone15promax-tele-lens', 'iPhone 15 Pro Max 5x 15.66mm f/2.8', 'Apple', 'fixed', 15.66, 2.8, null, 0, null, { bodies: ['iphone15promax-tele'], ois: true }),
  P('iphone16pro-main-lens', 'iPhone 16 Pro main 6.765mm f/1.78', 'Apple', 'fixed', 6.765, 1.78, null, 0, null, { bodies: ['iphone16pro-main'], ois: true }),
  P('iphone16pro-ultra-lens', 'iPhone 16 Pro ultrawide 2.22mm f/2.2', 'Apple', 'fixed', 2.22, 2.2, null, 0, null, { bodies: ['iphone16pro-ultra'] }),
  P('iphone16pro-tele-lens', 'iPhone 16 Pro 5x 15.66mm f/2.8', 'Apple', 'fixed', 15.66, 2.8, null, 0, null, { bodies: ['iphone16pro-tele'], ois: true }),
];

const THIRD_STOPS = [0.95, 1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32];

/** Widest aperture at a focal length. Variable zooms step through third stops between the two published ends. */
export function maxApertureAt(lens: LensSpec, focal: number): number {
  const a = lens.maxAperture;
  if (a.length === 1) return a[0][1];
  const [[f0, n0], [f1, n1]] = a;
  const t = Math.min(1, Math.max(0, Math.log(focal / f0) / Math.log(f1 / f0)));
  const n = n0 * Math.pow(n1 / n0, t); // shortcut: log-linear between the ends; real lenses step at maker-specific focals
  return THIRD_STOPS.reduce((best, s) => (Math.abs(Math.log(s / n)) < Math.abs(Math.log(best / n)) ? s : best), n0);
}

/** Minimum focus distance at a focal length (linear between the published ends), or undefined if unpublished. */
export function minFocusAt(lens: LensSpec, focal: number): number | undefined {
  const m = lens.minFocusM;
  if (!m) return undefined;
  if (m.length === 1 || lens.focal[0] === lens.focal[1]) return m[0][1];
  const t = Math.min(1, Math.max(0, (focal - m[0][0]) / (m[1][0] - m[0][0])));
  return m[0][1] + t * (m[1][1] - m[0][1]);
}

export { THIRD_STOPS };
