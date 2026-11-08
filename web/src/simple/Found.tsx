// A-2 Found it: the answer in plain words. Where to stand, which way to face, the lens as an iPhone zoom, the next good
// light and "Take me there".
import { useEffect, useMemo, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings/index.ts';
import type { Photo, SolveResult, Spot } from '../module_bindings/types.ts';
import { angleDiff, compassWord, fmtTime, hfovDeg, lightWindows, metersBetween } from '../geo.ts';
import { searchPlaces, type Place } from '../studio/editor/PlaceSearch.tsx';
import { CONFIDENCE, geoSpotId, groundHeight, iphoneZoom, locate, photoCredit, resultLine } from './lib.ts';
import { Arrow } from './icons.tsx';
import { describeMark } from './street.ts';
import { streetsFor } from './streets.data.ts';

export const relDay = (d: Date, zone: string) => {
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(x);
  if (day(d) === day(new Date())) return 'Today';
  if (day(d) === day(new Date(Date.now() + 86_400_000))) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(d);
};

/** "6:35 to 7:15 AM": the first AM or PM is dropped when both ends share it. */
export function fmtRange(a: Date, b: Date, zone: string) {
  const x = fmtTime(a, zone), y = fmtTime(b, zone);
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)} to ${y}` : `${x} to ${y}`;
}

export function Compass({ heading, size = 52 }: { heading: number; size?: number }) {
  return (
    <svg className="s-compass" viewBox="-26 -26 52 52" width={size} height={size} role="img" aria-label={`Compass needle at ${Math.round(heading)} degrees, ${compassWord(heading)}`}>
      <circle r="24.5" className="ring" />
      {[0, 90, 180, 270].map(a => <line key={a} y1={-24.5} y2={-20.5} transform={`rotate(${a})`} className="tick" />)}
      <text y="-13" className="n">N</text>
      <g transform={`rotate(${heading})`}><path d="M0 -17 L4.2 2 L0 0 L-4.2 2 Z" className="needle" /><path d="M0 17 L4.2 -2 L0 0 L-4.2 -2 Z" className="tail" /></g>
      <circle r="2" className="hub" />
    </svg>
  );
}

/** A half dial seen from behind the camera: left to right is the view, the dot is the sun in that window. */
function SunPath({ rel, label }: { rel: number; label: string }) {
  const a = Math.max(-90, Math.min(90, rel)) * Math.PI / 180;
  return (
    <svg className="s-sunpath" viewBox="0 0 120 64" width={120} height={64} role="img" aria-label={label}>
      <path d="M8 56 A52 52 0 0 1 112 56" className="arc" />
      <line x1="2" y1="56" x2="118" y2="56" className="base" />
      <path d="M55 50 L65 50 L60 58 Z" className="cam" />
      <circle cx={60 + 52 * Math.sin(a)} cy={56 - 52 * Math.cos(a) * 0.25 - 4} r="6" className="sun" />
    </svg>
  );
}

export default function Found({ result, photo, spot, zone, credit, onGo }: {
  result: SolveResult; photo: Photo; spot?: Spot; zone: string; credit?: string; onGo: () => void;
}) {
  const pose = result.pose;
  const c = CONFIDENCE[result.confidence] ?? CONFIDENCE.check;
  const hfov = hfovDeg(pose.f35, photo.width, photo.height);
  const windows = useMemo(() => lightWindows(new Date(), pose.lat, pose.lon, pose.heading, hfov, 2), [pose.lat, pose.lon, pose.heading, hfov]);
  const golden = windows.find(w => w.kind === 'Golden hour');
  const blue = golden && windows.filter(w => w.kind === 'Blue hour').sort((a, b) => Math.abs(a.start.getTime() - golden.start.getTime()) - Math.abs(b.start.getTime() - golden.start.getTime()))[0];
  const rel = golden ? angleDiff(golden.sunAz, pose.heading) : 0;
  const side = Math.abs(rel) < 25 ? 'ahead of you, in the frame' : Math.abs(rel) > 135 ? 'behind you' : rel < 0 ? 'from the left' : 'from the right';
  const face = `${Math.round(pose.heading)}° ${compassWord(pose.heading)}`;
  const streets = streetsFor(spot?.id ?? '');
  const street = describeMark(streets, pose.lat, pose.lon);
  const coords = `${pose.lat.toFixed(6)}, ${pose.lon.toFixed(6).replace('-', '−')}`;
  return (
    <article className="s-found">
      <p className="s-conf" data-tone={c.tone}><i aria-hidden="true" />{c.word}</p>
      <h1 className="s-title">{spot?.name ?? 'Your spot'}</h1>
      <p className="s-muted">{resultLine(result)}</p>
      <hr />
      <div className="s-two">
        <div>
          <p className="s-label">Facing</p>
          <p className="s-big"><span>{Math.round(pose.heading)}°</span><small> {compassWord(pose.heading)}</small><Compass heading={pose.heading} /></p>
          <p className="s-muted">Camera {pose.alt.toFixed(1)} m up, tilted {pose.pitch >= 0 ? 'up' : 'down'} {Math.abs(Math.round(pose.pitch))}°</p>
        </div>
        <div>
          <p className="s-label">Lens</p>
          <p className="s-big"><span>{iphoneZoom(pose.f35)}</span></p>
          <p className="s-sub">on your iPhone's main camera</p>
          <p className="s-muted small">{Math.round(pose.f35)} mm full-frame equivalent</p>
        </div>
      </div>
      <hr />
      <div className="s-mark">
        <div>
          <p className="s-label">The mark</p>
          <p className="s-mid">{street ?? coords}</p>
          <p className="s-muted">Stand here and face {face} to match the photo</p>
          {street && <p className="s-muted small s-coords">{coords} · {streets!.credit}</p>}
        </div>
        <button className="s-btn primary big" onClick={onGo}><Arrow width={18} height={18} /> Take me there</button>
      </div>
      <hr />
      {golden ? (
        <div className="s-light">
          <div>
            <p className="s-label">Next good light</p>
            <p className="s-mid strong">Golden hour, {relDay(golden.start, zone)} {fmtRange(golden.start, golden.end, zone)}</p>
            <p className="s-muted">Sun {side}.{blue ? ` Blue hour ${blue.start < golden.start ? 'starts' : 'follows'} at ${fmtTime(blue.start, zone)}.` : ''}</p>
          </div>
          <SunPath rel={rel} label={`Sun ${side} during golden hour`} />
        </div>
      ) : <p className="s-muted">No golden hour in the next two days at this spot.</p>}
      <p className="s-credit">{photoCredit(photo, spot?.id ?? '', credit)}</p>
    </article>
  );
}

/** Found it for a free-location shoot (anywhere.md cases 1 and 2): planned at a pin from the photo's GPS, Nemotron's guess or
 *  a place someone picked. Nothing is solved, so the stand and the heading are labelled approximate. */
export function PinFound({ photo, geo, title, zone, sessionId, credit, onGo }: {
  photo: Photo; geo: { lat: number; lon: number }; title: string; zone: string; sessionId: bigint; credit?: string; onGo: () => void;
}) {
  const [place, setPlace] = useState(title === 'Untitled shoot' ? '' : title);
  const moved = photo.pinLat == null || photo.pinLon == null || metersBetween(photo.pinLat, photo.pinLon, geo.lat, geo.lon) > 50;
  // The title names the place the shoot was made for. After Change place, the crew's geocoder names the new pin.
  useEffect(() => {
    if (!moved && place) return;
    let live = true;
    locate(photo.url, geo).then(r => { if (live && r?.place) setPlace(r.place.split(',').slice(0, 2).join(',').trim()); });
    return () => { live = false; };
  }, [photo.url, geo.lat, geo.lon, moved]); // eslint-disable-line react-hooks/exhaustive-deps
  const guessed = photo.source === 'locate';
  const name = place || 'this place';
  const note = moved ? 'You picked this place. Plan the shot here; where you stand and which way you face are up to you.'
    : guessed ? `Nemotron's guess from the photo: ${name}. Not one of our mapped spots yet, so where they stood is approximate.`
    : `Not one of our mapped spots yet. Planning it at ${name} from your photo's location.`;
  const f35 = photo.exifF35;
  const golden = useMemo(() => lightWindows(new Date(), geo.lat, geo.lon, 0, 60, 2).find(w => w.kind === 'Golden hour'), [geo.lat, geo.lon]);
  return (
    <article className="s-found s-pin">
      <p className="s-conf" data-tone="warn"><i aria-hidden="true" />Approximate</p>
      <h1 className="s-title">{place || "Your photo's place"}</h1>
      <p className="s-muted s-pin-note">{note}</p>
      <ChangePlace sessionId={sessionId} />
      <hr />
      <div className="s-two">
        <div>
          <p className="s-label">Facing</p>
          <p className="s-mid">Not measured</p>
          <p className="s-muted small s-approx">Only mapped spots give a heading. Line the photo up on site, or aim Cam A in Studio.</p>
        </div>
        <div>
          <p className="s-label">Lens</p>
          {f35 ? (
            <>
              <p className="s-big"><span>{iphoneZoom(f35)}</span></p>
              <p className="s-sub">on your iPhone's main camera</p>
              <p className="s-muted small">{Math.round(f35)} mm full-frame equivalent, from the photo</p>
            </>
          ) : (
            <>
              <p className="s-mid">Unknown</p>
              <p className="s-muted small s-approx">The photo carries no lens data, so the plan starts at a phone's 26 mm.</p>
            </>
          )}
        </div>
      </div>
      <hr />
      <div className="s-mark">
        <div>
          <p className="s-label">The mark</p>
          <p className="s-mid">{geo.lat.toFixed(5)}, {geo.lon.toFixed(5).replace('-', '\u2212')}</p>
          <p className="s-muted small s-approx">{moved ? 'The place you picked.' : guessed ? "Where the map puts Nemotron's guess, not where the photographer stood." : "Your photo's GPS, usually within 5 to 30 m."}</p>
        </div>
        <button className="s-btn primary big" onClick={onGo}><Arrow width={18} height={18} /> Take me there</button>
      </div>
      {golden && (
        <>
          <hr />
          <div className="s-light">
            <div>
              <p className="s-label">Next good light</p>
              <p className="s-mid strong">Golden hour, {relDay(golden.start, zone)} {fmtRange(golden.start, golden.end, zone)}</p>
              <p className="s-muted small s-approx">Approximate local time, estimated from the longitude.</p>
            </div>
          </div>
        </>
      )}
      <p className="s-credit">{photoCredit(photo, '', credit)} · Place names © OpenStreetMap contributors</p>
    </article>
  );
}

