// Putting the user's 3D objects into their own photo so they look like they belong there. Pure pixel work on raw buffers
// (no model calls), so it runs even when every generator is down, and the tests drive it with synthetic images.
//   shadow pass  -> darkens the real ground and walls (multiply), softened to the photo's shadow hardness
//   beauty layer -> exposure and white balance pulled toward the photo around each object, grain added, edges feathered
//   generator    -> FLUX (or a fallback) output blended in ONLY over the objects and their contact areas, at a strength
import sharp from 'sharp';

export type LightLike = { hardness?: string; sun_side?: string; time_look?: string };

/** Shadow softness and darkness from the light read: hard sun casts crisp dark shadows, overcast light soft pale ones. */
export function shadowParams(hardness = '', diagPx: number) {
  const h = hardness.toLowerCase();
  const [sigmaK, darkness] = /hard/.test(h) ? [0.0012, 0.62] : /soft/.test(h) ? [0.007, 0.42] : [0.003, 0.52];
  return { sigma: Math.max(0.3, sigmaK * diagPx), darkness };
}

/** One channel 0..255 from a PNG: its alpha when it has one, else inverted luminance (black = shadow). */
export async function alphaOf(png: Buffer, w: number, h: number): Promise<Buffer> {
  const img = sharp(png).resize({ width: w, height: h, fit: 'fill' });
  const meta = await sharp(png).metadata();
  if (meta.hasAlpha) return img.ensureAlpha().extractChannel(3).raw().toBuffer();
  return img.greyscale().negate().raw().toBuffer();
}

export const blur1 = (m: Buffer, w: number, h: number, sigma: number) =>
  sigma < 0.3 ? Promise.resolve(m) : sharp(m, { raw: { width: w, height: h, channels: 1 } }).blur(sigma).extractChannel(0).raw().toBuffer(); // sharp widens 1 channel to 3 otherwise

/** Darkens photo pixels under the shadow alpha. Blue loses less than red, like real shadows lit by the sky. */
export function applyShadow(rgb: Buffer, shadowA: Buffer, darkness: number): Buffer {
  const out = Buffer.from(rgb), tint = [1, 0.94, 0.8];
  for (let i = 0, p = 0; i < shadowA.length; i++, p += 3) {
    const a = (shadowA[i] / 255) * darkness;
    if (!a) continue;
    for (let c = 0; c < 3; c++) out[p + c] = Math.round(rgb[p + c] * (1 - a * tint[c]));
  }
  return out;
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Mean RGB where `pick` is true. */
function meanWhere(rgb: Buffer, n: number, stride: number, pick: (i: number) => boolean) {
  let r = 0, g = 0, b = 0, k = 0;
  for (let i = 0; i < n; i++) if (pick(i)) { r += rgb[i * stride]; g += rgb[i * stride + 1]; b += rgb[i * stride + 2]; k++; }
  return k ? { r: r / k, g: g / k, b: b / k, n: k } : null;
}

export type Match = { gain: number; wb: [number, number, number] };

/** Exposure and white balance that move the objects part of the way toward the photo around them (a ring outside their
 *  silhouette), keeping each object's own colour: a red bike stays red, it just takes the scene's light. */
export function matchParams(beauty: Buffer, photo: Buffer, ring: Uint8Array, w: number, h: number, k = 0.45): Match {
  const n = w * h;
  const o = meanWhere(beauty, n, 4, i => beauty[i * 4 + 3] > 128);
  const p = meanWhere(photo, n, 3, i => ring[i] > 0) ?? meanWhere(photo, n, 3, () => true);
  if (!o || !p) return { gain: 1, wb: [1, 1, 1] };
  const lo = Math.max(1, lum(o.r, o.g, o.b)), lp = Math.max(1, lum(p.r, p.g, p.b));
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  const gain = clamp((lp / lo) ** k, 0.6, 1.6);
  const cast = (x: number, l: number) => x / l;
  const wb = (['r', 'g', 'b'] as const).map(c => clamp((cast(p[c], lp) / Math.max(1e-3, cast(o[c], lo))) ** 0.5, 0.8, 1.25)) as [number, number, number];
  return { gain, wb };
}

/** Deterministic gaussian noise (LCG + Box-Muller), so the same render gets the same grain. */
function* gauss(seed: number) {
  let s = seed >>> 0 || 1;
  const u = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) + 1) / 4294967297;
  for (;;) { const a = Math.sqrt(-2 * Math.log(u())), t = 2 * Math.PI * u(); yield a * Math.cos(t); yield a * Math.sin(t); }
}

