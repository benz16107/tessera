// Looking through the shot camera: it becomes the default camera, its field of view is fitted so the photo's frame sits
// letterboxed in the viewport, and the frame renders through the physical camera chain in LensEffects.ts:
// depth of field, motion and shake, chromatic aberration, then distortion, vignetting, exposure, white balance, starbursts
// and noise. Every number comes from the body and lens (camera/shot.ts optics, optics.ts formulas).
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import { Box3, HalfFloatType, Vector2, Vector3, Vector4, type Object3D, type PerspectiveCamera } from 'three';
import { DofEffect, LensEffect, MotionEffect, TcaEffect } from './LensEffects.ts';
import type { Fit, Optics } from '../camera/shot.ts';
import type { Shot } from '../state/useShotSettings.ts';

export interface Walker { root: Object3D; velocity: Vector3 } // three-world metres per second
export interface PointLight { pos: Vector3; strength: number } // three-world position, 0 to 1
export interface Histogram { bins: number[]; clipHi: number; clipLo: number }

interface Props {
  camera: PerspectiveCamera; o: Optics; shot: Shot; gain: number; wb: [number, number, number]; dofOn: boolean; vignette: boolean;
  fit: (vw: number, vh: number) => Fit;
  /** Over the user's photo only their objects and shadows draw: helpers hide and nothing renders outside the frame. */
  photoOnly?: boolean;
  walkers?: () => Walker[];
  lights?: () => PointLight[];
  shakePx?: number; // handheld shake during the shutter, in frame pixels
  onHistogram?: (h: Histogram) => void;
  grab?: React.MutableRefObject<((url: string) => void) | null>; // set to receive the next frame as a JPEG data URL
}

export function fitShotCamera(camera: PerspectiveCamera, o: Optics, fit: Fit, vw: number, vh: number) {
  const t = Math.tan((fit.fovDeg * Math.PI) / 360) * o.overscan;
  camera.fov = (2 * Math.atan(t) * 180) / Math.PI;
  camera.aspect = vw / vh;
  camera.near = 0.1; camera.far = 20000;
  camera.updateProjectionMatrix();
  // Lens shift: put the optical axis at the frame's centre, which sits above the viewport's centre.
  camera.projectionMatrix.elements[8] = -fit.shiftX;
  camera.projectionMatrix.elements[9] = -fit.shiftY;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return fit;
}

const box = new Box3(), v3 = new Vector3(), corner = new Vector3();
const toUv = (p: Vector3, cam: PerspectiveCamera) => { p.project(cam); return new Vector2((p.x + 1) / 2, (p.y + 1) / 2); };

