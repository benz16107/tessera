// Street geometry from spots/<id>/geometry.json (built by splat/street_geometry.py from our own SfM model, so it may be used
// for placement, shadows and occlusion, unlike Google's tiles). Same east-north-up frame as scene_object rows.
// Planes are n . x = d with the unit normal facing the street; quads run ground, ground, top, top.
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

export interface Plane { normal: [number, number, number]; d: number }
export interface StreetGeometry {
  spot: string;
  street?: { heading_deg: number; centre: [number, number, number]; width_m: number };
  ground: { plane: Plane; polygon: [number, number, number][]; slope_deg?: number };
  facades: { name: string; plane: Plane; height_m: number; quads: [number, number, number][][] }[];
  mesh?: { vertices: [number, number, number][]; triangles: [number, number, number][] };
}

const FILES = import.meta.glob('../../../../spots/*/geometry.json', { eager: true, import: 'default' }) as Record<string, StreetGeometry>;
export const geometryFor = (spotId: string): StreetGeometry | null =>
  Object.entries(FILES).find(([k]) => k.includes(`/spots/${spotId}/`))?.[1] ?? null;

/** Height of the ground at (x, y): on the plane when the spot has geometry, else z = 0. */
export function groundZ(g: StreetGeometry | null, x: number, y: number) {
  if (!g) return 0;
  const [a, b, c] = g.ground.plane.normal;
  return Math.abs(c) < 1e-6 ? 0 : (g.ground.plane.d - a * x - b * y) / c;
}

const quadGeometry = (quads: [number, number, number][][]) => {
  const pos: number[] = [];
  for (const q of quads) for (const i of [0, 1, 2, 0, 2, 3]) pos.push(...q[i]);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
};

/** The ground polygon, extended 60 m past its ends along the street so shadows never run off the edge. */
export function groundGeometry(g: StreetGeometry) {
  const p = g.ground.polygon.map(v => new Vector3(...v));
  const along = p[1].clone().sub(p[0]).normalize().multiplyScalar(60);
  const ext = (v: Vector3, s: number, w: Vector3) => {
    const o = v.clone().addScaledVector(along, s).add(w);
    o.z = groundZ(g, o.x, o.y);
    return o.toArray() as [number, number, number];
  };
  const side = p[3].clone().sub(p[0]).normalize().multiplyScalar(4); // a little wider than the curbs
  return quadGeometry([[ext(p[0], -1, side.clone().negate()), ext(p[1], 1, side.clone().negate()), ext(p[2], 1, side), ext(p[3], -1, side)]]);
}

export const facadeGeometry = (g: StreetGeometry) => quadGeometry(g.facades.flatMap(f => f.quads));

/** Facade quads pushed `inset` metres into the buildings: depth-only occluders that hide objects behind a wall without
 *  clipping the visible facade of the world model (the planes carry about 1 m of error). */
export function occluderGeometry(g: StreetGeometry, inset = 1) {
  return quadGeometry(g.facades.flatMap(f => f.quads.map(q => q.map(v => [v[0] - f.plane.normal[0] * inset, v[1] - f.plane.normal[1] * inset, v[2]] as [number, number, number]))));
}

// Gaussian splats trained by splat/train.sh, in each spot model's georegistered frame (see spots/<id>/SPLAT.md).
// `urls` are tried in order (the lite file first: 27.5 MB on venue Wi-Fi), `full` is the high-quality option.
export const SPLATS: Record<string, { urls: string[]; full: string[]; offset: [number, number, number]; credit: string }> = {
  nyc_dumbo: {
    // shortcut: lite .splat (54 MB) leads because Spark 2.4 panics on the lite PLY's empty `sh` element; put the 27.5 MB PLY first once it's re-exported.
    urls: ['/splat/nyc_dumbo_lite.splat', '/splat/nyc_dumbo_lite.compressed.ply', '/splat/nyc_dumbo.compressed.ply', '/splat/nyc_dumbo.splat'],
    full: ['/splat/nyc_dumbo.compressed.ply', '/splat/nyc_dumbo.splat'],
    offset: [5.349, 71.953, 0],
    credit: '3D scene trained from photos by 26 Wikimedia Commons contributors, CC BY-SA 4.0, credits at /credits',
  },
};
