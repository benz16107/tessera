// A-1 Drop: one action. Drop or pick a photo (the camera roll on a phone), or paste a link; joining with a code is the
// quiet path. Dropping creates the shoot, adds the photo (which queues the solve) and opens the person's view.
import { useEffect, useRef, useState } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from '../module_bindings/index.ts';
import { NAME_KEY } from '../config.ts';
import { navigate } from '../App.tsx';
import { fetchLinkedPhoto, uploadPhoto, type Upload } from './lib.ts';
import { preferredView, viewPath } from './view.ts';
import { Link as LinkIcon, Photo, Viewfinder, Close } from './icons.tsx';
import './simple.css';

type Phase = 'idle' | 'uploading' | 'creating' | 'adding';
const PHASE_TEXT: Record<Phase, string> = { idle: '', uploading: 'Uploading your photo', creating: 'Setting up your shoot', adding: 'Starting the search' };

export function Wordmark() {
  return (
    <a className="s-logo" href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>
      <Viewfinder width={18} height={18} /> ShotMatch
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
  const { isActive } = useSpacetimeDB();
  const [spots] = useTable(tables.spot);
  const [mine] = useTable(tables.mySessions);
  const createSession = useReducer(reducers.createSession);
  const addPhoto = useReducer(reducers.addPhoto);
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const [link, setLink] = useState('');
  const [joinOpen, setJoinOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<{ u: Upload; spotId: string; before: Set<string> } | null>(null);

  // createSession returns nothing: the new shoot is the one in my_sessions that was not there before the click.
  useEffect(() => {
    const p = pending.current;
    if (phase !== 'creating' || !p) return;
    const s = [...mine].find(x => !p.before.has(String(x.id)));
    if (!s) return;
    pending.current = null;
    setPhase('adding');
    const { u, spotId } = p;
    addPhoto({
      sessionId: s.id, spotId, url: u.url, thumb: u.thumb, width: u.width, height: u.height,
      pinLat: u.gpsLat ?? undefined, pinLon: u.gpsLon ?? undefined, exifF35: u.exifF35 ?? undefined, source: 'web',
    }).then(() => navigate(viewPath(preferredView(false), s.code)))
      .catch(x => { setPhase('idle'); setErr(String(x?.message ?? x)); });
  }, [mine, phase, addPhoto]);

  const start = async (file: Blob, name = '') => {
    if (phase !== 'idle') return;
    setErr(''); setPhase('uploading');
    try {
      const u = await uploadPhoto(file, name);
      // The photo's GPS picks the spot; with one spot loaded, that one is the answer.
      const spotId = u.nearestSpot ?? (spots.length === 1 ? spots[0].id : '');
      pending.current = { u, spotId, before: new Set(mine.map(s => String(s.id))) };
      setPhase('creating');
      const nm = localStorage.getItem(NAME_KEY) || 'Guest';
      await createSession({ spotId, title: 'New shoot', name: nm });
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
  const example = async () => {
    try { const r = await fetch('/simple/example-dumbo.jpg'); await start(await r.blob(), 'example.jpg'); }
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
        <p className="s-lede">Drop in a photo of a place you love. ShotMatch finds where the photographer stood, which way they faced and the lens they used.</p>
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
        <div className="s-example">
          <img src="/simple/example-dumbo-thumb.jpg" alt="" width={36} height={48} />
          <p>No photo handy?<br /><button className="s-textbtn" onClick={example} disabled={busy}>Try Manhattan Bridge from Washington St</button></p>
        </div>
        <p className="s-example-credit">Example photo: Shah Ronak S, CC BY-SA 4.0</p>
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