/** The beauty layer with the match applied, grain added and alpha edges feathered. RGBA. */
export async function harmonizeBeauty(beauty: Buffer, w: number, h: number, m: Match, grain: number, seed = 7): Promise<Buffer> {
  const out = Buffer.from(beauty), g = gauss(seed);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    if (!beauty[p + 3]) continue;
    const n = grain ? (g.next().value as number) * grain : 0;
    for (let c = 0; c < 3; c++) out[p + c] = Math.max(0, Math.min(255, Math.round(beauty[p + c] * m.gain * m.wb[c] + n)));
  }
  // Feather the silhouette inward only (min with the blurred alpha), so edges soften without a dark fringe outside.
  const a0 = Buffer.alloc(w * h);
  for (let i = 0; i < a0.length; i++) a0[i] = out[i * 4 + 3];
  const alpha = await blur1(a0, w, h, 0.7);
  for (let i = 0; i < a0.length; i++) out[i * 4 + 3] = Math.min(a0[i], alpha[i]);
  return out;
}

/** RGBA over RGB. */
export function over(rgb: Buffer, rgba: Buffer): Buffer {
  const out = Buffer.from(rgb);
  for (let i = 0, p = 0, q = 0; i < rgb.length / 3; i++, p += 3, q += 4) {
    const a = rgba[q + 3] / 255;
    if (!a) continue;
    for (let c = 0; c < 3; c++) out[p + c] = Math.round(rgba[q + c] * a + rgb[p + c] * (1 - a));
  }
  return out;
}

/** Where a generator may change pixels: the objects plus their shadows and a feathered band around them (contact areas). */
export async function contactMask(beautyA: Buffer, shadowA: Buffer | null, w: number, h: number): Promise<Buffer> {
  const m = Buffer.alloc(w * h);
  for (let i = 0; i < m.length; i++) m[i] = Math.max(beautyA[i], shadowA ? Math.round(shadowA[i] * 0.8) : 0);
  const r = Math.max(2, Math.hypot(w, h) * 0.006);
  const soft = await blur1(m, w, h, r);
  for (let i = 0; i < m.length; i++) m[i] = Math.max(m[i], Math.min(255, soft[i] * 2));
  return blur1(m, w, h, r / 2);
}

/** The surroundings of the objects (for colour stats): a band outside the silhouette. */
export async function ringOf(beautyA: Buffer, w: number, h: number): Promise<Uint8Array> {
  const soft = await blur1(beautyA, w, h, Math.max(3, Math.hypot(w, h) * 0.03));
  const ring = new Uint8Array(w * h);
  for (let i = 0; i < ring.length; i++) ring[i] = soft[i] > 12 && beautyA[i] < 8 ? 1 : 0;
  return ring;
}

/** base + (gen - base) * mask * strength, per pixel. Outside the mask the user's photo stays exactly as it was. */
export function blendMasked(base: Buffer, gen: Buffer, mask: Buffer, strength: number): Buffer {
  const out = Buffer.from(base);
  for (let i = 0, p = 0; i < mask.length; i++, p += 3) {
    const k = (mask[i] / 255) * strength;
    if (!k) continue;
    for (let c = 0; c < 3; c++) out[p + c] = Math.round(base[p + c] + (gen[p + c] - base[p + c]) * k);
  }
  return out;
}

export const rawRgb = (img: Buffer | string, w: number, h: number) => sharp(img).resize({ width: w, height: h, fit: 'fill' }).removeAlpha().raw().toBuffer();
export const rawRgba = (img: Buffer, w: number, h: number) => sharp(img).resize({ width: w, height: h, fit: 'fill' }).ensureAlpha().raw().toBuffer();
export const jpeg = (rgb: Buffer, w: number, h: number, q = 92) => sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: q }).toBuffer();

// Checked in this order: "behind (front-lit)" must not match "front".
const REL: [string, number][] = [['behind', 180], ['front-lit', 180], ['backlit', 0], ['left', -90], ['right', 90], ['front', 0]];
/** A 3D sun that reproduces the light read: which side the sun is on relative to the camera, and how high for that time of day. */
export function sunFromRead(light: LightLike | undefined, heading: number): { azimuth: number; altitude: number } | null {
  if (!light) return null;
  const side = (light.sun_side ?? '').toLowerCase();
  if (/none|overcast|night/.test(side)) return null;
  const hit = REL.find(([k]) => side.includes(k));
  const t = (light.time_look ?? '').toLowerCase();
  const altitude = /overhead/.test(side) ? 70 : /sunrise|sunset/.test(t) ? 4 : /golden/.test(t) ? 8 : /blue/.test(t) ? -4 : /midday|\bnoon\b/.test(t) ? 60 : /morning|afternoon/.test(t) ? 28 : 35;
  const rel = /overhead/.test(side) ? 0 : hit ? hit[1] : 0;
  return { azimuth: Math.round((heading + rel + 360) % 360), altitude };
}

/** Degrees between two azimuths. */
export const azDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
