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

/** Where a generator may change pixels: the objects, their shadows, and a band running DOWN from each object's lowest pixels
 *  (contact under feet and wheels). Nothing spreads upward or sideways, so no smear rises into the scene behind an object. */
export async function contactMask(beautyA: Buffer, shadowA: Buffer | null, w: number, h: number): Promise<Buffer> {
  const m = Buffer.alloc(w * h), band = Math.max(2, Math.round(h * 0.015));
  for (let x = 0; x < w; x++) {
    let run = 0;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (beautyA[i] > 8) { m[i] = beautyA[i]; run = band; }
      else if (run > 0) { m[i] = Math.round((255 * run) / band); run--; }
    }
  }
  if (shadowA) for (let i = 0; i < m.length; i++) m[i] = Math.max(m[i], Math.round(shadowA[i] * 0.8));
  return blur1(m, w, h, 1.2);
}

/** The edited crop's tone matched to the frame at the crop's border ring (per-channel mean and spread), so pasted pixels
 *  sit in the same exposure and white balance as their surroundings. */
export function toneToBorder(frame: Buffer, w: number, crop: Buffer, box: { left: number; top: number; width: number; height: number }): Buffer {
  const bw = box.width, bh = box.height, ring = Math.max(2, Math.round(Math.min(bw, bh) * 0.08));
  const st = [0, 1, 2].map(() => ({ so: 0, so2: 0, se: 0, se2: 0, n: 0 }));
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    if (x >= ring && y >= ring && x < bw - ring && y < bh - ring) continue;
    const o = ((box.top + y) * w + box.left + x) * 3, e = (y * bw + x) * 3;
    for (let c = 0; c < 3; c++) { const a = frame[o + c], b = crop[e + c], k = st[c]; k.so += a; k.so2 += a * a; k.se += b; k.se2 += b * b; k.n++; }
  }
  const tf = st.map(k => {
    const mo = k.so / k.n, me = k.se / k.n, so = Math.sqrt(Math.max(1, k.so2 / k.n - mo * mo)), se = Math.sqrt(Math.max(1, k.se2 / k.n - me * me));
    const g = Math.max(0.7, Math.min(1.4, so / se));
    return (v: number) => Math.max(0, Math.min(255, Math.round((v - me) * g + mo)));
  });
  const out = Buffer.alloc(crop.length);
  for (let i = 0; i < crop.length; i++) out[i] = tf[i % 3](crop[i]);
  return out;
}

/** Where an edited crop should replace the frame: the placeholder's own pixels, plus pixels near it (within `reach` px) that
 *  the edit really changed (the new person, their shadow). Background the model merely redrew elsewhere in the crop stays
 *  original, so no box edge shows. One channel, crop-local, softened by `soft` px. */
export async function changedRegion(frame: Buffer, w: number, crop: Buffer, box: { left: number; top: number; width: number; height: number }, objLocal: Buffer, reach: number, soft = 2): Promise<Buffer> {
  const bw = box.width, bh = box.height;
  const near = await blur1(objLocal, bw, bh, reach);
  const r = Buffer.alloc(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = y * bw + x, o = ((box.top + y) * w + box.left + x) * 3, e = i * 3;
    const d = Math.max(Math.abs(frame[o] - crop[e]), Math.abs(frame[o + 1] - crop[e + 1]), Math.abs(frame[o + 2] - crop[e + 2]));
    r[i] = objLocal[i] || (near[i] > 6 && d > 36) ? 255 : 0;
  }
  // Close small holes (a jacket close to the street's colour) and soften the edge.
  const closed = await blur1(r, bw, bh, Math.max(2, reach / 6));
  for (let i = 0; i < r.length; i++) r[i] = closed[i] > 90 || objLocal[i] ? 255 : 0;
  return blur1(r, bw, bh, soft);
}

/** Pastes an edited crop at full opacity inside `region` (or the whole box), with only the outer `feather` px of the box
 *  blended (a person comes back solid: no see-through body, no seam). Returns a new RGB frame. */
export function pasteCrop(frame: Buffer, w: number, crop: Buffer, box: { left: number; top: number; width: number; height: number }, feather: number, region?: Buffer): Buffer {
  const out = Buffer.from(frame), bw = box.width, bh = box.height;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const edge = Math.min(1, (Math.min(x, y, bw - 1 - x, bh - 1 - y) + 1) / Math.max(1, feather));
    const a = region ? Math.min(edge, region[y * bw + x] / 255) : edge;
    if (!a) continue;
    const o = ((box.top + y) * w + box.left + x) * 3, e = (y * bw + x) * 3;
    for (let c = 0; c < 3; c++) out[o + c] = Math.round(crop[e + c] * a + frame[o + c] * (1 - a));
  }
  return out;
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

const hexRgb = (hex: string) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toLinear = (c: number) => Math.round(255 * ((c / 255) <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));

/** One 0/255 mask per object from the studio's object-ID layer (flat colours, black = none). Each pixel goes to the
 *  nearest legend colour, tried both as sRGB and as linear, since the render target may write either. */
export function objectMasks(maskRgb: Buffer, w: number, h: number, legend: { id: string; color: string }[]): Map<string, Buffer> {
  const keys = legend.flatMap(l => { const c = hexRgb(l.color); return [{ id: l.id, c }, { id: l.id, c: c.map(toLinear) }]; });
  const out = new Map<string, Buffer>(legend.map(l => [l.id, Buffer.alloc(w * h)]));
  for (let i = 0, p = 0; i < w * h; i++, p += 3) {
    const r = maskRgb[p], g = maskRgb[p + 1], b = maskRgb[p + 2];
    if (r + g + b < 30) continue;
    let best = '', bd = 3 * 40 * 40;
    for (const k of keys) { const d = (r - k.c[0]) ** 2 + (g - k.c[1]) ** 2 + (b - k.c[2]) ** 2; if (d < bd) { bd = d; best = k.id; } }
    if (best) out.get(best)![i] = 255;
  }
  return out;
}

/** Per-pixel blend strength: `base` over the contact areas, and each placeholder object's own (higher) strength inside its
 *  dilated, feathered mask, so a mannequin is fully replaced while the street around it barely changes. */
export async function strengthMap(contact: Buffer, base: number, objects: { mask: Buffer; strength: number }[], w: number, h: number): Promise<Buffer> {
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(contact[i] * base);
  const r = Math.max(2, Math.hypot(w, h) * 0.004);
  for (const o of objects) {
    const soft = await blur1(o.mask, w, h, r);
    for (let i = 0; i < out.length; i++) { const v = Math.min(255, Math.max(o.mask[i], soft[i] * 2)) * o.strength; if (v > out[i]) out[i] = Math.round(v); }
  }
  return out;
}

/** Bounding box of a mask, padded by `pad` of its size and clamped to the frame; null when the mask is empty. */
export function maskBox(m: Buffer, w: number, h: number, pad = 0.35) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < m.length; i++) if (m[i]) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const px = Math.round((x1 - x0 + 1) * pad), py = Math.round((y1 - y0 + 1) * pad);
  const left = Math.max(0, x0 - px), top = Math.max(0, y0 - py);
  return { left, top, width: Math.min(w, x1 + px + 1) - left, height: Math.min(h, y1 + py + 1) - top };
}
