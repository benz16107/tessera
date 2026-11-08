import { useEffect, useRef, useState } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module_bindings/index.ts';
import type { Session } from './module_bindings/types.ts';
import { NAME_KEY } from './config.ts';
import { bearing, metersBetween, angleDiff, compassWord, norm360 } from './geo.ts';

const ARRIVED_M = 8; // matches the module's scout_arrived toast

export default function Scout({ code }: { code: string }) {
  const { identity, isActive } = useSpacetimeDB();
  const [rows, ready] = useTable(tables.session.where(r => r.code.eq(code)));
  const session = rows[0];
  const [parts, partsReady] = useTable(tables.participant.where(r => r.sessionId.eq(session?.id ?? 0n)), { enabled: !!session });
  const join = useReducer(reducers.joinSession);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [err, setErr] = useState('');
  const me = identity && parts.find(p => p.identity.isEqual(identity));

  if (!ready || (session && !partsReady)) return <div className="scout-wait" aria-busy="true"><p className="wordmark">ShotMatch</p><span className="sk sk-line" /></div>;
  if (!session) return <div className="scout-wait"><p className="wordmark">ShotMatch</p><h1>No shoot with code {code}</h1><p>Check the link or QR code.</p></div>;
  if (!me || me.role !== 'scout') {
    return (
      <main className="scout-wait">
        <p className="wordmark">ShotMatch scout</p>
        <h1>{session.title}</h1>
        <p>You will walk to the mark with the camera open. Your position and compass heading are shared with this shoot while the page is open.</p>
        <form className="stack" onSubmit={e => {
          e.preventDefault();
          const n = name.trim() || 'Scout';
          localStorage.setItem(NAME_KEY, n);
          join({ code, name: n, role: 'scout' }).catch(x => setErr(String(x?.message ?? x)));
        }}>
          <label className="field"><span>Your name</span><input value={name} onChange={e => setName(e.target.value)} maxLength={40} autoComplete="nickname" /></label>
          {err && <p className="error" role="alert">{err}</p>}
          <button className="btn primary big-btn" disabled={!isActive}>Join as scout</button>
        </form>
      </main>
    );
  }
  return <ScoutLive session={session} />;
}

interface Fix { lat: number; lon: number; acc: number }

function ScoutLive({ session }: { session: Session }) {
  const sid = session.id;
  const [cams] = useTable(tables.camera.where(r => r.sessionId.eq(sid)));
  const [results] = useTable(tables.solveResult.where(r => r.sessionId.eq(sid)));
  const [photos] = useTable(tables.photo.where(r => r.sessionId.eq(sid)));
  const push = useReducer(reducers.pushDevicePose);

  const [started, setStarted] = useState(false);
  const [camErr, setCamErr] = useState('');
  const [geoErr, setGeoErr] = useState('');
  const [fix, setFix] = useState<Fix | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [opacity, setOpacity] = useState(0.4);
  const video = useRef<HTMLVideoElement>(null);
  const latest = useRef<{ fix: Fix | null; heading: number | null }>({ fix: null, heading: null });

  // Target: the shared camera row (the solved mark), else the newest placed result.
  const placed = [...results].filter(r => r.confidence !== 'none').sort((a, b) => Number(b.jobId - a.jobId))[0];
  const target = cams[0]?.pose ?? placed?.pose;
  const ghost = placed ? photos.find(p => p.id === placed.photoId) : [...photos].sort((a, b) => Number(b.id - a.id))[0];

  const start = async () => {
    // iOS asks for motion permission only from a tap.
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE?.requestPermission === 'function') { try { await DOE.requestPermission(); } catch { /* denied: GPS still works */ } }
    setStarted(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
      if (video.current) { video.current.srcObject = stream; await video.current.play().catch(() => {}); }
    } catch (e) {
      setCamErr(e instanceof Error ? e.message : 'Camera unavailable');
    }
  };

  useEffect(() => {
    if (!started) return;
    if (!('geolocation' in navigator)) { setGeoErr('This browser has no location.'); return; }
    const w = navigator.geolocation.watchPosition(
      p => { const f = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; latest.current.fix = f; setFix(f); setGeoErr(''); },
      e => setGeoErr(e.code === 1 ? 'Location permission is off. Allow it in the browser settings.' : 'Waiting for a GPS fix.'),
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

  // Stop the camera when leaving.
  useEffect(() => () => { (video.current?.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop()); }, []);

  const dist = fix && target ? metersBetween(fix.lat, fix.lon, target.lat, target.lon) : null;
  const there = dist !== null && dist <= ARRIVED_M;
  const toMark = fix && target ? bearing(fix.lat, fix.lon, target.lat, target.lon) : null;
  // At the mark the arrow turns toward the shot's heading instead.
  const aim = there && target ? target.heading : toMark;
  const turn = aim !== null && heading !== null ? angleDiff(aim, heading) : null;

  return (
    <main className="scout">
      <video ref={video} className="feed" playsInline muted autoPlay aria-label="Rear camera" />
      {ghost && started && <img className="ghost" src={ghost.url || ghost.thumb} alt="" aria-hidden="true" style={{ opacity }} />}
      {!started && (
        <div className="scout-start">
          <p className="wordmark">ShotMatch scout</p>
          <h1>{session.title}</h1>
          {ghost && <img className="start-thumb" src={ghost.thumb} alt="The shot you are matching" />}
          <button className="btn primary big-btn" onClick={start}>Open camera and compass</button>
          <p className="muted small">Your browser asks for camera, location and motion access.</p>
        </div>
      )}
      {started && (
        <>
          <div className="hud-top" aria-live="polite">
            {!target ? <p>No mark yet. The planner's photo is still being placed.</p>
              : there ? <p className="there">You're there. {turn !== null ? (Math.abs(turn) < 8 ? `Facing ${compassWord(target.heading)}, shoot.` : `Turn ${turn > 0 ? 'right' : 'left'} ${Math.round(Math.abs(turn))}°.`) : `Face ${Math.round(target.heading)}° ${compassWord(target.heading)}.`}</p>
              : dist !== null ? <p><span className="big mono">{dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(2)} km`}</span> to the mark{fix ? <span className="mono muted"> GPS ±{Math.round(fix.acc)} m</span> : null}</p>
              : <p>{geoErr || 'Waiting for a GPS fix.'}</p>}
            {camErr && <p className="error">No camera ({camErr}). Distance and the arrow still work.</p>}
          </div>
          {turn !== null && (
            <div className="arrow" style={{ transform: `rotate(${turn}deg)` }} role="img" aria-label={`Turn ${turn > 0 ? 'right' : 'left'} ${Math.round(Math.abs(turn))} degrees`}>
              <svg viewBox="0 0 60 60"><path d="M30 4 L52 50 L30 38 L8 50 Z" /></svg>
            </div>
          )}
          {aim !== null && heading === null && <p className="hud-mid">Compass unavailable. Head {compassWord(aim)} ({Math.round(aim)}°).</p>}
          <div className="hud-bottom">
            {ghost && (
              <label className="slider inline">
                <span>Camera</span>
                <input type="range" min={0} max={0.9} step={0.01} value={opacity} onChange={e => setOpacity(+e.target.value)} aria-label="Ghost overlay opacity" />
                <span>Ghost</span>
              </label>
            )}
          </div>
        </>
      )}
    </main>
  );
}
