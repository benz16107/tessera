import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTable, useReducer } from 'spacetimedb/react';
import type { Identity } from 'spacetimedb';
import QRCode from 'qrcode';
import SunCalc from 'suncalc';
import { tables, reducers } from './module_bindings/index.ts';
import type { AgentStep, DevicePose, Message, Participant, Person, Photo, Pose, PreviewJob, Session, SolveJob, SolveResult, Spot } from './module_bindings/types.ts';
import { useConfig, shareBase } from './config.ts';
import { compassWord, phoneZoom, hfovDeg, lightWindows, spotZone, fmtTime, sunRelation, metersBetween, angleDiff } from './geo.ts';
import type { PlaceMode } from './SceneView.tsx';

export function Footer() {
  return (
    <footer className="foot">
      <a href="/credits">Credits and licenses</a>
      <span>3D view: Google Photorealistic 3D Tiles, credits shown on the map.</span>
      <span>Previews are AI interpretations of your photo.</span>
    </footer>
  );
}

export function Presence({ parts, me }: { parts: readonly Participant[]; me?: Identity }) {
  // The top bar shows who is here now; the Live tab lists everyone.
  const sorted = parts.filter(p => p.online);
  return (
    <ul className="presence" aria-label="People in this shoot">
      {sorted.slice(0, 6).map(p => (
        <li key={String(p.id)} title={`${p.name} (${p.role}) ${p.online ? 'online' : 'offline'}`}>
          <span className="dot" data-on={p.online} aria-hidden="true" />
          <span className="who">{p.name}{me && p.identity.isEqual(me) ? ' (you)' : ''}</span>
          <span className="sr-only">{p.online ? 'online' : 'offline'}, {p.role}</span>
        </li>
      ))}
      {sorted.length > 6 && <li className="more">+{sorted.length - 6}</li>}
    </ul>
  );
}

function Qr({ url, label }: { url: string; label: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#1c1a17', light: '#f4efe4' } }).then(setSrc); }, [url]);
  const [copied, setCopied] = useState(false);
  return (
    <figure className="qr">
      {src ? <img src={src} alt={`QR code for ${label}`} width={180} height={180} /> : <span className="sk qr-sk" />}
      <figcaption>
        <strong>{label}</strong>
        <code className="url">{url}</code>
        <button className="btn small" onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? 'Copied' : 'Copy link'}</button>
      </figcaption>
    </figure>
  );
}

export function ShareDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const base = shareBase(useConfig());
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="sheet share" onClose={onClose} aria-labelledby="share-title">
      <h2 id="share-title">Share shoot <span className="mono">{code}</span></h2>
      <div className="qr-row">
        <Qr url={`${base}/s/${code}`} label="Scout at the spot (phone)" />
        <Qr url={`${base}/p/${code}`} label="Plan together" />
      </div>
      <form method="dialog"><button className="btn">Done</button></form>
    </dialog>
  );
}

interface ToastItem { id: number; kind: string; text: string }
export function Toasts({ sessionId }: { sessionId: bigint }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const onInsert = useCallback((t: { kind: string; text: string }) => {
    const id = Math.random();
    setItems(xs => [...xs.slice(-3), { id, kind: t.kind, text: t.text }]);
    setTimeout(() => setItems(xs => xs.filter(x => x.id !== id)), 6000);
  }, []);
  useTable(tables.toast.where(r => r.sessionId.eq(sessionId)), { onInsert });
  return (
    <ol className="toasts" role="status" aria-live="polite">
      {items.map(t => <li key={t.id} data-kind={t.kind}>{t.text}</li>)}
    </ol>
  );
}

interface Upload { url: string; width: number; height: number; thumb: string; exifF35: number | null; gpsLat: number | null; gpsLon: number | null; nearestSpot: string | null }

