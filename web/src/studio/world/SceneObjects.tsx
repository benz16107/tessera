// Draws every scene_object row: catalog props and generated GLBs fitted to real size, posed mannequins, lights by type,
// cameras as frustums with depth-of-field planes, text as labels. Helper meshes carry userData.helper so the render
// layers can hide them. Everything here lives inside the east-north-up group.
import { Component, Suspense, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line, useGLTF, useTexture } from '@react-three/drei';
import { AnimationMixer, Box3, BoxGeometry, CanvasTexture, EdgesGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, SRGBColorSpace, Vector3, type Object3DEventMap } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { SceneObject } from '../../module_bindings/types.ts';
import { GLTF_UPRIGHT } from '../frame.ts';
import { propById } from '../catalog/props.ts';
import { kelvinToRgb } from '../optics.ts';
import { parseParams, num } from '../scene/objects.ts';
import type { Optics } from '../camera/shot.ts';

RectAreaLightUniformsLib.init();
const DRACO = '/studio/draco/';
const MANNEQUIN = '/studio/people/mannequin.glb';
const MANNEQUIN_H = 1.83; // metres, measured from the GLB's bounds

export const kelvinHex = (k: number) => {
  const [r, g, b] = kelvinToRgb(k);
  return '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
};
export const propUrl = (row: SceneObject) => row.kind === 'prop_generated' ? row.assetId : `/studio/props/${row.assetId}.glb`;

class Fallback extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const Placeholder = ({ h = 1, color = '#6b655b' }: { h?: number; color?: string }) => (
  <mesh position={[0, 0, h / 2]} castShadow><boxGeometry args={[0.5, 0.5, h]} /><meshStandardMaterial color={color} wireframe /></mesh>
);

/** A GLB scaled so its height (or longer horizontal side) matches a real size, standing on z = 0, front facing north. */
/** Real-world size of each object as drawn (east, north, up extents in metres), for the inspector and contact shadows. */
export const objectSizes = new Map<bigint, [number, number, number]>();

