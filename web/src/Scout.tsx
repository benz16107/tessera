// The scout's camera (Figma A-4): walk to the mark with the original photo as a ghost over the live camera, a distance
// card with an arrow, and "You're there" with the last turn. /s/:code uses it full screen with its own identity; Simple's
// "Take me there" step embeds the same view. Position and compass go to device_pose so everyone sees the walk.
import { useEffect, useRef, useState } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module_bindings/index.ts';
import type { Session } from './module_bindings/types.ts';
import { NAME_KEY } from './config.ts';
import { useSessionCard } from './spacetime/hooks.ts';
import { useClaimInvite } from './photon/hooks.ts';
import { bearing, metersBetween, angleDiff, compassWord, norm360 } from './geo.ts';
import { Check, Turn, Up, Viewfinder } from './simple/icons.tsx';
import { fmtDistance, photoCredit } from './simple/lib.ts';
import './simple/simple.css';

const ARRIVED_M = 8; // matches the module's scout_arrived toast

export default function Scout({ code }: { code: string }) {
  const { identity, isActive } = useSpacetimeDB();
  // Session rows are visible only to participants; the session_card(code) view shows the title before joining.
  const [card, ready] = useSessionCard(code);
  const [rows] = useTable(tables.session.where(r => r.code.eq(code)));
  const session = rows[0];
  const [parts, partsReady] = useTable(tables.participant.where(r => r.sessionId.eq(card?.id ?? 0n)), { enabled: !!card });
  const join = useReducer(reducers.joinSession);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [err, setErr] = useState('');
  const me = identity && parts.find(p => p.identity.isEqual(identity));
  useClaimInvite(me ? me.id : undefined); // opened from a Photon invite: link this phone to the invitee's channel

  const brand = <p className="s-logo"><Viewfinder width={18} height={18} /> ShotMatch</p>;
  if (!ready || (card && !partsReady)) return <div className="simple s-center" aria-busy="true">{brand}<span className="s-sk s-sk-line" /></div>;
  if (!card) return <div className="simple s-center">{brand}<h1>No shoot with the code {code}</h1><p className="s-muted">Check the link or the QR code.</p></div>;
  if (!me || me.role !== 'scout') {
    return (
      <main className="simple s-center">
        {brand}
        <p className="s-eyebrow">Scout</p>
        <h1>{card.title}</h1>
        <p className="s-muted">Walk to the mark with the camera open. Your position and compass heading are shared with this shoot while the page is open.</p>
        <form className="s-join-form" onSubmit={e => {
          e.preventDefault();
          const n = name.trim() || 'Scout';
          localStorage.setItem(NAME_KEY, n);
          join({ code, name: n, role: 'scout' }).catch(x => setErr(String(x?.message ?? x)));
        }}>
          <label htmlFor="sc-name">Your name</label>
          <input id="sc-name" className="s-field" value={name} onChange={e => setName(e.target.value)} maxLength={40} autoComplete="nickname" />
          {err && <p className="s-error" role="alert">{err}</p>}
          <button className="s-btn primary wide" disabled={!isActive}>Join as scout</button>
        </form>
      </main>
    );
  }
  if (!session) return <div className="simple s-center" aria-busy="true">{brand}<span className="s-sk s-sk-line" /></div>;
  return <main className="simple sc-page"><ScoutView session={session} /></main>;
}

interface Fix { lat: number; lon: number; acc: number }

