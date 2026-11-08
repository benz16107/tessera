// Tessera Simple: the friendly, phone-first view of a shoot (Figma round 1, direction A "Viewfinder"). It reads and writes
// the same SpacetimeDB rows as Studio (scene_object, shot_settings, session.planTime, preview jobs, shot_version), so a
// friend here and a photographer in Studio edit one shot together. Steps: Found it, Make it yours, Take me there.
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { Timestamp } from 'spacetimedb';
import { Quaternion, Vector3 } from 'three';
import { tables, reducers } from '../module_bindings/index.ts';
import type { Photo, Pose, Session, SolveJob, SolveResult, Spot } from '../module_bindings/types.ts';
import { useConfig, NAME_KEY } from '../config.ts';
import { navigate } from '../App.tsx';
import { sunAt, spotZone, fmtTime, angleDiff } from '../geo.ts';
import { useSessionCard } from '../spacetime/hooks.ts';
import { useScene } from '../studio/state/useScene.ts';
import { useShotSettings, defaultShot } from '../studio/state/useShotSettings.ts';
import { optics as opticsOf, frameFromPhoto } from '../studio/camera/shot.ts';
import { sceneEv100 } from '../studio/optics.ts';
import { cameraHpr, cameraQuat, llhToEnu, type Origin } from '../studio/frame.ts';
import { geometryFor, groundZ } from '../studio/world/geometry.ts';
import { newUid, parseParams } from '../studio/scene/objects.ts';
import type { Layers } from '../studio/render/layers.ts';
import ShotView from './ShotView.tsx';
import Found, { PinFound, ChangePlace } from './Found.tsx';
import Yours from './Yours.tsx';
import There from './There.tsx';
import ShareSheet from './Share.tsx';
import { Wordmark, LegalLinks } from './Drop.tsx';
import { ViewSwitch } from './ViewSwitch.tsx';
import { CONFIDENCE, initials, lonZone, parseGeo, uploadPhoto, useNow } from './lib.ts';
import { Close, Photo as PhotoIcon, Sun } from './icons.tsx';
import './simple.css';

export default function Simple({ code, active = true }: { code: string; active?: boolean }) {
  return <Gate code={code} active={active} />;
}

export type Step = 'found' | 'yours' | 'there';
const STEPS: [Step, string][] = [['found', 'Found it'], ['yours', 'Make it yours'], ['there', 'Take me there']];

export function Gate({ code, active }: { code: string; active: boolean }) {
  const { identity, isActive } = useSpacetimeDB();
  // Session rows reach participants only, so the public session_card(code) view answers "is there a shoot?".
  const [card, ready] = useSessionCard(code);
  const [rows] = useTable(tables.session.where(r => r.code.eq(code)));
  const session = rows[0];
  const [parts, partsReady] = useTable(tables.participant.where(r => r.sessionId.eq(card?.id ?? 0n)), { enabled: !!card });
  const joinSession = useReducer(reducers.joinSession);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [err, setErr] = useState('');
  const me = identity && parts.find(p => p.identity.isEqual(identity));
  const tried = useRef(false);
  const saved = useRef(name);

  const join = useCallback((n: string) => {
    localStorage.setItem(NAME_KEY, n);
    joinSession({ code, name: n, role: 'planner' }).catch(x => setErr(String(x?.message ?? x)));
  }, [code, joinSession]);
  // A returning person with a saved name rejoins without a prompt (only the name saved before this page loaded counts).
  useEffect(() => {
    if (card && partsReady && isActive && !me && saved.current && !tried.current) { tried.current = true; join(saved.current); }
  }, [card, partsReady, isActive, me, join]);

  // Once in, stay in: a participant row that blinks during a presence update must not unmount the shoot.
  const entered = useRef<{ session: Session; name: string } | null>(null);
  if (session && me) entered.current = { session, name: me.name };
  else if (entered.current && session) entered.current = { ...entered.current, session };
  if (entered.current) return <SimpleSession session={entered.current.session} myName={entered.current.name} active={active} />;

  if (!ready || (card && (!partsReady || (tried.current && !err)))) return <SessionSkeleton />;
  if (!card) {
    return (
      <div className="simple s-center">
        <Wordmark />
        <h1>No shoot with the code {code}</h1>
        <p className="s-muted">Check the code with whoever sent it.</p>
        <button className="s-btn" onClick={() => navigate('/')}>Start your own</button>
      </div>
    );
  }
  return (
    <div className="simple s-center">
      <Wordmark />
      <p className="s-eyebrow">You're invited</p>
      <h1>{card.title}</h1>
      <form className="s-join-form" onSubmit={e => { e.preventDefault(); if (name.trim()) { setErr(''); tried.current = true; join(name.trim()); } }}>
        <label htmlFor="s-name">Your name</label>
        <input id="s-name" className="s-field" value={name} onChange={e => setName(e.target.value)} maxLength={40} autoComplete="nickname" required autoFocus />
        {err && <p className="s-error" role="alert">{err}</p>}
        <button className="s-btn primary wide" disabled={!isActive}>Join the shoot</button>
      </form>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="simple s-app" aria-busy="true" aria-label="Loading the shoot">
      <header className="s-top"><Wordmark /><span className="s-sk s-sk-chip" /></header>
      <main className="s-main"><section className="s-stage"><span className="s-sk s-sk-stage" /></section>
        <section className="s-panel"><span className="s-sk s-sk-line" /><span className="s-sk s-sk-title" /><span className="s-sk s-sk-block" /></section></main>
    </div>
  );
}

