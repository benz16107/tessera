// The studio's physical camera baked into the final render, so the stored image matches what the viewport's look-through
// shows. A port of web/src/studio/post/LensEffects.ts to raw buffers, in the same order: depth of field (from the scene
// depth the studio renders from its own clay massing, never tiles), handheld shake, lensfun distortion and lateral
// chromatic aberration, vignetting, exposure, white balance and tint, sensor noise. Works in linear light like the shader.
import sharp from 'sharp';

export type CameraBake = {
  exposureStops?: number; wbGains?: [number, number, number]; noiseSigma?: number; sensorMm?: [number, number];
  blades?: number; airyPx?: number; vignette?: boolean; distortionPoly?: [number, number, number, number, number] | null; unitMm?: number;
  tca?: { r: [number, number, number]; b: [number, number, number] } | null; shakePx?: number; photoF35?: number | null;
};
export type Optic = { focalMm: number; aperture: number; focusM: number; f35?: number };
export type Depth = { png: Buffer; nearM: number; farM: number };

const toLin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const LIN = Float32Array.from({ length: 256 }, (_, i) => toLin(i));
const toSrgb = (c: number) => Math.round(255 * Math.max(0, Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)));

/** Thin-lens blur circle in sensor millimetres, optics.ts blurCircleMm: c = f^2 |z - s| / (N z (s - f)). */
export function blurCircleMm(focalMm: number, aperture: number, focusM: number, zM: number): number {
  const f = focalMm / 1000, s = Math.max(focusM, f * 1.001);
  return ((f * f * Math.abs(zM - s)) / (aperture * Math.max(zM, 1e-3) * (s - f))) * 1000;
}

/** Inverse-depth PNG (white = nearM, black = farM or beyond) to metres per pixel. */
async function depthMetres(d: Depth, w: number, h: number): Promise<Float32Array> {
  const g = await sharp(d.png).resize({ width: w, height: h, fit: 'fill' }).greyscale().extractChannel(0).raw().toBuffer();
  const a = 1 / d.nearM - 1 / d.farM, out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = 1 / ((g[i] / 255) * a + 1 / d.farM);
  return out;
}

const sample = (img: Float32Array, w: number, h: number, x: number, y: number, c: number) => {
  // Bilinear, clamped to the frame edge (barrel distortion samples just past it).
  const fx = Math.max(0, Math.min(w - 1.001, x)), fy = Math.max(0, Math.min(h - 1.001, y)), x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
  const i = (y0 * w + x0) * 3 + c, j = i + w * 3;
  return (img[i] * (1 - tx) + img[i + 3] * tx) * (1 - ty) + (img[j] * (1 - tx) + img[j + 3] * tx) * ty;
};

