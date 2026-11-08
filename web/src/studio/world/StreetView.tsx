// Google Street View as a Through Cam A backplate, through the Map Tiles API (the key the 3D tiles already use): a session
// with mapType streetview, the nearest pano id, its metadata, then equirect tiles stitched onto an inside-out sphere that
// follows the camera, drawn first with no depth, so placed objects and any lens draw over it.
// Display only, like the 3D tiles: userData.helper keeps it out of every render layer, and nothing here goes to a model.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, DoubleSide, MeshBasicMaterial, SRGBColorSpace, Vector3, type Mesh } from 'three';

const API = 'https://tile.googleapis.com/v1';
const json = (r: Response) => (r.ok ? r.json() : Promise.reject(new Error(`Street View ${r.status}`)));
let session: Promise<string> | null = null;
const getSession = (key: string) => (session ??= fetch(`${API}/createSession?key=${key}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapType: 'streetview', language: 'en-US', region: 'US' }),
}).then(json).then(j => j.session as string).catch(e => { session = null; throw e; }));

export interface Pano { id: string; session: string; key: string; heading: number; w: number; h: number; tile: number; copyright: string; date: string }

/** The nearest Street View pano within `radius` metres: undefined while looking, null when there is none (or no API). */
export function usePano(key: string | undefined, at: { lat: number; lon: number } | null, radius = 15): Pano | null | undefined {
  const [pano, setPano] = useState<Pano | null | undefined>(undefined);
  const lat = at?.lat.toFixed(5), lon = at?.lon.toFixed(5);
  useEffect(() => {
    if (!key || !lat || !lon) { setPano(null); return; }
    let live = true;
    (async () => {
      const s = await getSession(key);
      const ids = await fetch(`${API}/streetview/panoIds?session=${s}&key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locations: [{ lat: +lat, lng: +lon }], radius }),
      }).then(json);
      const id: string = ids.panoIds?.[0] ?? '';
      if (!id) return null;
      const m = await fetch(`${API}/streetview/metadata?session=${s}&key=${key}&panoId=${encodeURIComponent(id)}`).then(json);
      return { id, session: s, key, heading: m.heading ?? 0, w: m.imageWidth, h: m.imageHeight, tile: m.tileWidth ?? 512, copyright: m.copyright ?? '', date: m.date ?? '' };
    })().then(p => { if (live) setPano(p); }, () => { if (live) setPano(null); });
    return () => { live = false; };
  }, [key, lat, lon, radius]);
  return pano;
}

/** One zoom level of the pano as a cropped equirect canvas (the full size is at the highest zoom). */
async function stitch(p: Pano, z: number, zmax: number) {
  const w = Math.round(p.w / 2 ** (zmax - z)), h = Math.round(p.h / 2 ** (zmax - z));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const jobs: Promise<void>[] = [];
  for (let y = 0; y * p.tile < h; y++) for (let x = 0; x * p.tile < w; x++) {
    jobs.push(fetch(`${API}/streetview/tiles/${z}/${x}/${y}?session=${p.session}&key=${p.key}&panoId=${encodeURIComponent(p.id)}`)
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error(`tile ${r.status}`)))).then(createImageBitmap).then(b => { g.drawImage(b, x * p.tile, y * p.tile); b.close(); }));
  }
  await Promise.all(jobs);
  return c;
}

/** `grade` and `level` are what the "Your photo" plate gets (world/Clay.tsx: gradeIt(c) x uLevel x uSkyDim), so the time of day
 *  changes Street View the same way; the meter's gain then applies to both alike in Through Cam A. */
export default function StreetViewSphere({ pano, grade, level }: { pano: Pano; grade: { rgb: [number, number, number]; desat: number }; level: number }) {
  const u = useMemo(() => ({ uGrade: { value: new Vector3(1, 1, 1) }, uDesat: { value: 0 }, uLevel: { value: 1 } }), []);
  const mat = useMemo(() => {
    const m = new MeshBasicMaterial({ side: DoubleSide, depthWrite: false, depthTest: false, toneMapped: false });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = 'uniform vec3 uGrade; uniform float uDesat; uniform float uLevel;\n' + sh.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), uDesat) * uGrade * uLevel;');
    };
    return m;
  }, [u]);
  useEffect(() => () => mat.dispose(), [mat]);
  u.uGrade.value.set(...grade.rgb); u.uDesat.value = grade.desat; u.uLevel.value = level;
  const [tex, setTex] = useState<CanvasTexture | null>(null);
  useEffect(() => {
    let live = true, cur: CanvasTexture | null = null;
    const zmax = Math.ceil(Math.log2(pano.w / pano.tile));
    (async () => {
      for (const z of [zmax - 2, zmax - 1]) { // a quick level first, then the sharp one; full resolution is too heavy here
        const c = await stitch(pano, Math.max(0, z), zmax);
        if (!live) return;
        const t = new CanvasTexture(c);
        t.colorSpace = SRGBColorSpace;
        cur?.dispose(); cur = t; setTex(t);
      }
    })().catch(console.error);
    return () => { live = false; cur?.dispose(); };
  }, [pano.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<Mesh>(null);
  useFrame(({ camera }) => { ref.current?.position.copy(camera.position); }); // a skybox: always centred on the eye
  if (!tex) return null;
  if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }
  // Mirrored so u runs clockwise (heading 90 + 360u), then turned so the image centre faces the pano's heading.
  return (
    <mesh ref={ref} material={mat} renderOrder={-1000} frustumCulled={false} scale={[-1, 1, 1]} rotation={[0, ((270 - pano.heading) * Math.PI) / 180, 0]} userData={{ helper: true }}>
      <sphereGeometry args={[1000, 64, 32]} />
    </mesh>
  );
}
