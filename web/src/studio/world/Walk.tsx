// Walk: first-person navigation in the World view (Blender's walk navigation, and the phone equivalent).
// Desktop: click empty space to capture the mouse and look around; WASD or arrows walk, Shift runs, E or Space up and
// Q down (flying), the wheel sets the speed, Esc releases the mouse and a second Esc leaves Walk. Phone and tablet: a
// left joystick, drag elsewhere to look, pinch for eye height, optional gyro look. Gravity keeps the eye at a height above
// the street plane; building footprints and the SfM facades are walls. Movement is damped, with no head bob.
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Raycaster, Vector2, Vector3, type Object3D } from 'three';
import { enuToThree, llhToEnu, threeToEnu, type Origin } from '../frame.ts';
import type { StreetGeometry } from './geometry.ts';
import type { FC } from '../../layers/useGeoLayers.ts';

type XY = [number, number];
type Seg = [number, number, number, number];
export interface Obstacles { polys: XY[][]; segs: Seg[] }

/** Walls to walk into: every footprint edge and the ground edge of each facade quad (quads run ground, ground, top, top). */
export function obstaclesFor(buildings: FC | null | undefined, origin: Origin | null, geo: StreetGeometry | null): Obstacles {
  const polys: XY[][] = [], segs: Seg[] = [];
  if (buildings && origin) for (const f of buildings.features) {
    const rings = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.map(p => p[0]) : [];
    for (const ring of rings as number[][][]) {
      const pts = ring.map(c => { const v = llhToEnu(origin, c[1], c[0], origin.height); return [v.x, v.y] as XY; });
      if (pts.length < 3) continue;
      polys.push(pts);
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; segs.push([a[0], a[1], b[0], b[1]]); }
    }
  }
  for (const fa of geo?.facades ?? []) for (const q of fa.quads) segs.push([q[0][0], q[0][1], q[1][0], q[1][1]]);
  return { polys, segs };
}

const inPoly = ([x, y]: XY, p: XY[]) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  return c;
};
const segDist = ([x, y]: XY, [ax, ay, bx, by]: Seg) => {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};
const R = 0.35; // body radius
/** A step from a to b is blocked when it enters a footprint or comes closer than R to a wall (moving away is always free). */
export function blocked(o: Obstacles, a: XY, b: XY) {
  for (const s of o.segs) { const db = segDist(b, s); if (db < R && db < segDist(a, s)) return true; }
  for (const p of o.polys) if (inPoly(b, p) && !inPoly(a, p)) return true;
  return false;
}

/** Shared between the 3D controls and the DOM overlay (touch joystick, look pad, buttons). */
export interface WalkInput {
  joy: Vector2; look: Vector2; up: number; speed: number;
  lock?: () => void; pickAt?: (ndcX: number, ndcY: number) => void;
  pose?: () => { pos: Vector3; quat: import('three').Quaternion }; // ENU eye position and three-world camera rotation
  gyro?: { yaw: number; pitch: number } | null; // absolute device look, radians
}
export const newWalkInput = (): WalkInput => ({ joy: new Vector2(), look: new Vector2(), up: 0, speed: 1 });

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);
const WALK_MPS = 1.4, RUN = 3;

