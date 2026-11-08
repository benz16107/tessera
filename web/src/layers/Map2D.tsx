// The 2D map: MapLibre GL with OpenFreeMap's keyless "dark" vector style (free, no key; attribution "OpenFreeMap
// © OpenMapTiles, data from OpenStreetMap" stays on the map), the same layers as the 3D set, building shadows at the set
// time, and the shot camera's view cone. Loaded lazily, so the studio does not pay for MapLibre until a map opens.
import { useEffect, useRef } from 'react';
import { Map as MlMap, AttributionControl, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FC, GeoLayers, LayerId } from './useGeoLayers.ts';

setWorkerUrl(workerUrl);

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';
export const MAP_STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron'; // Simple mode's light pages

export interface CameraCone { lat: number; lon: number; heading: number; hfovDeg: number; rangeM?: number }
interface Props {
  geo: GeoLayers; center: { lat: number; lon: number }; camera?: CameraCone | null;
  height?: number | string; zoom?: number; interactive?: boolean; className?: string;
  theme?: 'dark' | 'light';
  /** Building shadows to draw instead of the server's half-hourly ones (the full map passes the timeline's exact time). */
  shadow?: FC | null;
  /** Called once the style and these layers are in, so a caller can add its own sources on top. */
  onMap?: (m: MlMap) => void;
}

const EMPTY: FC = { type: 'FeatureCollection', features: [] };
const SOURCES: LayerId[] = ['alerts', 'film', 'closures', 'construction', 'buildings', 'pois', 'photographers', 'quakes', 'tides'];

/** A short line along each photo's compass heading, so the dots say which way people point. */
export function headingArrows(fc: FC | undefined, lengthM = 14): FC {
  const R = 6371008.8, out: FC = { type: 'FeatureCollection', features: [] };
  for (const f of fc?.features ?? []) {
    const h = f.properties.heading;
    if (f.geometry?.type !== 'Point' || typeof h !== 'number') continue;
    const [lon, lat] = f.geometry.coordinates, b = (h * Math.PI) / 180;
    const to: [number, number] = [lon + ((lengthM * Math.sin(b)) / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI), lat + ((lengthM * Math.cos(b)) / R) * (180 / Math.PI)];
    out.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[lon, lat], to] }, properties: { layer: 'photographers', kind: 'heading', label: '' } });
  }
  return out;
}

/** A wedge from the camera along its heading, `rangeM` long, as wide as the lens's horizontal field of view. */
export function conePolygon(c: CameraCone): FC {
  const R = 6371008.8, r = c.rangeM ?? 160, pts: number[][] = [[c.lon, c.lat]];
  for (let i = 0; i <= 12; i++) {
    const b = ((c.heading - c.hfovDeg / 2 + (c.hfovDeg * i) / 12) * Math.PI) / 180;
    pts.push([c.lon + ((r * Math.sin(b)) / (R * Math.cos((c.lat * Math.PI) / 180))) * (180 / Math.PI), c.lat + ((r * Math.cos(b)) / R) * (180 / Math.PI)]);
  }
  pts.push([c.lon, c.lat]);
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts as [number, number][]] }, properties: { layer: 'camera', kind: 'cone', label: 'Shot camera' } }] };
}

