// The 2D map as the overview: past about 300 m of camera height the 3D set fades into the map, centred where the
// camera looks, at the zoom that matches its height. It takes no pointer input, so orbiting back down still works.
import { lazy, Suspense } from 'react';
import type { GeoLayers } from './useGeoLayers.ts';
import type { CameraCone } from './Map2D.tsx';
import './layers.css';

const Map2D = lazy(() => import('./Map2D.tsx'));

/** Web-mercator zoom at which a `heightM` camera with a 50 degree field of view fills `widthPx`. */
export const zoomForHeight = (heightM: number, lat: number, widthPx: number) =>
  Math.log2((156543.03 * Math.cos((lat * Math.PI) / 180) * widthPx) / Math.max(1, 0.93 * heightM));

export default function GeoOverview({ geo, center, camera, heightM, widthPx, from = 300, to = 650 }: {
  geo: GeoLayers; center: { lat: number; lon: number }; camera?: CameraCone | null; heightM: number; widthPx: number; from?: number; to?: number;
}) {
  if (heightM < from || !geo.data) return null;
  const k = Math.min(1, (heightM - from) / (to - from));
  return (
    <div className="geo-overview" style={{ opacity: k }} aria-hidden={k < 0.5}>
      <Suspense fallback={null}>
        <Map2D geo={geo} center={center} camera={camera} height="100%" zoom={Math.min(17, zoomForHeight(heightM, center.lat, widthPx))} interactive={false} />
      </Suspense>
      {k > 0.6 && <span className="st-pill geo-overview-pill">Map overview · zoom in for the 3D set</span>}
    </div>
  );
}
