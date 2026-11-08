import { useEffect, useRef, useState } from 'react';
import {
  Entity, Cartesian3, Color, HeightReference, VerticalOrigin, ScreenSpaceEventType, PolygonHierarchy,
  ClassificationType, JulianDate, LabelStyle, Cartesian2, defined, BoundingSphere, HeadingPitchRange, Math as CMath,
} from 'cesium';
import type { Identity } from 'spacetimedb';
import type { Camera, DevicePose, Participant, Person, Pose } from './module_bindings/types.ts';
import { createScene, applyPose, readPose, setLens, flyToSpot, pickLatLon, groundAt, type Scene } from './cesium.ts';
import { offset } from './geo.ts';

export interface Frame { url: string; width: number; height: number; pose: Pose; key: string }

export type PlaceMode = { kind: 'none' } | { kind: 'add' } | { kind: 'move'; id: bigint };

interface Props {
  mapsKey: string;
  spot: { lat: number; lon: number } | undefined;
  frame: Frame | undefined; // the photo on screen and its pose; the camera snaps when key changes
  solved: Pose | undefined; // the user's mark, drawn as a point
  route: readonly { lat: number; lon: number }[]; // shoot-day stops, numbered in order
  overview: number; // bump to fly out over the route
  lens: number; // f35 currently shown
  opacity: number;
  people: readonly Person[];
  scouts: readonly DevicePose[];
  participants: readonly Participant[];
  camera: Camera | undefined;
  me: Identity | undefined;
  planTime: Date;
  shadows: boolean;
  placing: PlaceMode;
  selectedPerson: bigint | null;
  onPick: (lat: number, lon: number) => void;
  onSelectPerson: (id: bigint | null) => void;
  onBroadcast: (pose: Pose) => void;
  onRemoteLens: (f35: number) => void;
  onReady: (poseNow: ((f35: number) => Pose) | null) => void; // reads the live camera; null after unmount
}

// A plain 1.7 m standing figure; viewBox ratio matches the 0.5 x 1.7 m billboard.
const PERSON_SVG = (fill: string) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="272" viewBox="0 0 40 136"><g fill="${fill}" stroke="#1c1a17" stroke-width="1.5" stroke-linejoin="round">` +
    `<circle cx="20" cy="11" r="8.5"/><path d="M9 25 Q20 21 31 25 L35 70 Q35 74 31 74 L29 74 L27.5 132 Q27.5 135 24.5 135 L22.5 135 L20 86 L17.5 135 L15.5 135 Q12.5 135 12.5 132 L11 74 L9 74 Q5 74 5 70 Z"/></g></svg>`
  );
const PERSON_IMG = PERSON_SVG('#f2ebdc');
const PERSON_SEL = PERSON_SVG('#e8a33d');
const SCOUT = Color.fromCssColorString('#e8a33d');
const MARK = Color.fromCssColorString('#d2452c');
const ROUTE = Color.fromCssColorString('#f2c46b');
// Numbered route marker: a badge with a pointer, drawn as one SVG so the number never hides behind the dot.
const stopBadge = (n: number) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 30 30"><path d="M15 29 L10 22 A11 11 0 1 1 20 22 Z" fill="#f2c46b" stroke="#1c1a17" stroke-width="1.6"/>` +
    `<text x="15" y="16" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace, monospace" font-weight="700" font-size="12" fill="#1c1a17">${n}</text></svg>`
  );