/** Change place: search a place (Nominatim) and move the shoot's pin there for everyone (setSessionSpot to 'geo:...'). */
export function ChangePlace({ sessionId }: { sessionId: bigint }) {
  const setSessionSpot = useReducer(reducers.setSessionSpot);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true); setErr('');
    try { const r = await searchPlaces(q.trim()); setRes(r); if (!r.length) setErr('No place found. Try a street address or a landmark.'); }
    catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const pick = async (p: Place) => {
    setBusy(true); setErr('');
    try { await setSessionSpot({ sessionId, spotId: geoSpotId(p.lat, p.lon, await groundHeight(p.lat, p.lon)) }); setOpen(false); setRes(null); setQ(''); }
    catch (x) { setErr(String((x as Error)?.message ?? x)); }
    setBusy(false);
  };
  return (
    <div className="s-place">
      {!open ? <button type="button" className="s-btn s-place-btn" onClick={() => setOpen(true)}>Change place</button> : (
        <form className="s-place-form" onSubmit={search}>
          <label className="sr-only" htmlFor="s-place-q">Search for a place</label>
          <div className="s-invite-row">
            <input id="s-place-q" className="s-field" value={q} onChange={e => setQ(e.target.value)} placeholder="An address or a landmark" autoComplete="off" autoFocus />
            <button className="s-btn" disabled={busy || !q.trim()}>{busy ? 'Searching' : 'Search'}</button>
            <button type="button" className="s-btn" onClick={() => { setOpen(false); setRes(null); }}>Cancel</button>
          </div>
          {err && <p className="s-error" role="alert">{err}</p>}
          {res && res.length > 0 && (
            <ul className="s-place-results">
              {res.map(p => <li key={`${p.lat},${p.lon}`}><button type="button" onClick={() => void pick(p)} disabled={busy}>{p.name}</button></li>)}
            </ul>
          )}
          <p className="s-place-credit">Search by Nominatim, data © OpenStreetMap contributors</p>
        </form>
      )}
    </div>
  );
}
