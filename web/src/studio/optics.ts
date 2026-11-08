// Camera math for the studio. Units: focal lengths and sensor sizes in mm, distances in metres, times in seconds.
// Thin-lens, rectilinear, focus at the stated distance. Self-check: `node src/studio/optics.check.ts`.

export const DIAG_35 = Math.hypot(36, 24); // 43.27 mm
const DEG = 180 / Math.PI;

export interface Fov { h: number; v: number; d: number } // degrees

/** Angle of view for a rectilinear lens focused at infinity (Wikipedia, "Angle of view": 2 atan(d / 2f)). */
export function fov(focalMm: number, sensorW: number, sensorH: number): Fov {
  const a = (size: number) => 2 * Math.atan(size / (2 * focalMm)) * DEG;
  return { h: a(sensorW), v: a(sensorH), d: a(Math.hypot(sensorW, sensorH)) };
}

/** Crop factor on the diagonal against 36 x 24 (Wikipedia, "Crop factor"). */
export const cropFactor = (sensorW: number, sensorH: number) => DIAG_35 / Math.hypot(sensorW, sensorH);

/** 35 mm equivalent focal length: real focal x crop factor (Wikipedia, "35 mm equivalent focal length"). */
export const equiv35 = (focalMm: number, crop: number) => focalMm * crop;

/** Hyperfocal distance H = f^2 / (N c) + f (Wikipedia, "Hyperfocal distance"). Returns metres. */
export const hyperfocalM = (focalMm: number, n: number, cocMm: number) => ((focalMm * focalMm) / (n * cocMm) + focalMm) / 1000;

export interface Dof { nearM: number; farM: number; totalM: number; hyperfocalM: number }

/** Thin-lens depth of field (Wikipedia, "Depth of field", near = s(H-f)/(H+s-2f), far = s(H-f)/(H-s)). */
export function depthOfField(focalMm: number, n: number, cocMm: number, focusM: number): Dof {
  const f = focalMm / 1000, h = hyperfocalM(focalMm, n, cocMm), s = Math.max(focusM, f * 1.001);
  const nearM = (s * (h - f)) / (h + s - 2 * f);
  const farM = s >= h ? Infinity : (s * (h - f)) / (h - s);
  return { nearM, farM, totalM: farM - nearM, hyperfocalM: h };
}

/** Blur-circle diameter on the sensor (mm) for an object at objectM when focused at focusM
 *  (Wikipedia, "Circle of confusion": c = f^2 |S2 - S1| / (N S2 (S1 - f))). */
export function blurCircleMm(focalMm: number, n: number, focusM: number, objectM: number): number {
  const f = focalMm / 1000, s1 = Math.max(focusM, f * 1.001);
  const c = (f * f * Math.abs(objectM - s1)) / (n * objectM * (s1 - f)); // metres
  return c * 1000;
}

/** Exposure value of camera settings, normalised to ISO 100: EV100 = log2(N^2 / t) - log2(S / 100) (Wikipedia, "Exposure value"). */
export const settingsEv100 = (n: number, t: number, iso: number) => Math.log2((n * n) / t) - Math.log2(iso / 100);

/** Meter reading in stops: positive = brighter than a mid-grey exposure (overexposed). */
export const meterStops = (sceneEv100: number, n: number, t: number, iso: number) => sceneEv100 - settingsEv100(n, t, iso);

export const SHUTTERS = [
  30, 25, 20, 15, 13, 10, 8, 6, 5, 4, 3.2, 2.5, 2, 1.6, 1.3, 1, 0.8, 0.6, 0.5, 0.4, 0.3,
  1 / 4, 1 / 5, 1 / 6, 1 / 8, 1 / 10, 1 / 13, 1 / 15, 1 / 20, 1 / 25, 1 / 30, 1 / 40, 1 / 50, 1 / 60, 1 / 80, 1 / 100, 1 / 125,
  1 / 160, 1 / 200, 1 / 250, 1 / 320, 1 / 400, 1 / 500, 1 / 640, 1 / 800, 1 / 1000, 1 / 1250, 1 / 1600, 1 / 2000, 1 / 2500,
  1 / 3200, 1 / 4000, 1 / 5000, 1 / 6400, 1 / 8000,
];
export const ISOS = [50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 25600, 51200];

const nearestLog = (xs: number[], v: number) => xs.reduce((b, x) => (Math.abs(Math.log(x / v)) < Math.abs(Math.log(b / v)) ? x : b), xs[0]);

/** Shutter speed (snapped to a third stop) that meters 0 for this scene, aperture and ISO. */
export const shutterForScene = (sceneEv100: number, n: number, iso: number) =>
  nearestLog(SHUTTERS, (n * n) / Math.pow(2, sceneEv100 + Math.log2(iso / 100)));

export const fmtShutter = (t: number) => (t >= 0.3 ? `${+t.toFixed(1)}"` : `1/${Math.round(1 / t)}`);

export type Weather = 'clear' | 'slight-overcast' | 'overcast' | 'heavy-overcast' | 'open-shade';
export type NightLight = 'none' | 'street' | 'floodlit';