export function PhotoDrop({ session, spotId, onUploaded, asStage, compact, children }: { session: Session; spotId: string; onUploaded: () => void; asStage?: boolean; compact?: boolean; children?: React.ReactNode }) {
  const addPhoto = useReducer(reducers.addPhoto);
  const setSessionSpot = useReducer(reducers.setSessionSpot);
  const [over, setOver] = useState(false);
  const [state, setState] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const send = async (file: File) => {
    if (!file.type.startsWith('image/') && !/\.(heic|heif|jpe?g|png)$/i.test(file.name)) { setState('error'); setErr('That file is not an image.'); return; }
    if (file.size > 25 * 1024 * 1024) { setState('error'); setErr('Photos up to 25 MB.'); return; }
    setState('uploading'); setErr('');
    try {
      const r = await fetch('/api/upload', { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'image/heic' } });
      if (!r.ok) throw new Error(r.status === 404 || r.status >= 502 ? 'The ShotMatch service is not taking uploads right now.' : `Upload failed (${r.status}).`);
      const u: Upload = await r.json();
      await addPhoto({
        sessionId: session.id, spotId: u.nearestSpot ?? spotId, url: u.url, thumb: u.thumb, width: u.width, height: u.height,
        pinLat: u.gpsLat ?? undefined, pinLon: u.gpsLon ?? undefined, exifF35: u.exifF35 ?? undefined, source: 'web',
      });
      if (!spotId && u.nearestSpot) setSessionSpot({ sessionId: session.id, spotId: u.nearestSpot }).catch(() => {});
      setState('idle');
      onUploaded();
    } catch (e) {
      setState('error'); setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const drop = {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void send(f); },
  };
  if (asStage) {
    return <div className="stage-drop" data-over={over} {...drop}>{children}{over && <p className="drop-veil">Drop to place this photo</p>}</div>;
  }
  return (
    <div className="dropzone" data-over={over} data-compact={compact || undefined} {...drop}>
      <input ref={input} type="file" accept="image/*,.heic,.heif" className="sr-only" id="photo-input" onChange={e => { const f = e.target.files?.[0]; if (f) void send(f); e.target.value = ''; }} />
      <label htmlFor="photo-input" className={compact ? 'btn' : 'btn primary'}>{state === 'uploading' ? 'Uploading' : compact ? 'Add another photo' : 'Choose a photo'}</label>
      {!compact && <p>or drop one anywhere on the 3D view. JPEG, PNG or HEIC.</p>}
      {!spotId && !compact && <p className="muted">No spot picked: the photo's GPS chooses one, or pick a spot above.</p>}
      {state === 'error' && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

const STATE_TEXT: Record<string, string> = { queued: 'Queued', running: 'Solving', done: 'Done', failed: 'Failed' };

export function JobStatus({ job, result, photo, spots, compact }: { job?: SolveJob; result?: SolveResult; photo?: Photo; spots?: readonly Spot[]; compact?: boolean }) {
  const enqueue = useReducer(reducers.enqueueSolve);
  const fallbackSpot = spots?.length === 1 ? spots[0].id : '';
  const [spotId, setSpotId] = useState(job?.spotId || fallbackSpot);
  const [hint, setHint] = useState('');
  useEffect(() => { setSpotId(job?.spotId || fallbackSpot); }, [job?.spotId, fallbackSpot]);
  if (compact && job) {
    return <p className="job compact" data-state={job.state}><span className="led" aria-hidden="true" />{STATE_TEXT[job.state] ?? job.state}{job.progress !== job.state ? `: ${job.progress}` : ''}</p>;
  }
  const active = job && (job.state === 'queued' || job.state === 'running');
  const unsure = !job || job.state === 'failed' || (result && result.confidence !== 'solid');
  const retry = photo && spots && !active && (
    <form className="retry" onSubmit={e => {
      e.preventDefault();
      const f = parseFloat(hint);
      if (spotId) enqueue({ photoId: photo.id, spotId, lensHintF35: f >= 8 && f <= 1200 ? f : undefined }).catch(console.error);
    }}>
      <label className="field"><span>Spot</span>
        <select value={spotId} onChange={e => setSpotId(e.target.value)}>
          <option value="">Pick a spot</option>
          {spots.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="field"><span>Lens, mm (optional)</span>
        <input type="number" inputMode="decimal" min={8} max={1200} step={1} value={hint} onChange={e => setHint(e.target.value)} placeholder={job?.lensHintF35 ? String(Math.round(job.lensHintF35)) : '50'} />
      </label>
      <button className="btn" disabled={!spotId}>Solve again</button>
    </form>
  );
  return (
    <div className="stack">
      {job ? (
        <p className="job" data-state={job.state} aria-live="polite">
          <span className="led" aria-hidden="true" />
          <strong>{STATE_TEXT[job.state] ?? job.state}</strong> {job.progress !== job.state && <span>{job.progress}</span>}
          {job.state === 'queued' && job.attempts === 0 && <span className="muted"> The solver picks it up when it is running.</span>}
          {job.attempts > 1 && <span className="muted"> Attempt {job.attempts}.</span>}
          {job.lensHintF35 !== undefined && <span className="muted"> Lens hint {Math.round(job.lensHintF35)} mm.</span>}
        </p>
      ) : <p className="muted">This photo had no GPS, so ShotMatch needs to know which spot it shows.</p>}
      {job?.state === 'failed' && job.error && <p className="error">{job.error}</p>}
      {result && <ConfidenceBadge result={result} detail />}
      {retry && (unsure ? (
        <>
          <p className="small">Know roughly which lens took it? A hint narrows the search and often fixes a far, flat scene.</p>
          {retry}
        </>
      ) : <details className="resolve"><summary>Re-solve with a lens hint</summary>{retry}</details>)}
    </div>
  );
}

const CONF: Record<string, string> = { solid: 'Solid', check: 'Check this', none: "Couldn't place" };
export function ConfidenceBadge({ result, detail }: { result: SolveResult; detail?: boolean }) {
  return (
    <div className="conf" data-c={result.confidence}>
      <span className="conf-tag">{CONF[result.confidence] ?? result.confidence}</span>
      <span className="conf-reason">{result.reason || `${result.inliers} matches`}</span>
      {detail && <span className="mono muted small">solved in {result.secs.toFixed(1)} s</span>}
    </div>
  );
}

function Compass({ heading }: { heading: number }) {
  return (
    <svg className="compass" viewBox="-50 -50 100 100" role="img" aria-label={`Heading ${Math.round(heading)} degrees, ${compassWord(heading)}`}>
      <circle r="46" className="ring" />
      {Array.from({ length: 36 }, (_, i) => <line key={i} y1={-46} y2={i % 9 === 0 ? -38 : -42} transform={`rotate(${i * 10})`} className="tick" />)}
      {['N', 'E', 'S', 'W'].map((l, i) => <text key={l} x={0} y={-28} transform={`rotate(${i * 90}) rotate(${-i * 90} 0 -31)`} className="cardinal">{l}</text>)}
      <g transform={`rotate(${heading})`}><path d="M0 -36 L6 4 L0 0 L-6 4 Z" className="needle" /></g>
      <circle r="3" className="hub" />
    </svg>
  );
}

const fmtLatLon = (x: number) => x.toFixed(6);
const relDays = (d: Date, zone: string) => {
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(x);
  const today = day(new Date()), tomorrow = day(new Date(Date.now() + 86_400_000));
  return day(d) === today ? 'Today' : day(d) === tomorrow ? 'Tomorrow' : new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(d);
};

export function AnswerCard({ pose, photo, spot }: { pose: Pose; photo: Photo; spot: Spot }) {
  const zone = spotZone(spot.id, spot.lon);
  const hfov = hfovDeg(pose.f35, photo.width, photo.height);
  const windows = useMemo(() => {
    const all = lightWindows(new Date(), pose.lat, pose.lon, pose.heading, hfov, 2);
    const golden = all.filter(w => w.kind === 'Golden hour').slice(0, 2);
    const blue = all.filter(w => w.kind === 'Blue hour').slice(0, 1);
    return [...golden, ...blue].sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [pose.lat, pose.lon, pose.heading, hfov]);
  const walk = `https://www.google.com/maps/dir/?api=1&destination=${pose.lat},${pose.lon}&travelmode=walking`;
  return (
    <section className="block answer" aria-label="Answer">
      <h2>{spot.name}</h2>
      <div className="answer-grid">
        <Compass heading={pose.heading} />
        <dl className="facts">
          <div><dt>Facing</dt><dd><span className="big mono">{Math.round(pose.heading)}°</span> {compassWord(pose.heading)}</dd></div>
          <div><dt>Lens</dt><dd><span className="big mono">{Math.round(pose.f35)} mm</span> full-frame equivalent</dd></div>
          <div><dt>On a phone</dt><dd>{phoneZoom(pose.f35).text}</dd></div>
          <div><dt>Height</dt><dd className="mono">{pose.alt.toFixed(1)} m above ground, tilt {pose.pitch >= 0 ? '+' : ''}{pose.pitch.toFixed(0)}°</dd></div>
        </dl>
      </div>
      <div className="mark">
        <div><span className="muted">Mark</span> <span className="mono">{fmtLatLon(pose.lat)}, {fmtLatLon(pose.lon)}</span></div>
        <a className="btn" href={walk} target="_blank" rel="noreferrer">Walk here</a>
      </div>
      <h3>Next good light facing {compassWord(pose.heading)}</h3>
      <ul className="light-list">
        {windows.map(w => (
          <li key={w.start.getTime()}>
            <span className="lk" data-k={w.kind}>{w.kind}</span>
            <span className="mono">{relDays(w.start, zone)} {fmtTime(w.start, zone)} to {fmtTime(w.end, zone)}</span>
            <span>sun {w.relation}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">Forward planning only. ShotMatch does not guess when the original was taken. Times are local to the spot.</p>
    </section>
  );
}

export function Trace({ steps }: { steps: readonly AgentStep[] }) {
  const sorted = [...steps].sort((a, b) => Number(a.id - b.id)).slice(-30);
  return (
    <details className="block trace" open>
      <summary><h2>Agent trace</h2><span className="mono muted">{steps.length} steps</span></summary>
      <ol>
        {sorted.map(s => (
          <li key={String(s.id)}>
            <div className="trace-head"><code>{s.tool}</code><span className="mono muted">{s.ms} ms</span></div>
            {s.result && <p className="trace-result">{s.result.length > 220 ? s.result.slice(0, 220) + '...' : s.result}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function LensPanel({ lens, solvedF35, photo, onChange }: { lens: number; solvedF35: number; photo: Photo; onChange: (f: number) => void }) {
  const k = lens / solvedF35;
  const cw = Math.round(photo.width / k), ch = Math.round(photo.height / k);
  return (
    <section className="block">
      <h2>Lens</h2>
      <label className="slider">
        <span className="sr-only">Focal length, 35 mm equivalent</span>
        <input type="range" min={16} max={200} step={1} value={Math.round(lens)} onChange={e => onChange(+e.target.value)} />
      </label>
      <div className="lens-read">
        <span className="big mono">{Math.round(lens)} mm</span>
        <span>{phoneZoom(lens).text}</span>
        <button className="btn small" onClick={() => onChange(solvedF35)} disabled={Math.abs(lens - solvedF35) < 0.5}>Back to {Math.round(solvedF35)} mm</button>
      </div>
      <div className="presets" role="group" aria-label="Common lenses">
        {[24, 35, 50, 85, 135].map(f => <button key={f} className="btn small" aria-pressed={Math.round(lens) === f} onClick={() => onChange(f)}>{f}</button>)}
      </div>
      {k > 1.01 && (
        <div className="crop">
          <div className="crop-frame" style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
            <img src={photo.url || photo.thumb} alt={`Your photo cropped to ${Math.round(lens)} mm`} style={{ transform: `scale(${k})` }} />
          </div>
          <p className="muted small">A longer lens from the same mark is an exact crop of your photo: {cw} x {ch} px of {photo.width} x {photo.height}.</p>
        </div>
      )}
      {k < 0.99 && <p className="muted small">Wider than your photo: the 3D view shows what sits outside its frame. A preview fills it in as an AI interpretation.</p>}
    </section>
  );
}

export function PeoplePanel({ people, placing, setPlacing, selected, setSelected }: {
  people: readonly Person[]; placing: PlaceMode; setPlacing: (m: PlaceMode) => void; selected: bigint | null; setSelected: (id: bigint | null) => void;
}) {
  const remove = useReducer(reducers.removePerson);
  const sorted = [...people].sort((a, b) => Number(a.id - b.id));
  return (
    <section className="block">
      <h2>People</h2>
      <button className="btn" aria-pressed={placing.kind === 'add'} onClick={() => setPlacing(placing.kind === 'add' ? { kind: 'none' } : { kind: 'add' })}>
        {placing.kind === 'add' ? 'Done placing' : 'Place people'}
      </button>
      {sorted.length === 0 ? <p className="muted small">Click "Place people", then click the 3D view. Each figure is 1.7 m tall.</p> : (
        <ul className="people">
          {sorted.map(p => (
            <li key={String(p.id)} data-sel={selected === p.id}>
              <button className="linkish" onClick={() => setSelected(selected === p.id ? null : p.id)} aria-pressed={selected === p.id}>{p.label}</button>
              <span className="row-actions">
                <button className="btn small" aria-pressed={placing.kind === 'move' && placing.id === p.id} onClick={() => setPlacing({ kind: 'move', id: p.id })}>Move</button>
                <button className="btn small danger" onClick={() => { remove({ id: p.id }).catch(console.error); if (selected === p.id) setSelected(null); }} aria-label={`Remove ${p.label}`}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SunDial({ heading, hfov, sun }: { heading: number; hfov: number; sun: { azimuth: number; altitude: number } }) {
  const rel = angleDiff(sun.azimuth, heading);
  const r = 40 * (1 - Math.max(0, Math.min(90, sun.altitude)) / 90) + 4;
  const up = sun.altitude > -1;
  const half = (hfov / 2) * Math.PI / 180;
  return (
    <svg className="sundial" viewBox="-50 -50 100 100" role="img" aria-label={`Sun ${Math.round(rel)} degrees ${rel < 0 ? 'left' : 'right'} of where the camera faces, ${Math.round(sun.altitude)} degrees up`}>
      <circle r="44" className="ring" />
      <path d={`M0 0 L${44 * Math.sin(-half)} ${-44 * Math.cos(half)} A44 44 0 0 1 ${44 * Math.sin(half)} ${-44 * Math.cos(half)} Z`} className="fov" />
      <text y="47" className="dial-label">behind</text>
      <g transform={`rotate(${rel})`}><circle cy={-r} r="6" className={up ? 'sun' : 'sun down'} /></g>
      <circle r="3" className="hub" />
    </svg>
  );
}

export function LightPanel({ spotId, pose, photo, planTime, onChange, shadows, setShadows, sun }: {
  spotId: string; pose: Pose; photo: Photo; planTime: Date; onChange: (d: Date) => void; shadows: boolean; setShadows: (b: boolean) => void; sun?: { azimuth: number; altitude: number };
}) {
  const zone = spotZone(spotId, pose.lon);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(planTime);
  const times = useMemo(() => {
    const noon = new Date(utcDay(day) + 12 * 3_600_000 - (pose.lon / 15) * 3_600_000); // approximate solar noon
    return SunCalc.getTimes(noon, pose.lat, pose.lon);
  }, [day, pose.lat, pose.lon]);
  const min = (times.nauticalDawn ?? times.sunrise).getTime(), max = (times.nauticalDusk ?? times.sunset).getTime();
  const hfov = hfovDeg(pose.f35, photo.width, photo.height);
  const rel = sun ? sunRelation(sun.azimuth, sun.altitude, pose.heading, hfov) : undefined;
  const setDay = (v: string) => { if (v) onChange(new Date(utcDay(v) + planTime.getTime() - utcDay(day))); };
  const jump = (a: Date, b: Date) => onChange(new Date((a.getTime() + b.getTime()) / 2));
  return (
    <section className="block">
      <h2>Light</h2>
      <div className="light-row">
        <label className="field"><span>Day</span><input type="date" value={day} onChange={e => setDay(e.target.value)} /></label>
        <p className="big mono" aria-live="polite">{fmtTime(planTime, zone)}</p>
      </div>
      <label className="slider">
        <span className="sr-only">Time of day at the spot</span>
        <input type="range" min={min} max={max} step={5 * 60_000} value={Math.min(max, Math.max(min, planTime.getTime()))} onChange={e => onChange(new Date(+e.target.value))}
          aria-valuetext={fmtTime(planTime, zone)} />
      </label>
      <div className="presets" role="group" aria-label="Jump to">
        <button className="btn small" onClick={() => jump(times.dawn, times.sunrise)}>Morning blue</button>
        <button className="btn small" onClick={() => jump(times.sunrise, times.goldenHourEnd)}>Morning gold</button>
        <button className="btn small" onClick={() => jump(times.goldenHour, times.sunset)}>Evening gold</button>
        <button className="btn small" onClick={() => jump(times.sunset, times.dusk)}>Evening blue</button>
      </div>
      {sun && (
        <div className="sun-read">
          <SunDial heading={pose.heading} hfov={hfov} sun={sun} />
          <div>
            <p><strong>Sun {rel}</strong></p>
            <p className="mono muted">{Math.round(sun.azimuth)}° {compassWord(sun.azimuth)}, {sun.altitude.toFixed(0)}° up</p>
            <label className="check"><input type="checkbox" checked={shadows} onChange={e => setShadows(e.target.checked)} /> Cast shadows in 3D</label>
          </div>
        </div>
      )}
    </section>
  );
}

const utcDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };

const PREVIEW_TEXT: Record<string, string> = { queued: 'Queued for the image model', running: 'Making the preview' };

export function PreviewPanel({ sessionId, photo, lens, people, sun, previews }: {
  sessionId: bigint; photo: Photo; lens: number; people: number; sun?: { azimuth: number; altitude: number }; previews: readonly PreviewJob[];
}) {
  const request = useReducer(reducers.requestPreview);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const job = [...previews].filter(p => p.photoId === photo.id).sort((a, b) => Number(b.id - a.id))[0];
  const busy = job && (job.state === 'queued' || job.state === 'running');
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    request({ sessionId, photoId: photo.id, instruction: text.trim(), f35: lens, people, sunAzimuth: sun?.azimuth, sunAltitude: sun?.altitude })
      .catch(x => setErr(String(x?.message ?? x)));
  };
  return (
    <section className="block">
      <h2>Preview</h2>
      <form onSubmit={go} className="stack">
        <label className="field"><span>Anything else (optional)</span>
          <textarea rows={2} maxLength={500} value={text} onChange={e => setText(e.target.value)} placeholder="Two friends on the cobblestones, one holding a coffee" />
        </label>
        <p className="muted small mono">{Math.round(lens)} mm, {people} {people === 1 ? 'person' : 'people'}{sun ? `, sun ${Math.round(sun.azimuth)}° at ${sun.altitude.toFixed(0)}°` : ''}</p>
        {err && <p className="error" role="alert">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Working' : 'Make preview'}</button>
      </form>
      {job && (
        <div className="preview">
          <figure>
            <img src={photo.url || photo.thumb} alt="Your original photo" />
            <figcaption>Original</figcaption>
          </figure>
          <figure>
            {job.state === 'done' && job.imageUrl ? <img src={job.imageUrl} alt="AI interpretation of your plan" /> : <div className="sk preview-sk" style={{ aspectRatio: `${photo.width} / ${photo.height}` }} aria-busy={busy} />}
            <figcaption><span className="ai-label">AI interpretation</span> {busy ? PREVIEW_TEXT[job.state] : job.state === 'failed' ? `Failed: ${job.error}` : ''}</figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}

const CHANNEL: Record<string, string> = { imessage: 'iMessage', telegram: 'Telegram', voice: 'Voice', web: 'Web' };

export function LivePanel({ sessionId, parts, scouts, messages, ready, myName, me, solved }: {
  sessionId: bigint; parts: readonly Participant[]; scouts: readonly DevicePose[]; messages: readonly Message[]; ready: boolean; myName: string; me?: Identity; solved?: Pose;
}) {
  const post = useReducer(reducers.postMessage);
  const [text, setText] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const sorted = [...messages].sort((a, b) => Number(a.id - b.id));
  useEffect(() => { list.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }); }, [messages.length]);
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    post({ sessionId, channel: 'web', threadId: '', externalId: '', parentExternalId: '', direction: 'in', author: myName, text: t, imageUrl: '' })
      .then(() => setText('')).catch(console.error);
  };
  const scoutOf = (id: bigint) => scouts.find(s => s.participantId === id);
  return (
    <>
      <section className="block">
        <h2>People</h2>
        <ul className="roster">
          {[...parts].sort((a, b) => Number(b.online) - Number(a.online)).map(p => {
            const s = scoutOf(p.id);
            const d = s && solved ? metersBetween(s.lat, s.lon, solved.lat, solved.lon) : undefined;
            return (
              <li key={String(p.id)}>
                <span className="dot" data-on={p.online} aria-hidden="true" />
                <span>{p.name}{me && p.identity.isEqual(me) ? ' (you)' : ''}</span>
                <span className="role">{p.role}</span>
                <span className="mono muted">{p.online ? (d !== undefined ? `${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'} from mark` : 'online') : 'offline'}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="block chat">
        <h2>Messages</h2>
        {!ready ? <div className="sk sk-block" /> : sorted.length === 0 ? <p className="muted small">Messages from the web, iMessage, Telegram and calls show here.</p> : (
          <ol ref={list} className="messages">
            {sorted.map(m => (
              <li key={String(m.id)} data-dir={m.direction}>
                <div className="msg-head"><span className="chan" data-ch={m.channel}>{CHANNEL[m.channel] ?? m.channel}</span><strong>{m.author}</strong><time className="mono muted">{m.createdAt.toDate().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>
                {m.text && <p>{m.text}</p>}
                {m.imageUrl && <img src={m.imageUrl} alt="Attached" loading="lazy" />}
              </li>
            ))}
          </ol>
        )}
        <form onSubmit={send} className="composer">
          <label className="sr-only" htmlFor="msg">Message</label>
          <input id="msg" value={text} onChange={e => setText(e.target.value)} maxLength={4000} placeholder="Message the shoot" autoComplete="off" />
          <button className="btn primary" disabled={!text.trim()}>Send</button>
        </form>
      </section>
    </>
  );
}
