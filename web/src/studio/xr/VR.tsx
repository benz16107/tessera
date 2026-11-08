// WebXR: an Enter VR button (only when the browser reports immersive-vr), teleport locomotion on our own ground plane,
// smooth thumbstick locomotion, 1:1 scale (the set is in metres). The XR origin starts at the shot camera's ground point.
import { useEffect, useRef, useState } from 'react';
import { createXRStore, useXRControllerLocomotion, XROrigin } from '@react-three/xr';
import type { Group, Vector3 } from 'three';

// emulate: false so a desktop browser never pretends to have a headset.
export const xrStore = createXRStore({ emulate: false, controller: { teleportPointer: true }, hand: { teleportPointer: true } });

export function useVrSupported() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } }).xr;
    xr?.isSessionSupported('immersive-vr').then(setOk).catch(() => setOk(false));
  }, []);
  return ok;
}

export function VrButton() {
  const ok = useVrSupported();
  if (!ok) return null;
  return <button className="st-btn" onClick={() => xrStore.enterVR()}>Enter VR</button>;
}

/** The XR origin, with smooth locomotion on the left thumbstick (and snap turn on the right) besides teleport. */
export function VrOrigin({ position }: { position: Vector3 }) {
  const ref = useRef<Group>(null);
  useXRControllerLocomotion(ref, { speed: 1.6 });
  return <XROrigin ref={ref} position={position} />;
}