export function ScoutView({ session }: { session: Session }) {
  const sid = session.id;
  const { identity } = useSpacetimeDB();
  const [cams] = useTable(tables.camera.where(r => r.sessionId.eq(sid)));
  const [results] = useTable(tables.solveResult.where(r => r.sessionId.eq(sid)));
  const [photos] = useTable(tables.photo.where(r => r.sessionId.eq(sid)));
  const [parts] = useTable(tables.participant.where(r => r.sessionId.eq(sid)));
  const push = useReducer(reducers.pushDevicePose);

  const [started, setStarted] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState('');
  const [geoErr, setGeoErr] = useState('');
  const [fix, setFix] = useState<Fix | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [opacity, setOpacity] = useState(0.4);
  const [shot, setShot] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const latest = useRef<{ fix: Fix | null; heading: number | null }>({ fix: null, heading: null });

  // Target: the shared camera row (the solved mark), else the newest placed result.
  const placed = [...results].filter(r => r.confidence !== 'none').sort((a, b) => Number(b.jobId - a.jobId))[0];
  const target = cams[0]?.pose ?? placed?.pose;
  const ghost = placed ? photos.find(p => p.id === placed.photoId) : [...photos].sort((a, b) => Number(b.id - a.id))[0];
  const planners = parts.filter(p => p.online && p.role === 'planner' && !(identity && p.identity.isEqual(identity))).map(p => p.name);

  const start = async () => {
    // iOS asks for motion permission only from a tap.
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE?.requestPermission === 'function') { try { await DOE.requestPermission(); } catch { /* denied: GPS still works */ } }
    setStarted(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
      stream.current = s;
      if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
      setCamOn(true);
    } catch (e) {
      setCamErr(e instanceof Error ? e.message : 'camera unavailable');
    }
  };

  useEffect(() => {
    if (!started) return;
    if (!('geolocation' in navigator)) { setGeoErr('This browser has no location.'); return; }
    const w = navigator.geolocation.watchPosition(
      p => { const f = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; latest.current.fix = f; setFix(f); setGeoErr(''); },
      e => setGeoErr(e.code === 1 ? 'Location is off for this page. Allow it in the browser settings.' : 'Waiting for a GPS fix.'),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    const onOrient = (e: DeviceOrientationEvent) => {
      const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      let h: number | null = null;
      if (typeof ios === 'number' && !Number.isNaN(ios)) h = ios;
      else if (e.absolute && e.alpha !== null) h = 360 - e.alpha;
      if (h === null) return;
      h = norm360(h + (screen.orientation?.angle ?? 0));
      latest.current.heading = h;
      setHeading(h);
    };
    const absEvent = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    addEventListener(absEvent, onOrient as EventListener);
    // Push the latest fix at most 5 times a second.
    const t = setInterval(() => {
      const { fix: f, heading: h } = latest.current;
      if (f) push({ sessionId: sid, lat: f.lat, lon: f.lon, accuracyM: f.acc, heading: h ?? undefined }).catch(() => {});
    }, 200);
    return () => { navigator.geolocation.clearWatch(w); removeEventListener(absEvent, onOrient as EventListener); clearInterval(t); };
  }, [started, sid, push]);

  // Stop the camera when leaving (the stream is kept in a ref, so a detached video element can't hide it).
  useEffect(() => () => { stream.current?.getTracks().forEach(t => t.stop()); }, []);

  const dist = fix && target ? metersBetween(fix.lat, fix.lon, target.lat, target.lon) : null;
  const there = dist !== null && dist <= ARRIVED_M;
  const toMark = fix && target ? bearing(fix.lat, fix.lon, target.lat, target.lon) : null;
  // At the mark the arrow turns toward the shot's heading instead.
  const aim = there && target ? target.heading : toMark;
  const turn = aim !== null && heading !== null ? angleDiff(aim, heading) : null;
  const walk = target ? `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lon}&travelmode=walking` : '';
  const credit = ghost ? photoCredit(ghost, session.spotId) : '';

  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob(async b => {
      if (!b) return;
      const file = new File([b], `shotmatch-${session.code}.jpg`, { type: 'image/jpeg' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }).catch(() => {}); return; }
      if (shot) URL.revokeObjectURL(shot);
      setShot(URL.createObjectURL(b));
    }, 'image/jpeg', 0.92);
  };

  return (
    <div className="sc" data-started={started || undefined}>
      <video ref={video} className="sc-feed" playsInline muted autoPlay aria-label="Rear camera" />
      {ghost && <img className="sc-ghost" src={ghost.url || ghost.thumb} alt="" aria-hidden="true" style={{ opacity: started ? opacity : 1 }} />}
      {!started ? (
        <div className="sc-start">
          <div className="sc-startcard">
            <p className="s-eyebrow">{session.title}</p>
            <h2>Walk to the mark</h2>
            <p className="s-muted">The camera opens with the original photo over it. Line the two up, then shoot.</p>
            <button className="s-btn primary wide big" onClick={start}>Open camera and compass</button>
            {walk && <a className="s-textbtn" href={walk} target="_blank" rel="noreferrer">Walking directions in Maps</a>}
            <p className="s-muted small">Your browser asks for the camera, location and motion.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="sc-top">
            <div className="sc-card" aria-live="polite">
              {!target ? <p className="sc-sub">No mark yet. The photo is still being placed.</p>
                : there ? (
                  <>
                    <span className="sc-ok" aria-hidden="true"><Check width={26} height={26} /></span>
                    <div>
                      <p className="sc-big">You're there.</p>
                      <p className="sc-turn">{turn === null ? `Face ${Math.round(target.heading)}° ${compassWord(target.heading)}`
                        : Math.abs(turn) < 6 ? 'Facing the right way. Take it.'
                        : <><Turn width={18} height={18} /> Turn {turn > 0 ? 'right' : 'left'} {Math.round(Math.abs(turn))}°</>}</p>
                    </div>
                  </>
                )
                : dist !== null ? (
                  <>
                    <div>
                      <p className="sc-dist">{fmtDistance(dist)}</p>
                      <p className="sc-sub">to the mark{fix ? ` · GPS ±${Math.round(fix.acc)} m` : ''}</p>
                    </div>
                    {turn !== null && (
                      <span className="sc-arrow" role="img" aria-label={`Turn ${turn > 0 ? 'right' : 'left'} ${Math.round(Math.abs(turn))} degrees`}>
                        <Up width={30} height={30} style={{ transform: `rotate(${turn}deg)` }} />
                      </span>
                    )}
                  </>
                )
                : <p className="sc-sub">{geoErr || 'Waiting for a GPS fix.'}</p>}
            </div>
            <div className="sc-chips">
              <span className="sc-chip"><i aria-hidden="true" />{session.code}{planners.length ? ` · ${planners.slice(0, 2).join(' and ')} ${planners.length === 1 ? 'is' : 'are'} planning` : ''}</span>
              {walk && !there && <a className="sc-chip" href={walk} target="_blank" rel="noreferrer">Directions</a>}
            </div>
            {aim !== null && heading === null && <p className="sc-chip sc-note">No compass on this device. Head {compassWord(aim)} ({Math.round(aim)}°).</p>}
            {camErr && <p className="sc-chip sc-note">No camera ({camErr}). Distance and the arrow still work.</p>}
          </div>
          <div className="sc-bottom">
            {ghost && (
              <label className="sc-ghostctl">
                <span>Ghost</span>
                <input type="range" min={0} max={0.9} step={0.01} value={opacity} onChange={e => setOpacity(+e.target.value)} aria-label="Ghost of the original photo" aria-valuetext={`${Math.round(opacity * 100)}%`} />
                <span className="sc-pct">{Math.round(opacity * 100)}%</span>
              </label>
            )}
            <div className="sc-row">
              {ghost ? (
                <button className="sc-thumb" onClick={() => setOpacity(o => (o > 0.05 ? 0 : 0.4))} aria-label={opacity > 0.05 ? 'Hide the ghost' : 'Show the ghost'}>
                  <img src={ghost.thumb} alt="" />
                </button>
              ) : <span className="sc-thumb" />}
              <button className="sc-shutter" onClick={shoot} disabled={!camOn} aria-label="Take the photo" />
              {shot ? <a className="sc-thumb" href={shot} download={`shotmatch-${session.code}.jpg`} aria-label="Save the photo you took"><img src={shot} alt="" /></a> : <span className="sc-thumb sc-empty" />}
            </div>
            {credit && <p className="sc-credit">Ghost: {credit.replace(/^Photo: /, '')}</p>}
          </div>
        </>
      )}
    </div>
  );
}
