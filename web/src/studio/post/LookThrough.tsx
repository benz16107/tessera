// Looking through the shot camera: it becomes the default camera, its field of view is fitted so the photo's frame sits
// letterboxed in the viewport, and the frame renders through DofEffect then LensEffect (see LensEffects.ts).
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import { HalfFloatType, Vector2, Vector3, Vector4, type PerspectiveCamera } from 'three';
import { DofEffect, LensEffect } from './LensEffects.ts';
import type { Fit, Optics } from '../camera/shot.ts';
import type { Shot } from '../state/useShotSettings.ts';

interface Props { camera: PerspectiveCamera; o: Optics; shot: Shot; gain: number; wb: [number, number, number]; dofOn: boolean; vignette: boolean; fit: (vw: number, vh: number) => Fit }

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

export default function LookThrough({ camera, o, shot, gain, wb, dofOn, vignette, fit: fitFn }: Props) {
  const { gl, scene, size, set, camera: prev, viewport } = useThree();
  useEffect(() => {
    set({ camera });
    return () => set({ camera: prev });
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps

  const { composer, dof, lens, dofPass } = useMemo(() => {
    const composer = new EffectComposer(gl, { frameBufferType: HalfFloatType });
    const dof = new DofEffect(), lens = new LensEffect();
    const dofPass = new EffectPass(camera, dof);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(dofPass);
    composer.addPass(new EffectPass(camera, lens));
    return { composer, dof, lens, dofPass };
  }, [gl, scene, camera]);
  useEffect(() => () => composer.dispose(), [composer]);
  useEffect(() => { composer.setSize(size.width, size.height); }, [composer, size.width, size.height]);

  useFrame((_, dt) => {
    const fit = fitShotCamera(camera, o, fitFn(size.width, size.height), size.width, size.height);
    const dpr = viewport.dpr;
    dofPass.enabled = dofOn;
    dof.set(shot.focalMm, shot.aperture, shot.focusM, (o.frame.w / o.sensorMm[0]) * fit.pxPerFramePx * dpr / o.overscan);
    const u = lens.uniforms;
    (u.get('frameScale')!.value as Vector2).set(fit.scale[0], fit.scale[1]);
    (u.get('center')!.value as Vector2).set(0.5 + fit.shiftX / 2, 0.5 + fit.shiftY / 2);
    (u.get('sensorMm')!.value as Vector2).set(o.sensorMm[0], o.sensorMm[1]);
    u.get('distOn')!.value = o.poly ? 1 : 0;
    if (o.poly) { u.get('c0')!.value = o.poly[0]; (u.get('c14')!.value as Vector4).set(o.poly[1], o.poly[2], o.poly[3], o.poly[4]); }
    u.get('unitMm')!.value = o.unitMm;
    u.get('overscan')!.value = o.overscan;
    u.get('vigMode')!.value = !vignette ? 0 : o.vig ? 2 : 1; // measured lensfun falloff, else natural cos^4
    if (o.vig) (u.get('vigK')!.value as Vector3).set(o.vig.k1, o.vig.k2, o.vig.k3);
    u.get('vigUnitMm')!.value = o.vigUnitMm;
    u.get('focalMm')!.value = shot.focalMm;
    u.get('gain')!.value = gain;
    (u.get('wb')!.value as Vector3).set(wb[0], wb[1], wb[2]);
    composer.render(dt);
  }, 1);
  return null;
}
