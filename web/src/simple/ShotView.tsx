// Simple's 3D view: the spot's world (Google tiles, display only) and every scene_object of the shared set, seen through
// the shot camera, under the user's photo with a blend. Built from the studio's world pieces (Tiles, ObjectNode, the street
// geometry) and its render-layer function, so a friend here and a photographer in Studio see and render the same set.
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import { Group, Object3D, Vector3, type PerspectiveCamera as PCam, type Quaternion } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import type { SceneObject } from '../module_bindings/types.ts';
import Tiles, { tilesRef } from '../studio/world/Tiles.tsx';
import { ObjectNode } from '../studio/world/SceneObjects.tsx';
import { ENU_TO_THREE, type Origin } from '../studio/frame.ts';
import { facadeGeometry, groundGeometry, occluderGeometry, type StreetGeometry } from '../studio/world/geometry.ts';
import { sunVector } from '../studio/light/sun.ts';
import type { Optics } from '../studio/camera/shot.ts';
import type { Layers } from '../studio/render/layers.ts';

export interface ShotViewProps {
  mapsKey: string;
  origin: Origin;
  geo: StreetGeometry | null;
  gz: (x: number, y: number) => number;
  cam: { pos: Vector3; q: Quaternion }; // the shot camera, east-north-up metres from the spot
  optics: Optics;
  rows: readonly SceneObject[];
  shotId: bigint | null;
  sun: { azimuth: number; altitude: number };
  expo: number;
  photo: { url: string; width: number; height: number };
  photoScale: number; // current lens / solved lens: above 1 the photo is an exact crop, below 1 the world shows around it
  blend: number; // 0 shows the 3D world, 1 the photo
  selected: bigint | null;
  onSelect: (id: bigint | null) => void;
  capture: MutableRefObject<(() => Promise<Layers>) | null>;
  live: boolean; // false unmounts the canvas (the view is hidden behind Studio)
  children?: ReactNode; // overlays inside the stage
}

