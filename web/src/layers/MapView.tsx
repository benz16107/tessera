// The full-screen Map view: the 2D map (Map2D: OpenFreeMap, the geo layers, shared layer switches) with every shot of the
// session on it. Cameras get a pin, their view cone, lens and heading, and can be dragged to move them (updateSceneObject).
// Also shown: the scout's live position, check-ins, placed people and props, the solved photo's spot, the sun's direction
// and building shadows at the timeline's time, and, zoomed out, shots around the world as clustered pins. Click a pin
// for its card; "Open in 3D" hands the shot to the studio. Past `enter3DZoom` it asks the studio to cross-fade into 3D.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MlMap, GeoJSONSource, MapMouseEvent, MapGeoJSONFeature } from 'maplibre-gl';
import { useTable, useReducer } from 'spacetimedb/react';
import { Quaternion, Vector3 } from 'three';
import { tables, reducers } from '../module_bindings/index.ts';
import type { SceneObject } from '../module_bindings/types.ts';
import { enuToLlh, llhToEnu, cameraHpr, type Origin } from '../studio/frame.ts';
import { bodyById } from '../studio/catalog/index.ts';
import { sunAt, sunRelation, hfovDeg, fmtTime, compassWord } from '../geo.ts';
import { shadowPolygons } from '../../../crew/src/layers/buildings.ts';
import { toXY, type LonLat } from '../../../crew/src/layers/geom.ts';
import Map2D, { conePolygon } from './Map2D.tsx';
import { LAYERS, type FC, type Feature, type GeoLayers, type LayerId } from './useGeoLayers.ts';
import './layers.css';

export interface MapCamera { lat: number; lon: number; zoom: number; bearing: number; pitch: number }
export interface ShotTarget { objectId: bigint | null; lat: number; lon: number; heading: number; pitch: number }
interface Props {
  geo: GeoLayers; sessionId: bigint; origin: Origin; at: Date; zone: string;
  theme?: 'dark' | 'light';
  /** Simple mode: no layer panel, no dragging. Dark like Studio unless `theme` says otherwise. */
  compact?: boolean;
  /** Where to look; the studio sets it from the 3D camera when the user zooms out of the set. */
  camera?: MapCamera | null;
  onCamera?: (c: MapCamera) => void;
  /** Zoom at which the map hands over to the 3D set (about street level). */
  enter3DZoom?: number;
  onEnter3D?: (center: { lat: number; lon: number }, heading: number, pitch: number) => void;
  onOpenShot?: (t: ShotTarget, mode: 'world' | 'shot') => void;
}

const EMPTY: FC = { type: 'FeatureCollection', features: [] };
const R = 6371008.8;
const offset = (lat: number, lon: number, bearingDeg: number, m: number): LonLat => {
  const b = (bearingDeg * Math.PI) / 180;
  return [lon + ((m * Math.sin(b)) / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI), lat + ((m * Math.cos(b)) / R) * (180 / Math.PI)];
};
const point = (c: LonLat, properties: Record<string, unknown>): Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { layer: 'shots', kind: '', label: '', ...properties } });
const commonsThumb = (title: string) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(title)}?width=320`;
const commonsPage = (title: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title.replace(/ /g, '_'))}`;
const params = (s: string) => Object.fromEntries(s.split(';').filter(Boolean).map(kv => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));