export default function SceneView(p: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [failed, setFailed] = useState(false);
  const [tilesReady, setTilesReady] = useState(false);
  const interacting = useRef(0); // timestamp until which the local user counts as dragging
  const live = useRef(p);
  live.current = p;

  // One viewer per mount.
  useEffect(() => {
    const s = createScene(hostRef.current!, p.mapsKey);
    sceneRef.current = s;
    let dead = false; // StrictMode mounts twice; ignore the first viewer's tileset result
    s.tileset.then(t => { if (dead) return; if (t) setTilesReady(true); else setFailed(true); });
    const v = s.viewer;
    v.clock.shouldAnimate = false;
    p.onReady(f35 => readPose(v, f35));

    const el = v.canvas;
    const busy = () => { interacting.current = performance.now() + 600; };
    const hold = () => { interacting.current = Infinity; };
    el.addEventListener('pointerdown', hold);
    el.addEventListener('pointerup', busy);
    el.addEventListener('pointercancel', busy);
    el.addEventListener('wheel', busy, { passive: true });

    let last = 0;
    let trailing: number | undefined;
    const send = () => {
      last = performance.now();
      live.current.onBroadcast(readPose(v, live.current.lens));
    };
    const offChanged = v.camera.changed.addEventListener(() => {
      if (performance.now() > interacting.current) return; // only the person dragging broadcasts
      const wait = 200 - (performance.now() - last); // about 5 updates a second
      clearTimeout(trailing);
      if (wait <= 0) send(); else trailing = window.setTimeout(send, wait);
    });

    v.screenSpaceEventHandler.setInputAction((e: { position: Cartesian2 }) => {
      const cur = live.current;
      if (cur.placing.kind !== 'none') {
        const ll = pickLatLon(v, e.position.x, e.position.y);
        if (ll) cur.onPick(ll.lat, ll.lon);
        return;
      }
      const picked = v.scene.pick(e.position);
      const id = defined(picked) && picked.id instanceof Entity ? String(picked.id.id) : '';
      cur.onSelectPerson(id.startsWith('person:') ? BigInt(id.slice(7)) : null);
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      dead = true;
      offChanged();
      clearTimeout(trailing);
      el.removeEventListener('pointerdown', hold);
      el.removeEventListener('pointerup', busy);
      el.removeEventListener('pointercancel', busy);
      el.removeEventListener('wheel', busy);
      p.onReady(null);
      v.destroy();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.mapsKey]);

  const viewer = () => (sceneRef.current && !sceneRef.current.viewer.isDestroyed() ? sceneRef.current.viewer : null);
  const w = p.frame?.width || 16, h = p.frame?.height || 10;

  // First view: the shared camera if the session has one, else the spot overview.
  const placedOnce = useRef(false);
  useEffect(() => {
    const v = viewer();
    if (!v || !tilesReady || placedOnce.current) return;
    if (p.camera) { placedOnce.current = true; void applyPose(v, p.camera.pose, w, h); }
    else if (p.spot) { placedOnce.current = true; flyToSpot(v, p.spot.lat, p.spot.lon); }
  }, [tilesReady, p.camera, p.spot, w, h]);

  // Spot changed: fly to it unless a solved pose is on screen.
  const spotKey = p.spot ? `${p.spot.lat},${p.spot.lon}` : '';
  useEffect(() => {
    const v = viewer();
    if (v && tilesReady && p.spot && !p.frame && placedOnce.current) flyToSpot(v, p.spot.lat, p.spot.lon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotKey]);

  // A new solve result (or a newly selected photo with one): snap to the solved pose.
  useEffect(() => {
    const v = viewer();
    if (!v || !tilesReady || !p.frame) return;
    placedOnce.current = true;
    void applyPose(v, p.frame.pose, w, h, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.frame?.key, tilesReady]);

  // Route overview: frame every stop from above, looking north.
  useEffect(() => {
    const v = viewer();
    if (!v || !tilesReady || !p.overview || p.route.length === 0) return;
    const r0 = p.route[0];
    void groundAt(v, r0.lat, r0.lon).then(g => {
      if (v.isDestroyed()) return;
      const pts = p.route.map(r => Cartesian3.fromDegrees(r.lon, r.lat, g ?? 0));
      const sphere = BoundingSphere.fromPoints(pts);
      const range = Math.max(sphere.radius * 3.2, 140);
      v.camera.flyToBoundingSphere(sphere, {
        offset: new HeadingPitchRange(0, CMath.toRadians(-42), range),
        duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.4,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.overview, tilesReady]);

  // Remote camera moves, unless the local user is dragging or the update is our own echo.
  useEffect(() => {
    const v = viewer();
    const cam = p.camera;
    if (!v || !tilesReady || !cam || !p.me || cam.updatedBy.isEqual(p.me)) return;
    if (performance.now() <= interacting.current) return;
    void applyPose(v, cam.pose, w, h);
    if (Math.abs(cam.pose.f35 - p.lens) > 0.2) p.onRemoteLens(cam.pose.f35);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.camera, tilesReady]);

  // Lens slider and photo aspect drive the frustum live.
  useEffect(() => {
    const v = viewer();
    if (v) setLens(v, p.lens, w, h);
  }, [p.lens, w, h]);

  // Light: the plan time drives Cesium's sun.
  useEffect(() => {
    const v = viewer();
    if (!v) return;
    v.clock.currentTime = JulianDate.fromDate(p.planTime);
    v.shadows = p.shadows;
    v.scene.shadowMap.softShadows = true;
    v.scene.shadowMap.darkness = 0.55;
  }, [p.planTime, p.shadows]);

  // Entities: people, scouts with heading wedges, and the solved mark.
  useEffect(() => {
    const v = viewer();
    if (!v) return;
    const ents = v.entities;
    const keep = new Set<string>();
    const upsert = (id: string, make: () => Entity.ConstructorOptions, update: (e: Entity) => void) => {
      keep.add(id);
      const e = ents.getById(id) ?? ents.add(new Entity({ id, ...make() }));
      update(e);
    };
    for (const person of p.people) {
      const sel = p.selectedPerson === person.id;
      upsert(`person:${person.id}`, () => ({
        billboard: { image: PERSON_IMG, width: 0.5, height: 1.7, sizeInMeters: true, verticalOrigin: VerticalOrigin.BOTTOM, heightReference: HeightReference.CLAMP_TO_3D_TILE, disableDepthTestDistance: 0 },
      }), e => {
        e.position = Cartesian3.fromDegrees(person.lon, person.lat) as never;
        if (e.billboard) e.billboard.image = (sel ? PERSON_SEL : PERSON_IMG) as never;
        e.name = person.label;
      });
    }
    const names = new Map(p.participants.map(x => [String(x.id), x.name]));
    for (const s of p.scouts) {
      const key = String(s.participantId);
      upsert(`scout:${key}`, () => ({
        point: { pixelSize: 14, color: SCOUT, outlineColor: Color.fromCssColorString('#1c1a17'), outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_3D_TILE, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: '', font: '500 13px "IBM Plex Mono", monospace', fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -22), heightReference: HeightReference.CLAMP_TO_3D_TILE, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      }), e => {
        e.position = Cartesian3.fromDegrees(s.lon, s.lat) as never;
        if (e.label) e.label.text = (names.get(key) ?? 'Scout') as never;
      });
      if (s.heading !== undefined) {
        const a = offset(s.lat, s.lon, s.heading - 22, 28), b = offset(s.lat, s.lon, s.heading + 22, 28);
        upsert(`wedge:${key}`, () => ({
          polygon: { material: SCOUT.withAlpha(0.45), classificationType: ClassificationType.CESIUM_3D_TILE },
        }), e => {
          if (e.polygon) e.polygon.hierarchy = new PolygonHierarchy(Cartesian3.fromDegreesArray([s.lon, s.lat, a.lon, a.lat, b.lon, b.lat])) as never;
        });
      }
    }
    if (p.solved) {
      upsert('mark', () => ({
        point: { pixelSize: 12, color: MARK, outlineColor: Color.WHITE, outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_3D_TILE, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: 'Mark', font: '500 13px "IBM Plex Mono", monospace', fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -20), heightReference: HeightReference.CLAMP_TO_3D_TILE, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      }), e => { e.position = Cartesian3.fromDegrees(p.solved!.lon, p.solved!.lat) as never; });
    }
    p.route.forEach((r, i) => {
      upsert(`stop:${i}`, () => ({
        billboard: { image: stopBadge(i + 1), width: 30, height: 30, heightReference: HeightReference.CLAMP_TO_3D_TILE, disableDepthTestDistance: Number.POSITIVE_INFINITY, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -6) },
      }), e => { e.position = Cartesian3.fromDegrees(r.lon, r.lat) as never; });
    });
    if (p.route.length > 1) {
      upsert('route-path', () => ({
        polyline: { width: 4, clampToGround: true, classificationType: ClassificationType.CESIUM_3D_TILE, material: ROUTE.withAlpha(0.9) },
      }), e => { if (e.polyline) e.polyline.positions = Cartesian3.fromDegreesArray(p.route.flatMap(r => [r.lon, r.lat])) as never; });
    }
    for (const e of [...ents.values]) if (!keep.has(String(e.id))) ents.remove(e);
  }, [p.people, p.scouts, p.participants, p.solved, p.selectedPerson, p.route]);

  const k = p.frame ? p.lens / p.frame.pose.f35 : 1;
  return (
    <div className="scene-frame">
      <div className="scene" style={p.frame ? { aspectRatio: `${w} / ${h}`, width: `min(100cqw, calc(100cqh * ${w / h}))`, height: 'auto' } : undefined} data-placing={p.placing.kind !== 'none' || undefined}>
        <div ref={hostRef} className="scene-host" />
        {p.frame && (
          <div className="overlay" aria-hidden="true" style={{ opacity: p.opacity }}>
            <img src={p.frame.url} alt="" style={{ transform: `scale(${k})` }} />
          </div>
        )}
        {!tilesReady && !failed && <div className="scene-skeleton" aria-label="Loading 3D tiles" />}
        {failed && <p className="scene-note">Google 3D tiles did not load after four tries. Check the connection and reload.</p>}
      </div>
    </div>
  );
}
