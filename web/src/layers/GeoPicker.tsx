// A map for location clues (anywhere2.md): "pin" sets the exact standing spot (tap, or drag the pin), "area" draws a
// circle (drag its centre or its edge, or tap to move the centre). Same dark basemap as the Map view, 44 px touch
// handles, no session needed, so Simple's Drop, Found and Couldn't place and Studio's Change place can all embed it.
import { useEffect, useRef } from 'react';
import { Marker, type Map as MlMap, type GeoJSONSource } from 'maplibre-gl';
import { createMap } from './Map2D.tsx';
import { circle, metres, toLonLat } from '../../../crew/src/layers/geom.ts';
import './layers.css';

export interface PickedPoint { lat: number; lon: number }
export interface PickedArea { lat: number; lon: number; radiusM: number }
interface Common { center: PickedPoint; zoom?: number; height?: number | string; theme?: 'dark' | 'light' }
type Props = Common & (
  | { mode: 'pin'; value: PickedPoint | null; onChange: (v: PickedPoint) => void }
  | { mode: 'area'; value: PickedArea | null; onChange: (v: PickedArea) => void });

export const MIN_RADIUS_M = 100, MAX_RADIUS_M = 50_000, DEFAULT_RADIUS_M = 1500;
export const clampRadius = (m: number) => Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(m)));
export const fmtRadius = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m / 10) * 10} m`);
/** The circle's edge handle sits due east of the centre. */
export const edgeOf = (a: PickedArea) => { const [lon, lat] = toLonLat(a, [a.radiusM, 0]); return { lat, lon }; };
const EMPTY = { type: 'FeatureCollection', features: [] } as const;

function handle(kind: 'pin' | 'mid' | 'edge', label: string) {
  const d = document.createElement('div');
  d.className = `geo-handle ${kind}`;
  d.setAttribute('role', 'slider');
  d.setAttribute('aria-label', label);
  if (kind === 'edge') d.append(document.createElement('span'));
  return d;
}

export default function GeoPicker(props: Props) {
  const { mode, center, height = 320, theme = 'dark' } = props;
  const zoom = props.zoom ?? (mode === 'pin' ? 15 : 12);
  const el = useRef<HTMLDivElement>(null);
  const onChange = useRef(props.onChange as (v: PickedPoint | PickedArea) => void);
  onChange.current = props.onChange as (v: PickedPoint | PickedArea) => void;
  type State = { m: MlMap; pin?: Marker; mid?: Marker; edge?: Marker; area: PickedArea; shown: string; draw: () => void };
  const s = useRef<State | null>(null);
  const keyOf = (v: PickedPoint | PickedArea | null) => (v ? [v.lat.toFixed(6), v.lon.toFixed(6), 'radiusM' in v ? Math.round(v.radiusM) : ''].join() : '');

  useEffect(() => {
    const m = createMap(el.current!, { center, zoom, dark: theme === 'dark', interactive: true });
    m.dragRotate.disable(); m.touchZoomRotate.disableRotation(); // flat and north-up while picking
    const st: State = { m, area: (props.value && 'radiusM' in props.value) ? props.value : { ...center, radiusM: DEFAULT_RADIUS_M }, shown: keyOf(props.value), draw: () => {} };
    s.current = st;
    const emit = (v: PickedPoint | PickedArea) => { st.shown = keyOf(v); onChange.current(v); };

    if (mode === 'pin') {
      const pin = new Marker({ element: handle('pin', 'Where the photo was taken; drag to move'), draggable: true });
      st.pin = pin;
      if (props.value) pin.setLngLat([props.value.lon, props.value.lat]).addTo(m);
      pin.on('dragend', () => { const ll = pin.getLngLat(); emit({ lat: ll.lat, lon: ll.lng }); });
      m.on('click', e => { pin.setLngLat(e.lngLat).addTo(m); emit({ lat: e.lngLat.lat, lon: e.lngLat.lng }); });
    } else {
      const mid = new Marker({ element: handle('mid', 'Centre of the area; drag to move'), draggable: true });
      const edge = new Marker({ element: handle('edge', 'Edge of the area; drag to resize'), draggable: true });
      st.mid = mid; st.edge = edge;
      const place = () => { const e = edgeOf(st.area); mid.setLngLat([st.area.lon, st.area.lat]); edge.setLngLat([e.lon, e.lat]); };
      st.draw = () => {
        (m.getSource('pick-area') as GeoJSONSource | undefined)?.setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [circle([st.area.lon, st.area.lat], st.area.radiusM, 72)] }, properties: {} } as never);
        edge.getElement().querySelector('span')!.textContent = fmtRadius(st.area.radiusM);
      };
      place();
      mid.addTo(m); edge.addTo(m);
      m.on('load', () => {
        m.addSource('pick-area', { type: 'geojson', data: EMPTY as never });
        m.addLayer({ id: 'pick-area', type: 'fill', source: 'pick-area', paint: { 'fill-color': '#f2efe8', 'fill-opacity': 0.1 } });
        m.addLayer({ id: 'pick-area-line', type: 'line', source: 'pick-area', paint: { 'line-color': '#f2efe8', 'line-width': 2 } });
        st.draw();
      });
      mid.on('drag', () => { const ll = mid.getLngLat(); st.area = { ...st.area, lat: ll.lat, lon: ll.lng }; const e = edgeOf(st.area); edge.setLngLat([e.lon, e.lat]); st.draw(); });
      edge.on('drag', () => { const ll = edge.getLngLat(); st.area = { ...st.area, radiusM: clampRadius(metres(st.area, { lat: ll.lat, lon: ll.lng })) }; st.draw(); });
      for (const h of [mid, edge]) h.on('dragend', () => { place(); st.draw(); emit({ ...st.area }); });
      m.on('click', e => { st.area = { ...st.area, lat: e.lngLat.lat, lon: e.lngLat.lng }; place(); st.draw(); emit({ ...st.area }); });
      if (!props.value) emit({ ...st.area }); // "Use this area" always has a value
      m.once('load', () => fit(m, st.area));
    }
    return () => { s.current = null; m.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A value from outside (a search result, say) moves the pin or circle and brings it into view.
  useEffect(() => {
    const st = s.current, v = props.value;
    if (!st || !v || keyOf(v) === st.shown) return;
    st.shown = keyOf(v);
    if (mode === 'pin' && st.pin) { st.pin.setLngLat([v.lon, v.lat]).addTo(st.m); st.m.easeTo({ center: [v.lon, v.lat], zoom: Math.max(st.m.getZoom(), 15) }); }
    if (mode === 'area' && 'radiusM' in v && st.mid && st.edge) {
      st.area = { ...v, radiusM: clampRadius(v.radiusM) };
      const e = edgeOf(st.area);
      st.mid.setLngLat([v.lon, v.lat]); st.edge.setLngLat([e.lon, e.lat]); st.draw();
      fit(st.m, st.area);
    }
  }, [keyOf(props.value)]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="geo-map geo-picker" data-theme={theme} data-mode={mode} style={{ height }} aria-label={mode === 'pin' ? 'Map: tap where the photo was taken' : 'Map: drag the circle around where the photo was taken'} role="region" />;
}

function fit(m: MlMap, a: PickedArea) {
  const ring = circle([a.lon, a.lat], a.radiusM, 16);
  const lons = ring.map(c => c[0]), lats = ring.map(c => c[1]);
  m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 48, duration: 0 });
}
