// A-4 Take me there: the scout camera (web/src/Scout.tsx) in the stage, and the walk in words beside it: distance from
// this person's shared device position, walking directions, the geo thread's compact map of the shot (web/src/layers),
// and a QR code to open the camera on a phone.
import { Suspense, useEffect, useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import QRCode from 'qrcode';
import { tables } from '../module_bindings/index.ts';
import type { Photo, Pose, Session, Spot } from '../module_bindings/types.ts';
import { useGeoLayers, GeoMapView } from '../layers/index.ts';
import { useConfig, shareBase } from '../config.ts';
import { bearing, compassWord, metersBetween } from '../geo.ts';
import { ScoutView } from '../Scout.tsx';
import { fmtDistance, parseGeo } from './lib.ts';
import { Arrow } from './icons.tsx';

function There({ session, pose, spot, zone }: { session: Session; pose: Pose; photo: Photo; zone: string; spot?: Spot }) {
  const { identity } = useSpacetimeDB();
  const [parts] = useTable(tables.participant.where(r => r.sessionId.eq(session.id)));
  const [poses] = useTable(tables.devicePose.where(r => r.sessionId.eq(session.id)));
  const [qr, setQr] = useState('');
  const scoutUrl = `${shareBase(useConfig())}/s/${session.code}`;
  useEffect(() => { QRCode.toDataURL(scoutUrl, { margin: 1, width: 320, color: { dark: '#1d1d1f', light: '#ffffff' } }).then(setQr).catch(() => {}); }, [scoutUrl]);
  const planTime = session.planTime?.toDate() ?? new Date(); // useGeoLayers rounds to half-hour slots, so a fresh Date is fine
  const geo = useGeoLayers(session.id, session.spotId, planTime);
  const walk = `https://www.google.com/maps/dir/?api=1&destination=${pose.lat},${pose.lon}&travelmode=walking`;
  const face = `${Math.round(pose.heading)}° ${compassWord(pose.heading)}`;
  // Everyone walking: this person and any scout, from the shared device_pose rows.
  const walkers = poses.map(d => {
    const p = parts.find(x => x.id === d.participantId);
    if (!p || !p.online) return null;
    const m = metersBetween(d.lat, d.lon, pose.lat, pose.lon);
    return { id: String(d.participantId), name: identity && p.identity.isEqual(identity) ? 'You' : p.name, m, dir: compassWord(bearing(d.lat, d.lon, pose.lat, pose.lon)) };
  }).filter(Boolean) as { id: string; name: string; m: number; dir: string }[];

  return (
    <article className="s-there">
      <p className="s-eyebrow">Take me there</p>
      {/* A free-location shoot has no measured heading: only the walk. */}
      <h1 className="s-title">{parseGeo(session.spotId) ? 'Walk to the mark' : `Walk to the mark, then face ${face}`}</h1>
      <ol className="s-howto">
        <li>Open the camera. The original photo sits over it as a ghost.</li>
        <li>Follow the arrow until the card says you're there.</li>
        <li>Turn until the street lines up with the ghost, then take the photo.</li>
      </ol>
      <a className="s-btn primary big" href={walk} target="_blank" rel="noreferrer"><Arrow width={18} height={18} /> Walking directions</a>
      <div className="s-map" aria-label="Map of the shot: the camera and its view, the sun, and anyone walking">
        <Suspense fallback={<span className="s-sk s-sk-fill" />}>
          <GeoMapView compact geo={geo} sessionId={session.id} origin={{ lat: spot?.lat ?? pose.lat, lon: spot?.lon ?? pose.lon, height: 0 }} at={planTime} zone={zone} />
        </Suspense>
      </div>
      {walkers.length > 0 && (
        <>
          <hr />
          <p className="s-label">On the way</p>
          <ul className="s-walkers">
            {walkers.map(w => <li key={w.id}><b>{w.name}</b><span>{w.m <= 8 ? 'at the mark' : `${fmtDistance(w.m)} away, head ${w.dir}`}</span></li>)}
          </ul>
        </>
      )}
      <hr />
      <div className="s-phoneqr">
        {qr ? <img src={qr} alt={`QR code to open the scout camera at ${scoutUrl}`} width={112} height={112} /> : <span className="s-sk s-sk-qr" />}
        <div>
          <p className="s-label">On a laptop?</p>
          <p className="s-muted">Scan this with your phone to open the camera there. Your walk shows up here live.</p>
        </div>
      </div>
    </article>
  );
}

function Stage({ session, live }: { session: Session; live: boolean }) {
  return live ? <ScoutView session={session} /> : null;
}

export default Object.assign(There, { Stage });