export default function LookThrough({ camera, o, shot, gain, wb, dofOn, vignette, fit: fitFn, photoOnly = false, walkers, lights, shakePx = 0, onHistogram, grab }: Props) {
  const { gl, scene, size, set, camera: prev, viewport } = useThree();
  useEffect(() => {
    set({ camera });
    return () => set({ camera: prev });
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps

  const { composer, dof, lens, motion, tca, dofPass, motionPass, tcaPass } = useMemo(() => {
    const composer = new EffectComposer(gl, { frameBufferType: HalfFloatType });
    const dof = new DofEffect(), motion = new MotionEffect(), tca = new TcaEffect(), lens = new LensEffect();
    const dofPass = new EffectPass(camera, dof), motionPass = new EffectPass(camera, motion), tcaPass = new EffectPass(camera, tca);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(dofPass);
    composer.addPass(motionPass);
    composer.addPass(tcaPass);
    composer.addPass(new EffectPass(camera, lens));
    return { composer, dof, lens, motion, tca, dofPass, motionPass, tcaPass };
  }, [gl, scene, camera]);
  useEffect(() => () => composer.dispose(), [composer]);
  useEffect(() => { composer.setSize(size.width, size.height); }, [composer, size.width, size.height]);
  const hist = useMemo(() => ({ c: document.createElement('canvas'), last: 0 }), []);

  useFrame((_, dt) => {
    const fit = fitShotCamera(camera, o, fitFn(size.width, size.height), size.width, size.height);
    const dpr = viewport.dpr;
    const k = (fit.pxPerFramePx * dpr) / o.overscan; // render pixels per frame pixel
    const center = new Vector2(0.5 + fit.shiftX / 2, 0.5 + fit.shiftY / 2);
    const frameScale = new Vector2(fit.scale[0], fit.scale[1]);

    // Depth of field, shaped by the aperture.
    dofPass.enabled = dofOn;
    dof.set(shot.focalMm, shot.aperture, shot.focusM, (o.frame.w / o.sensorMm[0]) * k);
    const du = dof.uniforms;
    du.get('minR')!.value = (o.airyPx / 2) * k;
    du.get('blades')!.value = o.blades;
    du.get('polyAmt')!.value = Math.max(0, Math.min(1, o.stopsDown / 2)); // rounded blades read round wide open
    du.get('catEye')!.value = 0.5 * Math.max(0, Math.min(1, 1 - o.stopsDown / 2));
    (du.get('frameScale')!.value as Vector2).copy(frameScale); (du.get('center')!.value as Vector2).copy(center);

    // Motion blur of walkers during the shutter, and handheld shake.
    const ws = walkers?.() ?? [];
    const mu = motion.uniforms;
    let n = 0;
    camera.updateMatrixWorld();
    for (const w of ws.slice(0, 4)) {
      box.setFromObject(w.root);
      if (box.isEmpty()) continue;
      let lo = new Vector2(Infinity, Infinity), hi = new Vector2(-Infinity, -Infinity), behind = false;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        if (corner.clone().applyMatrix4(camera.matrixWorldInverse).z > -0.1) behind = true;
        const uv = toUv(corner, camera); lo = lo.min(uv); hi = hi.max(uv);
      }
      if (behind) continue;
      const c = box.getCenter(v3.clone());
      const a = toUv(c.clone(), camera), b = toUv(c.clone().addScaledVector(w.velocity, shot.shutterS), camera);
      const vel = b.sub(a);
      if (vel.length() * size.width < 1) continue; // under a pixel: sharp
      const zc = -c.clone().applyMatrix4(camera.matrixWorldInverse).z, r = box.getSize(v3.clone()).length() / 2;
      (mu.get('box')!.value as Vector4[])[n].set(lo.x, lo.y, hi.x, hi.y);
      (mu.get('vel')!.value as Vector2[])[n].copy(vel);
      (mu.get('band')!.value as Vector2[])[n].set(zc - r, zc + r);
      n++;
    }
    mu.get('count')!.value = n;
    const shake = (shakePx * fit.pxPerFramePx) / size.width;
    (mu.get('shake')!.value as Vector2).set(shake * 0.8, shake * 0.6 * (size.width / size.height));
    motionPass.enabled = n > 0 || shake > 0.0004;

    // Lateral chromatic aberration (lensfun TCA).
    tcaPass.enabled = !!o.tca;
    if (o.tca) {
      const tu = tca.uniforms;
      (tu.get('frameScale')!.value as Vector2).copy(frameScale); (tu.get('center')!.value as Vector2).copy(center);
      (tu.get('sensorMm')!.value as Vector2).set(o.sensorMm[0], o.sensorMm[1]);
      tu.get('unitMm')!.value = o.unitMm; tu.get('overscan')!.value = o.overscan;
      (tu.get('tr')!.value as Vector3).set(...o.tca.r); (tu.get('tb')!.value as Vector3).set(...o.tca.b);
    }

    const u = lens.uniforms;
    (u.get('frameScale')!.value as Vector2).copy(frameScale);
    (u.get('center')!.value as Vector2).copy(center);
    (u.get('sensorMm')!.value as Vector2).set(o.sensorMm[0], o.sensorMm[1]);
    u.get('distOn')!.value = o.poly ? 1 : 0;
    if (o.poly) { u.get('c0')!.value = o.poly[0]; (u.get('c14')!.value as Vector4).set(o.poly[1], o.poly[2], o.poly[3], o.poly[4]); }
    u.get('unitMm')!.value = o.unitMm;
    u.get('overscan')!.value = o.overscan;
    u.get('vigMode')!.value = !vignette ? 0 : o.vig ? 2 : 1; // measured lensfun falloff, else natural cos^4 plus optical
    if (o.vig) (u.get('vigK')!.value as Vector3).set(o.vig.k1, o.vig.k2, o.vig.k3);
    u.get('optVig')!.value = o.optVig;
    u.get('vigUnitMm')!.value = o.vigUnitMm;
    u.get('focalMm')!.value = shot.focalMm;
    u.get('gain')!.value = gain;
    (u.get('wb')!.value as Vector3).set(wb[0], wb[1], wb[2]);
    u.get('clip')!.value = photoOnly ? 1 : 0;
    // Noise: averaged over the frame pixels each screen pixel shows.
    u.get('noise')!.value = o.noise * Math.sqrt(Math.min(1, fit.pxPerFramePx));
    // Starbursts from point lights once stopped down (they grow from f/8 to full at f/16).
    const ls = lights?.() ?? [];
    const amt = Math.max(0, Math.min(1, (shot.aperture - 8) / 8));
    let sc = 0;
    if (amt > 0 && o.spikes > 0) for (const l of ls) {
      if (sc >= 8) break;
      if (l.pos.clone().applyMatrix4(camera.matrixWorldInverse).z > -0.2) continue;
      const uv = toUv(l.pos.clone(), camera);
      if (uv.x < -0.1 || uv.x > 1.1 || uv.y < -0.1 || uv.y > 1.1) continue;
      (u.get('stars')!.value as Vector4[])[sc++].set(uv.x, uv.y, 0.5 * amt * l.strength, shot.aperture * 2.2 * dpr);
    }
    u.get('starCount')!.value = sc;
    u.get('spikes')!.value = o.spikes;

    const hide: Object3D[] = [];
    if (photoOnly) scene.traverse(x => { if (x.userData.helper && x.visible) hide.push(x); });
    hide.forEach(x => (x.visible = false));
    composer.render(dt);
    hide.forEach(x => (x.visible = true));

    // The frame, read back right after rendering: a histogram for the readout, and a grab for Compare.
    const now = performance.now();
    const fx = Math.round(fit.rect.x * dpr), fy = Math.round(fit.rect.y * dpr), fw = Math.round(fit.rect.w * dpr), fh = Math.round(fit.rect.h * dpr);
    if (grab?.current && fw > 0) {
      const c = document.createElement('canvas');
      c.width = fw; c.height = fh;
      c.getContext('2d')!.drawImage(gl.domElement, fx, fy, fw, fh, 0, 0, fw, fh);
      const cb = grab.current; grab.current = null;
      cb(c.toDataURL('image/jpeg', 0.92));
    }
    if (onHistogram && now - hist.last > 400 && fw > 0) {
      hist.last = now;
      const W = 64, H = Math.max(8, Math.round((64 * fh) / fw));
      hist.c.width = W; hist.c.height = H;
      const ctx = hist.c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(gl.domElement, fx, fy, fw, fh, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data, bins = new Array(32).fill(0);
      let hiN = 0, loN = 0, total = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        bins[Math.min(31, Math.floor(l / 8))]++; total++;
        if (Math.max(d[i], d[i + 1], d[i + 2]) >= 250) hiN++;
        if (l <= 4) loN++;
      }
      if (total) onHistogram({ bins: bins.map(b => b / total), clipHi: hiN / total, clipLo: loN / total });
    }
  }, 1);
  return null;
}
