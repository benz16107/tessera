// Live collaboration in the set through web/src/spacetime's useSetEvents (SpacetimeDB event table, never stored):
// other people's cursors on the ground, laser pings ("Maya is pointing here"), and this client's view sent while
// someone follows it. Points are east-north-up metres, the same frame as scene_object rows.
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Identity } from 'spacetimedb';
import { enuToThree, threeToEnu } from '../frame.ts';
import { useSpacetimeMod, usePhotonMod } from '../slots.tsx';

export interface Pt { x: number; y: number; z: number }
export interface SetEv {
  cursors: Map<string, Pt & { name: string; color: string }>;
  pings: (Pt & { name: string; color: string; key: number; at: number })[];
  followers: Set<string>;
  views: Map<string, { eye: Pt; target: Pt; name: string; at: number }>; // the views people send while followed
  following: string | null; // whom this client follows (identity hex), shared with the presence bar
  cursor(p: Pt): void;
  ping(p: Pt, objectId?: bigint): Promise<void>;
  view(eye: Pt, target: Pt): Promise<void>;
}
type UseSetEvents = (sessionId: bigint, me?: Identity) => SetEv;

/** Runs the hook outside the canvas (it needs the SpacetimeDB React context) and lifts its state up. */
function Bridge({ hook, sessionId, me, onChange }: { hook: UseSetEvents; sessionId: bigint; me?: Identity; onChange: (e: SetEv) => void }) {
  const ev = hook(sessionId, me);
  // The hook returns a fresh object each render; lift it only when its state or senders change (no render loop).
  useEffect(() => { onChange(ev); }, [ev.cursors, ev.pings, ev.followers, ev.views, ev.following, ev.cursor, onChange]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function SetEventsBridge(p: { sessionId: bigint; me?: Identity; onChange: (e: SetEv) => void }) {
  const mod = useSpacetimeMod();
  const hook = mod?.useSetEvents as UseSetEvents | undefined;
  return hook ? <Bridge hook={hook} {...p} /> : null;
}

/** Presence heartbeat, always on (spacetime usePresence beats every 10 s while the tab is visible), so the People list
 *  means "here now" even when nobody has the People drawer open. */
type UsePresence = (sessionId: bigint, focusObjectId?: bigint | null) => unknown;
function PresenceBeatInner({ hook, sessionId, focus }: { hook: UsePresence; sessionId: bigint; focus: bigint | null }) { hook(sessionId, focus); return null; }
export function PresenceBeat(p: { sessionId: bigint; focus: bigint | null }) {
  const hook = useSpacetimeMod()?.usePresence as UsePresence | undefined;
  return hook ? <PresenceBeatInner hook={hook} {...p} /> : null;
}

/** Inside the east-north-up group: remote cursors and pings. */
export function SetEventMarks({ ev }: { ev: SetEv | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t); }, []);
  if (!ev) return null;
  return (
    <group userData={{ helper: true }}>
      {[...ev.cursors.entries()].map(([k, c]) => (
        <group key={k} position={[c.x, c.y, c.z + 0.05]}>
          <mesh rotation={[0, 0, 0]}><ringGeometry args={[0.25, 0.34, 32]} /><meshBasicMaterial color={c.color} toneMapped={false} /></mesh>
          <Html position={[0, 0, 0.4]} center className="st-cursor-tag" style={{ ['--who' as string]: c.color }}>{c.name}</Html>
        </group>
      ))}
      {ev.pings.map(p => {
        const t = Math.min(1, (now - p.at) / 1200);
        return (
          <group key={p.key} position={[p.x, p.y, p.z + 0.06]}>
            <mesh scale={0.4 + t * 2.2}><ringGeometry args={[0.8, 1, 48]} /><meshBasicMaterial color={p.color} transparent opacity={1 - t} toneMapped={false} depthWrite={false} /></mesh>
            <mesh position={[0, 0, 1.5]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.03, 0.03, 3, 8]} /><meshBasicMaterial color={p.color} toneMapped={false} /></mesh>
            <Html position={[0, 0, 3.2]} center className="st-ping-tag" style={{ ['--who' as string]: p.color }}>{p.name} is pointing here</Html>
          </group>
        );
      })}
    </group>
  );
}

/** While anyone follows this client, send the editor camera's eye and target about 10 times a second. */
export function ViewBroadcaster({ ev }: { ev: SetEv | null }) {
  const { camera, controls } = useThree();
  const last = useRef(0);
  useFrame(() => {
    if (!ev || ev.followers.size === 0) return;
    const now = performance.now();
    if (now - last.current < 100) return;
    last.current = now;
    const target = (controls as unknown as { target?: import('three').Vector3 } | null)?.target;
    const eye = threeToEnu(camera.position), tgt = target ? threeToEnu(target) : eye;
    ev.view({ x: eye.x, y: eye.y, z: eye.z }, { x: tgt.x, y: tgt.y, z: tgt.z }).catch(() => {});
  });
  return null;
}

/** While following someone: ease this camera and its orbit target toward the view they send (about 10 Hz). */
export function FollowCamera({ ev }: { ev: SetEv | null }) {
  const { camera, controls } = useThree();
  useFrame((_, dt) => {
    const v = ev?.following ? ev.views.get(ev.following) : undefined;
    if (!v) return;
    const k = 1 - Math.exp(-dt * 10);
    camera.position.lerp(enuToThree(v.eye), k);
    const c = controls as unknown as { target?: import('three').Vector3; update?: () => void } | null;
    if (c?.target) { c.target.lerp(enuToThree(v.target), k); c.update?.(); } else camera.lookAt(enuToThree(v.target));
  });
  return null;
}

/** Photon check-ins: the hook runs outside the canvas (SpacetimeDB context); the marks render inside the ENU group. */
type UseCheckins = (sessionId: bigint) => unknown[];
function CheckinBridgeInner({ hook, sessionId, onChange }: { hook: UseCheckins; sessionId: bigint; onChange: (rows: unknown[]) => void }) {
  const rows = hook(sessionId);
  useEffect(() => { onChange(rows); }, [rows, onChange]);
  return null;
}
export function CheckinBridge({ sessionId, onChange }: { sessionId: bigint; onChange: (rows: unknown[]) => void }) {
  const mod = usePhotonMod();
  const hook = mod?.useCheckins as UseCheckins | undefined;
  return hook ? <CheckinBridgeInner hook={hook} sessionId={sessionId} onChange={onChange} /> : null;
}
export function CheckinMarksSlot({ rows }: { rows: unknown[] }) {
  const mod = usePhotonMod();
  const Marks = mod?.CheckinMarks as ((p: { rows: unknown[] }) => JSX.Element) | undefined;
  return Marks && rows.length ? <Marks rows={rows} /> : null;
}
