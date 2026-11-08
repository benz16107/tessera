// The shot camera's optics in one place: frame size, field of view, depth of field and the lens profile, from the
// session's shot_settings (body, lens, focal, aperture, focus) and the photo's pixel size.
// The frame keeps the photo's aspect; the body's sensor diagonal maps onto the frame diagonal, so f35 = focal x crop
// gives the same field of view as CONTRACTS.md's f35 convention (fpx = f35 * hypot(w, h) / 43.27).
import { bodyById, defaultBody, lensById } from '../catalog/index.ts';
import { profileFor, distortionPoly, radiusUnitsMm, overscanFor, vignetting, distort, type Poly, type Vig } from '../catalog/profiles.ts';
import { DIAG_35, depthOfField, fov, type Dof } from '../optics.ts';
import type { Shot } from '../state/useShotSettings.ts';

export interface Frame { w: number; h: number }

export interface Optics {
  frame: Frame;
  f35: number;
  fpx: number; // focal length in frame pixels
  sensorMm: [number, number]; // the frame's size on the sensor
  vfovDeg: number; hfovDeg: number;
  dof: Dof;
  cocMm: number;
  poly: Poly | null; // lensfun distortion, null when off or unmeasured
  unitMm: number; // lensfun distortion radius unit
  vigUnitMm: number;
  overscan: number; // render wider by this so barrel distortion never samples outside
  vig: Vig | undefined;
  hasProfile: boolean;
  distortionPct: number; // radial distortion at the frame corner, % (negative = barrel)
}

export function optics(s: Shot, frame: Frame): Optics {
  const body = bodyById(s.bodyId) ?? defaultBody();
  const lens = lensById(s.lensId);
  const f35 = s.focalMm * body.crop;
  const diagPx = Math.hypot(frame.w, frame.h);
  const fpx = (f35 * diagPx) / DIAG_35;
  const mmPerPx = body.diagMm / diagPx;
  const sensorMm: [number, number] = [frame.w * mmPerPx, frame.h * mmPerPx];
  const a = fov(s.focalMm, sensorMm[0], sensorMm[1]);
  const profile = lens ? profileFor(lens.id) : undefined;
  const hasProfile = !!profile?.distortion.length;
  const poly = s.distortion && profile && hasProfile ? distortionPoly(profile, s.focalMm) : null;
  const [unitMm, vigUnitMm] = profile ? radiusUnitsMm(profile) : [sensorMm[1] / 2, Math.hypot(...sensorMm) / 2];
  return {
    frame, f35, fpx, sensorMm, vfovDeg: a.v, hfovDeg: a.h,
    dof: depthOfField(s.focalMm, s.aperture, body.cocMm, s.focusM), cocMm: body.cocMm,
    poly, unitMm, vigUnitMm,
    overscan: poly ? overscanFor(poly, sensorMm[0], sensorMm[1], unitMm) : 1,
    vig: vignetting(profile, s.focalMm, s.aperture, s.focusM),
    hasProfile,
    distortionPct: (() => {
      const p = profile && hasProfile ? distortionPoly(profile, s.focalMm) : null;
      if (!p) return 0;
      const rc = Math.hypot(...sensorMm) / 2 / unitMm;
      return (distort(p, rc) / rc - 1) * 100;
    })(),
  };
}

/** Fit the frame into a box inside the viewport (margins in px) and return the camera's vertical FOV for the whole
 *  viewport, the frame's rectangle in viewport pixels, its size as a fraction of the viewport (for the lens shader), and
 *  the lens shift (NDC) that puts the optical axis at the frame's centre. */
export function fitFrame(o: Optics, vw: number, vh: number, m = { top: 56, bottom: 60, left: 24, right: 24 }) {
  const bw = Math.max(80, vw - m.left - m.right), bh = Math.max(80, vh - m.top - m.bottom);
  const s = Math.min(bw / o.frame.w, bh / o.frame.h);
  const rw = o.frame.w * s, rh = o.frame.h * s;
  const x = m.left + (bw - rw) / 2, y = m.top;
  const fovDeg = (2 * Math.atan((vh / 2) / (o.fpx * s)) * 180) / Math.PI;
  return {
    fovDeg, rect: { x, y, w: rw, h: rh }, scale: [rw / vw, rh / vh] as [number, number], pxPerFramePx: s,
    shiftX: (x + rw / 2 - vw / 2) / (vw / 2), shiftY: (vh / 2 - (y + rh / 2)) / (vh / 2),
  };
}
export type Fit = ReturnType<typeof fitFrame>;

export const frameFromPhoto = (p?: { width: number; height: number }): Frame => (p && p.width > 0 ? { w: p.width, h: p.height } : { w: 6000, h: 4000 });
