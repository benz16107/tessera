// Google Photorealistic 3D Tiles inside the east-north-up group, for display and editing only.
// Policy (Map Tiles API terms, BUILD.md): tile pixels and geometry never reach a render, an export, an AI step or an object
// placement. Objects snap to our own ground plane (z = 0) and our own objects. Two reads of tile geometry, both for display
// and navigation only, nothing stored: the alignment below, which moves the tiles so their street sits on z = 0, and
// `tileGroundAt`, which keeps a walking eye above the ground.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CompressedTexture, LinearMipmapLinearFilter, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector3, type Camera } from 'three';
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

export default function Tiles({ apiKey, origin, probes, visible, extraCamera, onAttribution, onGround, groundAt, contextOnly }: Props) {
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
    });
    t.group.matrixAutoUpdate = false;
    tilesRef.current = t;
    return t;
  }, [apiKey, gl]);
  useEffect(() => () => { tiles.dispose(); if (tilesRef.current === tiles) tilesRef.current = null; }, [tiles]);

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
        const hits = ray.intersectObject(tiles.group, true);
        if (!hits.length) continue;
        const z = hits[hits.length - 1].point.clone().applyMatrix4(enu.matrixWorld.clone().invert()).z - (groundAt?.(p.x, p.y) ?? 0);
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