// Sunny 16 family (Kodak film-box rule: f/16, 11, 8, 5.6, 4 at 1/ISO), as EV100.
export const WEATHER_EV: Record<Weather, number> = { clear: 15, 'slight-overcast': 14, overcast: 13, 'heavy-overcast': 12, 'open-shade': 11 };
// Wikipedia "Exposure value" table: night street scenes EV 7-8, floodlit buildings EV 3-5.
export const NIGHT_EV: Record<NightLight, number> = { none: -Infinity, street: 7, floodlit: 4 };

/** Scene EV100 estimate from the sun's altitude (degrees) and the weather.
 *  Full sunny-16 value from 20 degrees up; falls 3 stops to EV 12 at sunset (Wikipedia table: "at sunset 12");
 *  then about 1 stop per degree through twilight (blue hour at -4 to -6 degrees is about EV 6-8). */
export function sceneEv100(sunAltDeg: number, weather: Weather = 'clear', night: NightLight = 'street'): number {
  const base = WEATHER_EV[weather];
  let ev: number;
  if (sunAltDeg >= 20) ev = base;
  else if (sunAltDeg >= 0) ev = base - ((20 - sunAltDeg) / 20) * 3;
  else ev = Math.max(base - 3 + sunAltDeg, base - 21); // floor about EV -6 for moonless natural night
  return Math.max(ev, NIGHT_EV[night]);
}

export interface Handheld { safeS: number; ratio: number; risk: 'ok' | 'borderline' | 'high' }

/** Reciprocal rule: slowest safe handheld shutter = 1 / (focal x crop), times 2^stabilisation stops. */
export function handheld(t: number, focalMm: number, crop: number, stabStops = 0): Handheld {
  const safeS = Math.pow(2, stabStops) / (focalMm * crop);
  const ratio = t / safeS;
  return { safeS, ratio, risk: ratio <= 1 ? 'ok' : ratio <= 2 ? 'borderline' : 'high' };
}

export interface Diffraction { airyUm: number; limitN: number; warn: boolean }

/** Airy disk diameter to the first zero = 2.44 lambda N (Wikipedia, "Airy disk"); warn past 2 pixels. */
export function diffraction(n: number, pitchUm: number, lambdaNm = 550): Diffraction {
  const airyUm = 2.44 * (lambdaNm / 1000) * n;
  return { airyUm, limitN: (2 * pitchUm) / (2.44 * (lambdaNm / 1000)), warn: airyUm > 2 * pitchUm };
}

/** Thin-lens magnification m = f / (d - f), d measured from the lens (Wikipedia, "Magnification", photography). */
export const magnification = (focalMm: number, distanceM: number) => {
  const f = focalMm / 1000;
  return f / Math.max(distanceM - f, 1e-6);
};

/** Fraction of the frame height a subject of heightM fills at distanceM (image height = H m over sensor height). */
export const frameFraction = (heightM: number, focalMm: number, distanceM: number, sensorHmm: number) =>
  (heightM * 1000 * magnification(focalMm, distanceM)) / sensorHmm;

/** Distance at which a subject fills `fraction` of the frame height (inverse of frameFraction). */
export const distanceForFraction = (heightM: number, focalMm: number, fraction: number, sensorHmm: number) => {
  const m = (fraction * sensorHmm) / (heightM * 1000);
  return (focalMm / 1000) * (1 + 1 / m);
};

export interface Compression { d2M: number; bgRatio: number; limit: number }

/** Background compression: keep the subject the same size while changing focal f1 -> f2.
 *  Subject distance scales with focal (d2 = d1 f2 / f1, distant-subject approximation); a background bgM behind the subject
 *  is then magnified, relative to the subject, by (f2 / (d2 + B)) / (f1 / (d1 + B)), which tends to f2 / f1 for far backgrounds. */
export function compression(f1Mm: number, f2Mm: number, d1M: number, bgBehindM: number): Compression {
  const d2M = (d1M * f2Mm) / f1Mm;
  const bgRatio = (f2Mm / (d2M + bgBehindM)) / (f1Mm / (d1M + bgBehindM));
  return { d2M, bgRatio, limit: f2Mm / f1Mm };
}

/** Black-body colour temperature to sRGB 0..1 (Tanner Helland's fit to Mitchell Charity's black-body table, 1000-40000 K). */
export function kelvinToRgb(k: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, k)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return [c(r), c(g), c(b)];
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); // IEC 61966-2-1 sRGB

/** White-balance multipliers (linear RGB) for a scene lit at lightK and a camera set to cameraK, normalised to keep luminance.
 *  The camera divides out the illuminant it assumes, so the image shifts by light / camera (von Kries scaling). */
export function whiteBalanceGains(lightK: number, cameraK: number): [number, number, number] {
  const l = kelvinToRgb(lightK).map(toLinear), c = kelvinToRgb(cameraK).map(toLinear);
  const g = l.map((v, i) => v / Math.max(c[i], 1e-3)); // below ~1900 K the fit's blue reaches 0
  const y = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]; // Rec. 709 luminance weights
  return [g[0] / y, g[1] / y, g[2] / y];
}
