// Simple's 3D view through the shot camera. It opens on the user's photo with every object of the shared set composited
// over it (people, props, their shadows on the street). The blend slider reveals the spot's world under the photo: the
// spot's Gaussian splat when it exists (our own data), else Google's tiles (display only, with Google's credit). Built
// from the studio's world pieces and render-layer function, so Simple and Studio see and render the same set.
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import {
  Group, Mesh, MeshBasicMaterial, Object3D, OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace, TextureLoader, Vector3,
  type PerspectiveCamera as PCam, type Quaternion, type Texture,
} from 'three';
import { SparkRenderer } from '@sparkjsdev/spark';
import type { TilesRenderer } from '3d-tiles-renderer';
import type { SceneObject } from '../module_bindings/types.ts';
import Tiles, { tilesRef } from '../studio/world/Tiles.tsx';
import Splat, { useSplatUrl, sparkRef, splatRef } from '../studio/world/Splat.tsx';
import { ObjectNode } from '../studio/world/SceneObjects.tsx';
import { ENU_TO_THREE, type Origin } from '../studio/frame.ts';
import { facadeGeometry, groundGeometry, occluderGeometry, SPLATS, type StreetGeometry } from '../studio/world/geometry.ts';
import { sunVector } from '../studio/light/sun.ts';
import type { Optics } from '../studio/camera/shot.ts';
import type { Layers } from '../studio/render/layers.ts';

export interface ShotViewProps {
  mapsKey: string;
  origin: Origin;
  spotId: string;
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

type Credit = { tiles: string; splat: boolean };

export default function ShotView(p: ShotViewProps) {
  const cell = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [credit, setCredit] = useState<Credit>({ tiles: '', splat: false });
  // The world loads the first time someone reveals it, so a quick look at the answer costs no tiles or splat download.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { if (p.blend < 0.99) setRevealed(true); }, [p.blend]);
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
  const worldShown = revealed && (p.blend < 0.98 || p.photoScale < 0.995);
  return (
    <div className="sv" ref={cell}>
      {/* Behind a lens wider than the photo, before the world is revealed: a soft copy of the photo, not grey bars. */}
      <img className="sv-backdrop" src={p.photo.url} alt="" aria-hidden="true" />
      {box.w > 0 && (
        <div className="sv-frame" style={{ width: fw, height: fh, left: (box.w - fw) / 2, top: (box.h - fh) / 2 }}>
          {/* Paints at once and stays under the canvas; the canvas draws the same photo at the blend between its passes. */}
          <img className="sv-photo" src={p.photo.url} alt="" style={{ transform: `scale(${p.photoScale})` }} />
          {p.live && <World {...p} world={revealed} onCredit={setCredit} />}
        </div>
      )}
      <div className="sv-scrim" aria-hidden="true" />
      {p.children}
      {worldShown && (credit.tiles || credit.splat) && (
        <p className="sv-credit">
          {credit.tiles && <><img src="/studio/attribution/google-maps-logo.svg" alt="Google Maps" width={73} height={16} /><span>{credit.tiles}</span></>}
          {!credit.tiles && credit.splat && <span>{SPLATS[p.spotId]?.credit}</span>}
        </p>
      )}
    </div>
  );
}

const hasScene = (o: Object3D | null | undefined, scene: Object3D) => { for (let x = o; x; x = x.parent) if (x === scene) return true; return false; };
const attached = (o: Object3D | null | undefined) => !!o?.parent;

// The studio's render step hides its world through module singletons (tilesRef, sparkRef, splatRef). Our own Tiles and
// Splat would take those slots, so once ours mount we hand each slot back to the studio's live instance; our own render
// and capture hide our world through our own wrapper group instead.
const foreign: { tiles: TilesRenderer | null; spark: SparkRenderer | null; splat: Object3D | null } = { tiles: null, spark: null, splat: null };
function OwnWorld({ children }: { children: ReactNode }) {
  const { scene } = useThree();
  const t = tilesRef.current, s = sparkRef.current, m = splatRef.current;
  if (t && attached(t.group) && !hasScene(t.group, scene)) foreign.tiles = t;
  if (s && attached(s) && !hasScene(s, scene)) foreign.spark = s;
  if (m && attached(m) && !hasScene(m, scene)) foreign.splat = m;
  const restore = () => {
    if (foreign.tiles && attached(foreign.tiles.group) && tilesRef.current !== foreign.tiles) tilesRef.current = foreign.tiles;
    if (foreign.spark && attached(foreign.spark) && sparkRef.current !== foreign.spark) sparkRef.current = foreign.spark;
    if (foreign.splat && attached(foreign.splat) && splatRef.current !== foreign.splat) splatRef.current = foreign.splat as typeof splatRef.current;
  };
  useLayoutEffect(restore); // tiles take the slot while rendering
  useEffect(restore); // Spark takes its slots in an effect, which runs before this parent's
  return <>{children}</>;
}

function World(p: ShotViewProps & { world: boolean; onCredit: (c: Credit) => void }) {
  const worldWrap = useRef<Group | null>(null);
  const objWrap = useRef<Group | null>(null);
  const groups = useRef(new Map<bigint, Group>());
  const register = (id: bigint, g: Group | null) => { if (g) groups.current.set(id, g); else groups.current.delete(id); };
  const probes = useMemo(() => [{ x: 0, y: 0 }, { x: p.cam.pos.x, y: p.cam.pos.y }], [p.cam.pos.x, p.cam.pos.y]);
  const [badSplats, setBadSplats] = useState<string[]>([]);
  const splatUrl = useSplatUrl(p.spotId, false, badSplats); // a file Spark can't parse moves on to the next one
  const [splatLoaded, setSplatLoaded] = useState(false);
  const [tilesText, setTilesText] = useState('');
  const { onCredit } = p;
  useEffect(() => { onCredit({ tiles: tilesText, splat: splatLoaded }); }, [tilesText, splatLoaded, onCredit]);
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
        <group ref={worldWrap}>
          {p.world && (
            <OwnWorld>
              <Tiles apiKey={p.mapsKey} origin={p.origin} probes={probes} visible contextOnly={splatLoaded} groundAt={p.gz} onAttribution={setTilesText} />
              {splatUrl && <Splat spotId={p.spotId} url={splatUrl} visible onLoaded={() => setSplatLoaded(true)} onError={() => { setSplatLoaded(false); setBadSplats(b => [...b, splatUrl]); }} />}
            </OwnWorld>
          )}
        </group>
        <primitive object={target} position={[tx, ty, tz]} />
        {sunUp && (
          <directionalLight target={target} position={[tx + sd[0] * 80, ty + sd[1] * 80, tz + sd[2] * 80]} intensity={2.2} castShadow
            shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-camera-left={-30} shadow-camera-right={30}
            shadow-camera-top={30} shadow-camera-bottom={-30} shadow-camera-near={1} shadow-camera-far={200} />
        )}
        <group ref={objWrap}>
          <Catchers geo={p.geo} />
          {p.rows.map(r => (
            <Suspense key={String(r.id)} fallback={null}>
              <ObjectNode row={r} selected={r.id === p.selected} lockedBy={null} dragging={false} expo={p.expo} optics={p.optics}
                isShot={r.id === p.shotId} lookingThrough focusM={8} camName="Cam A" showLabels={false}
                onSelect={id => p.onSelect(id)} register={register} />
            </Suspense>
          ))}
        </group>
      </group>
      <Composite world={worldWrap} objects={objWrap} photoUrl={p.photo.url} scale={p.photoScale} blend={p.blend} />
      <Capture capture={p.capture} vfovDeg={p.optics.vfovDeg} frame={{ w: p.photo.width, h: p.photo.height }}
        hide={scene => [...(worldWrap.current ? [worldWrap.current] : []), ...scene.children.filter(c => c instanceof SparkRenderer)]}
        objects={() => p.rows.filter(r => r.visible && r.kind !== 'camera' && r.kind !== 'light' && groups.current.get(r.id))
          .map(r => ({ id: r.id, name: r.name, kind: r.kind, root: groups.current.get(r.id)! }))} />
    </Canvas>
  );
}

