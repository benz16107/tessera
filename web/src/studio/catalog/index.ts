// Catalog lookups shared by the studio: which lenses fit a body, and the default lens for a solved field of view.
import { BODIES, bodyById, DEFAULT_BODY, type Body } from './bodies.ts';
import { LENSES, maxApertureAt, type LensSpec } from './lenses.ts';
import { profileFor } from './profiles.ts';

export { BODIES, LENSES, bodyById };
export const lensById = (id: string) => LENSES.find(l => l.id === id);

/** Lenses that mount on a body and cover its sensor. Fixed-lens cameras get their own lens only. */
export function lensesFor(body: Body): LensSpec[] {
  if (body.fixedLens) return LENSES.filter(l => l.id === body.fixedLens);
  const crop = body.format === 'apsc' || body.format === 'apsc-canon';
  return LENSES.filter(l => l.mount === body.mount && (!l.apsc || crop));
}

export const profileStatus = (lensId: string) => {
  const p = profileFor(lensId);
  if (!p) return 'no measured profile';
  return [p.distortion.length ? 'distortion' : '', p.vignetting.length ? 'vignetting' : ''].filter(Boolean).join(' + ') + ' measured (lensfun)';
};

export const clampFocal = (lens: LensSpec, f: number) => Math.min(lens.focal[1], Math.max(lens.focal[0], f));

/** Closest real lens for a 35 mm-equivalent focal: a prime within 5%, else a zoom that covers it, else the nearest prime. */
export function pickLens(body: Body, f35: number): { lens: LensSpec; focal: number } {
  const target = f35 / body.crop;
  const fits = lensesFor(body);
  const off = (l: LensSpec) => Math.abs(Math.log(clampFocal(l, target) / target));
  const primes = fits.filter(l => l.focal[0] === l.focal[1]).sort((a, b) => off(a) - off(b));
  const zooms = fits.filter(l => l.focal[0] < l.focal[1] && l.focal[0] <= target && target <= l.focal[1])
    .sort((a, b) => maxApertureAt(a, target) - maxApertureAt(b, target) || a.focal[1] / a.focal[0] - b.focal[1] / b.focal[0]);
  const lens = primes[0] && off(primes[0]) < Math.log(1.05) ? primes[0] : zooms[0] ?? [...fits].sort((a, b) => off(a) - off(b))[0];
  return { lens, focal: clampFocal(lens, target) };
}

export const defaultBody = () => bodyById(DEFAULT_BODY)!;