const MADE_CAM = new Set<bigint>();
const NO_ROWS: readonly never[] = []; // Found it shows the photo and the blend only; the set's people and props start at Make it yours

function SimpleSession({ session, myName, active }: { session: Session; myName: string; active: boolean }) {
  const cfg = useConfig();
  const { identity } = useSpacetimeDB();
  const sid = session.id;
  const [spots] = useTable(tables.spot);
  const [photos] = useTable(tables.photo.where(r => r.sessionId.eq(sid)));
  const [jobs] = useTable(tables.solveJob.where(r => r.sessionId.eq(sid)));
  const [results] = useTable(tables.solveResult.where(r => r.sessionId.eq(sid)));
  const [parts] = useTable(tables.participant.where(r => r.sessionId.eq(sid)));
  const setPlanTime = useReducer(reducers.setPlanTime);
  const setSessionSpot = useReducer(reducers.setSessionSpot);
  const scene = useScene(sid);

  // The newest photo is the one this shoot is about; its newest job and its result drive the screen.
  const photo = useMemo(() => [...photos].sort((a, b) => Number(b.id - a.id))[0], [photos]);
  const result = photo && results.find(r => r.photoId === photo.id);
  const job = photo && [...jobs].filter(j => j.photoId === photo.id).sort((a, b) => Number(b.id - a.id))[0];
  const solved = result && result.confidence !== 'none' ? result : undefined;
  // A free-location shoot (spot id 'geo:...', anywhere.md) plans at its pin: nothing is solved, so the stand and heading are approximate.
  const geoSpot = useMemo(() => parseGeo(session.spotId), [session.spotId]);
  const spotId = geoSpot ? session.spotId : job?.spotId || session.spotId;
  const spot = spots.find(s => s.id === spotId);
  const origin: Origin | null = useMemo(() => (spot ? { lat: spot.lat, lon: spot.lon, height: 0 } : geoSpot), [spot?.lat, spot?.lon, geoSpot]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinShoot = !!geoSpot && !!photo && !solved;
  const geo = useMemo(() => geometryFor(spotId), [spotId]);
  const gz = useCallback((x: number, y: number) => groundZ(geo, x, y), [geo]);
  const zone = geoSpot ? lonZone(geoSpot.lon) : spotZone(spotId, origin?.lon ?? 0);
  const owner = photo && parts.find(p => p.identity.isEqual(photo.owner))?.name;

  useEffect(() => {
    if (!session.spotId && job?.spotId) setSessionSpot({ sessionId: sid, spotId: job.spotId }).catch(() => {});
  }, [session.spotId, job?.spotId, sid, setSessionSpot]);

  // Plan time is shared through the session row (Studio's timeline reads it); local while it settles.
  const [planLocal, setPlanLocal] = useState<Date | null>(null);
  const planTime = planLocal ?? session.planTime?.toDate() ?? new Date();
  const changeTime = useCallback((d: Date) => {
    setPlanLocal(d);
    setPlanTime({ sessionId: sid, at: Timestamp.fromDate(d) }).then(() => setPlanLocal(null)).catch(() => setPlanLocal(null));
  }, [setPlanTime, sid]);
  const sun = origin ? sunAt(planTime, origin.lat, origin.lon) : { azimuth: 180, altitude: 45 };
  const sceneEv = sceneEv100(sun.altitude, 'clear', 'street');
  const expo = 3 / (2.5 * Math.pow(2, sceneEv));

  const startF35 = solved?.pose.f35 ?? (pinShoot ? photo?.exifF35 ?? 26 : 35);
  const defaults = useMemo(() => ({ ...defaultShot(startF35, 8, sceneEv), aspect: '4:3' }),
    [startF35, Math.round(sceneEv * 3)]); // eslint-disable-line react-hooks/exhaustive-deps
  const { shot, set: setShot } = useShotSettings(sid, defaults);
  const frame = useMemo(() => frameFromPhoto(photo), [photo?.width, photo?.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const o = useMemo(() => opticsOf(shot, frame), [shot, frame]);

  // The shot camera is Cam A in the shared set; before anyone made it, the solved pose stands in.
  const cams = scene.rows.filter(r => r.kind === 'camera');
  const shotRow = cams.find(r => parseParams(r.params).shot === '1') ?? cams[0];
  // The pin's stand-in pose: the pin, 1.6 m up, Cam A's heading once someone aims it, the photo's EXIF lens else a phone's 26 mm.
  const pose: Pose | undefined = solved?.pose ?? (pinShoot && geoSpot ? {
    lat: geoSpot.lat, lon: geoSpot.lon, alt: 1.6, pitch: 0, roll: 0, f35: photo?.exifF35 ?? 26,
    heading: shotRow ? cameraHpr(new Quaternion(shotRow.qx, shotRow.qy, shotRow.qz, shotRow.qw).normalize()).heading : 0,
  } : undefined);
  const cam = useMemo(() => {
    if (shotRow) return { pos: new Vector3(shotRow.x, shotRow.y, shotRow.z), q: new Quaternion(shotRow.qx, shotRow.qy, shotRow.qz, shotRow.qw).normalize() };
    if (!pose || !origin) return null;
    const p = llhToEnu(origin, pose.lat, pose.lon, 0);
    return { pos: new Vector3(p.x, p.y, gz(p.x, p.y) + pose.alt), q: cameraQuat(pose.heading, pose.pitch, pose.roll) };
  }, [shotRow?.x, shotRow?.y, shotRow?.z, shotRow?.qx, shotRow?.qy, shotRow?.qz, shotRow?.qw, solved?.photoId, pinShoot, origin, gz]); // eslint-disable-line react-hooks/exhaustive-deps

  // Like Studio, the first person in makes Cam A at the solved pose (or the pin, marked approx), so "add a friend" frames through it.
  const camCount = useRef(cams.length);
  camCount.current = cams.length;
  useEffect(() => {
    if (!scene.ready || cams.length || MADE_CAM.has(sid) || !pose || !origin || !photo) return;
    const t = window.setTimeout(() => {
      if (camCount.current || MADE_CAM.has(sid)) return;
      MADE_CAM.add(sid);
      const p = llhToEnu(origin, pose.lat, pose.lon, 0);
      const q = cameraQuat(pose.heading, pose.pitch, pose.roll);
      scene.addObject({
        kind: 'camera', assetId: '', name: 'Cam A', x: p.x, y: p.y, z: gz(p.x, p.y) + pose.alt, qx: q.x, qy: q.y, qz: q.z, qw: q.w, scale: 1,
        color: '', intensity: 0, lightType: '', params: `uid=${newUid()};shot=1;photo=${photo.id};alt=${pose.alt}${solved ? '' : ';approx=1'}`, visible: true,
      });
    }, 4000);
    return () => clearTimeout(t);
  }, [scene.ready, cams.length, solved, pinShoot, origin]); // eslint-disable-line react-hooks/exhaustive-deps

  const [step, setStep] = useState<Step>('found');
  const [blend, setBlend] = useState(1); // open on the photo; the slider reveals the 3D on demand
  const [selected, setSelected] = useState<bigint | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const capture = useRef<(() => Promise<Layers>) | null>(null);
  const selRow = scene.rows.find(r => r.id === selected && r.kind !== 'camera');
  useEffect(() => { if (selected !== null && !scene.rows.some(r => r.id === selected)) setSelected(null); }, [scene.rows, selected]);

  const solvedF35 = pose?.f35 ?? o.f35;
  const online = parts.filter(p => p.online);
  const stageReady = !!(photo && pose && cam && origin);
  const sunWords = pose ? sunWords3(sun, pose.heading) : '';

  let panel: React.ReactNode;
  if (!photo) panel = <AddPhoto session={session} spotId={spotId} />;
  else if (!pose) panel = <Solving photo={photo} job={job} result={result} spots={spots} sessionId={sid} />;
  else if (step === 'found') panel = solved ? <Found result={solved} photo={photo} spot={spot} zone={zone} credit={owner} onGo={() => setStep('there')} />
    : <PinFound photo={photo} geo={geoSpot!} title={session.title} zone={zone} sessionId={sid} credit={owner} onGo={() => setStep('there')} />;
  else if (step === 'yours') panel = (
    <Yours sessionId={sid} photo={photo} spotId={spotId} pose={pose} shot={shot} setShot={setShot} o={o} planTime={planTime} zone={zone}
      changeTime={changeTime} people={scene.rows.filter(r => r.kind === 'person').length} capture={capture} sun={sun} credit={owner} />
  );
  else panel = <There session={session} pose={pose} photo={photo} zone={zone} spot={spot} />;

  return (
    <div className="simple s-app" data-step={stageReady ? step : 'solving'}>
      <header className="s-top">
        <Wordmark />
        <ViewSwitch code={session.code} current="simple" selected={selected} onArrive={h => { if (h.selected !== null) setSelected(h.selected); }} />
        <div className="s-session">
          <ul className="s-avatars" aria-label={`${online.length} ${online.length === 1 ? 'person' : 'people'} here now`}>
            {online.slice(0, 4).map((p, i) => <li key={String(p.id)} title={`${p.name}${identity && p.identity.isEqual(identity) ? ' (you)' : ''}`} data-i={i % 3}>{initials(p.name)}</li>)}
          </ul>
          <span className="s-code" aria-label={`Shoot code ${session.code}`}>{session.code}</span>
          <button className="s-pill" onClick={() => setShareOpen(true)}>Share</button>
        </div>
      </header>
      <main className="s-main">
        <section className="s-stage" aria-label={step === 'there' ? 'Camera' : 'Your photo over the 3D spot'}>
          <StageBoundary key={step} fallback={photo ? <StagePhoto photo={photo} solving={false} note="The 3D view is off on this device. Everything else still works." /> : null}>
          {step === 'there' && stageReady ? <There.Stage session={session} live={active} />
            : stageReady ? (
              <ShotView mapsKey={cfg.mapsKey} origin={origin!} spotId={spotId} geo={geo} gz={gz} cam={cam!} optics={o} rows={step === 'found' ? NO_ROWS : scene.rows} shotId={shotRow?.id ?? null}
                sun={sun} expo={expo} photo={{ url: photo!.url || photo!.thumb, width: photo!.width, height: photo!.height }}
                photoScale={o.f35 / solvedF35} blend={blend} selected={selected} onSelect={setSelected} capture={capture} live={active}>
                {step === 'yours' && <p className="s-float s-sunpill"><Sun width={18} height={18} /> Sun {sunWords}, {fmtTime(planTime, zone)}</p>}
                {selRow && step !== 'found' && (
                  <div className="s-float s-selchip" role="status">
                    <span>{selRow.name.replace(/ \(.*\)$/, '')}</span>
                    <button className="s-textbtn" onClick={() => { scene.deleteObject(selRow); setSelected(null); }}>Remove</button>
                    <button className="s-icon-btn small" aria-label="Deselect" onClick={() => setSelected(null)}><Close width={16} height={16} /></button>
                  </div>
                )}
                <label className="s-float s-blend">
                  <span aria-hidden="true">3D</span>
                  <input type="range" min={0} max={1} step={0.01} value={blend} onChange={e => setBlend(+e.target.value)}
                    aria-label="Blend between the 3D spot and your photo" aria-valuetext={`${Math.round(blend * 100)}% photo`} />
                  <span aria-hidden="true">Photo</span>
                </label>
              </ShotView>
            ) : photo ? <StagePhoto photo={photo} solving={!result || (job?.state === 'queued' || job?.state === 'running')} /> : <div className="s-stage-empty"><PhotoIcon width={40} height={40} /></div>}
          </StageBoundary>
        </section>
        {/* Its own grid row, so the tabs stay in one place on every step: under the top bar on a phone, atop the right column on a laptop. */}
        {stageReady && (
          <div className="s-stepsbar">
            <div className="s-steps" role="tablist" aria-label="Steps">
              {STEPS.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={step === k} onClick={() => setStep(k)}>{label}</button>
              ))}
            </div>
          </div>
        )}
        <section className="s-panel">
          <div className="s-panel-body" role={stageReady ? 'tabpanel' : undefined}>{panel}</div>
          <footer className="s-panel-foot"><LegalLinks /><span>Previews are AI interpretations of your photo.</span></footer>
        </section>
      </main>
      <Toasts sessionId={sid} />
      {shareOpen && <ShareSheet session={session} myName={myName} onClose={() => setShareOpen(false)} />}
    </div>
  );
}

/** "from the right" style words for where the sun sits relative to the camera. */
export function sunWords3(sun: { azimuth: number; altitude: number }, heading: number) {
  if (sun.altitude < -1) return 'below the horizon';
  const d = angleDiff(sun.azimuth, heading);
  if (Math.abs(d) < 25) return 'ahead of you';
  if (Math.abs(d) > 135) return 'behind you';
  return d < 0 ? 'from the left' : 'from the right';
}

function StagePhoto({ photo, solving, note }: { photo: Photo; solving: boolean; note?: string }) {
  return (
    <figure className="s-stage-photo" data-solving={solving || undefined}>
      <img src={photo.url || photo.thumb} alt="Your photo" />
      {solving && <span className="s-scan" aria-hidden="true" />}
      {note && <figcaption className="s-float s-sunpill" role="status">{note}</figcaption>}
    </figure>
  );
}

/** A lost or refused WebGL context (a backgrounded phone tab, a blocked GPU) takes down only the 3D stage, not the page. */
class StageBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const SOLVE_STEPS = ['Uploading your photo', 'Finding the place', 'Matching it with photos of the spot', 'Working out where they stood and the lens'];

function Solving({ photo, job, result, spots, sessionId }: { photo: Photo; job?: SolveJob; result?: SolveResult; spots: readonly Spot[]; sessionId: bigint }) {
  const enqueue = useReducer(reducers.enqueueSolve);
  const [spotPick, setSpotPick] = useState('');
  const now = useNow(1000, !!job && job.state !== 'done' && job.state !== 'failed');
  const failed = job?.state === 'failed' || result?.confidence === 'none';
  // Which plain-words step is active: queued is "finding", running walks through matching then solving.
  const prog = job?.progress ?? '';
  const at = !job ? 1 : job.state === 'queued' ? 1 : job.state === 'running' ? (/pnp|pose|lens|focal|refin|solv/i.test(prog) ? 3 : 2) : 4;
  const secs = job ? Math.max(0, Math.round((now - job.createdAt.toDate().getTime()) / 1000)) : 0;
  const retry = (lens?: number) => {
    const s = job?.spotId || spotPick || (spots.length === 1 ? spots[0].id : '');
    if (s) enqueue({ photoId: photo.id, spotId: s, lensHintF35: lens }).catch(() => {});
  };

  if (failed) {
    return (
      <div className="s-solving">
        <p className="s-conf" data-tone="bad"><i aria-hidden="true" />{CONFIDENCE.none.word}</p>
        <h1 className="s-title">We could not tell where this was taken</h1>
        <p className="s-muted">{job?.state === 'failed' ? job.error || 'The search stopped with an error.' : result?.reason}</p>
        <hr />
        <p className="s-label">Know roughly which lens took it? It narrows the search.</p>
        <div className="s-chips">
          {[24, 35, 50, 85].map(f => <button key={f} className="s-chip" onClick={() => retry(f)}>{f} mm</button>)}
          <button className="s-chip" onClick={() => retry()}>Try again</button>
        </div>
        <hr />
        <p className="s-label">Not taken at {spots.find(s => s.id === job?.spotId)?.name ?? 'a mapped spot'}? Pick the place and plan it there.</p>
        <ChangePlace sessionId={sessionId} />
      </div>
    );
  }
  if (!job) {
    return (
      <div className="s-solving">
        <h1 className="s-title">Which place is this?</h1>
        <p className="s-muted">The photo has no location, so pick the spot it shows.</p>
        <div className="s-chips">
          {spots.map(s => <button key={s.id} className="s-chip" aria-pressed={spotPick === s.id} onClick={() => { setSpotPick(s.id); enqueue({ photoId: photo.id, spotId: s.id, lensHintF35: undefined }).catch(() => {}); }}>{s.name}</button>)}
        </div>
      </div>
    );
  }
  return (
    <div className="s-solving" aria-live="polite">
      <p className="s-eyebrow">Finding where they stood</p>
      <h1 className="s-title">This usually takes about 20 seconds</h1>
      <ol className="s-progress">
        {SOLVE_STEPS.map((t, i) => (
          <li key={t} data-state={i < at ? 'done' : i === at ? 'now' : 'next'}>
            <span className="s-tick" aria-hidden="true" />
            <span>{t}{i === at && prog && job.state === 'running' ? <small>{prog}</small> : null}</span>
            <span className="sr-only">{i < at ? 'done' : i === at ? 'in progress' : 'next'}</span>
          </li>
        ))}
      </ol>
      <p className="s-muted small">{job.state === 'queued' && job.attempts === 0 && secs > 20 ? 'Waiting for the solver to pick it up.' : `${secs} s`}</p>
    </div>
  );
}

function AddPhoto({ session, spotId }: { session: Session; spotId: string }) {
  const addPhoto = useReducer(reducers.addPhoto);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const send = async (f: File) => {
    setBusy(true); setErr('');
    try {
      const u = await uploadPhoto(f, f.name);
      await addPhoto({ sessionId: session.id, spotId: u.nearestSpot ?? spotId, url: u.url, thumb: u.thumb, width: u.width, height: u.height,
        pinLat: u.gpsLat ?? undefined, pinLon: u.gpsLon ?? undefined, exifF35: u.exifF35 ?? undefined, source: 'web' });
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="s-solving">
      <h1 className="s-title">Add the photo you want to match</h1>
      <p className="s-muted">Everyone in this shoot sees it the moment it lands.</p>
      <input ref={input} type="file" accept="image/*,.heic,.heif" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void send(f); e.target.value = ''; }} />
      <button className="s-btn primary" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Uploading' : 'Choose a photo'}</button>
      {err && <p className="s-error" role="alert">{err}</p>}
    </div>
  );
}

interface ToastItem { id: number; text: string }
function Toasts({ sessionId }: { sessionId: bigint }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const onInsert = useCallback((t: { kind: string; text: string }) => {
    const id = Math.random();
    setItems(xs => [...xs.slice(-2), { id, text: t.text }]);
    setTimeout(() => setItems(xs => xs.filter(x => x.id !== id)), 6000);
  }, []);
  useTable(tables.toast.where(r => r.sessionId.eq(sessionId)), { onInsert });
  return <ol className="s-toasts" role="status" aria-live="polite">{items.map(t => <li key={t.id}>{t.text}</li>)}</ol>;
}