export default function WalkControls({ gz, eye, fly, input, obstacles, editing, pickables, onPick }: {
  gz: (x: number, y: number) => number; eye: number; fly: boolean; input: WalkInput; obstacles: Obstacles;
  /** True while an object is selected and the mouse is free: WASD then belong to the gizmo shortcuts (arrows still walk). */
  editing: boolean;
  pickables: () => [bigint, Object3D][]; onPick: (id: bigint | null) => void;
}) {
  const { camera, gl } = useThree();
  const s = useRef({ yaw: 0, pitch: 0, vel: new Vector3(), keys: new Set<string>(), locked: false, gyro0: null as null | { yaw: number; pitch: number; at: { yaw: number; pitch: number } } });
  const live = useRef({ editing, fly, eye, onPick, pickables });
  live.current = { editing, fly, eye, onPick, pickables };

  // Start where the orbit camera was, looking the same way, at eye height.
  useEffect(() => {
    const d = threeToEnu(camera.getWorldDirection(new Vector3()));
    s.current.yaw = Math.atan2(d.x, d.y);
    s.current.pitch = Math.max(-0.6, Math.min(0.6, Math.asin(Math.max(-1, Math.min(1, d.z)))));
    const p = threeToEnu(camera.position);
    camera.position.copy(enuToThree({ x: p.x, y: p.y, z: gz(p.x, p.y) + live.current.eye }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = gl.domElement, st = s.current, ray = new Raycaster();
    const pick = (x: number, y: number) => {
      ray.setFromCamera(new Vector2(x, y), camera);
      let best: { id: bigint; d: number } | null = null;
      for (const [id, o] of live.current.pickables()) {
        const h = ray.intersectObject(o, true)[0];
        if (h && (!best || h.distance < best.d)) best = { id, d: h.distance };
      }
      live.current.onPick(best?.id ?? null);
    };
    input.lock = () => { if (matchMedia('(pointer: fine)').matches) void el.requestPointerLock?.(); };
    input.pickAt = pick;
    input.pose = () => ({ pos: threeToEnu(camera.position), quat: camera.quaternion.clone() });
    const typing = (e: Event) => !!(e.target as HTMLElement).closest?.('input, select, textarea, [contenteditable]');
    const kd = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.has(k) && live.current.editing && !st.locked) return;
      if (MOVE_KEYS.has(k) || k === ' ' || k.startsWith('arrow') || k === 'shift') { st.keys.add(k); if (k === ' ' || k.startsWith('arrow')) e.preventDefault(); }
    };
    const ku = (e: KeyboardEvent) => st.keys.delete(e.key.toLowerCase());
    const blur = () => st.keys.clear();
    const lockChange = () => { st.locked = document.pointerLockElement === el; };
    const mm = (e: MouseEvent) => { if (st.locked) { st.yaw += e.movementX * 0.0022; st.pitch = Math.max(-1.45, Math.min(1.45, st.pitch - e.movementY * 0.0022)); } };
    const md = (e: MouseEvent) => { if (st.locked && e.button === 0) pick(0, 0); }; // the crosshair picks while the mouse is captured
    const wheel = (e: WheelEvent) => { e.preventDefault(); input.speed = Math.max(0.25, Math.min(8, input.speed * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); };
    addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('blur', blur);
    document.addEventListener('pointerlockchange', lockChange); document.addEventListener('mousemove', mm); document.addEventListener('mousedown', md);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('blur', blur);
      document.removeEventListener('pointerlockchange', lockChange); document.removeEventListener('mousemove', mm); document.removeEventListener('mousedown', md);
      el.removeEventListener('wheel', wheel);
      if (document.pointerLockElement === el) document.exitPointerLock();
      input.lock = undefined; input.pickAt = undefined; input.pose = undefined;
    };
  }, [gl, camera, input]);

  useFrame((_, dtIn) => {
    const dt = Math.min(dtIn, 0.05), st = s.current, k = st.keys, { fly: flying, eye: eyeM } = live.current;
    // Touch look (pixels) and gyro look (absolute device angles, applied as changes since gyro was switched on).
    st.yaw += input.look.x * 0.005; st.pitch = Math.max(-1.45, Math.min(1.45, st.pitch - input.look.y * 0.005)); input.look.set(0, 0);
    if (input.gyro) {
      if (!st.gyro0) st.gyro0 = { ...input.gyro, at: { yaw: st.yaw, pitch: st.pitch } };
      st.yaw = st.gyro0.at.yaw + (input.gyro.yaw - st.gyro0.yaw);
      st.pitch = Math.max(-1.45, Math.min(1.45, st.gyro0.at.pitch + (input.gyro.pitch - st.gyro0.pitch)));
    } else st.gyro0 = null;
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) + input.joy.y;
    const r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + input.joy.x;
    const u = (k.has('e') || k.has(' ') ? 1 : 0) - (k.has('q') ? 1 : 0) + input.up;
    const speed = WALK_MPS * input.speed * (k.has('shift') ? RUN : 1);
    const fw = new Vector3(Math.sin(st.yaw), Math.cos(st.yaw), 0), rt = new Vector3(Math.cos(st.yaw), -Math.sin(st.yaw), 0);
    const want = fw.multiplyScalar(f).add(rt.multiplyScalar(r));
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(speed);
    want.z = flying ? u * speed : 0;
    st.vel.lerp(want, 1 - Math.exp(-dt * 9)); // damped start and stop
    const p = threeToEnu(camera.position);
    const a: XY = [p.x, p.y];
    let nx = p.x + st.vel.x * dt, ny = p.y + st.vel.y * dt;
    if (blocked(obstacles, a, [nx, ny])) { // slide along the wall: keep whichever axis is free
      if (!blocked(obstacles, a, [nx, p.y])) ny = p.y;
      else if (!blocked(obstacles, a, [p.x, ny])) nx = p.x;
      else { nx = p.x; ny = p.y; st.vel.x = st.vel.y = 0; }
    }
    const ground = gz(nx, ny);
    let nz = flying ? Math.max(ground + 0.3, p.z + st.vel.z * dt) : p.z + (ground + eyeM - p.z) * (1 - Math.exp(-dt * 12));
    if (!Number.isFinite(nz)) nz = ground + eyeM;
    camera.position.copy(enuToThree({ x: nx, y: ny, z: nz }));
    const cp = Math.cos(st.pitch);
    const look = enuToThree({ x: nx + Math.sin(st.yaw) * cp, y: ny + Math.cos(st.yaw) * cp, z: nz + Math.sin(st.pitch) });
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
  });
  return null;
}

