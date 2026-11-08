// The geodata layers in the 3D set. Mount inside the studio's east-north-up group (x east, y north, z up, metres from the
// spot). Everything here comes from its own open source, never from Google's tiles: NYC and OSM footprints extruded as
// invisible shadow casters for the sun, permit and closure zones draped on our street plane, POI pins, the
// photographer heatmap with heading arrows, alert volumes. The root is tagged `helper`, so the studio's render layers and
// picture-in-picture leave it out and AI renders stay made of the user's photo and objects only.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferGeometry, CanvasTexture, Color, DoubleSide, EdgesGeometry, ExtrudeGeometry, Float32BufferAttribute, InstancedMesh, Matrix4, Object3D, Shape, ShapeGeometry, SRGBColorSpace, Vector2 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { llhToEnu, type Origin } from '../studio/frame.ts';
import type { Feature, FC, GeoLayers } from './useGeoLayers.ts';

type XY = [number, number];
type Gz = (x: number, y: number) => number;
interface Props { geo: GeoLayers; origin: Origin; groundAt: Gz; labels?: boolean }

const COLORS = { film: '#f2a33a', closures: '#e8675e', construction: '#d9b44a', alerts: '#e8675e' } as const;
// Amber belongs to the studio's selection and Render button: until the Conditions panel is open or the camera is high,
// zones and shed volumes draw in this neutral at low opacity, so the street stays quiet.
const QUIET = '#a39f96';
const POI = { viewpoint: '#f2efe8', transit: '#5f9cf0', cafe: '#5ec8c2', restroom: '#a39f96', parking: '#75716a' } as Record<string, string>;

/** lon/lat -> metres east and north of the spot, on the WGS84 ellipsoid (frame.ts). */
function useProject(origin: Origin) {
  return useMemo(() => (c: number[]): XY => { const v = llhToEnu(origin, c[1], c[0], origin.height); return [v.x, v.y]; }, [origin.lat, origin.lon, origin.height]);
}

const ringsOf = (f: Feature): number[][][] =>
  f.geometry?.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.map(p => p[0]) : [];
const centroid = (pts: XY[]): XY => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];