/** Three passes into one canvas: the world, the photo at the blend, then the set's objects and shadows on top of both. */
function Composite({ world, objects, photoUrl, scale, blend }: {
  world: MutableRefObject<Group | null>; objects: MutableRefObject<Group | null>; photoUrl: string; scale: number; blend: number;
}) {
  const [tex, setTex] = useState<Texture | null>(null);
  useEffect(() => {
    let live = true;
    new TextureLoader().load(photoUrl, t => { t.colorSpace = SRGBColorSpace; if (live) setTex(t); else t.dispose(); });
    return () => { live = false; };
  }, [photoUrl]);
  useEffect(() => () => tex?.dispose(), [tex]);
  const photo = useMemo(() => {
    const scene = new Scene();
    const mat = new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const quad = new Mesh(new PlaneGeometry(2, 2), mat);
    scene.add(quad);
    return { scene, quad, mat, cam: new OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }, []);
  useFrame(({ gl, scene, camera }) => {
    const w = world.current, o = objects.current;
    if (!w || !o) return;
    const sparks = scene.children.filter(c => c instanceof SparkRenderer);
    gl.autoClear = false;
    gl.clear();
    if (blend < 0.995 || scale < 0.995) { o.visible = false; gl.render(scene, camera); o.visible = true; }
    if (tex && blend > 0.005) {
      if (photo.mat.map !== tex) { photo.mat.map = tex; photo.mat.needsUpdate = true; }
      photo.mat.opacity = blend;
      photo.quad.scale.set(scale, scale, 1);
      gl.render(photo.scene, photo.cam);
    }
    gl.clearDepth();
    w.visible = false; sparks.forEach(s => (s.visible = false));
    gl.render(scene, camera);
    w.visible = true; sparks.forEach(s => (s.visible = true));
  }, 1);
  return null;
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
  hide: (scene: Scene) => Object3D[]; objects: () => { id: bigint; name: string; kind: string; root: Object3D }[];
}) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    capture.current = async () => {
      const { renderLayers } = await import('../studio/render/layers.ts');
      // Layers carry only the user's objects: our tiles and splat are hidden here, editor helpers by renderLayers.
      return renderLayers({ gl, scene, camera: camera as PCam, vfovDeg, width: frame.w, height: frame.h, hide: hide(scene), objects: objects() });
    };
    return () => { capture.current = null; };
  });
  return null;
}