export default function ShotView(p: ShotViewProps) {
  const cell = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [attribution, setAttribution] = useState('');
  useEffect(() => {
    const el = cell.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The frame (photo and 3D together) covers the stage, centred, so both crop the same way and stay aligned.
  const ar = p.photo.width / p.photo.height || 0.75;
  const fw = box.w / box.h > ar ? box.w : box.h * ar;
  const fh = fw / ar;
  return (
    <div className="sv" ref={cell}>
      {box.w > 0 && (
        <div className="sv-frame" style={{ width: fw, height: fh, left: (box.w - fw) / 2, top: (box.h - fh) / 2 }}>
          {p.live && <World {...p} onAttribution={setAttribution} />}
          <img className="sv-photo" src={p.photo.url} alt="" style={{ opacity: p.blend, transform: `scale(${p.photoScale})` }} />
        </div>
      )}
      <div className="sv-scrim" aria-hidden="true" />
      {p.children}
      {p.blend < 0.98 && (
        <p className="sv-credit">
          <img src="/studio/attribution/google-maps-logo.svg" alt="Google Maps" width={73} height={16} />
          <span>{attribution || 'Google'}</span>
        </p>
      )}
    </div>
  );
}

// The studio's render step hides the tiles through the tilesRef singleton. Our own Tiles instance would take that slot,
// so after it mounts we hand the slot back to the studio's instance if one is alive; our capture hides our tiles itself.
let foreignTiles: TilesRenderer | null = null;
function OwnTiles(props: Parameters<typeof Tiles>[0] & { wrap: MutableRefObject<Group | null> }) {
  const { wrap, ...rest } = props;
  const cur = tilesRef.current;
  if (cur && cur.group.parent && cur.group.parent !== wrap.current) foreignTiles = cur;
  useLayoutEffect(() => {
    if (foreignTiles && foreignTiles !== tilesRef.current && foreignTiles.group.parent) tilesRef.current = foreignTiles;
  });
  return <group ref={wrap}><Tiles {...rest} /></group>;
}

function World(p: ShotViewProps & { onAttribution: (s: string) => void }) {
  const tilesWrap = useRef<Group | null>(null);
  const groups = useRef(new Map<bigint, Group>());
  const register = (id: bigint, g: Group | null) => { if (g) groups.current.set(id, g); else groups.current.delete(id); };
  const probes = useMemo(() => [{ x: 0, y: 0 }, { x: p.cam.pos.x, y: p.cam.pos.y }], [p.cam.pos.x, p.cam.pos.y]);
  // Light the set around the point 12 m in front of the camera (camera forward is its local -Z), as the studio does.
  const fwd = new Vector3(0, 0, -1).applyQuaternion(p.cam.q).setZ(0).normalize();
  const tx = p.cam.pos.x + fwd.x * 12, ty = p.cam.pos.y + fwd.y * 12, tz = p.gz(tx, ty);
  const sd = sunVector(p.sun.azimuth, Math.max(p.sun.altitude, 4));
  const target = useMemo(() => new Object3D(), []);
  const sunUp = p.sun.altitude > -2;
  return (
    <Canvas className="sv-canvas" shadows gl={{ antialias: true, alpha: true }} dpr={[1, 2]}
      onPointerMissed={e => { if (e.type === 'click') p.onSelect(null); }}>
      <hemisphereLight args={['#dfe7f5', '#4d463c', sunUp ? 0.9 : 1.2]} />
      <group rotation={ENU_TO_THREE}>
        <group position={p.cam.pos} quaternion={p.cam.q}>
          <PerspectiveCamera makeDefault fov={p.optics.vfovDeg} near={0.1} far={20000} />
        </group>
        <OwnTiles wrap={tilesWrap} apiKey={p.mapsKey} origin={p.origin} probes={probes} visible groundAt={p.gz} onAttribution={p.onAttribution} />
        <primitive object={target} position={[tx, ty, tz]} />
        {sunUp && (
          <directionalLight target={target} position={[tx + sd[0] * 80, ty + sd[1] * 80, tz + sd[2] * 80]} intensity={2.2} castShadow
            shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-camera-left={-30} shadow-camera-right={30}
            shadow-camera-top={30} shadow-camera-bottom={-30} shadow-camera-near={1} shadow-camera-far={200} />
        )}
        <Catchers geo={p.geo} />
        {p.rows.map(r => (
          <Suspense key={String(r.id)} fallback={null}>
            <ObjectNode row={r} selected={r.id === p.selected} lockedBy={null} dragging={false} expo={p.expo} optics={p.optics}
              isShot={r.id === p.shotId} lookingThrough focusM={8} camName="Cam A" showLabels={false}
              onSelect={id => p.onSelect(id)} register={register} />
          </Suspense>
        ))}
      </group>
      <Capture capture={p.capture} vfovDeg={p.optics.vfovDeg} frame={{ w: p.photo.width, h: p.photo.height }}
        hide={() => (tilesWrap.current ? [tilesWrap.current] : [])}
        objects={() => p.rows.filter(r => r.visible && r.kind !== 'camera' && r.kind !== 'light' && groups.current.get(r.id))
          .map(r => ({ id: r.id, name: r.name, kind: r.kind, root: groups.current.get(r.id)! }))} />
    </Canvas>
  );
}

/** Shadow catchers on our own street geometry, and depth-only occluders so people behind a facade are hidden. */
function Catchers({ geo }: { geo: StreetGeometry | null }) {
  const ground = useMemo(() => (geo ? groundGeometry(geo) : null), [geo]);
  const walls = useMemo(() => (geo ? facadeGeometry(geo) : null), [geo]);
  const occ = useMemo(() => (geo ? occluderGeometry(geo) : null), [geo]);
  const mat = <shadowMaterial transparent opacity={0.45} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} side={2} />;
  return (
    <>
      {ground
        ? <mesh geometry={ground} receiveShadow userData={{ ground: true, catcher: true }} renderOrder={2}>{mat}</mesh>
        : <mesh position={[0, 0, 0.01]} receiveShadow userData={{ ground: true, catcher: true }} renderOrder={2}><planeGeometry args={[3000, 3000]} />{mat}</mesh>}
      {walls && <mesh geometry={walls} receiveShadow userData={{ catcher: true, wall: true }} renderOrder={2}>{mat}</mesh>}
      {occ && <mesh geometry={occ} renderOrder={-1} userData={{ occluder: true }} raycast={() => null}><meshBasicMaterial colorWrite={false} side={2} /></mesh>}
    </>
  );
}

function Capture({ capture, vfovDeg, frame, hide, objects }: {
  capture: MutableRefObject<(() => Promise<Layers>) | null>; vfovDeg: number; frame: { w: number; h: number };
  hide: () => Object3D[]; objects: () => { id: bigint; name: string; kind: string; root: Object3D }[];
}) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    capture.current = async () => {
      const { renderLayers } = await import('../studio/render/layers.ts');
      // Layers carry only the user's objects: our tiles are hidden here, helpers and the studio's own tiles by renderLayers.
      return renderLayers({ gl, scene, camera: camera as PCam, vfovDeg, width: frame.w, height: frame.h, hide: hide(), objects: objects() });
    };
    return () => { capture.current = null; };
  });
  return null;
}
