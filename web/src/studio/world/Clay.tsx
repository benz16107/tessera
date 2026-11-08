// "Clay" world: a crisp massing model, like Blender's solid viewport. NYC building footprints extruded to their roof
// heights (the geo layers' buildings layer), the street plane and the SfM facades from geometry.json, matte clay with
// edge lines and the sun's shadows. With `projector`, the user's photo is projected from its solved pose onto every
// surface that pose sees (VFX camera projection); a depth map from the projector keeps it off hidden surfaces, and the
// sky and bridge land on a far matte where the photo hits no clay. Our own data and photo, so no attribution limits.
// The group is a helper: picture-in-picture, the render layers and the photo look-through skip it.
import { useEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BufferGeometry, DepthTexture, EdgesGeometry, Euler, ExtrudeGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, PerspectiveCamera, Quaternion, Scene, Shape, SRGBColorSpace, TextureLoader, Vector2, Vector3, WebGLRenderTarget,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ENU_TO_THREE, enuToThree, llhToEnu, type Origin } from '../frame.ts';
import { facadeGeometry, type StreetGeometry } from './geometry.ts';
import type { FC } from '../../layers/useGeoLayers.ts';

type Gz = (x: number, y: number) => number;
export interface Projector { url: string; pos: Vector3; quat: Quaternion; vfovDeg: number; aspect: number } // ENU pose, camera looks down -Z

const GROUND_R = 700, MATTE_M = 900, NEAR = 1, FAR = 2500;

function buildingGeometry(fc: FC, origin: Origin, gz: Gz) {
  const parts: BufferGeometry[] = [];
  for (const f of fc.features) {
    const h = Number(f.properties.height_m) || 0;
    const rings = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.map(p => p[0]) : [];
    for (const ring of rings as number[][][]) {
      const pts = ring.map(c => { const v = llhToEnu(origin, c[1], c[0], origin.height); return new Vector2(v.x, v.y); });
      if (pts.length < 4 || h <= 0) continue;
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const g = new ExtrudeGeometry(new Shape(pts), { depth: h + 1, bevelEnabled: false });
      g.translate(0, 0, gz(cx, cy) - 1);
      parts.push(g.index ? g.toNonIndexed() : g);
    }
  }
  const m = parts.length ? mergeGeometries(parts, false) : null;
  m?.computeVertexNormals();
  return m;
}

/** The street plane, 1.4 km across: one quad, since the plane is flat (it may slope). */
function groundQuad(gz: Gz) {
  const c = [[-GROUND_R, -GROUND_R], [GROUND_R, -GROUND_R], [GROUND_R, GROUND_R], [-GROUND_R, -GROUND_R], [GROUND_R, GROUND_R], [-GROUND_R, GROUND_R]];
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(c.flatMap(([x, y]) => [x, y, gz(x, y)]), 3));
  g.computeVertexNormals();
  return g;
}