function FittedModel({ url, fit, onSize }: { url: string; fit: ['height' | 'length', number]; onSize?: (s: [number, number, number]) => void }) {
  const { scene } = useGLTF(url, DRACO);
  const { obj, k, off, dims } = useMemo(() => {
    const obj = scene.clone(true);
    obj.traverse(o => { if ((o as Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const box = new Box3().setFromObject(obj), size = box.getSize(new Vector3()), c = box.getCenter(new Vector3());
    const dim = fit[0] === 'height' ? size.y : Math.max(size.x, size.z);
    const k = dim > 0 ? fit[1] / dim : 1;
    return { obj, k, off: [-c.x * k, -box.min.y * k, -c.z * k] as [number, number, number], dims: [size.x * k, size.z * k, size.y * k] as [number, number, number] };
  }, [scene, fit[0], fit[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { onSize?.(dims); }, [dims]); // eslint-disable-line react-hooks/exhaustive-deps
  return <group quaternion={GLTF_UPRIGHT}><group position={off} scale={k}><primitive object={obj} /></group></group>;
}

// A soft dark ellipse under feet and wheels: the contact shadow a sun shadow map is too coarse to draw.
let blobTex: CanvasTexture | null = null;
const blobTexture = () => {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.45, 'rgba(0,0,0,0.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return (blobTex = new CanvasTexture(c));
};
export function ContactShadow({ w, d, opacity = 0.6 }: { w: number; d: number; opacity?: number }) {
  return (
    <mesh position={[0, 0, 0.012]} scale={[w * 1.25, d * 1.25, 1]} userData={{ contact: true }} renderOrder={12} raycast={() => null}>
      <planeGeometry />
      <meshBasicMaterial map={blobTexture()} color="#000" transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** "Place as image": a flat print standing on its bottom edge, facing the object's front (local +Y). */
function ImagePlane({ url, w, h }: { url: string; w: number; h: number }) {
  const tex = useTexture(url);
  tex.colorSpace = SRGBColorSpace;
  return (
    <group quaternion={GLTF_UPRIGHT}>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={tex} side={2} roughness={0.85} />
      </mesh>
    </group>
  );
}

const CLIP_AT: Record<string, number> = { walk: 0.3, jump: 0.45, push: 0.4 }; // fraction of the clip that reads best as a still

function Person({ pose, height }: { pose: string; height: number }) {
  const { scene, animations } = useGLTF(MANNEQUIN, DRACO);
  const obj = useMemo(() => {
    const o = cloneSkinned(scene);
    o.traverse(m => {
      if ((m as Mesh).isMesh) {
        m.castShadow = true; m.receiveShadow = true;
        const mesh = m as Mesh;
        mesh.material = (mesh.material as MeshStandardMaterial).clone();
        mesh.frustumCulled = false; // skinned bounds do not follow the pose
      }
    });
    return o;
  }, [scene]);
  useLayoutEffect(() => {
    const clip = animations.find(a => a.name === (pose === 'lean' ? 'stand' : pose)) ?? animations[0];
    if (!clip) return;
    const mixer = new AnimationMixer(obj);
    mixer.clipAction(clip).play();
    mixer.setTime(clip.duration * (CLIP_AT[pose] ?? 0.1)); // a still pose, not a loop: this is a photo set
    return () => { mixer.stopAllAction(); mixer.uncacheRoot(obj); };
  }, [obj, animations, pose]);
  const k = height / MANNEQUIN_H;
  return (
    <group rotation={[pose === 'lean' ? -0.17 : 0, 0, 0]} scale={k}>
      <group quaternion={GLTF_UPRIGHT}><primitive object={obj} /></group>
    </group>
  );
}

/** Lights aim along their local +Y. Physical units scaled by the viewport's metered exposure (`expo`). */
function Light({ row, expo, selected }: { row: SceneObject; expo: number; selected: boolean }) {
  const p = parseParams(row.params);
  const color = kelvinHex(num(p, 'k', 5500));
  const size = num(p, 'size', 0.3), shadows = p.shadows === '1';
  const target = useMemo(() => { const o = new Object3D(); o.position.set(0, 10, 0); return o; }, []);
  const i = row.intensity * expo;
  const helperMat = <meshBasicMaterial color={selected ? '#e8a33d' : color} toneMapped={false} />;
  return (
    <>
      <primitive object={target} />
      {row.lightType === 'point' && <pointLight color={color} intensity={i} distance={0} decay={2} castShadow={shadows} shadow-mapSize={[512, 512]} />}
      {row.lightType === 'spot' && <spotLight color={color} intensity={i} angle={0.5} penumbra={Math.min(1, size * 2)} decay={2} target={target} castShadow={shadows} shadow-mapSize={[1024, 1024]} shadow-radius={4} shadow-bias={-0.0005} />}
      {row.lightType === 'sun' && <directionalLight color={color} intensity={i} target={target} castShadow={shadows} shadow-camera-left={-25} shadow-camera-right={25} shadow-camera-top={25} shadow-camera-bottom={-25} shadow-mapSize={[2048, 2048]} />}
      {row.lightType === 'area' && <rectAreaLight color={color} intensity={i} width={size} height={size} rotation={[Math.PI / 2, 0, 0]} />}
      <group userData={{ helper: true }}>
        {row.lightType === 'area'
          ? <mesh rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[size, size]} />{helperMat}</mesh>
          : <mesh><sphereGeometry args={[0.12, 16, 12]} />{helperMat}</mesh>}
        {row.lightType !== 'point' && <Line points={[[0, 0, 0], [0, 1.2, 0]]} color={selected ? '#e8a33d' : '#d8cdb4'} lineWidth={1.5} />}
      </group>
    </>
  );
}

/** Frustum of a camera row (looks down local -Z) with the depth-of-field near and far planes and the focus plane. */
export function CameraGizmo({ o, selected, isShot, focusM }: { o: Optics; selected: boolean; isShot: boolean; focusM: number }) {
  const tx = Math.tan((o.hfovDeg * Math.PI) / 360), ty = Math.tan((o.vfovDeg * Math.PI) / 360);
  const rect = (d: number): [number, number, number][] => [[-tx * d, -ty * d, -d], [tx * d, -ty * d, -d], [tx * d, ty * d, -d], [-tx * d, ty * d, -d], [-tx * d, -ty * d, -d]];
  const L = 3;
  const c = selected ? '#f2a33a' : isShot ? '#e9e2d3' : '#8f877a';
  const near = Math.min(o.dof.nearM, 80), far = Math.min(o.dof.farM, 80), focus = Math.min(focusM, 80);
  return (
    <group userData={{ helper: true }}>
      <Line points={rect(L)} color={c} lineWidth={1.5} />
      {[0, 1, 2, 3].map(i => <Line key={i} points={[[0, 0, 0], rect(L)[i]]} color={c} lineWidth={1} />)}
      <Line points={[[-tx * L * 0.3, ty * L * 1.08, -L], [0, ty * L * 1.3, -L], [tx * L * 0.3, ty * L * 1.08, -L]]} color={c} lineWidth={1.5} />
      <mesh position={[0, 0, 0.12]}><boxGeometry args={[0.24, 0.16, 0.2]} /><meshBasicMaterial color={c} /></mesh>
      {isShot && (
        <>
          <Line points={rect(focus)} color="#f2efe8" lineWidth={1} dashed dashSize={0.3} gapSize={0.2} transparent opacity={0.6} />
          {[near, far].map((d, i) => (
            <mesh key={i} position={[0, 0, -d]}>
              <planeGeometry args={[2 * tx * d, 2 * ty * d]} />
              <meshBasicMaterial color="#f2efe8" transparent opacity={0.05} depthWrite={false} side={2} />
            </mesh>
          ))}
          {[near, far].map((d, i) => <Line key={`l${i}`} points={rect(d)} color="#f2efe8" lineWidth={0.75} transparent opacity={0.35} />)}
        </>
      )}
    </group>
  );
}

export interface NodeProps {
  row: SceneObject;
  selected: boolean;
  lockedBy: string | null; // another editor's name while they hold the gizmo
  lockColor?: string;
  camName: string;
  showLabels: boolean;
  dragging: boolean;
  expo: number;
  optics: Optics;
  isShot: boolean;
  lookingThrough: boolean;
  focusM: number;
  onSelect: (id: bigint, point: Vector3, alt: boolean) => void;
  register: (id: bigint, g: Group | null) => void;
}

export function ObjectNode(p: NodeProps) {
  const { row } = p;
  const ref = useRef<Group>(null);
  const prm = parseParams(row.params);
  // Rows drive the transform, except while this client drags the object (the gizmo owns it then).
  useLayoutEffect(() => {
    const g = ref.current;
    if (!g || p.dragging) return;
    g.position.set(row.x, row.y, row.z);
    g.quaternion.copy(new Quaternion(row.qx, row.qy, row.qz, row.qw).normalize());
    g.scale.setScalar(row.scale);
  }, [row.x, row.y, row.z, row.qx, row.qy, row.qz, row.qw, row.scale, p.dragging]);
  useLayoutEffect(() => { p.register(row.id, ref.current); return () => p.register(row.id, null); }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [size, setSize] = useState<[number, number, number] | null>(null);
  const onSize = (d: [number, number, number]) => { objectSizes.set(row.id, d); setSize(d); };
  let body: ReactNode;
  let foot: [number, number] | null = null;
  if (row.kind === 'person') {
    const h = num(prm, 'height', 1.75);
    body = <Person pose={prm.pose ?? 'stand'} height={h} />;
    foot = prm.pose === 'sit' ? [0.55, 0.6] : [0.5, 0.36];
    if (!objectSizes.has(row.id)) objectSizes.set(row.id, [0.5, 0.3, h]);
  } else if (row.kind === 'model') {
    const spec = propById(row.assetId);
    body = <FittedModel url={propUrl(row)} fit={spec?.fit ?? ['height', 1]} onSize={onSize} />;
    foot = size ? [size[0], size[1]] : null;
  } else if (row.kind === 'prop_generated' && prm.type === 'image') {
    const w = num(prm, 'w', 1), h = num(prm, 'h', 1);
    body = <ImagePlane url={row.assetId} w={w} h={h} />;
    objectSizes.set(row.id, [w, 0.01, h]);
  } else if (row.kind === 'prop_generated') {
    body = <FittedModel url={propUrl(row)} fit={['height', num(prm, 'h', 1)]} onSize={onSize} />;
    foot = size ? [size[0], size[1]] : null;
  } else if (row.kind === 'light') body = <Light row={row} expo={p.expo} selected={p.selected} />;
  else if (row.kind === 'camera') body = p.isShot && p.lookingThrough ? null : <CameraGizmo o={p.optics} selected={p.selected} isShot={p.isShot} focusM={p.focusM} />;
  else body = <Html center className="studio-text-obj">{row.name}</Html>;
  const label = row.kind === 'light' ? `${row.name.split(' ')[0]} · ${num(prm, 'k', 5500)} K`
    : row.kind === 'camera' && !(p.isShot && p.lookingThrough) ? `${p.camName} · ${Math.round(p.optics.f35)} mm` : null;

  return (
    <group ref={ref} visible={row.visible} userData={{ objectId: row.id }}
      onClick={e => { e.stopPropagation(); p.onSelect(row.id, e.point, e.nativeEvent.altKey); }}>
      <Fallback fallback={<Placeholder color="#a3301b" />}>
        <Suspense fallback={<Placeholder />}>{body}</Suspense>
      </Fallback>
      {foot && row.visible && <ContactShadow w={foot[0]} d={foot[1]} />}
      {label && p.showLabels && <Html position={row.kind === 'camera' ? [0, -0.38, 0] : [0, 0, 0.45]} center zIndexRange={[10, 0]}><span className={`st-obj-label${row.kind === 'camera' ? ' cam' : ''}`}>{label}</span></Html>}
      {p.lockedBy && (
        <Html position={[0, 0, 2.2]} center zIndexRange={[20, 0]}><span className="st-lock-tag" style={{ ['--c' as string]: p.lockColor }}>{p.lockedBy} is moving {row.name}</span></Html>
      )}
    </group>
  );
}

/** Amber box around the selected object, drawn in world space every frame so it follows drags and remote moves. */
export function SelectionBox({ target }: { target: Object3D<Object3DEventMap> | null }) {
  const ref = useRef<Group>(null);
  const box = useMemo(() => new Box3(), []);
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), []);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.visible = !!target;
    if (!target) return;
    box.setFromObject(target, true);
    if (box.isEmpty()) { g.visible = false; return; }
    box.getCenter(g.position);
    box.getSize(g.scale).max(new Vector3(0.05, 0.05, 0.05));
  });
  return (
    <group ref={ref} userData={{ helper: true }}>
      <lineSegments geometry={edges} raycast={() => null}>
        <lineBasicMaterial color="#e8a33d" />
      </lineSegments>
    </group>
  );
}

useGLTF.preload(MANNEQUIN, DRACO);
