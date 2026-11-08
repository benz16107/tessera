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
  const photos = geo.data.summary.photographers?.count ?? 0;
  return (
    <div className="geo-overview" style={{ opacity: k }} aria-hidden={k < 0.5}>
      <Suspense fallback={null}>
        <Map2D geo={geo} center={center} camera={camera} height="100%" zoom={Math.min(17, zoomForHeight(heightM, center.lat, widthPx))} interactive={false} />
      </Suspense>
      {k > 0.6 && (
        // Top right: the studio's "Building your set" card sits bottom left and the picture-in-picture bottom right.
        <div className="geo-overview-card">
          <p><b>Map overview</b> · zoom in for the 3D set</p>
          <ul className="geo-legend">
            {geo.on('photographers') && photos > 0 && <li><i className="dot" />Where photographers stood: {photos} geotagged Commons photos</li>}
            {geo.on('film') && <li><i style={{ background: '#f2a33a' }} />Blocks with film permits in the past year</li>}
            {geo.on('construction') && <li><i style={{ background: '#d9b44a' }} />Sidewalk sheds and scaffolds</li>}
            {camera && <li><i className="cone" />What Cam A sees</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