/** Clay that shows the projected photo where the projector sees it. `matte`: show only the photo (sky and bridge), else discard. */
function projectedMaterial(color: string, lift: string, matte: boolean) {
  const u = {
    uProjTex: { value: null as Texture | null }, uProjDepth: { value: null as Texture | null }, uProjMat: { value: new Matrix4() },
    uProjPos: { value: new Vector3() }, uProjOn: { value: 0 }, uFade: { value: 1 },
  };
  // Lambert, not Standard: the scene's image light comes from the photo and tints standard clay purple-brown.
  const mat = matte ? new MeshBasicMaterial({ color: '#000', toneMapped: false })
    : new MeshLambertMaterial({ color, emissive: lift, side: 2, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }) // double-sided like the projector's depth map, or a wall facing away hides what the camera sees;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uProjMat;\nvarying vec4 vProj;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vec4 wp = modelMatrix * vec4(transformed, 1.0);
vProj = uProjMat * wp;
vWPos = wp.xyz;
vWNrm = ${matte ? 'vec3(0.0, 1.0, 0.0)' : 'normalize(mat3(modelMatrix) * objectNormal)'};`); // MeshBasicMaterial has no objectNormal
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uProjTex; uniform sampler2D uProjDepth; uniform vec3 uProjPos; uniform float uProjOn; uniform float uFade;
varying vec4 vProj; varying vec3 vWPos; varying vec3 vWNrm;
float projLinear(float d) { float z = d * 2.0 - 1.0; return 2.0 * ${NEAR.toFixed(1)} * ${FAR.toFixed(1)} / (${FAR.toFixed(1)} + ${NEAR.toFixed(1)} - z * (${FAR.toFixed(1)} - ${NEAR.toFixed(1)})); }`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
{
  vec3 ndc = vProj.xyz / vProj.w;
  vec2 puv = ndc.xy * 0.5 + 0.5;
  vec2 e = min(puv, 1.0 - puv);
  float inside = vProj.w > 0.0 ? smoothstep(0.0, 0.004, min(e.x, e.y)) : 0.0;
  // The farthest of five depth samples: at a depth edge the 1024 px map would otherwise hide a sliver of a visible wall.
  vec2 tx = vec2(1.5 / 1024.0, 1.5 / 1365.0);
  float stored = max(max(texture2D(uProjDepth, puv).r, texture2D(uProjDepth, puv + vec2(tx.x, 0.0)).r),
    max(max(texture2D(uProjDepth, puv - vec2(tx.x, 0.0)).r, texture2D(uProjDepth, puv + vec2(0.0, tx.y)).r), texture2D(uProjDepth, puv - vec2(0.0, tx.y)).r));
  ${matte
    ? 'float vis = inside * step(0.9999, stored);'
    : `float dz = projLinear(ndc.z * 0.5 + 0.5);
  float vis = inside * step(dz, projLinear(stored) * 1.01 + 0.15);
  vec3 toP = normalize(uProjPos - vWPos);
  vis *= mix(1.0, smoothstep(0.0, 0.04, dot(normalize(vWNrm), toP)), uFade); // the street is always grazing from 1 m up: keep it`}
  vis *= uProjOn;
  vec4 photo = linearToOutputTexel(vec4(texture2D(uProjTex, puv).rgb, 1.0));
  ${matte ? 'if (vis < 0.01) discard;\n  gl_FragColor = vec4(photo.rgb, 1.0);' : 'gl_FragColor.rgb = mix(gl_FragColor.rgb, photo.rgb, vis);'}
}`);
  };
  return { mat, u };
}

export default function Clay({ buildings, geo, origin, gz, projector, plate = false, onReady }: {
  buildings: FC | null; geo: StreetGeometry | null; origin: Origin; gz: Gz; projector: Projector | null;
  /** The photo backplate of Through Cam A: the projection is the picture (every surface the photo saw shows it, however
   *  grazing), so the camera chain (crop, depth of field, exposure) acts on the photo itself. Not a helper. */
  plate?: boolean;
  onReady?: (ready: boolean) => void; // the photo texture is loaded
}) {
  const { gl } = useThree();
  const bGeom = useMemo(() => (buildings ? buildingGeometry(buildings, origin, gz) : null), [buildings, origin.lat, origin.lon, gz]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges = useMemo(() => (bGeom ? new EdgesGeometry(bGeom, 25) : null), [bGeom]);
  const ground = useMemo(() => groundQuad(gz), [gz]);
  const facades = useMemo(() => (geo ? facadeGeometry(geo) : null), [geo]);
  useEffect(() => () => { bGeom?.dispose(); edges?.dispose(); }, [bGeom, edges]);

  const mats = useMemo(() => ({ building: projectedMaterial('#d9d4ca', '#3b3833', false), ground: projectedMaterial('#9f998e', '#26241f', false), matte: projectedMaterial('', '', true) }), []);
  const all = [mats.building, mats.ground, mats.matte];
  useEffect(() => () => all.forEach(m => m.mat.dispose()), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [tex, setTex] = useState<Texture | null>(null);
  useEffect(() => {
    if (!projector?.url) { setTex(null); return; }
    let live = true;
    new TextureLoader().load(projector.url, t => { t.colorSpace = SRGBColorSpace; if (live) setTex(t); else t.dispose(); });
    return () => { live = false; };
  }, [projector?.url]);
  useEffect(() => () => tex?.dispose(), [tex]);

  // The projector's camera (three world) and its depth map over the clay: which surfaces the photo actually saw.
  const proj = useMemo(() => {
    if (!projector) return null;
    const cam = new PerspectiveCamera(projector.vfovDeg, projector.aspect, NEAR, FAR);
    cam.position.copy(enuToThree(projector.pos));
    cam.quaternion.copy(new Quaternion().setFromEuler(new Euler(...ENU_TO_THREE)).multiply(projector.quat));
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    return cam;
  }, [projector?.pos.x, projector?.pos.y, projector?.pos.z, projector?.quat.x, projector?.quat.y, projector?.quat.z, projector?.quat.w, projector?.vfovDeg, projector?.aspect]); // eslint-disable-line react-hooks/exhaustive-deps
  const rt = useMemo(() => {
    const t = new WebGLRenderTarget(1024, Math.round(1024 / (projector?.aspect || 0.75)));
    t.depthTexture = new DepthTexture(t.width, t.height);
    return t;
  }, [projector?.aspect]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => rt.dispose(), [rt]);
  useEffect(() => {
    if (!proj) return;
    const s = new Scene(), g = new Group(), m = new MeshBasicMaterial({ colorWrite: false, side: 2 });
    g.rotation.set(...ENU_TO_THREE);
    for (const geom of [bGeom, ground, facades]) if (geom) g.add(new Mesh(geom, m));
    s.add(g);
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(rt); gl.clear(); gl.render(s, proj); gl.setRenderTarget(prev);
    m.dispose();
  }, [proj, rt, bGeom, ground, facades, gl]);

  // Uniforms: shared projector state on every clay material.
  const projMat = useMemo(() => (proj ? new Matrix4().multiplyMatrices(proj.projectionMatrix, proj.matrixWorldInverse) : new Matrix4()), [proj]);
  for (const { u } of all) {
    u.uProjTex.value = tex; u.uProjDepth.value = rt.depthTexture; u.uProjMat.value = projMat;
    if (proj) u.uProjPos.value.copy(proj.position);
    u.uProjOn.value = proj && tex ? 1 : 0;
    u.uFade.value = plate ? 0 : 1;
  }
  useEffect(() => { onReady?.(!!(proj && tex)); }, [proj, tex]); // eslint-disable-line react-hooks/exhaustive-deps

  // The far matte: a quad across the projector's frustum, MATTE_M out, carrying the sky and the bridge.
  const matte = useMemo(() => {
    if (!projector) return null;
    const h = Math.tan((projector.vfovDeg * Math.PI) / 360) * MATTE_M, w = h * projector.aspect;
    const g = new BufferGeometry();
    const c = [[-w, -h], [w, -h], [w, h], [-w, -h], [w, h], [-w, h]].map(([x, y]) => new Vector3(x * 1.02, y * 1.02, -MATTE_M).applyQuaternion(projector.quat).add(projector.pos));
    g.setAttribute('position', new Float32BufferAttribute(c.flatMap(v => [v.x, v.y, v.z]), 3));
    return g;
  }, [projector?.pos.x, projector?.pos.y, projector?.pos.z, projector?.quat.w, projector?.vfovDeg, projector?.aspect]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <group userData={plate ? { plate: true } : { helper: true, clay: true }}>
      <mesh geometry={ground} material={mats.ground.mat} receiveShadow raycast={() => null} />
      {bGeom && <mesh geometry={bGeom} material={mats.building.mat} castShadow={!plate} receiveShadow raycast={() => null} />}
      {facades && <mesh geometry={facades} material={mats.building.mat} castShadow={!plate} receiveShadow raycast={() => null} />}
      {edges && !plate && <lineSegments geometry={edges} raycast={() => null}><lineBasicMaterial color="#26231f" transparent opacity={0.6} /></lineSegments>}
      {matte && tex && <mesh geometry={matte} material={mats.matte.mat} raycast={() => null} />}
    </group>
  );
}
