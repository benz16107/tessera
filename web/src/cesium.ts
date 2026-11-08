// Cesium helpers: viewer setup with Google Photorealistic 3D Tiles, and pose <-> camera per CONTRACTS.md.
import {
  Viewer, Cartographic, Cartesian3, Cartesian2, Math as CMath, PerspectiveFrustum, Ion,
  createGooglePhotorealistic3DTileset, Cesium3DTileset, Color,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { Pose } from './module_bindings/types.ts';
import { frustumFor } from './geo.ts';

Ion.defaultAccessToken = ''; // no Cesium ion: tiles come straight from Google with the session's key

export interface Scene { viewer: Viewer; tileset: Promise<Cesium3DTileset | null> }

export function createScene(el: HTMLElement, mapsKey: string): Scene {
  const viewer = new Viewer(el, {
    globe: false,
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    requestRenderMode: false,
  });
  if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
  viewer.scene.backgroundColor = Color.fromCssColorString('#b4c2cf'); // flat sky: the atmosphere does not draw without a globe
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
  viewer.camera.percentageChanged = 0.002;
  // A dropped request on a flaky network should not leave the view blank, so retry the tileset a few times.
  const load = async (): Promise<Cesium3DTileset | null> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const t = await createGooglePhotorealistic3DTileset({ key: mapsKey, onlyUsingWithGoogleGeocoder: true }, { showCreditsOnScreen: true, maximumScreenSpaceError: 16 });
        if (viewer.isDestroyed()) return null;
        viewer.scene.primitives.add(t);
        return t;
      } catch (e) {
        console.error('Google 3D tiles failed', e);
        if (viewer.isDestroyed()) return null;
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    return null;
  };
  const tileset = load();
  return { viewer, tileset };
}

const groundCache = new Map<string, number>();
const gkey = (lat: number, lon: number) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

/** Ellipsoid height of the 3D tiles surface at lat/lon (cached per ~1 m). */
export async function groundAt(viewer: Viewer, lat: number, lon: number): Promise<number | undefined> {
  const k = gkey(lat, lon);
  const hit = groundCache.get(k);
  if (hit !== undefined) return hit;
  try {
    const [c] = await viewer.scene.sampleHeightMostDetailed([Cartographic.fromDegrees(lon, lat)]);
    if (c && Number.isFinite(c.height)) { groundCache.set(k, c.height); return c.height; }
  } catch { /* tiles not ready */ }
  return undefined;
}

/** Last ground height we resolved, used when a fresh sample is not available yet. */
let lastGround = 0;

/** Set frustum from f35 for an image w x h. Cesium's fov is the larger dimension's angle. */
export function setLens(viewer: Viewer, f35: number, w: number, h: number) {
  const f = viewer.camera.frustum;
  if (!(f instanceof PerspectiveFrustum)) return;
  const v = frustumFor(f35, w, h);
  f.fov = v.fov;
  f.aspectRatio = v.aspectRatio;
}

/** Move the camera to a module Pose. alt is above ground, so resolve the ground first. */
export async function applyPose(viewer: Viewer, pose: Pose, w: number, h: number, fly = false) {
  const g = (await groundAt(viewer, pose.lat, pose.lon)) ?? lastGround;
  lastGround = g;
  if (viewer.isDestroyed()) return;
  const destination = Cartesian3.fromDegrees(pose.lon, pose.lat, g + pose.alt);
  const orientation = { heading: CMath.toRadians(pose.heading), pitch: CMath.toRadians(pose.pitch), roll: CMath.toRadians(pose.roll) };
  setLens(viewer, pose.f35, w, h);
  if (fly && !matchMedia('(prefers-reduced-motion: reduce)').matches) viewer.camera.flyTo({ destination, orientation, duration: 1.2 });
  else viewer.camera.setView({ destination, orientation });
}

/** Read the current camera as a module Pose (alt above the ground under the camera). */
export function readPose(viewer: Viewer, f35: number): Pose {
  const c = viewer.camera;
  const carto = c.positionCartographic;
  const lat = CMath.toDegrees(carto.latitude), lon = CMath.toDegrees(carto.longitude);
  const cached = groundCache.get(gkey(lat, lon));
  let g = cached ?? viewer.scene.sampleHeight(Cartographic.fromDegrees(lon, lat));
  if (g === undefined || !Number.isFinite(g)) { g = lastGround; void groundAt(viewer, lat, lon); }
  else lastGround = g;
  return {
    lat, lon, alt: carto.height - g,
    heading: CMath.toDegrees(c.heading), pitch: CMath.toDegrees(c.pitch), roll: CMath.toDegrees(c.roll), f35,
  };
}

/** Overview of a spot: look at it from 250 m out, 120 m up. */
export function flyToSpot(viewer: Viewer, lat: number, lon: number) {
  const destination = Cartesian3.fromDegrees(lon, lat - 0.0022, 260);
  const orientation = { heading: 0, pitch: CMath.toRadians(-30), roll: 0 };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) viewer.camera.setView({ destination, orientation });
  else viewer.camera.flyTo({ destination, orientation, duration: 1.6 });
}

/** Lat/lon on the 3D tiles under a canvas pixel, if any. */
export function pickLatLon(viewer: Viewer, x: number, y: number) {
  const p = viewer.scene.pickPosition(new Cartesian2(x, y));
  if (!p) return null;
  const c = Cartographic.fromCartesian(p);
  return { lat: CMath.toDegrees(c.latitude), lon: CMath.toDegrees(c.longitude) };
}