export default function Map2D({ geo, center, camera, height = 320, zoom = 16.2, interactive = true, className, theme = 'dark', shadow, onMap }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!el.current) return;
    const dark = theme === 'dark', halo = dark ? '#0b0b0a' : '#ffffff';
    const m = new MlMap({ container: el.current, style: dark ? MAP_STYLE : MAP_STYLE_LIGHT, center: [center.lon, center.lat], zoom, attributionControl: false, interactive, maxPitch: 60 });
    // OpenFreeMap's TileJSON carries its attribution ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap"); the control shows it.
    m.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    if (interactive) m.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    m.on('load', () => {
      // The dark style is near black; lift roads, buildings and labels a step so the base map reads under the layers.
      if (dark) for (const l of m.getStyle().layers ?? []) {
        if (l.type === 'line' && /road|highway|street|bridge|tunnel|path|rail/.test(l.id)) m.setPaintProperty(l.id, 'line-color', /path|rail/.test(l.id) ? '#34322e' : '#46443f');
        if (l.type === 'fill' && /building/.test(l.id)) m.setPaintProperty(l.id, 'fill-color', '#1f1e1b');
        if (l.type === 'fill' && /water/.test(l.id)) m.setPaintProperty(l.id, 'fill-color', '#0f1a24');
        if (l.type === 'symbol' && l.layout && 'text-field' in l.layout) m.setPaintProperty(l.id, 'text-color', '#8a867e');
      }
      for (const id of [...SOURCES, 'shadow', 'cone', 'mark', 'arrows']) m.addSource(`geo-${id}`, { type: 'geojson', data: EMPTY });
      const add = (spec: Parameters<MlMap['addLayer']>[0]) => m.addLayer(spec);
      add({ id: 'geo-shadow', type: 'fill', source: 'geo-shadow', filter: ['==', ['get', 'kind'], 'building_shadow'], paint: { 'fill-color': '#000', 'fill-opacity': 0.38 } });
      add({ id: 'geo-buildings', type: 'fill-extrusion', source: 'geo-buildings', paint: { 'fill-extrusion-color': '#3a3833', 'fill-extrusion-height': ['coalesce', ['get', 'height_m'], 9], 'fill-extrusion-opacity': 0.8 } });
      add({ id: 'geo-alerts', type: 'fill', source: 'geo-alerts', paint: { 'fill-color': '#e8675e', 'fill-opacity': 0.12 } });
      add({ id: 'geo-alerts-line', type: 'line', source: 'geo-alerts', paint: { 'line-color': '#e8675e', 'line-width': 1.5 } });
      add({ id: 'geo-film', type: 'fill', source: 'geo-film', paint: { 'fill-color': '#f2a33a', 'fill-opacity': ['case', ['==', ['get', 'active'], true], 0.55, 0.09] } });
      add({ id: 'geo-closures', type: 'fill', source: 'geo-closures', paint: { 'fill-color': '#e8675e', 'fill-opacity': 0.55 } });
      add({ id: 'geo-construction', type: 'fill', source: 'geo-construction', paint: { 'fill-color': '#d9b44a', 'fill-opacity': 0.5 } });
      add({ id: 'geo-construction-line', type: 'line', source: 'geo-construction', paint: { 'line-color': '#d9b44a', 'line-width': 1.2 } });
      // Plain dots, one per geotagged photo: where photographers stood. No glow; the overview legend names them.
      add({ id: 'geo-photographers', type: 'circle', source: 'geo-photographers', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 18, 3.5], 'circle-color': '#e6d3a8', 'circle-opacity': 0.8 } });
      add({ id: 'geo-photographers-arrows', type: 'line', source: 'geo-arrows', minzoom: 15.5, paint: { 'line-color': '#e6d3a8', 'line-width': 1, 'line-opacity': 0.6 } });
      add({ id: 'geo-pois', type: 'circle', source: 'geo-pois', paint: { 'circle-radius': 4, 'circle-stroke-width': 1, 'circle-stroke-color': halo,
        'circle-color': ['match', ['get', 'kind'], 'viewpoint', '#f2a33a', 'transit', '#5f9cf0', 'cafe', '#5ec8c2', '#a39f96'] } });
      add({ id: 'geo-pois-label', type: 'symbol', source: 'geo-pois', filter: ['in', ['get', 'kind'], ['literal', ['viewpoint', 'transit']]], minzoom: 15.5,
        layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': '#a39f96', 'text-halo-color': halo, 'text-halo-width': 1.2 } });
      add({ id: 'geo-quakes', type: 'circle', source: 'geo-quakes', paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 1.5, 3, 5, 14], 'circle-color': '#b48ce0', 'circle-opacity': 0.6 } });
      add({ id: 'geo-tides', type: 'circle', source: 'geo-tides', paint: { 'circle-radius': 5, 'circle-color': '#5f9cf0', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#c9d8f5' } });
      add({ id: 'geo-cone', type: 'fill', source: 'geo-cone', paint: { 'fill-color': '#f2a33a', 'fill-opacity': 0.2 } });
      add({ id: 'geo-cone-line', type: 'line', source: 'geo-cone', paint: { 'line-color': '#f2a33a', 'line-width': 1.5 } });
      add({ id: 'geo-mark', type: 'circle', source: 'geo-mark', paint: { 'circle-radius': 5, 'circle-color': '#f2efe8', 'circle-stroke-width': 2, 'circle-stroke-color': halo } });
      add({ id: 'geo-labels', type: 'symbol', source: 'geo-film', filter: ['==', ['get', 'active'], true], layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-optional': true }, paint: { 'text-color': '#f2a33a', 'text-halo-color': halo, 'text-halo-width': 1.2 } });
      ready.current = true;
      syncRef.current();
      onMap?.(m);
    });
    const popup = new Popup({ closeButton: false, closeOnClick: true, maxWidth: '260px', className: 'geo-popup' });
    const show = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f || (m.getLayer('map-pins') && m.queryRenderedFeatures(e.point, { layers: ['map-pins'] }).length)) return; // the Map view's pin card wins
      const p = f.properties as Record<string, string>;
      const box = document.createElement('div');
      const b = document.createElement('b'); b.textContent = p.label ?? ''; box.append(b);
      if (p.detail) { const s = document.createElement('p'); s.textContent = p.detail; box.append(s); }
      popup.setLngLat(e.lngLat).setDOMContent(box).addTo(m);
    };
    for (const l of ['geo-film', 'geo-closures', 'geo-construction', 'geo-alerts', 'geo-pois', 'geo-quakes', 'geo-tides', 'geo-photographers']) m.on('click', l, show);
    map.current = m;
    return () => { ready.current = false; map.current = null; m.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = () => {
    const m = map.current, d = geo.data;
    if (!m || !ready.current) return;
    const src = (id: string) => m.getSource(`geo-${id}`) as GeoJSONSource | undefined;
    for (const id of SOURCES) src(id)?.setData((d?.layers[id] ?? EMPTY) as never);
    src('shadow')?.setData((shadow ?? d?.layers.shadow ?? EMPTY) as never);
    src('arrows')?.setData(headingArrows(d?.layers.photographers) as never);
    src('cone')?.setData((camera ? conePolygon(camera) : EMPTY) as never);
    src('mark')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [center.lon, center.lat] }, properties: {} }] } as never);
    const vis = (layer: string, on: boolean) => { if (m.getLayer(layer)) m.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none'); };
    vis('geo-shadow', geo.on('shadow'));
    vis('geo-buildings', geo.on('buildings'));
    for (const id of ['alerts', 'film', 'closures', 'construction', 'pois', 'photographers', 'quakes'] as const)
      for (const l of [`geo-${id}`, `geo-${id}-line`, `geo-${id}-label`, `geo-${id}-arrows`]) vis(l, geo.on(id));
    vis('geo-labels', geo.on('film'));
    vis('geo-tides', geo.on('tides'));
  };
  syncRef.current = sync;
  useEffect(sync); // cheap: setData on a handful of small sources

  useEffect(() => { map.current?.easeTo({ center: [center.lon, center.lat], zoom, duration: 0 }); }, [center.lat, center.lon, zoom]);

  return <div ref={el} className={`geo-map ${className ?? ''}`} style={{ height }} aria-label="2D map of the spot with the data layers" role="region" />;
}
