// Google Photorealistic 3D Tiles inside the east-north-up group, for display and editing only.
// Policy (Map Tiles API terms, BUILD.md): tile pixels and geometry never reach a render, an export, an AI step or an object
// placement. Objects snap to our own ground plane (z = 0) and our own objects. Two reads of tile geometry, both for display
// and navigation only, nothing stored: the alignment below, which moves the tiles so their street sits on z = 0, and
// `tileGroundAt`, which keeps a walking eye above the ground.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, Color, CompressedTexture, LinearMipmapLinearFilter, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, Raycaster, Vector3, type Camera, type Material } from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin, GLTFExtensionsPlugin, TileCompressionPlugin, TilesFadePlugin } from '3d-tiles-renderer/plugins';
import { enuFrame, type Origin } from '../frame.ts';

interface Props {
  apiKey: string;
  origin: Origin; // spot lat/lon, height 0 on the ellipsoid; the ground offset is found below
  probes: { x: number; y: number }[]; // east-north points known to be on the street (spot centre, shot camera)
  visible: boolean;
  extraCamera?: Camera | null; // the shot camera, so tiles refine for the look-through view too
  onAttribution: (text: string) => void;
  onGround?: (offsetM: number) => void;
  groundAt?: (x: number, y: number) => number; // our street geometry's ground height; tiles are moved to match it
  contextOnly?: boolean; // the splat is the set: show tiles only when the camera is far from the spot
  /** 'live': relit by the scene's sun and sky, casting and receiving its shadows; 'captured' (default): Google's photos as shot. */
  light?: 'live' | 'captured';
  /** Put the tile meshes on this layer too (world/Atmosphere.tsx lights that layer in post). */
  postLitLayer?: number;
}

/** Live sun for the tiles. Google's meshes are unlit photogrammetry (daylight baked into the textures) without normals, so
 *  each one gets a flat-shaded Lambert copy: the face normal comes from screen-space derivatives (three's flatShading), and
 *  the light is texture x (sky + sun x N.L x shadow), with the sky term the floor that keeps the photo texture readable.
 *  The studio sets the sky colour and the sun's weight each frame (light/sun.ts daylight). */
export const TILE_LIGHT = { tileSky: { value: new Color(0.62, 0.62, 0.62) }, tileSunK: { value: 0.6 } };

function litMaterial(base: MeshBasicMaterial): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ map: base.map, color: base.color, transparent: base.transparent, opacity: base.opacity, side: base.side, alphaTest: base.alphaTest, flatShading: true });
  m.onBeforeCompile = sh => {
    sh.uniforms.tileSky = TILE_LIGHT.tileSky; sh.uniforms.tileSunK = TILE_LIGHT.tileSunK;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 tileSky;\nuniform float tileSunK;')
      // directDiffuse is the sun (with its shadow) and any placed lights; the scene's sky lights are tuned for objects.
      .replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
        'vec3 outgoingLight = diffuseColor.rgb * tileSky + reflectedLight.directDiffuse * tileSunK;');
  };
  m.customProgramCacheKey = () => 'tile-live-sun';
  return m;
}

/** Swap every tile mesh under `root` to the live or the captured material (creating the live one on first use). */
function applyLight(root: { traverse: (f: (o: unknown) => void) => void }, live: boolean) {
  root.traverse(o => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const u = mesh.userData as { captured?: Material; lit?: Material };
    if (!u.captured) {
      if (!(mesh.material instanceof MeshBasicMaterial)) return;
      u.captured = mesh.material;
    }
    if (live && !u.lit) {
      const g = mesh.geometry;
      // Shadow bias reads a vertex normal; the lighting itself uses face normals, so a constant one is enough.
      if (!g.getAttribute('normal')) { const n = new Float32Array(g.getAttribute('position').count * 3); for (let i = 2; i < n.length; i += 3) n[i] = 1; g.setAttribute('normal', new BufferAttribute(n, 3)); }
      u.lit = litMaterial(u.captured as MeshBasicMaterial);
    }
    mesh.material = (live ? u.lit : u.captured)!;
    mesh.castShadow = mesh.receiveShadow = live;
  });
}

export const tilesRef: { current: TilesRenderer | null } = { current: null };

const groundRay = new Raycaster();
/** Navigation only (Walk's eye height): the first tile surface below (x, y) from `fromZ`, in the east-north-up frame.
 *  Never stored, never used for placement, export, render or AI (Map Tiles API terms). */
export function tileGroundAt(x: number, y: number, fromZ: number): number | null {
  const t = tilesRef.current, enu = t?.group.parent;
  if (!t || !enu || !t.group.visible || t.visibleTiles.size === 0) return null;
  const from = new Vector3(x, y, fromZ).applyMatrix4(enu.matrixWorld);
  groundRay.set(from, new Vector3(0, 0, -1).transformDirection(enu.matrixWorld));
  groundRay.far = 600;
  const hit = groundRay.intersectObject(t.group, true)[0];
  return hit ? hit.point.applyMatrix4(enu.matrixWorld.clone().invert()).z : null;
}

