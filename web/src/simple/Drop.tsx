// A-1 Drop: one action. Drop or pick a photo (the camera roll on a phone), or paste a link; joining with a code is the
// quiet path. Dropping creates the shoot and opens the person's view. A photo of a mapped spot is solved; one from anywhere
// else becomes a free-location shoot at its GPS or at Nemotron's guess (POST /api/locate).
import { useEffect, useRef, useState } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { Timestamp } from 'spacetimedb';
import { tables, reducers } from '../module_bindings/index.ts';
import { NAME_KEY } from '../config.ts';
import { navigate } from '../App.tsx';
import { decidePlace, fetchLinkedPhoto, geoSpotId, groundHeight, localTimeOn, locate, placeLabel, uploadPhoto, type Upload } from './lib.ts';
import { preferredView, viewPath } from './view.ts';
import { Link as LinkIcon, Photo, Viewfinder, Close } from './icons.tsx';
import './simple.css';

/** An example shoot that starts already placed: a free location, and its Cam A as a scene_object (east/north/up metres from
 *  the pin). Values from demo shoot 7PL6L6 (docs/DEMO-SHOOTS.md). The pin is the street beside the tower, because Earth sets
 *  its ground from the lowest surface under the pin. Quaternion = cameraQuat(205.3, -0.5, 0), precomputed to keep three.js
 *  out of this page. */
interface Preset { spotId: string; title: string; zone: string; planAt: [number, number]; aimNote: string; deck: { lat: number; lon: number }; cam: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number } }
const TOP_OF_THE_ROCK: Preset = {
  spotId: 'geo:40.758764,-73.978650,90.0', title: 'Empire State Building from Top of the Rock', deck: { lat: 40.75904, lon: -73.97939 },
  zone: 'America/New_York', planAt: [16, 20], aimNote: 'Set on the Top of the Rock deck', // opens in golden hour, like 7PL6L6
  cam: { x: -62.486, y: 30.65, z: 259, qx: -0.154176, qy: -0.686925, qz: -0.692946, qw: -0.155527 }, // the 70th-floor deck, 850 ft up
};

type Phase = 'idle' | 'uploading' | 'locating' | 'creating' | 'adding';
const PHASE_TEXT: Record<Phase, string> = { idle: '', uploading: 'Uploading your photo', locating: 'Finding the place', creating: 'Setting up your shoot', adding: 'Starting the search' };

export function Wordmark() {
  return (
    <a className="s-logo" href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>
      <Viewfinder width={18} height={18} /> Tessera
    </a>
  );
}

export function LegalLinks() {
  return (
    <nav className="s-legal" aria-label="Legal">
      <a href="/privacy" onClick={e => { e.preventDefault(); navigate('/privacy'); }}>Privacy</a>
      <a href="/terms" onClick={e => { e.preventDefault(); navigate('/terms'); }}>Terms</a>
      <a href="/credits">Credits and licenses</a>
    </nav>
  );
}