/** Lay every vertex of a flat geometry onto the street plane, `lift` metres above it. */
function drape(g: BufferGeometry, gz: Gz, lift: number) {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setZ(i, gz(p.getX(i), p.getY(i)) + lift);
  p.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

/** True while the camera is more than `m` metres up (the top view, or orbiting out): ground overlays then draw as an
 *  x-ray over the tiles and the quieter labels appear. At street level they stay depth-tested and only blockers are labelled. */
function useHigh(m = 60) {
  const [high, setHigh] = useState(false);
  const last = useRef(0);
  useFrame(({ camera }) => {
    const now = performance.now();
    if (now - last.current < 250) return;
    last.current = now;
    const h = camera.position.y > m; // three.js world is Y-up (frame.ts)
    if (h !== high) setHigh(h);
  });
  return high;
}

export default function GeoScene({ geo, origin, groundAt, labels = true }: Props) {
  const P = useProject(origin);
  const high = useHigh();
  const d = geo.data;
  if (!d) return null;
  const L = d.layers;
  const quiet = labels && high;
  const loud = labels || high; // the panel is open (labels only show then) or we look from above
  return (
    <group name="geo-layers" userData={{ helper: true }}>
      {geo.on('shadow') && L.buildings && <Casters fc={L.buildings} P={P} gz={groundAt} />}
      {geo.on('buildings') && L.buildings && <Outlines fc={L.buildings} P={P} gz={groundAt} />}
      {geo.on('film') && L.film && <Zones fc={L.film} P={P} gz={groundAt} color={loud ? COLORS.film : QUIET} dim={!loud} lift={high ? 0.06 : 0.45} xray={high} labels={labels} quiet={quiet} />}
      {geo.on('closures') && L.closures && <Zones fc={L.closures} P={P} gz={groundAt} color={loud ? COLORS.closures : QUIET} dim={!loud} lift={high ? 0.08 : 0.5} xray={high} labels={labels} quiet={quiet} />}
      {geo.on('construction') && L.construction && <Sheds fc={L.construction} P={P} gz={groundAt} labels={labels} dim={!loud} />}
      {geo.on('alerts') && L.alerts && <Alerts fc={L.alerts} P={P} gz={groundAt} />}
      {geo.on('pois') && L.pois && <Pins fc={L.pois} P={P} gz={groundAt} labels={quiet} />}
      {geo.on('photographers') && L.photographers && <Heat fc={L.photographers} P={P} gz={groundAt} high={high} hotspots={quiet ? d.summary.photographers?.hotspots ?? [] : []} />}
      {geo.on('shadow') && labels && d.summary.shadow?.probes.map((pr, i, all) => <Probe key={pr.label} probe={pr} label={i === all.length - 1} xray={high} sunUp={(d.summary.shadow?.sun.alt ?? 1) > 0} P={P} gz={groundAt} />)}
    </group>
  );
}

/** Footprints extruded to their roof height: invisible (no colour, no depth) but casting the sun's shadow. */
function Casters({ fc, P, gz }: { fc: FC; P: (c: number[]) => XY; gz: Gz }) {
  const geom = useMemo(() => extrudeAll(fc, P, gz), [fc, P, gz]);
  useEffect(() => () => geom?.dispose(), [geom]);
  if (!geom) return null;
  return (
    <mesh geometry={geom} castShadow raycast={() => null} userData={{ geoCaster: true }}>
      <meshBasicMaterial colorWrite={false} depthWrite={false} />
    </mesh>
  );
}

function extrudeAll(fc: FC, P: (c: number[]) => XY, gz: Gz) {
  const parts: BufferGeometry[] = [];
  for (const f of fc.features) {
    const h = Number(f.properties.height_m) || 0;
    for (const ring of ringsOf(f)) {
      const pts = ring.map(P);
      if (pts.length < 4 || h <= 0) continue;
      const [cx, cy] = centroid(pts), base = gz(cx, cy) - 1;
      const g = new ExtrudeGeometry(new Shape(pts.map(([x, y]) => new Vector2(x, y))), { depth: h + 1, bevelEnabled: false });
      g.translate(0, 0, base);
      parts.push(g.index ? g.toNonIndexed() : g);
    }
  }
  return parts.length ? mergeGeometries(parts, false) : null;
}

/** Faint massing lines, so people can see what casts the shadows. */
function Outlines({ fc, P, gz }: { fc: FC; P: (c: number[]) => XY; gz: Gz }) {
  const geom = useMemo(() => { const g = extrudeAll(fc, P, gz); return g ? new EdgesGeometry(g, 30) : null; }, [fc, P, gz]);
  useEffect(() => () => geom?.dispose(), [geom]);
  if (!geom) return null;
  return <lineSegments geometry={geom} raycast={() => null}><lineBasicMaterial color="#a39f96" transparent opacity={0.35} toneMapped={false} /></lineSegments>;
}

/** Permit and closure areas draped on the street; active ones bright and labelled, film history faint. */
function Zones({ fc, P, gz, color, dim, lift, xray, labels, quiet }: { fc: FC; P: (c: number[]) => XY; gz: Gz; color: string; dim: boolean; lift: number; xray: boolean; labels: boolean; quiet: boolean }) {
  // From above every block shows; at street level only what is in force, so past film permits don't wash the street.
  const items = useMemo(() => fc.features.filter(f => xray || f.properties.active !== false).flatMap((f, i) => ringsOf(f).map((ring, j) => {
    const pts = ring.map(P);
    const g = drape(new ShapeGeometry(new Shape(pts.map(([x, y]) => new Vector2(x, y)))), gz, lift);
    const edge = drape(new BufferGeometry().setFromPoints(pts.map(([x, y]) => new Vector2(x, y))), gz, lift + 0.01);
    return { key: `${i}-${j}`, f, g, edge, c: centroid(pts), first: j === 0 };
  })), [fc, P, gz, lift, xray]);
  useEffect(() => () => items.forEach(it => { it.g.dispose(); it.edge.dispose(); }), [items]);
  // Street level: only what is in force within 250 m. From above: also the nearest film history.
  const labelled = new Set(items.filter(it => it.first && ((it.f.properties.active && Number(it.f.properties.m ?? 0) < 250) || (quiet && Number(it.f.properties.m) < 120)))
    .sort((a, b) => Number(a.f.properties.m) - Number(b.f.properties.m)).slice(0, quiet ? 6 : 3).map(it => it.key));
  return (
    <>
      {items.map(it => {
        const active = it.f.properties.active !== false;
        return (
          <group key={it.key}>
            <mesh geometry={it.g} raycast={() => null} renderOrder={xray ? 12 : 3}>
              <meshBasicMaterial color={color} transparent opacity={dim ? 0.07 : active ? 0.32 : 0.12} depthWrite={false} depthTest={!xray} toneMapped={false} side={DoubleSide} polygonOffset polygonOffsetFactor={-4} />
            </mesh>
            <lineLoop geometry={it.edge} raycast={() => null} renderOrder={xray ? 12 : 3}>
              <lineBasicMaterial color={color} transparent opacity={dim ? 0.25 : active ? 0.9 : 0.4} depthTest={!xray} toneMapped={false} />
            </lineLoop>
            {labels && labelled.has(it.key) && (
              <Html position={[it.c[0], it.c[1], gz(it.c[0], it.c[1]) + 2.5]} center zIndexRange={[20, 0]}>
                <span className="st-obj-label geo-label" style={{ borderLeft: `2px solid ${color}` }} title={it.f.properties.detail}>{it.f.properties.label}</span>
              </Html>
            )}
          </group>
        );
      })}
    </>
  );
}

/** Sidewalk sheds and scaffolds: a 3 m translucent wall around the building that carries the permit. */
function Sheds({ fc, P, gz, labels, dim }: { fc: FC; P: (c: number[]) => XY; gz: Gz; labels: boolean; dim: boolean }) {
  const items = useMemo(() => fc.features.map((f, i) => {
    const pts = (ringsOf(f)[0] ?? []).map(P);
    if (pts.length < 3) return null;
    const c = centroid(pts), base = gz(c[0], c[1]);
    const g = new ExtrudeGeometry(new Shape(pts.map(([x, y]) => new Vector2(x, y))), { depth: 3.2, bevelEnabled: false });
    g.translate(0, 0, base);
    return { key: i, f, g, c, top: base + 3.6 };
  }).filter((x): x is NonNullable<typeof x> => !!x), [fc, P, gz]);
  useEffect(() => () => items.forEach(it => it.g.dispose()), [items]);
  return (
    <>
      {items.map(it => (
        <group key={it.key}>
          <mesh geometry={it.g} raycast={() => null} renderOrder={4}>
            <meshBasicMaterial color={dim ? QUIET : COLORS.construction} transparent opacity={dim ? 0.06 : 0.16} depthWrite={false} toneMapped={false} side={DoubleSide} />
          </mesh>
          {labels && Number(it.f.properties.m) < 160 && it.key < 4 && (
            <Html position={[it.c[0], it.c[1], it.top]} center zIndexRange={[20, 0]}>
              <span className="st-obj-label geo-label" style={{ borderLeft: `2px solid ${COLORS.construction}` }} title={it.f.properties.detail}>{it.f.properties.label}</span>
            </Html>
          )}
        </group>
      ))}
    </>
  );
}

function inside([x, y]: XY, ring: XY[]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** NWS alert areas are county-sized: when the spot is inside one, a translucent drum around the set says so. */
function Alerts({ fc, P, gz }: { fc: FC; P: (c: number[]) => XY; gz: Gz }) {
  const hits = fc.features.filter(f => ringsOf(f).some(r => inside([0, 0], r.map(P))) || !f.geometry);
  if (!hits.length) return null;
  const sev = hits.some(f => f.properties.severity === 'severe') ? '#e8675e' : '#f2a33a';
  const z = gz(0, 0);
  return (
    <group>
      <mesh position={[0, 0, z + 30]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={5}>
        <cylinderGeometry args={[180, 180, 60, 64, 1, true]} />
        <meshBasicMaterial color={sev} transparent opacity={0.09} depthWrite={false} side={DoubleSide} toneMapped={false} />
      </mesh>
      <Html position={[0, 0, z + 14]} center zIndexRange={[20, 0]}>
        <span className="st-obj-label geo-label" style={{ borderLeft: `2px solid ${sev}` }}>{hits.map(f => f.properties.label).join(' · ')}</span>
      </Html>
    </group>
  );
}

/** Quiet pins: a thin stem and a coloured head, labels only for viewpoints and transit. */
function Pins({ fc, P, gz, labels }: { fc: FC; P: (c: number[]) => XY; gz: Gz; labels: boolean }) {
  const pts = useMemo(() => fc.features.filter(f => f.geometry?.type === 'Point' && Number(f.properties.m) < 450)
    .map(f => { const [x, y] = P((f.geometry as { coordinates: number[] }).coordinates); return { f, x, y, z: gz(x, y) }; }), [fc, P, gz]);
  return (
    <>
      <PinInstances pts={pts} />
      {labels && pts.filter(p => p.f.properties.kind === 'viewpoint' || (p.f.properties.kind === 'transit' && Number(p.f.properties.m) < 250)).slice(0, 8).map((p, i) => (
        <Html key={i} position={[p.x, p.y, p.z + 4.6]} center zIndexRange={[20, 0]}>
          <span className="st-obj-label geo-label quiet" style={{ borderLeft: `2px solid ${POI[String(p.f.properties.kind)] ?? '#a39f96'}` }}>{p.f.properties.label}</span>
        </Html>
      ))}
    </>
  );
}

function PinInstances({ pts }: { pts: { f: Feature; x: number; y: number; z: number }[] }) {
  const n = Math.max(1, pts.length);
  const ref = (m: InstancedMesh | null, kind: 'head' | 'stem') => {
    if (!m) return;
    const o = new Object3D(), c = new Color();
    pts.forEach((p, i) => {
      if (kind === 'head') { o.position.set(p.x, p.y, p.z + 3.6); o.rotation.set(0, 0, 0); o.scale.setScalar(1); }
      else { o.position.set(p.x, p.y, p.z + 1.8); o.rotation.set(Math.PI / 2, 0, 0); o.scale.setScalar(1); }
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.set(POI[String(p.f.properties.kind)] ?? '#a39f96'));
    });
    if (!pts.length) m.setMatrixAt(0, new Matrix4().makeScale(0, 0, 0));
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  return (
    <>
      <instancedMesh key={`h${pts.length}`} args={[undefined, undefined, n]} ref={m => ref(m, 'head')} raycast={() => null}>
        <sphereGeometry args={[0.35, 12, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh key={`s${pts.length}`} args={[undefined, undefined, n]} ref={m => ref(m, 'stem')} raycast={() => null}>
        <cylinderGeometry args={[0.04, 0.04, 3.6, 6]} />
        <meshBasicMaterial toneMapped={false} transparent opacity={0.6} />
      </instancedMesh>
    </>
  );
}

const HEAT_R = 450, HEAT_PX = 512;

/** Where photographers stand: a heat texture of the geotagged photos on the street plane, each photo's heading as an
 *  arrow on the ground, and the three busiest spots labelled. Drawn from above only: at eye level it is noise. */
function Heat({ fc, P, gz, high, hotspots }: { fc: FC; P: (c: number[]) => XY; gz: Gz; high: boolean; hotspots: { lat: number; lon: number; n: number; text: string }[] }) {
  const pts = useMemo(() => fc.features.filter(f => f.geometry?.type === 'Point').map(f => ({ xy: P((f.geometry as { coordinates: number[] }).coordinates), h: f.properties.heading as number | undefined })), [fc, P]);
  const tex = useMemo(() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = HEAT_PX;
    const ctx = cv.getContext('2d')!;
    const px = (m: number) => ((m + HEAT_R) / (2 * HEAT_R)) * HEAT_PX, r = (11 / (2 * HEAT_R)) * HEAT_PX;
    ctx.globalCompositeOperation = 'lighter';
    for (const { xy: [x, y] } of pts) {
      const cx = px(x), cy = HEAT_PX - px(y);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.09)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }
    // Density (about 11 overlapping photos saturate) to amber, then pale gold where most people stand. Alpha rises
    // smoothly from zero so the edges fade instead of stepping.
    const im = ctx.getImageData(0, 0, HEAT_PX, HEAT_PX), a = im.data;
    for (let i = 0; i < a.length; i += 4) {
      const v = Math.min(1, a[i + 3] / 255); // density lives in alpha: 'lighter' on a clear canvas keeps the colour at white
      const k = Math.max(0, (v - 0.35) / 0.65);
      a[i] = 242 + 13 * k; a[i + 1] = 140 + 95 * k; a[i + 2] = 40 + 150 * k;
      a[i + 3] = Math.round(210 * Math.pow(v, 0.7));
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.putImageData(im, 0, 0);
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [pts]);
  const quad = useMemo(() => {
    const g = new BufferGeometry();
    const c: XY[] = [[-HEAT_R, -HEAT_R], [HEAT_R, -HEAT_R], [HEAT_R, HEAT_R], [-HEAT_R, HEAT_R]];
    g.setAttribute('position', new Float32BufferAttribute(c.flatMap(([x, y]) => [x, y, gz(x, y) + 0.12]), 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }, [gz]);
  const arrows = useMemo(() => {
    const v: number[] = [];
    for (const { xy: [x, y], h } of pts) {
      if (h === undefined || h === null) continue;
      const r = (h * Math.PI) / 180, dx = Math.sin(r), dy = Math.cos(r), L = 6, z = gz(x, y) + 0.2;
      const tx = x + dx * L, ty = y + dy * L;
      const back = (a: number) => [tx - (dx * Math.cos(a) - dy * Math.sin(a)) * 1.6, ty - (dy * Math.cos(a) + dx * Math.sin(a)) * 1.6];
      const [l1, l2] = back(0.5), [r1, r2] = back(-0.5);
      v.push(x, y, z, tx, ty, z, tx, ty, z, l1, l2, z, tx, ty, z, r1, r2, z);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(v, 3));
    return g;
  }, [pts, gz]);
  useEffect(() => () => { tex.dispose(); quad.dispose(); arrows.dispose(); }, [tex, quad, arrows]);
  return (
    <>
      {high && (
        <mesh geometry={quad} raycast={() => null} renderOrder={11}>
          <meshBasicMaterial map={tex} transparent depthWrite={false} depthTest={false} toneMapped={false} />
        </mesh>
      )}
      {high && (
        <lineSegments geometry={arrows} raycast={() => null} renderOrder={13}>
          <lineBasicMaterial color="#f7c97a" transparent opacity={0.75} depthTest={false} toneMapped={false} />
        </lineSegments>
      )}
      {hotspots.map((h, i) => { const [x, y] = P([h.lon, h.lat]); return (
        <Html key={i} position={[x, y, gz(x, y) + 2]} center zIndexRange={[20, 0]}>
          <span className="st-obj-label geo-label quiet" style={{ borderLeft: '2px solid #f2a33a' }}>{h.text.replace(/ from .* of the mark/, ' here')}</span>
        </Html>
      ); })}
    </>
  );
}

/** The street point the shadow readout is about: amber ring in sun, slate ring in building shadow. */
function Probe({ probe, label, xray, sunUp, P, gz }: { probe: { label: string; lat: number; lon: number; readout: string; now: { shadow: boolean } }; label: boolean; xray: boolean; sunUp: boolean; P: (c: number[]) => XY; gz: Gz }) {
  const [x, y] = P([probe.lon, probe.lat]), z = gz(x, y) + 0.08;
  const color = probe.now.shadow || !sunUp ? '#7f8ea8' : '#f2a33a';
  return (
    <group position={[x, y, z]}>
      <mesh raycast={() => null} renderOrder={xray ? 13 : 4} position={[0, 0, xray ? 0 : 0.3]}><ringGeometry args={[1.0, 1.25, 40]} /><meshBasicMaterial color={color} transparent opacity={0.9} toneMapped={false} depthWrite={false} depthTest={!xray} side={DoubleSide} /></mesh>
      {label && (
        <Html position={[0, 0, 1.4]} center zIndexRange={[20, 0]}>
          <span className="st-obj-label geo-label" style={{ borderLeft: `2px solid ${color}` }} title={probe.readout}>{!sunUp ? 'Sun down' : probe.now.shadow ? 'Street in building shadow now' : 'Street in sun now'}</span>
        </Html>
      )}
    </group>
  );
}