/** The DOM side: help card, crosshair, the Walk bar, and on touch screens a joystick, a look pad, pinch height and gyro. */
export function WalkHud({ input, eye, setEye, fly, setFly, onStandHere, onExit, canStand }: {
  input: WalkInput; eye: number; setEye: (m: number) => void; fly: boolean; setFly: (v: boolean) => void;
  onStandHere: () => void; onExit: () => void; canStand: boolean;
}) {
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const [help, setHelp] = useState(() => { try { return !localStorage.getItem('studio/hint-walk'); } catch { return true; } });
  const [locked, setLocked] = useState(false);
  const [speed, setSpeed] = useState(input.speed);
  const [gyro, setGyro] = useState(false);
  useEffect(() => {
    const on = () => setLocked(!!document.pointerLockElement);
    const t = setInterval(() => setSpeed(input.speed), 250);
    document.addEventListener('pointerlockchange', on);
    return () => { document.removeEventListener('pointerlockchange', on); clearInterval(t); };
  }, [input]);
  const closeHelp = () => { setHelp(false); try { localStorage.setItem('studio/hint-walk', '1'); } catch { /* private mode */ } };

  // Gyro look: iOS asks for motion permission on a tap. Tuned for portrait, phone held upright (beta 90 is level).
  useEffect(() => {
    if (!gyro) { input.gyro = null; return; }
    const on = (e: DeviceOrientationEvent) => {
      if (e.alpha === null || e.beta === null) return;
      input.gyro = { yaw: (-e.alpha * Math.PI) / 180, pitch: ((e.beta - 90) * Math.PI) / 180 };
    };
    addEventListener('deviceorientation', on);
    return () => { removeEventListener('deviceorientation', on); input.gyro = null; };
  }, [gyro, input]);
  const toggleGyro = async () => {
    if (gyro) { setGyro(false); return; }
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    try { if (D.requestPermission && (await D.requestPermission()) !== 'granted') return; } catch { return; }
    setGyro(true);
  };

  // Touch: the joystick on the left, everything else looks; a short tap picks; two fingers pinch the eye height.
  const joy = useRef<{ id: number; x: number; y: number } | null>(null);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const pad = useRef<{ pts: Map<number, [number, number]>; start: Map<number, [number, number, number]>; pinch: number | null; eye0: number }>({ pts: new Map(), start: new Map(), pinch: null, eye0: eye });
  const JR = 52;
  const joyMove = (e: React.PointerEvent) => {
    if (!joy.current || e.pointerId !== joy.current.id) return;
    let dx = e.clientX - joy.current.x, dy = e.clientY - joy.current.y;
    const l = Math.hypot(dx, dy);
    if (l > JR) { dx *= JR / l; dy *= JR / l; }
    setKnob([dx, dy]); input.joy.set(dx / JR, -dy / JR);
  };
  const joyEnd = () => { joy.current = null; setKnob([0, 0]); input.joy.set(0, 0); };
  const padDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pad.current.pts.set(e.pointerId, [e.clientX, e.clientY]); pad.current.start.set(e.pointerId, [e.clientX, e.clientY, performance.now()]);
    if (pad.current.pts.size === 2) { const [a, b] = [...pad.current.pts.values()]; pad.current.pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); pad.current.eye0 = eye; }
  };
  const padMove = (e: React.PointerEvent) => {
    const p = pad.current, prev = p.pts.get(e.pointerId);
    if (!prev) return;
    p.pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (p.pts.size === 2 && p.pinch) { const [a, b] = [...p.pts.values()]; setEye(Math.max(0.3, Math.min(30, p.eye0 * (Math.hypot(a[0] - b[0], a[1] - b[1]) / p.pinch)))); return; }
    if (!gyro) input.look.add(new Vector2(e.clientX - prev[0], e.clientY - prev[1]));
  };
  const padUp = (e: React.PointerEvent) => {
    const p = pad.current, s0 = p.start.get(e.pointerId);
    p.pts.delete(e.pointerId); p.start.delete(e.pointerId);
    if (p.pts.size < 2) p.pinch = null;
    if (s0 && Math.hypot(e.clientX - s0[0], e.clientY - s0[1]) < 8 && performance.now() - s0[2] < 300) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      input.pickAt?.(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    }
  };

  return (
    <>
      {touch && (
        <>
          <div className="st-walk-pad" onPointerDown={padDown} onPointerMove={padMove} onPointerUp={padUp} onPointerCancel={padUp} aria-label="Drag to look around, pinch to change height" />
          <div className="st-walk-joy" aria-label="Move"
            onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); const r = e.currentTarget.getBoundingClientRect(); joy.current = { id: e.pointerId, x: r.left + r.width / 2, y: r.top + r.height / 2 }; joyMove(e); }}
            onPointerMove={joyMove} onPointerUp={joyEnd} onPointerCancel={joyEnd}>
            <i style={{ translate: `${knob[0]}px ${knob[1]}px` }} />
          </div>
        </>
      )}
      {locked && <div className="st-walk-cross" aria-hidden="true" />}
      <div className="st-walk-bar st-float" role="toolbar" aria-label="Walk">
        <span className="st-meta">Eye</span>
        <button className="st-icon-btn" onClick={() => setEye(Math.max(0.3, +(eye - 0.1).toFixed(1)))} aria-label="Lower the eye">−</button>
        <span className="mono">{eye.toFixed(1)} m</span>
        <button className="st-icon-btn" onClick={() => setEye(Math.min(30, +(eye + 0.1).toFixed(1)))} aria-label="Raise the eye">+</button>
        <div className="st-seg" role="group" aria-label="Gravity">
          <button aria-pressed={!fly} onClick={() => setFly(false)}>Walk</button>
          <button aria-pressed={fly} onClick={() => setFly(true)}>Fly</button>
        </div>
        <span className="st-meta mono">{speed.toFixed(speed < 1 ? 2 : 1)}×</span>
        {touch && <button className="st-btn small ghost" aria-pressed={gyro} onClick={() => void toggleGyro()}>Gyro</button>}
        {canStand && <button className="st-btn small" onClick={onStandHere}>Stand here as Cam A</button>}
        <button className="st-btn small ghost" onClick={onExit}>Done</button>
      </div>
      {help && (
        <div className="st-hint st-walk-help st-float" role="note">
          {touch
            ? <span>Left thumb walks. Drag anywhere else to look, pinch to change your eye height, tap a thing to select it.</span>
            : <span>Click empty space to look around with the mouse. <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows walk, <kbd>Shift</kbd> runs, <kbd>E</kbd> up and <kbd>Q</kbd> down fly, the wheel sets the speed. <kbd>Esc</kbd> frees the mouse, again to stop.</span>}
          <button className="st-btn small" onClick={closeHelp}>Got it</button>
        </div>
      )}
    </>
  );
}