export default function Home() {
  const { isActive, identity } = useSpacetimeDB();
  const [mine, mineReady] = useTable(tables.mySessions);
  const latest = useRef({ mine, mineReady });
  latest.current = { mine, mineReady };
  const createSession = useReducer(reducers.createSession);
  const addPhoto = useReducer(reducers.addPhoto);
  const addSceneObject = useReducer(reducers.addSceneObject);
  const setPlanTime = useReducer(reducers.setPlanTime);
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const [link, setLink] = useState('');
  const [joinOpen, setJoinOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<{ u: Upload; spotId: string; pin?: { lat: number; lon: number }; source: string; preset?: Preset; before: Set<string> } | null>(null);

  // createSession returns nothing: the new shoot is the one I own in my_sessions that was not there before. The snapshot
  // is taken only once my_sessions has loaded, so an older shoot arriving late is never mistaken for the new one.
  useEffect(() => {
    const p = pending.current;
    if (phase !== 'creating' || !p) return;
    const s = [...mine].find(x => !p.before.has(String(x.id)) && !!identity && x.owner.isEqual(identity));
    if (!s) return;
    pending.current = null;
    setPhase('adding');
    const { u, spotId, pin, source, preset } = p;
    addPhoto({
      sessionId: s.id, spotId, url: u.url, thumb: u.thumb, width: u.width, height: u.height,
      pinLat: pin?.lat ?? u.gpsLat ?? undefined, pinLon: pin?.lon ?? u.gpsLon ?? undefined, exifF35: u.exifF35 ?? undefined, source,
    }).then(() => preset && addSceneObject({ // Cam A before the shoot opens, so Simple doesn't make its own at 1.6 m
      sessionId: s.id, kind: 'camera', assetId: '', name: 'Cam A', ...preset.cam, scale: 1, color: '', intensity: 0, lightType: '', visible: true,
      params: `uid=${Math.random().toString(36).slice(2, 10)};shot=1;alt=${preset.cam.z};approx=1;placed=pin;place=${preset.title};aimnote=${preset.aimNote}`,
    }).then(() => setPlanTime({ sessionId: s.id, at: Timestamp.fromDate(localTimeOn(preset.zone, ...preset.planAt)) })))
      .then(() => navigate(viewPath(preferredView(false), s.code)))
      .catch(x => { setPhase('idle'); setErr(String(x?.message ?? x)); });
  }, [mine, phase, addPhoto, addSceneObject, setPlanTime, identity]);

  const start = async (file: Blob, name = '', knownSpot = '', preset?: Preset) => {
    if (phase !== 'idle') return;
    setErr(''); setPhase('uploading');
    try {
      const u = await uploadPhoto(file, name);
      // Only a mapped spot can be solved. Anywhere else becomes a free-location shoot at the photo's GPS or Nemotron's guess.
      const gps = u.gpsLat != null && u.gpsLon != null ? { lat: u.gpsLat, lon: u.gpsLon } : undefined;
      let loc = null;
      if (!knownSpot && !u.nearestSpot && !preset) { setPhase('locating'); loc = await locate(u.url, gps); }
      const at = preset ? { kind: 'pin' as const, ...preset.deck, place: preset.title, guessed: false } : decidePlace(u, loc, knownSpot);
      const pin = at.kind === 'pin' ? { lat: at.lat, lon: at.lon } : undefined;
      // A pin shoot's session spot is 'geo:...' (Studio reads it); its photo has no spot, so no solve is queued. A clue shoot has
      // neither yet: it opens on the clue panel.
      const sessionSpot = preset?.spotId ?? (at.kind === 'pin' ? geoSpotId(at.lat, at.lon, await groundHeight(at.lat, at.lon)) : at.kind === 'spot' ? at.spotId : '');
      const title = preset?.title ?? ((at.kind === 'pin' && placeLabel(at.place)) || 'Untitled shoot');
      for (let i = 0; !latest.current.mineReady && i < 100; i++) await new Promise(r => setTimeout(r, 100));
      if (!latest.current.mineReady) throw new Error('Still connecting to Tessera. Try again in a moment.');
      pending.current = { u, spotId: at.kind === 'spot' ? at.spotId : '', pin, source: at.kind === 'pin' && at.guessed ? 'locate' : 'web', preset, before: new Set(latest.current.mine.map(s => String(s.id))) };
      setPhase('creating');
      const nm = localStorage.getItem(NAME_KEY) || 'Guest';
      await createSession({ spotId: sessionSpot, title, name: nm }); // an 'Untitled shoot' gets the module's Nemotron title after the solve
    } catch (e) {
      pending.current = null;
      setPhase('idle');
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const fromLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!link.trim()) return;
    try { await start(await fetchLinkedPhoto(link)); } catch (x) { setErr((x as Error).message); }
  };
  const example = async (file: string, spot = '', preset?: Preset) => {
    try { const r = await fetch(`/simple/${file}`); await start(await r.blob(), file, spot, preset); }
    catch { setErr('Could not load the example photo.'); }
  };

  // Pasting a copied photo anywhere on the page starts too.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); void start(f, f.name); }
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  });

  const busy = phase !== 'idle';
  return (
    <div className="simple s-home" data-over={over || undefined}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void start(f, f.name); }}>
      <header className="s-top s-top-home">
        <Wordmark />
        <button className="s-pill quiet" onClick={() => setJoinOpen(true)}>Join with a code</button>
      </header>
      <main className="s-home-main">
        <h1>Where did they stand?</h1>
        <p className="s-lede">Drop in a photo of a place you love. Tessera finds where the photographer stood, which way they faced and the lens they used.</p>
        <div className="s-drop" data-busy={busy || undefined} aria-busy={busy}>
          <i className="s-corner tl" /><i className="s-corner tr" /><i className="s-corner bl" /><i className="s-corner br" />
          <input ref={input} id="s-file" type="file" accept="image/*,.heic,.heif" className="sr-only"
            onChange={e => { const f = e.target.files?.[0]; if (f) void start(f, f.name); e.target.value = ''; }} />
          {busy ? (
            <div className="s-drop-busy" role="status" aria-live="polite">
              <span className="s-sk s-sk-thumb" />
              <p className="s-drop-title">{PHASE_TEXT[phase]}</p>
              <p className="s-drop-sub">This takes a few seconds.</p>
            </div>
          ) : (
            <>
              <Photo width={36} height={36} className="s-drop-icon" />
              <p className="s-drop-title">Drop a photo here</p>
              <p className="s-drop-sub">JPG, HEIC or PNG, straight from your camera roll</p>
              <button type="button" className="s-btn primary" onClick={() => input.current?.click()} disabled={!isActive}>Choose a photo</button>
            </>
          )}
        </div>
        <form className="s-link" onSubmit={fromLink}>
          <LinkIcon width={18} height={18} />
          <label htmlFor="s-link-in" className="sr-only">Or paste a link to a photo</label>
          <input id="s-link-in" value={link} onChange={e => setLink(e.target.value)} placeholder="Or paste a link to a photo" inputMode="url" autoComplete="off" disabled={busy} />
          {link.trim() ? <button className="s-pill small" disabled={busy}>Use link</button> : <kbd>⌘V</kbd>}
        </form>
        {err && <p className="s-error" role="alert">{err}</p>}
        <p className="s-example-head">No photo handy?</p>
        <div className="s-examples">
        <div className="s-example">
          <img src="/simple/example-dumbo-thumb.jpg" alt="" width={36} height={48} />
          <button className="s-textbtn" onClick={() => void example('example-dumbo.jpg', 'nyc_dumbo')} disabled={busy}>Try Manhattan Bridge from Washington St</button>
        </div>
        <div className="s-example">
          <img src="/simple/example-esb-thumb.jpg" alt="" width={36} height={48} />
          <button className="s-textbtn" onClick={() => void example('example-esb.jpg', '', TOP_OF_THE_ROCK)} disabled={busy}>Try Empire State Building from Top of the Rock</button>
        </div>
        </div>
        <p className="s-example-credit">Example photos: Shah Ronak S; Daniel Schwen, CC BY-SA 4.0</p>
      </main>
      <footer className="s-foot"><LegalLinks /></footer>
      {joinOpen && <JoinDialog onClose={() => setJoinOpen(false)} />}
    </div>
  );
}

function JoinDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="simple s-sheet s-join" onClose={onClose} aria-labelledby="s-join-title">
      <form onSubmit={e => { e.preventDefault(); const c = code.trim().toUpperCase(); if (c.length >= 4) { ref.current?.close(); navigate(viewPath(preferredView(true), c)); } }}>
        <div className="s-sheet-head">
          <h2 id="s-join-title">Join with a code</h2>
          <button type="button" className="s-icon-btn" aria-label="Close" onClick={() => ref.current?.close()}><Close /></button>
        </div>
        <p className="s-muted">Ask whoever is planning for the six-letter code.</p>
        <label className="sr-only" htmlFor="s-code">Shoot code</label>
        <input id="s-code" className="s-field s-code-in" value={code} onChange={e => setCode(e.target.value)} maxLength={12}
          autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="A9TVAN" autoFocus />
        <button className="s-btn primary wide" disabled={code.trim().length < 4}>Join</button>
      </form>
    </dialog>
  );
}