/** Bakes the camera into a JPEG or PNG; returns JPEG bytes and what it applied. A missing field skips its stage. */
export async function bakeCamera(input: Buffer, cam: CameraBake, optic: Optic, depth?: Depth, seed = 7): Promise<{ jpeg: Buffer; applied: string[] }> {
  const applied: string[] = [];
  let img = sharp(input);
  let { width: w = 0, height: h = 0 } = await sharp(input).metadata();
  const w0 = w;
  // Longer than the photo: the frame is a centre crop (the world beyond a wider frame cannot come from the photo).
  let crop: { left: number; top: number; width: number; height: number } | null = null;
  if (cam.photoF35 && optic.f35 && optic.f35 > cam.photoF35 * 1.01) {
    const k = cam.photoF35 / optic.f35, cw = Math.round(w * k), ch = Math.round(h * k);
    crop = { left: Math.round((w - cw) / 2), top: Math.round((h - ch) / 2), width: cw, height: ch };
    img = img.extract(crop); w = cw; h = ch;
    applied.push(`centre crop to ${Math.round(optic.f35)} mm (${cw}x${ch})`);
  }
  const raw = await img.removeAlpha().raw().toBuffer();
  let a = new Float32Array(w * h * 3);
  for (let i = 0; i < a.length; i++) a[i] = LIN[raw[i]];
  const sensor = cam.sensorMm ?? [36, 24], pxPerMm = w / sensor[0], cx = w / 2, cy = h / 2;

  // 1. Depth of field: the shader's 48-tap gather shaped like the aperture, highlights weighted up, never below the Airy disk.
  if (depth) {
    // Depth at the photo's full size, then the same centre crop as the image.
    const zFull = await depthMetres(depth, w0, crop ? Math.round(h * (w0 / w)) : h);
    const z = crop ? Float32Array.from({ length: w * h }, (_, i) => zFull[(((i / w) | 0) + crop!.top) * w0 + (i % w) + crop!.left]) : zFull;
    const maxR = Math.max(28, Math.hypot(w, h) * 0.02), minR = (cam.airyPx ?? 0) / 2, blades = cam.blades ?? 9, polyAmt = optic.aperture > 2.8 ? 1 : 0, seg = (2 * Math.PI) / Math.max(3, blades);
    const coc = (zz: number) => Math.min(0.5 * blurCircleMm(optic.focalMm, optic.aperture, optic.focusM, zz) * pxPerMm, maxR);
    const taps = Array.from({ length: 48 }, (_, i) => {
      const fi = i + 0.5, th = fi * 2.39996323, ar = ((th - 0.3) % seg + seg) % seg - seg / 2;
      const pr = blades < 3 ? 1 : 1 + polyAmt * (Math.cos(seg / 2) / Math.cos(ar) - 1);
      return { dx: Math.cos(th) * Math.sqrt(fi / 48) * pr, dy: Math.sin(th) * Math.sqrt(fi / 48) * pr };
    });
    const hiW = (r: number, g: number, b: number) => { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b, t = Math.max(0, Math.min(1, (l - 0.82) / 0.18)); return 1 + 6 * t * t * (3 - 2 * t); };
    const out = new Float32Array(a.length);
    let blurred = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, p = i * 3, zc = z[i], r = Math.max(coc(zc), minR);
      if (r < 0.5) { out[p] = a[p]; out[p + 1] = a[p + 1]; out[p + 2] = a[p + 2]; continue; }
      if (r >= 1) blurred++;
      let w0 = hiW(a[p], a[p + 1], a[p + 2]), sr = a[p] * w0, sg = a[p + 1] * w0, sb = a[p + 2] * w0, ws = w0;
      for (const t of taps) {
        const sx = Math.round(x + t.dx * r), sy = Math.round(y + t.dy * r);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const j = sy * w + sx, q = j * 3, sz = z[j], rr = Math.hypot(t.dx, t.dy) * r;
        // Nearer samples count only when their own blur reaches this pixel, so sharp foregrounds keep their edges.
        let wt = sz < zc ? Math.max(0, Math.min(1, (Math.max(coc(sz), minR) - (rr - 1)) / 2)) : 1;
        wt *= hiW(a[q], a[q + 1], a[q + 2]);
        sr += a[q] * wt; sg += a[q + 1] * wt; sb += a[q + 2] * wt; ws += wt;
      }
      out[p] = sr / ws; out[p + 1] = sg / ws; out[p + 2] = sb / ws;
    }
    a = out;
    applied.push(`depth of field ${optic.focalMm} mm f/${optic.aperture} focused at ${optic.focusM} m (${Math.round((100 * blurred) / (w * h))}% of the frame out of focus)`);
  }

  // 2. Handheld shake: the frame averaged along one direction (the viewport's preview uses a fixed direction too).
  const shake = cam.shakePx ?? 0;
  if (shake >= 0.75) {
    const out = new Float32Array(a.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 12; k++) s += sample(a, w, h, x + shake * (k / 11 - 0.5), y, c);
      out[(y * w + x) * 3 + c] = s / 12;
    }
    a = out;
    applied.push(`handheld shake ${shake.toFixed(1)} px`);
  }

  // 3. Distortion (lensfun, Rd = Ru (c0 + c1 Ru + ... + c4 Ru^4), inverted with Newton as in the shader) and TCA.
  const poly = cam.distortionPoly, unit = cam.unitMm ?? 12, tca = cam.tca;
  if ((poly && poly.some((v, i) => Math.abs(v - (i ? 0 : 1)) > 1e-6)) || tca) {
    const [c0, c1, c2, c3, c4] = poly ?? [1, 0, 0, 0, 0];
    const dR = (r: number) => r * (c0 + r * (c1 + r * (c2 + r * (c3 + r * c4)))), dD = (r: number) => c0 + r * (2 * c1 + r * (3 * c2 + r * (4 * c3 + r * 5 * c4)));
    const out = new Float32Array(a.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = (x - cx) / pxPerMm, py = (y - cy) / pxPerMm, rd = Math.hypot(px, py) / unit;
      let ru = rd;
      if (poly) for (let k = 0; k < 6; k++) ru -= (dR(ru) - rd) / Math.max(dD(ru), 1e-4);
      const s = rd > 1e-6 ? ru / rd : 1, sx = cx + (x - cx) * s, sy = cy + (y - cy) * s, o = (y * w + x) * 3;
      const sR = tca ? tca.r[0] + tca.r[1] * ru + tca.r[2] * ru * ru : 1, sB = tca ? tca.b[0] + tca.b[1] * ru + tca.b[2] * ru * ru : 1;
      out[o] = sample(a, w, h, cx + (sx - cx) / sR, cy + (sy - cy) / sR, 0);
      out[o + 1] = sample(a, w, h, sx, sy, 1);
      out[o + 2] = sample(a, w, h, cx + (sx - cx) / sB, cy + (sy - cy) / sB, 2);
    }
    a = out;
    applied.push(`${poly ? 'lens distortion' : ''}${poly && tca ? ' and ' : ''}${tca ? 'lateral chromatic aberration' : ''} (lensfun)`);
  }

  // 4. Vignetting (cos^4 of the field angle), exposure, white balance and tint; 5. sensor noise, stronger in the shadows.
  const gain = 2 ** (cam.exposureStops ?? 0), wb = cam.wbGains ?? [1, 1, 1], noise = cam.noiseSigma ?? 0;
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3;
    let v = 1;
    if (cam.vignette) { const rmm = Math.hypot((x - cx) / pxPerMm, (y - cy) / pxPerMm), c = Math.cos(Math.atan(rmm / optic.focalMm)); v = c * c * c * c; }
    const r = a[o] * v * gain * wb[0], g = a[o + 1] * v * gain * wb[1], b = a[o + 2] * v * gain * wb[2];
    let nl = 0, nr = 0, ng = 0, nb = 0;
    if (noise > 0) {
      const l = Math.max(0, Math.min(1, 0.2126 * r + 0.7152 * g + 0.0722 * b)), sig = noise * (0.6 + 0.6 * (1 - l));
      nl = (rnd() + rnd() + rnd() - 1.5) * 1.2 * sig; nr = (rnd() - 0.5) * 0.6 * sig; ng = (rnd() - 0.5) * 0.6 * sig; nb = (rnd() - 0.5) * 0.6 * sig;
    }
    out[o] = toSrgb(r + nl + nr); out[o + 1] = toSrgb(g + nl + ng); out[o + 2] = toSrgb(b + nl + nb);
  }
  if (cam.vignette) applied.push('vignetting');
  if (gain !== 1) applied.push(`exposure ${(cam.exposureStops ?? 0) >= 0 ? '+' : ''}${(cam.exposureStops ?? 0).toFixed(2)} EV`);
  if (wb.some(g => Math.abs(g - 1) > 1e-3)) applied.push(`white balance ${wb.map(g => g.toFixed(2)).join('/')}`);
  if (noise > 0) applied.push(`sensor noise ${noise.toFixed(4)}`);
  return { jpeg: await sharp(out, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer(), applied };
}
