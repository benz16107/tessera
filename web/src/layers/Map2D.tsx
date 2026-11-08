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

export interface CameraCone { lat: number; lon: number; heading: number; hfovDeg: number; rangeM?: number }
interface Props {
  geo: GeoLayers; center: { lat: number; lon: number }; camera?: CameraCone | null;
  height?: number | string; zoom?: number; interactive?: boolean; className?: string;
}

const EMPTY: FC = { type: 'FeatureCollection', features: [] };
const SOURCES: LayerId[] = ['alerts', 'film', 'closures', 'construction', 'buildings', 'pois', 'photographers', 'quakes', 'tides'];

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

export default function Map2D({ geo, center, camera, height = 320, zoom = 16.2, interactive = true, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!el.current) return;
    const m = new MlMap({ container: el.current, style: MAP_STYLE, center: [center.lon, center.lat], zoom, attributionControl: false, interactive, maxPitch: 60 });
    // OpenFreeMap's TileJSON carries its attribution ("OpenFreeMap © OpenMapTiles Data from OpenStreetMap"); the control shows it.
    m.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    if (interactive) m.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    m.on('load', () => {
      // The dark style is near black; lift roads, buildings and labels a step so the base map reads under the layers.
      for (const l of m.getStyle().layers ?? []) {
        if (l.type === 'line' && /road|highway|street|bridge|tunnel|path|rail/.test(l.id)) m.setPaintProperty(l.id, 'line-color', /path|rail/.test(l.id) ? '#34322e' : '#46443f');
        if (l.type === 'fill' && /building/.test(l.id)) m.setPaintProperty(l.id, 'fill-color', '#1f1e1b');
        if (l.type === 'fill' && /water/.test(l.id)) m.setPaintProperty(l.id, 'fill-color', '#0f1a24');
        if (l.type === 'symbol' && l.layout && 'text-field' in l.layout) m.setPaintProperty(l.id, 'text-color', '#8a867e');
      }
      for (const id of [...SOURCES, 'shadow', 'cone', 'mark']) m.addSource(`geo-${id}`, { type: 'geojson', data: EMPTY });
      const add = (spec: Parameters<MlMap['addLayer']>[0]) => m.addLayer(spec);
      add({ id: 'geo-shadow', type: 'fill', source: 'geo-shadow', filter: ['==', ['get', 'kind'], 'building_shadow'], paint: { 'fill-color': '#000', 'fill-opacity': 0.38 } });
      add({ id: 'geo-buildings', type: 'fill-extrusion', source: 'geo-buildings', paint: { 'fill-extrusion-color': '#3a3833', 'fill-extrusion-height': ['coalesce', ['get', 'height_m'], 9], 'fill-extrusion-opacity': 0.8 } });
      add({ id: 'geo-alerts', type: 'fill', source: 'geo-alerts', paint: { 'fill-color': '#e8675e', 'fill-opacity': 0.12 } });
      add({ id: 'geo-alerts-line', type: 'line', source: 'geo-alerts', paint: { 'line-color': '#e8675e', 'line-width': 1.5 } });
      add({ id: 'geo-film', type: 'fill', source: 'geo-film', paint: { 'fill-color': '#f2a33a', 'fill-opacity': ['case', ['==', ['get', 'active'], true], 0.55, 0.16] } });
      add({ id: 'geo-closures', type: 'fill', source: 'geo-closures', paint: { 'fill-color': '#e8675e', 'fill-opacity': 0.55 } });
      add({ id: 'geo-construction', type: 'fill', source: 'geo-construction', paint: { 'fill-color': '#d9b44a', 'fill-opacity': 0.5 } });
      add({ id: 'geo-construction-line', type: 'line', source: 'geo-construction', paint: { 'line-color': '#d9b44a', 'line-width': 1.2 } });
      add({ id: 'geo-photographers', type: 'heatmap', source: 'geo-photographers', paint: {
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 13, 5, 17, 16], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 13, 0.3, 17, 0.7],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(242,163,58,0)', 0.25, 'rgba(242,163,58,0.35)', 0.6, 'rgba(247,201,122,0.7)', 1, 'rgba(255,244,214,0.95)'],
        'heatmap-opacity': 0.7 } });
      add({ id: 'geo-photographers-dot', type: 'circle', source: 'geo-photographers', minzoom: 17, paint: { 'circle-radius': 2.5, 'circle-color': '#f7c97a' } });
      add({ id: 'geo-pois', type: 'circle', source: 'geo-pois', paint: { 'circle-radius': 4, 'circle-stroke-width': 1, 'circle-stroke-color': '#0b0b0a',
        'circle-color': ['match', ['get', 'kind'], 'viewpoint', '#f2a33a', 'transit', '#5f9cf0', 'cafe', '#5ec8c2', '#a39f96'] } });
      add({ id: 'geo-pois-label', type: 'symbol', source: 'geo-pois', filter: ['in', ['get', 'kind'], ['literal', ['viewpoint', 'transit']]], minzoom: 15.5,
        layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': '#a39f96', 'text-halo-color': '#0b0b0a', 'text-halo-width': 1.2 } });
      add({ id: 'geo-quakes', type: 'circle', source: 'geo-quakes', paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 1.5, 3, 5, 14], 'circle-color': '#b48ce0', 'circle-opacity': 0.6 } });
      add({ id: 'geo-tides', type: 'circle', source: 'geo-tides', paint: { 'circle-radius': 5, 'circle-color': '#5f9cf0', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#c9d8f5' } });
      add({ id: 'geo-cone', type: 'fill', source: 'geo-cone', paint: { 'fill-color': '#f2a33a', 'fill-opacity': 0.2 } });
      add({ id: 'geo-cone-line', type: 'line', source: 'geo-cone', paint: { 'line-color': '#f2a33a', 'line-width': 1.5 } });
      add({ id: 'geo-mark', type: 'circle', source: 'geo-mark', paint: { 'circle-radius': 5, 'circle-color': '#f2efe8', 'circle-stroke-width': 2, 'circle-stroke-color': '#0b0b0a' } });
      add({ id: 'geo-labels', type: 'symbol', source: 'geo-film', filter: ['==', ['get', 'active'], true], layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-optional': true }, paint: { 'text-color': '#f2a33a', 'text-halo-color': '#0b0b0a', 'text-halo-width': 1.2 } });
      ready.current = true;
      syncRef.current();
    });
    const popup = new Popup({ closeButton: false, closeOnClick: true, maxWidth: '260px', className: 'geo-popup' });
    const show = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, string>;
      const box = document.createElement('div');
      const b = document.createElement('b'); b.textContent = p.label ?? ''; box.append(b);
      if (p.detail) { const s = document.createElement('p'); s.textContent = p.detail; box.append(s); }
      popup.setLngLat(e.lngLat).setDOMContent(box).addTo(m);
    };
    for (const l of ['geo-film', 'geo-closures', 'geo-construction', 'geo-alerts', 'geo-pois', 'geo-quakes', 'geo-tides', 'geo-photographers-dot']) m.on('click', l, show);
    map.current = m;
    return () => { ready.current = false; map.current = null; m.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = () => {
    const m = map.current, d = geo.data;
    if (!m || !ready.current) return;
    const src = (id: string) => m.getSource(`geo-${id}`) as GeoJSONSource | undefined;
    for (const id of SOURCES) src(id)?.setData((d?.layers[id] ?? EMPTY) as never);
    src('shadow')?.setData((d?.layers.shadow ?? EMPTY) as never);
    src('cone')?.setData((camera ? conePolygon(camera) : EMPTY) as never);
    src('mark')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [center.lon, center.lat] }, properties: {} }] } as never);
    const vis = (layer: string, on: boolean) => { if (m.getLayer(layer)) m.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none'); };
    vis('geo-shadow', geo.on('shadow'));
    vis('geo-buildings', geo.on('buildings'));
    for (const id of ['alerts', 'film', 'closures', 'construction', 'pois', 'photographers', 'quakes'] as const)
      for (const l of [`geo-${id}`, `geo-${id}-line`, `geo-${id}-label`, `geo-${id}-dot`]) vis(l, geo.on(id));
    vis('geo-labels', geo.on('film'));
    vis('geo-tides', geo.on('tides'));
  };
  syncRef.current = sync;
  useEffect(sync); // cheap: setData on a handful of small sources

  useEffect(() => { map.current?.easeTo({ center: [center.lon, center.lat], zoom, duration: 0 }); }, [center.lat, center.lon, zoom]);

  return <div ref={el} className={`geo-map ${className ?? ''}`} style={{ height }} aria-label="2D map of the spot with the data layers" role="region" />;
}