export default function Tiles({ apiKey, origin, probes, visible, extraCamera, onAttribution, onGround, groundAt, contextOnly, light = 'captured', postLitLayer }: Props) {
  const liveRef = useRef(light === 'live');
  liveRef.current = light === 'live';
  const layerRef = useRef(postLitLayer);
  layerRef.current = postLitLayer;
  const { camera, gl } = useThree();
  const ground = useRef<number | null>(null);

  const tiles = useMemo(() => {
    const t = new TilesRenderer();
    // Refine buildings to 4 screen pixels instead of the renderer's 16-pixel default.
    t.errorTarget = 4;
    const draco = new DRACOLoader().setDecoderPath('/studio/draco/');
    t.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
    t.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    t.registerPlugin(new TileCompressionPlugin({ disableMipmaps: false }));
    t.registerPlugin(new TilesFadePlugin());
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    t.addEventListener('load-model', ({ scene }) => {
      scene.traverse(object => {
        if (!(object instanceof Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!(material instanceof MeshBasicMaterial || material instanceof MeshStandardMaterial) || !material.map) continue;
          // Keep facade and street textures legible when viewed at oblique angles.
          if (!(material.map instanceof CompressedTexture)) {
            material.map.generateMipmaps = true;
            material.map.minFilter = LinearMipmapLinearFilter;
          }
          material.map.anisotropy = anisotropy;
          material.map.needsUpdate = true;
        }
      });
      if (liveRef.current) applyLight(scene, true);
      if (layerRef.current !== undefined) scene.traverse(o => o.layers.enable(layerRef.current!));
    });
    t.group.matrixAutoUpdate = false;
    tilesRef.current = t;
    return t;
  }, [apiKey, gl]);
  useEffect(() => () => { tiles.dispose(); if (tilesRef.current === tiles) tilesRef.current = null; }, [tiles]);
  useEffect(() => { applyLight(tiles.group, light === 'live'); }, [tiles, light]);
  useEffect(() => {
    if (postLitLayer === undefined) return;
    tiles.group.traverse(o => o.layers.enable(postLitLayer));
    return () => tiles.group.traverse(o => o.layers.disable(postLitLayer));
  }, [tiles, postLitLayer]);

  // ECEF -> local east-north-up of the spot, then down by the ground offset.
  const place = (offset: number) => {
    tiles.group.matrix.copy(new Matrix4().makeTranslation(0, 0, -offset).multiply(enuFrame(origin).invert()));
    tiles.group.matrixWorldNeedsUpdate = true;
  };
  useEffect(() => { ground.current = null; place(0); }, [tiles, origin.lat, origin.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Display alignment: the lowest surface under the probe points is the street. Re-checked while tiles refine.
  useEffect(() => {
    const ray = new Raycaster();
    const align = () => {
      const enu = tiles.group.parent;
      if (!enu || tiles.visibleTiles.size === 0) return;
      enu.updateMatrixWorld(true);
      let best: number | null = null;
      for (const p of probes) {
        const from = new Vector3(p.x, p.y, 400).applyMatrix4(enu.matrixWorld);
        const down = new Vector3(0, 0, -1).transformDirection(enu.matrixWorld);
        ray.set(from, down);
        ray.far = 2000; // the street, never the far side of a coarse globe tile while the city is still loading
        const hits = ray.intersectObject(tiles.group, true);
        if (!hits.length) continue;
        const z = hits[hits.length - 1].point.clone().applyMatrix4(enu.matrixWorld.clone().invert()).z - (groundAt?.(p.x, p.y) ?? 0);
        if (Math.abs(z) > 1500) continue; // a probe through a half-loaded tile
        best = best === null ? z : Math.min(best, z);
      }
      if (best === null) return;
      const offset = (ground.current ?? 0) + best;
      if (ground.current === null || Math.abs(best) > 0.05) { ground.current = offset; place(offset); onGround?.(offset); }
    };
    const id = window.setInterval(align, 1500);
    const stop = window.setTimeout(() => clearInterval(id), 45_000);
    return () => { clearInterval(id); clearTimeout(stop); };
  }, [tiles, probes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = window.setInterval(() => {
      const a = tiles.getAttributions().filter(x => x.type === 'string').map(x => String(x.value)).join(' ');
      onAttribution(tiles.group.visible && tiles.visibleTiles.size > 0 ? a || 'Google' : '');
    }, 1000);
    return () => clearInterval(id);
  }, [tiles, visible, onAttribution]);

  useFrame(() => {
    if (contextOnly) {
      const cam = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
      tiles.group.visible = visible && cam.position.length() > 140; // beyond the splat's reach
    } else tiles.group.visible = visible;
    if (!tiles.group.visible) return;
    const cam = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
    // Finer tiles as the camera comes down: 2 px of error at street level, 4 px over the block, 8 px from high up.
    const h = cam.position.y; // the frame's z = 0 is the street, and three's y is up
    tiles.errorTarget = h < 80 ? 2 : h < 400 ? 4 : 8;
    tiles.setCamera(cam);
    tiles.setResolutionFromRenderer(cam, gl);
    if (extraCamera && extraCamera !== cam) { tiles.setCamera(extraCamera); tiles.setResolutionFromRenderer(extraCamera, gl); }
    for (const c of [...tiles.cameras]) if (c !== cam && c !== extraCamera) tiles.deleteCamera(c);
    cam.updateMatrixWorld();
    tiles.update();
  });

  return <primitive object={tiles.group} />;
}