export default function MapView({ geo, sessionId, origin, at, zone, theme, compact = false, camera, onCamera, enter3DZoom = 18.6, onEnter3D, onOpenShot }: Props) {
  const [objects] = useTable(tables.sceneObject.where(r => r.sessionId.eq(sessionId)));
  const [versions] = useTable(tables.shotVersion.where(r => r.sessionId.eq(sessionId)));
  const [poses] = useTable(tables.devicePose.where(r => r.sessionId.eq(sessionId)));
  const [checkins] = useTable(tables.checkin.where(r => r.sessionId.eq(sessionId)));
  const [parts] = useTable(tables.participant.where(r => r.sessionId.eq(sessionId)));
  const [photos] = useTable(tables.photo.where(r => r.sessionId.eq(sessionId)));
  const [results] = useTable(tables.solveResult.where(r => r.sessionId.eq(sessionId)));
  const [settings] = useTable(tables.shotSettings.where(r => r.sessionId.eq(sessionId)));
  const [library] = useTable(tables.shotLibrary);
  const updateObject = useReducer(reducers.updateSceneObject);

  const solved = [...results].filter(r => r.confidence !== 'none').sort((a, b) => Number(b.photoId - a.photoId))[0];
  const photo = photos.find(p => p.id === solved?.photoId);
  const frame = { w: photo?.width || 3, h: photo?.height || 2 };
  const shotSettings = settings[0];
  const sun = sunAt(at, origin.lat, origin.lon);

  // Every shot of the session as pins and cones, in WGS84.
  const { shots, cones, byId } = useMemo(() => {
    const feats: Feature[] = [], coneFeats: Feature[] = [], byId = new Map<string, SceneObject>();
    const cams = objects.filter(o => o.kind === 'camera');
    const shotCam = cams.find(o => params(o.params).shot === '1') ?? cams[0];
    for (const o of objects) {
      if (!o.visible) continue;
      const ll = enuToLlh(origin, new Vector3(o.x, o.y, o.z)), c: LonLat = [ll.lon, ll.lat];
      if (o.kind === 'camera') {
        const hpr = cameraHpr(new Quaternion(o.qx, o.qy, o.qz, o.qw).normalize());
        const isShot = o.id === shotCam?.id;
        const crop = shotSettings ? bodyById(shotSettings.bodyId)?.crop ?? 1 : 1;
        const mm = isShot && shotSettings ? shotSettings.focalMm : Number(params(o.params).f35) || solved?.pose.f35 || 35;
        const f35 = isShot && shotSettings ? shotSettings.focalMm * crop : mm;
        const hfov = hfovDeg(f35, frame.w, frame.h);
        byId.set(String(o.id), o);
        feats.push(point(c, { kind: 'camera', id: String(o.id), label: `${o.name || 'Camera'} · ${Math.round(mm)} mm`, name: o.name || 'Camera', heading: Math.round(hpr.heading), pitch: Math.round(hpr.pitch), mm: Math.round(mm), f35: Math.round(f35), hfov, isShot, locked: !!o.lockedBy }));
        coneFeats.push(...conePolygon({ lat: ll.lat, lon: ll.lon, heading: hpr.heading, hfovDeg: hfov, rangeM: 120 }).features.map(f => ({ ...f, properties: { ...f.properties, id: String(o.id), isShot } })));
      } else if (o.kind !== 'light') feats.push(point(c, { kind: o.kind === 'person' ? 'person' : 'prop', label: o.name }));
    }
    for (const p of poses) {
      const who = parts.find(x => x.id === p.participantId)?.name ?? 'Scout';
      feats.push(point([p.lon, p.lat], { kind: 'scout', label: `${who} (live)`, accuracy: Math.round(p.accuracyM), heading: p.heading ?? undefined, at: p.at.toDate().toISOString() }));
    }
    for (const k of checkins) {
      const ll = enuToLlh(origin, new Vector3(k.x, k.y, 0));
      feats.push(point([ll.lon, ll.lat], { kind: 'checkin', label: `${k.name || 'Check-in'}`, heading: Math.round(k.heading), image: k.imageUrl, verdict: k.verdict, distance: Math.round(k.distanceM), at: k.createdAt.toDate().toISOString() }));
    }
    // The solved photo's spot, unless a camera already stands there (the studio makes Cam A at the solved pose; its card shows the photo).
    const camAt = (lat: number, lon: number) => feats.some(f => f.properties.kind === 'camera' && f.geometry?.type === 'Point' && Math.hypot((f.geometry.coordinates[0] - lon) * 84_000, (f.geometry.coordinates[1] - lat) * 111_000) < 3);
    if (solved && !camAt(solved.pose.lat, solved.pose.lon)) feats.push(point([solved.pose.lon, solved.pose.lat], { kind: 'photo', label: 'Your photo', heading: Math.round(solved.pose.heading), f35: Math.round(solved.pose.f35), image: photo?.thumb || photo?.url || '', pitch: Math.round(solved.pose.pitch) }));
    return { shots: { type: 'FeatureCollection', features: feats } as FC, cones: { type: 'FeatureCollection', features: coneFeats } as FC, byId };
  }, [objects, poses, checkins, parts, solved, photo, shotSettings, origin.lat, origin.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shots around the world: shared shots from the public shot library plus the lens dataset's geotagged Commons photos.
  const [commons, setCommons] = useState<FC>(EMPTY);
  useEffect(() => { fetch('/api/layers/world').then(r => (r.ok ? r.json() : EMPTY)).then(setCommons).catch(() => {}); }, []);
  const world = useMemo<FC>(() => ({ type: 'FeatureCollection', features: [
    ...library.filter(s => !s.error).map(s => point([s.lon, s.lat], { kind: 'shared_shot', label: s.title || 'Shared shot', heading: Math.round(s.heading), f35: Math.round(s.f35), image: s.imageUrl, code: s.shareCode })),
    ...commons.features,
  ] }), [library, commons]);

  // Building shadows and the sun's direction at the timeline's exact time (the server's copy is half-hourly).
  const place = useMemo(() => ({ id: 'map', name: '', lat: origin.lat, lon: origin.lon, radiusM: 500, zone }), [origin.lat, origin.lon, zone]);
  const casters = useMemo(() => (geo.data?.layers.buildings?.features ?? []).flatMap(f => f.geometry?.type === 'Polygon'
    ? [{ ring: f.geometry.coordinates[0].map(c => toXY(place, c)), h: Number(f.properties.height_m) || 0 }] : []), [geo.data, place]);
  const minute = Math.floor(at.getTime() / 60_000);
  const shadow = useMemo<FC>(() => ({ type: 'FeatureCollection', features: shadowPolygons(place, casters, sun.azimuth, sun.altitude) }), [casters, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const sunLine = useMemo<FC>(() => sun.altitude <= 0 ? EMPTY : { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[origin.lon, origin.lat], offset(origin.lat, origin.lon, sun.azimuth, 220)] }, properties: { layer: 'sun', kind: 'sun', label: '' } },
    point(offset(origin.lat, origin.lon, sun.azimuth, 240), { kind: 'sun', label: `Sun ${sun.altitude.toFixed(0)}° up, ${fmtTime(at, zone)}` }),
  ] }, [minute, origin.lat, origin.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  // Simple mode keeps the map to the shot, the sun and places; permits, shadows and photo dots stay in the studio.
  const simpleGeo = useMemo<GeoLayers>(() => ({ ...geo, on: id => id === 'pois' }), [geo]);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [card, setCard] = useState<{ p: Record<string, any>; lngLat: [number, number] } | null>(null);
  const [, setTick] = useState(0);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const armed = useRef(true), applied = useRef(''), layersRef = useRef<HTMLDetailsElement>(null);
  const latest = useRef({ shots, cones, byId, onCamera, onEnter3D, enter3DZoom, compact });
  latest.current = { shots, cones, byId, onCamera, onEnter3D, enter3DZoom, compact };

  const onMap = (m: MlMap) => {
    map.current = m;
    if (import.meta.env.DEV) (window as unknown as { __geoMap?: MlMap }).__geoMap = m; // test hook
    const dark = (theme ?? 'dark') === 'dark', ink = dark ? '#f2efe8' : '#1a1917', halo = dark ? '#0b0b0a' : '#ffffff';
    for (const id of ['map-cones', 'map-shots', 'map-sun']) m.addSource(id, { type: 'geojson', data: EMPTY });
    m.addSource('map-world', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 44, clusterMaxZoom: 11 });
    const text = { 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.2] as [number, number], 'text-anchor': 'top' as const, 'text-optional': true };
    m.addLayer({ id: 'map-world-clusters', type: 'circle', source: 'map-world', maxzoom: 14, filter: ['has', 'point_count'], paint: {
      'circle-color': '#e6d3a8', 'circle-opacity': 0.9, 'circle-stroke-color': halo, 'circle-stroke-width': 1.5,
      'circle-radius': ['step', ['get', 'point_count'], 11, 20, 15, 100, 20, 400, 26] } });
    m.addLayer({ id: 'map-world-count', type: 'symbol', source: 'map-world', maxzoom: 14, filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-allow-overlap': true }, paint: { 'text-color': '#1a1917' } });
    m.addLayer({ id: 'map-world-points', type: 'circle', source: 'map-world', maxzoom: 14, filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': 4, 'circle-color': '#e6d3a8', 'circle-stroke-color': halo, 'circle-stroke-width': 1 } });
    m.addLayer({ id: 'map-sun', type: 'line', source: 'map-sun', minzoom: 13, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#c9a46a', 'line-width': 1.5, 'line-dasharray': [2, 2] } });
    m.addLayer({ id: 'map-cones', type: 'fill', source: 'map-cones', paint: { 'fill-color': ['case', ['get', 'isShot'], '#f2efe8', '#a39f96'], 'fill-opacity': 0.18 } });
    m.addLayer({ id: 'map-cones-line', type: 'line', source: 'map-cones', paint: { 'line-color': ['case', ['get', 'isShot'], '#f2efe8', '#a39f96'], 'line-width': 1.2 } });
    m.addLayer({ id: 'map-dots', type: 'circle', source: 'map-shots', filter: ['in', ['get', 'kind'], ['literal', ['person', 'prop']]], minzoom: 15, paint: {
      'circle-radius': 3, 'circle-color': ['match', ['get', 'kind'], 'person', '#c9d8f5', '#a39f96'], 'circle-stroke-color': halo, 'circle-stroke-width': 1 } });
    m.addLayer({ id: 'map-pins', type: 'circle', source: 'map-shots', filter: ['in', ['get', 'kind'], ['literal', ['camera', 'scout', 'checkin', 'photo']]], paint: {
      'circle-radius': ['match', ['get', 'kind'], 'camera', 7, 'scout', 6, 5],
      'circle-color': ['match', ['get', 'kind'], 'camera', ink, 'scout', '#5ec8c2', 'checkin', '#5ec8c2', '#c9d8f5'],
      'circle-stroke-color': ['case', ['==', ['get', 'isShot'], true], '#f2efe8', halo], 'circle-stroke-width': 2 } });
    m.addLayer({ id: 'map-pins-label', type: 'symbol', source: 'map-shots', filter: ['in', ['get', 'kind'], ['literal', ['camera', 'scout', 'checkin', 'photo']]], minzoom: 14,
      layout: { ...text, 'text-field': ['get', 'label'] }, paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.4 } });

    const pickable = ['map-pins', 'map-world-points', 'map-world-clusters'];
    const open = (f: MapGeoJSONFeature) => {
      if (f.properties.cluster) {
        (m.getSource('map-world') as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id).then(z => m.easeTo({ center: (f.geometry as { coordinates: [number, number] }).coordinates, zoom: z + 0.5 }));
        return;
      }
      setCard({ p: f.properties, lngLat: (f.geometry as { coordinates: [number, number] }).coordinates });
    };
    m.on('click', e => {
      if (drag.current?.moved) return;
      const order = ['camera', 'photo', 'checkin', 'scout']; // stacked pins: the camera wins
      const rank = (f: MapGeoJSONFeature) => { const i = order.indexOf(String(f.properties.kind)); return i < 0 ? order.length : i; };
      const f = m.queryRenderedFeatures(e.point, { layers: pickable }).sort((a, b) => rank(a) - rank(b))[0];
      if (f) open(f); else setCard(null);
    });
    for (const l of pickable) {
      m.on('mouseenter', l, () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', l, () => { m.getCanvas().style.cursor = ''; });
    }
    // Drag a camera pin to move that camera in the shared set.
    m.on('mousedown', 'map-pins', (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      const f = e.features?.find(x => x.properties.kind === 'camera'); // a scout pin may sit on top of it
      if (latest.current.compact || !f || f.properties.locked) return;
      e.preventDefault();
      drag.current = { id: String(f.properties.id), moved: false };
      m.dragPan.disable();
      m.getCanvas().style.cursor = 'grabbing';
    });
    m.on('mousemove', e => {
      const d = drag.current;
      if (!d) return;
      d.moved = true;
      const { shots: s, cones: c } = latest.current, ll: LonLat = [e.lngLat.lng, e.lngLat.lat];
      const moved = s.features.map(f => (f.properties.id === d.id && f.properties.kind === 'camera' ? { ...f, geometry: { type: 'Point' as const, coordinates: ll } } : f));
      const p = s.features.find(f => f.properties.id === d.id)?.properties;
      const cone = p ? conePolygon({ lat: ll[1], lon: ll[0], heading: Number(p.heading), hfovDeg: Number(p.hfov), rangeM: 120 }).features[0] : null;
      (m.getSource('map-shots') as GeoJSONSource).setData({ ...s, features: moved } as never);
      if (cone) (m.getSource('map-cones') as GeoJSONSource).setData({ ...c, features: [...c.features.filter(f => f.properties.id !== d.id), { ...cone, properties: { ...cone.properties, id: d.id, isShot: p!.isShot } }] } as never);
    });
    m.on('mouseup', e => {
      const d = drag.current;
      if (!d) return;
      m.dragPan.enable();
      m.getCanvas().style.cursor = '';
      const o = latest.current.byId.get(d.id);
      if (d.moved && o) {
        const p = llhToEnu(origin, e.lngLat.lat, e.lngLat.lng, origin.height);
        const { id, sessionId: sid, kind, assetId, name, z, qx, qy, qz, qw, scale, color, intensity, lightType, params: prm, visible } = o;
        updateObject({ id, sessionId: sid, kind, assetId, name, x: p.x, y: p.y, z, qx, qy, qz, qw, scale, color, intensity, lightType, params: prm, visible }).catch(console.error);
      }
      setTimeout(() => { drag.current = null; }, 0); // let the click that follows mouseup see the drag
    });
    m.on('move', () => setTick(t => t + 1));
    m.on('moveend', () => {
      const c = m.getCenter(), z = m.getZoom();
      latest.current.onCamera?.({ lat: c.lat, lon: c.lng, zoom: z, bearing: m.getBearing(), pitch: m.getPitch() });
      if (z < latest.current.enter3DZoom - 0.6) armed.current = true;
      else if (z >= latest.current.enter3DZoom && armed.current && latest.current.onEnter3D) {
        armed.current = false;
        latest.current.onEnter3D({ lat: c.lat, lon: c.lng }, m.getBearing(), m.getPitch());
      }
    });
    setReady(true);
  };

  // Simple mode: frame the shot camera's cone instead of the spot's centre, once, when the camera first appears.
  const framed = useRef(false);
  useEffect(() => {
    const m = map.current, cam = shots.features.find(f => f.properties.kind === 'camera' && f.properties.isShot);
    if (!compact || !ready || !m || framed.current || cam?.geometry?.type !== 'Point') return;
    framed.current = true;
    const [lon, lat] = cam.geometry.coordinates;
    m.jumpTo({ center: offset(lat, lon, Number(cam.properties.heading) || 0, 45) });
  }, [compact, ready, shots]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource('map-shots') as GeoJSONSource | undefined)?.setData(shots as never);
    (m.getSource('map-cones') as GeoJSONSource | undefined)?.setData(cones as never);
    (m.getSource('map-world') as GeoJSONSource | undefined)?.setData(world as never);
    (m.getSource('map-sun') as GeoJSONSource | undefined)?.setData(sunLine as never);
  }, [ready, shots, cones, world, sunLine]);

  useEffect(() => {
    if (!camera || !map.current) return;
    // Compare by value: a parent that passes a fresh object each render must not keep re-jumping (and disarming 3D).
    const key = [camera.lat, camera.lon, camera.zoom, camera.bearing, camera.pitch].map(v => v.toFixed(6)).join();
    if (key === applied.current) return;
    applied.current = key;
    armed.current = camera.zoom < enter3DZoom - 0.6; // arriving from 3D: don't bounce straight back in
    map.current.jumpTo({ center: [camera.lon, camera.lat], zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch });
  }, [camera, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setCard(null); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const m0 = map.current, pos = card && m0 ? m0.project(card.lngLat) : null;
  // The sun's label, clamped inside the map so it never runs off an edge (it sits 240 m out along the sun's bearing).
  const sunChip = (() => {
    if (!m0 || !ready || sun.altitude <= 0 || m0.getZoom() < 13) return null;
    const p = m0.project(offset(origin.lat, origin.lon, sun.azimuth, 240)), w = m0.getContainer().clientWidth, h = m0.getContainer().clientHeight;
    let x = Math.min(w - 90, Math.max(90, p.x));
    const y = Math.min(h - 56, Math.max(24, p.y)), lp = layersRef.current?.getBoundingClientRect(), cr = m0.getContainer().getBoundingClientRect();
    if (lp && x - 75 < lp.right - cr.left + 8 && y + 14 > lp.top - cr.top && y - 14 < lp.bottom - cr.top) x = lp.right - cr.left + 8 + 75; // clear of the layer list
    return { x, y, text: `Sun ${sun.altitude.toFixed(0)}° up, ${fmtTime(at, zone)}` };
  })();
  const onScreen = !!pos && !!m0 && pos.x >= 0 && pos.y >= 0 && pos.x <= m0.getContainer().clientWidth && pos.y <= m0.getContainer().clientHeight;
  return (
    <div className="geo-mapview" data-theme={theme ?? 'dark'}>
      <Map2D geo={compact ? simpleGeo : geo} center={origin} height="100%" zoom={17} theme={theme ?? 'dark'} shadow={compact ? null : shadow} onMap={onMap} />
      {!compact && <LayerList geo={geo} innerRef={layersRef} />}
      {card && pos && onScreen && <ShotCard p={card.p} x={pos.x} y={pos.y} at={at} zone={zone} sun={sun} geo={geo} versions={card.p.isShot ? versions.filter(v => v.imageUrl) : []} photoUrl={card.p.isShot ? photo?.thumb || photo?.url : undefined}
        onClose={() => setCard(null)} onOpen={onOpenShot && (mode => onOpenShot({ objectId: card.p.id ? BigInt(card.p.id) : null, lat: card.lngLat[1], lon: card.lngLat[0], heading: Number(card.p.heading) || 0, pitch: Number(card.p.pitch) || 0 }, mode))} />}
      {!compact && <p className="st-chip geo-mapview-hint">Drag a camera to move it. Zoom in for 3D.</p>}
      {sunChip && <p className="st-chip geo-sunchip" style={{ left: sunChip.x, top: sunChip.y }}>{sunChip.text}</p>}
    </div>
  );
}

function LayerList({ geo, innerRef }: { geo: GeoLayers; innerRef: React.RefObject<HTMLDetailsElement> }) {
  const ids: LayerId[] = ['weather', 'alerts', 'film', 'closures', 'construction', 'shadow', 'tides', 'pois', 'photographers', 'buildings'];
  const [wide] = useState(() => matchMedia('(min-width: 720px)').matches); // phones start with the list folded
  return (
    <details ref={innerRef} className="geo-maplayers" aria-label="Map layers" open={wide}>
      <summary>Layers{geo.shared ? <small>shared with the set</small> : null}</summary>
      <ul className="geo-toggles one">
        {ids.map(id => { const l = LAYERS.find(x => x.id === id)!; const off = (id === 'film' || id === 'closures' || id === 'construction') && geo.data && !geo.data.nyc; return (
          <li key={id}><button aria-pressed={geo.on(id) && !off} disabled={!!off} onClick={() => geo.toggle(id)} title={l.note}><i style={{ background: l.color }} /><span>{l.name}</span><small>{off ? 'NYC only' : l.note}</small></button></li>
        ); })}
      </ul>
    </details>
  );
}

function ShotCard({ p, x, y, at, zone, sun, geo, versions, photoUrl, onClose, onOpen }: {
  p: Record<string, any>; x: number; y: number; at: Date; zone: string; sun: { azimuth: number; altitude: number }; geo: GeoLayers;
  versions: { id: bigint; label: string; imageUrl: string }[]; photoUrl?: string; onClose: () => void; onOpen?: (mode: 'world' | 'shot') => void;
}) {
  const kind = String(p.kind), heading = Number(p.heading), hasHeading = Number.isFinite(heading);
  const img = kind === 'commons_photo' ? commonsThumb(String(p.label)) : kind === 'camera' ? photoUrl : p.image || undefined;
  const title = kind === 'commons_photo' ? 'Commons photo' : kind === 'shared_shot' ? 'Shared shot' : kind === 'scout' ? 'Scout, live' : kind === 'checkin' ? 'Check-in' : String(p.label).split(' · ')[0];
  const hfov = Number(p.hfov) || hfovDeg(Number(p.f35) || 35, 3, 2);
  const cc = geo.data?.conditions?.colorChance;
  const lines = [
    p.mm ? `${p.mm} mm lens${p.f35 && p.f35 !== p.mm ? ` (${p.f35} mm full-frame equivalent)` : ''}` : p.f35 ? `${p.f35} mm full-frame equivalent` : '',
    hasHeading ? `Facing ${compassWord(heading)}, ${heading}°` : '',
    kind === 'camera' || kind === 'photo' ? `${fmtTime(at, zone, true)}: sun ${hasHeading ? sunRelation(sun.azimuth, sun.altitude, heading, hfov) : ''}${sun.altitude > -1 ? `, ${sun.altitude.toFixed(0)}° up` : ''}` : '',
    (kind === 'camera' || kind === 'photo') && cc ? `${cc.kind === 'sunset' ? 'Sunset' : 'Sunrise'} colour chance ${cc.label} (${cc.score})` : '',
    kind === 'scout' ? `Within ${p.accuracy} m · ${fmtTime(new Date(p.at), zone)}` : '',
    kind === 'checkin' ? `${p.verdict || 'Checked in'} · ${p.distance} m from the mark · ${fmtTime(new Date(p.at), zone)}` : '',
    kind === 'commons_photo' ? `${String(p.label).replace(/\.(jpe?g|png)$/i, '')} · ${p.author}, ${p.license}` : '',
    kind === 'shared_shot' ? String(p.label) : '',
  ].filter(Boolean);
  return (
    <div className="geo-shotcard" style={{ left: x, top: y }} role="dialog" aria-label={`${title} details`}>
      {img && <img src={img} alt="" loading="lazy" />}
      <header><b>{title}</b><button className="geo-x" onClick={onClose} aria-label="Close">×</button></header>
      <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {versions.length > 0 && <div className="geo-versions">{versions.slice(-4).map(v => <img key={String(v.id)} src={v.imageUrl} alt={v.label} title={v.label} />)}</div>}
      <footer>
        {onOpen && kind !== 'commons_photo' && kind !== 'shared_shot' && <button className="st-btn small" onClick={() => onOpen('world')}>Open in 3D</button>}
        {onOpen && (kind === 'camera' || kind === 'photo') && <button className="st-btn small" onClick={() => onOpen('shot')}>Look through</button>}
        {kind === 'commons_photo' && <a className="st-btn small" href={commonsPage(String(p.label))} target="_blank" rel="noreferrer">View on Commons</a>}
      </footer>
    </div>
  );
}
