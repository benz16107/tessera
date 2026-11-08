import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { Identity, Timestamp } from 'spacetimedb';
import { tables, reducers } from './module_bindings/index.ts';
import type { Pose, Session } from './module_bindings/types.ts';
import { useConfig, NAME_KEY } from './config.ts';
import { navigate, LoadBoundary } from './App.tsx';
import type { PlaceMode, Frame } from './SceneView.tsx';
import { SimilarShots, RoutePanel, parseCredit, shotKey, type SpotShot, type ShotPose, type Stop } from './extras.tsx';

// Cesium is ~4 MB, so the 3D view loads in its own chunk after the planner shell paints.
const SceneView = lazy(() => import('./SceneView.tsx'));
import { sunAt } from './geo.ts';
import { AnswerCard, ConfidenceBadge, JobStatus, Trace, LensPanel, PeoplePanel, LightPanel, PreviewPanel, LivePanel, ShareDialog, Toasts, PhotoDrop, Footer, Presence } from './panels.tsx';

export default function Planner({ code }: { code?: string }) {
  return code ? <SessionGate code={code} /> : <Home />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Home() {
  const { identity, isActive } = useSpacetimeDB();
  const [spots, spotsReady] = useTable(tables.spot);
  const [mine] = useTable(tables.session.where(r => r.owner.eq(identity ?? Identity.zero())), { enabled: !!identity });
  const createSession = useReducer(reducers.createSession);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [title, setTitle] = useState('');
  const [spotId, setSpotId] = useState('');
  const [join, setJoin] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState('');

  // createSession returns nothing, so watch our own sessions for the one made after the click.
  useEffect(() => {
    if (busy === null) return;
    const s = [...mine].filter(x => x.createdAt.toDate().getTime() >= busy - 5000).sort((a, b) => Number(b.id - a.id))[0];
    if (s) navigate(`/p/${s.code}`);
  }, [mine, busy]);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr('Add your name so friends know who is planning.');
    localStorage.setItem(NAME_KEY, name.trim());
    setErr('');
    setBusy(Date.now());
    createSession({ spotId, title: title.trim() || 'Untitled shoot', name: name.trim() }).catch(x => { setBusy(null); setErr(String(x?.message ?? x)); });
  };
  const doJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const c = join.trim().toUpperCase();
    if (c.length >= 4) navigate(`/p/${c}`);
  };
  const recent = [...mine].sort((a, b) => Number(b.id - a.id)).slice(0, 4);

  return (
    <div className="home">
      <header className="home-head">
        <p className="wordmark">ShotMatch</p>
        <p className="conn" data-on={isActive}>{isActive ? 'Live' : 'Connecting'}</p>
      </header>
      <main className="home-main">
        <section className="home-intro">
          <h1>Where did they stand, and what lens?</h1>
          <p>Drop a photo of a mapped spot. ShotMatch places it in Google's 3D city, reads the heading and the lens, and gives you a mark to walk to. Then plan your own version with friends: lens, people, light.</p>
        </section>
        <section className="sheet home-forms" aria-label="Start">
          <form onSubmit={create} className="stack">
            <h2>New shoot</h2>
            <Field label="Your name"><input value={name} onChange={e => setName(e.target.value)} maxLength={40} autoComplete="nickname" required /></Field>
            <Field label="Shoot title"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="Bridge at golden hour" /></Field>
            <Field label="Spot">
              <select value={spotId} onChange={e => setSpotId(e.target.value)} disabled={!spotsReady}>
                <option value="">{spotsReady ? (spots.length ? 'Pick later, or let the photo decide' : 'No spots loaded yet') : 'Loading spots'}</option>
                {spots.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            {err && <p className="error" role="alert">{err}</p>}
            <button className="btn primary" disabled={!isActive || busy !== null}>{busy !== null ? 'Creating' : 'Create shoot'}</button>
          </form>
          <hr />
          <form onSubmit={doJoin} className="stack">
            <h2>Join with a code</h2>
            <Field label="Session code"><input value={join} onChange={e => setJoin(e.target.value)} maxLength={12} autoCapitalize="characters" spellCheck={false} className="mono" placeholder="K7QF2M" /></Field>
            <button className="btn">Join</button>
          </form>
          {recent.length > 0 && (
            <>
              <hr />
              <h2>Your shoots</h2>
              <ul className="recent">
                {recent.map(s => <li key={String(s.id)}><a href={`/p/${s.code}`} onClick={e => { e.preventDefault(); navigate(`/p/${s.code}`); }}><span>{s.title}</span><code>{s.code}</code></a></li>)}
              </ul>
            </>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}

function SessionGate({ code }: { code: string }) {
  const { identity, isActive } = useSpacetimeDB();
  const [rows, ready] = useTable(tables.session.where(r => r.code.eq(code)));
  const session = rows[0];
  const [parts, partsReady] = useTable(tables.participant.where(r => r.sessionId.eq(session?.id ?? 0n)), { enabled: !!session });
  const joinSession = useReducer(reducers.joinSession);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [err, setErr] = useState('');
  const me = identity && parts.find(p => p.identity.isEqual(identity));
  const tried = useRef(false);

  const join = useCallback((n: string) => {
    localStorage.setItem(NAME_KEY, n);
    joinSession({ code, name: n, role: 'planner' }).catch(x => setErr(String(x?.message ?? x)));
  }, [code, joinSession]);

  // Returning planners with a saved name rejoin without a prompt.
  useEffect(() => {
    if (session && partsReady && isActive && !me && name && !tried.current) { tried.current = true; join(name); }
  }, [session, partsReady, isActive, me, name, join]);

  if (!ready) return <SessionSkeleton />;
  if (!session) {
    return (
      <div className="home"><main className="center-note">
        <p className="wordmark">ShotMatch</p>
        <h1>No shoot with code <code>{code}</code></h1>
        <p>Check the code with whoever shared it.</p>
        <button className="btn" onClick={() => navigate('/')}>Start a new shoot</button>
      </main></div>
    );
  }
  if (!me) {
    if (tried.current && !err) return <SessionSkeleton />;
    return (
      <div className="home"><main className="center-note">
        <p className="wordmark">ShotMatch</p>
        <h1>Join "{session.title}"</h1>
        <form className="stack sheet narrow" onSubmit={e => { e.preventDefault(); if (name.trim()) join(name.trim()); }}>
          <Field label="Your name"><input value={name} onChange={e => setName(e.target.value)} maxLength={40} required autoFocus /></Field>
          {err && <p className="error" role="alert">{err}</p>}
          <button className="btn primary" disabled={!isActive}>Join the shoot</button>
        </form>
      </main></div>
    );
  }
  return <SessionView session={session} myName={me.name} />;
}

function SessionSkeleton() {
  return (
    <div className="app" aria-busy="true">
      <header className="topbar"><p className="wordmark">ShotMatch</p><span className="sk sk-chip" /></header>
      <div className="workspace"><div className="stage"><div className="scene-skeleton" /></div><aside className="panel"><span className="sk sk-line" /><span className="sk sk-block" /><span className="sk sk-line" /></aside></div>
    </div>
  );
}

type Tab = 'shot' | 'yours' | 'live';

function SessionView({ session, myName }: { session: Session; myName: string }) {
  const cfg = useConfig();
  const { identity } = useSpacetimeDB();
  const sid = session.id;
  const [spots] = useTable(tables.spot);
  const [photos] = useTable(tables.photo.where(r => r.sessionId.eq(sid)));
  const [jobs] = useTable(tables.solveJob.where(r => r.sessionId.eq(sid)));
  const [results] = useTable(tables.solveResult.where(r => r.sessionId.eq(sid)));
  const [cams] = useTable(tables.camera.where(r => r.sessionId.eq(sid)));
  const [people] = useTable(tables.person.where(r => r.sessionId.eq(sid)));
  const [scouts] = useTable(tables.devicePose.where(r => r.sessionId.eq(sid)));
  const [parts] = useTable(tables.participant.where(r => r.sessionId.eq(sid)));
  const [previews] = useTable(tables.previewJob.where(r => r.sessionId.eq(sid)));
  const [messages, messagesReady] = useTable(tables.message.where(r => r.sessionId.eq(sid)));
  const [steps] = useTable(tables.agentStep.where(r => r.sessionId.eq(sid)));

  const moveCamera = useReducer(reducers.moveCamera);
  const setSessionSpot = useReducer(reducers.setSessionSpot);
  const setPlanTime = useReducer(reducers.setPlanTime);
  const placePerson = useReducer(reducers.placePerson);
  const deletePhoto = useReducer(reducers.deletePhoto);

  const [tab, setTab] = useState<Tab>('shot');
  const [selected, setSelected] = useState<bigint | null>(null);
  const [opacity, setOpacity] = useState(0.5);
  const [lensOverride, setLensOverride] = useState<number | null>(null);
  const [placing, setPlacing] = useState<PlaceMode>({ kind: 'none' });
  const [selPerson, setSelPerson] = useState<bigint | null>(null);
  const [shadows, setShadows] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const poseNow = useRef<((f35: number) => Pose) | null>(null);
  const [lookAt, setLookAt] = useState<(Frame & { credit?: string }) | null>(null); // a spot photo shown in place of yours
  const [snap, setSnap] = useState(0); // bump to fly back to your shot
  const [starred, setStarred] = useState<Map<string, SpotShot>>(new Map());
  const [route, setRoute] = useState<Stop[]>([]);
  const [overview, setOverview] = useState(0); // non-zero while the route overview is on screen

  const sortedPhotos = useMemo(() => [...photos].sort((a, b) => Number(a.id - b.id)), [photos]);
  const photo = sortedPhotos.find(p => p.id === selected) ?? sortedPhotos[sortedPhotos.length - 1];
  const result = photo && results.find(r => r.photoId === photo.id);
  const job = photo && [...jobs].filter(j => j.photoId === photo.id).sort((a, b) => Number(b.id - a.id))[0];
  const solved = result && result.confidence !== 'none' ? result.pose : undefined;
  const spotId = job?.spotId || session.spotId;
  const spot = spots.find(s => s.id === spotId);
  const frame: Frame | undefined = overview ? undefined : lookAt ?? (solved && photo
    ? { url: photo.url || photo.thumb, width: photo.width, height: photo.height, pose: solved, key: `${photo.id}:${result?.jobId}:${snap}` }
    : undefined);
  const lens = lensOverride ?? frame?.pose.f35 ?? photo?.exifF35 ?? 26;
  const camera = cams[0];

  // A solve against a spot names the shoot's spot when it had none.
  useEffect(() => {
    if (!session.spotId && job?.spotId) setSessionSpot({ sessionId: sid, spotId: job.spotId }).catch(() => {});
  }, [session.spotId, job?.spotId, sid, setSessionSpot]);

  // New photo or new result: lens back to the solved value.
  useEffect(() => { setLensOverride(null); setLookAt(null); }, [photo?.id, result?.jobId]);
  useEffect(() => { setRoute([]); setStarred(new Map()); setOverview(0); }, [photo?.id]);

  // Plan time: shared through the session row; local while the slider moves.
  const [planLocal, setPlanLocal] = useState<Date | null>(null);
  const planTime = planLocal ?? session.planTime?.toDate() ?? new Date();
  const commitTimer = useRef<number | undefined>(undefined);
  const changePlan = (d: Date) => {
    setPlanLocal(d);
    clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      setPlanTime({ sessionId: sid, at: Timestamp.fromDate(d) }).then(() => setPlanLocal(null)).catch(console.error);
    }, 350);
  };

  const broadcast = useCallback((pose: Pose) => { moveCamera({ sessionId: sid, pose }).catch(() => {}); }, [moveCamera, sid]);
  const changeLens = (f: number) => {
    setLensOverride(f);
    if (poseNow.current) broadcast(poseNow.current(f));
  };

  // Show a spot photo (similar shot or route stop) at its registered pose; friends follow through the camera row.
  const look = (url: string, p: ShotPose, credit?: string) => {
    const img = new Image();
    img.onload = () => {
      const pose: Pose = { lat: p.lat, lon: p.lon, alt: p.alt ?? 1.6, heading: p.heading, pitch: p.pitch, roll: p.roll, f35: p.f35 };
      setLensOverride(null);
      setOverview(0);
      setLookAt({ url, width: img.naturalWidth, height: img.naturalHeight, pose, key: `${url}:${Date.now()}`, credit });
      broadcast(pose);
    };
    img.src = url;
  };
  const backToMine = () => { setOverview(0); setLookAt(null); setLensOverride(null); setSnap(n => n + 1); if (solved) broadcast(solved); };
  const toggleStar = (shot: SpotShot) => setStarred(m => {
    const n = new Map(m);
    if (n.has(shotKey(shot))) n.delete(shotKey(shot)); else n.set(shotKey(shot), shot);
    return n;
  });
  const showStop = (stop: Stop) => {
    if (!stop.url) return backToMine();
    const known = [...starred.values()].find(x => x.url === stop.url);
    look(stop.url, known?.pose ?? { lat: stop.lat, lon: stop.lon, heading: stop.heading, pitch: 0, roll: 0, f35: stop.f35 }, stop.credit);
  };

  const onPick = (lat: number, lon: number) => {
    if (placing.kind === 'add') {
      placePerson({ sessionId: sid, id: 0n, lat, lon, heading: solved ? (solved.heading + 180) % 360 : 0, label: `Person ${people.length + 1}` }).catch(console.error);
    } else if (placing.kind === 'move') {
      const old = people.find(p => p.id === placing.id);
      placePerson({ sessionId: sid, id: placing.id, lat, lon, heading: old?.heading ?? 0, label: old?.label ?? 'Person' }).catch(console.error);
      setPlacing({ kind: 'none' });
    }
  };
  useEffect(() => {
    if (placing.kind === 'none') return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPlacing({ kind: 'none' }); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [placing.kind]);

  const sunPos = spot || solved ? sunAt(planTime, solved?.lat ?? spot!.lat, solved?.lon ?? spot!.lon) : undefined;
  const scoutsLive = scouts.filter(s => parts.some(p => p.id === s.participantId && p.online));

  return (
    <div className="app">
      <header className="topbar">
        <a className="wordmark" href="/" onClick={e => { e.preventDefault(); navigate('/'); }}>ShotMatch</a>
        <div className="session-title">
          <h1>{session.title}</h1>
          <span className="mono code-chip" aria-label={`Session code ${session.code}`}>{session.code}</span>
        </div>
        <Presence parts={parts} me={identity} />
        <button className="btn" onClick={() => setShareOpen(true)}>Share</button>
      </header>
      <div className="workspace">
        <section className="stage" aria-label="3D view">
          <PhotoDrop session={session} spotId={session.spotId} onUploaded={() => setSelected(null)} asStage>
            <LoadBoundary label="The 3D view">
            <Suspense fallback={<div className="scene-frame"><div className="scene"><div className="scene-skeleton" aria-label="Loading the 3D view" /></div></div>}>
            <SceneView
              mapsKey={cfg.mapsKey}
              spot={spot}
              frame={frame}
              solved={solved}
              route={route}
              overview={overview}
              lens={lens}
              opacity={opacity}
              people={people}
              scouts={scoutsLive}
              participants={parts}
              camera={camera}
              me={identity}
              planTime={planTime}
              shadows={shadows}
              placing={placing}
              selectedPerson={selPerson}
              onPick={onPick}
              onSelectPerson={id => { setSelPerson(id); if (id) setTab('yours'); }}
              onBroadcast={broadcast}
              onRemoteLens={f => setLensOverride(f)}
              onReady={fn => { poseNow.current = fn; }}
            />
            </Suspense>
            </LoadBoundary>
            {photo && !solved && (
              <figure className="stage-photo">
                <img src={photo.thumb} alt="Your photo" />
                <figcaption>{job && (job.state === 'queued' || job.state === 'running') ? 'Placing this photo' : result?.confidence === 'none' ? 'Not placed' : 'Your photo'}</figcaption>
              </figure>
            )}
          </PhotoDrop>
          <div className="stage-bar">
            {result && <ConfidenceBadge result={result} />}
            {overview > 0 && (
              <p className="looking">
                <span className="mono">Route</span> {route.length} stops
                <button className="btn small" onClick={backToMine}>Back to your shot</button>
              </p>
            )}
            {lookAt && (
              <p className="looking">
                <span className="mono">Spot photo</span> {lookAt.credit ? parseCredit(lookAt.credit).by : ''}
                <button className="btn small" onClick={backToMine}>Back to your shot</button>
              </p>
            )}
            {frame && (
              <label className="slider inline">
                <span>3D</span>
                <input type="range" min={0} max={1} step={0.01} value={opacity} onChange={e => setOpacity(+e.target.value)} aria-label="Photo overlay opacity, 0 shows the 3D view, 1 shows the photo" />
                <span>Photo</span>
              </label>
            )}
            {!result && job && <JobStatus job={job} compact />}
            {!spot && !photo && <p className="hint">Pick a spot or drop a photo to start.</p>}
            {placing.kind !== 'none' && <p className="hint" role="status">{placing.kind === 'add' ? 'Click the 3D view to drop people. Esc to stop.' : 'Click where this person should stand.'}</p>}
          </div>
        </section>
        <aside className="panel">
          <div role="tablist" className="tabs" aria-label="Panels">
            {([['shot', 'Shot'], ['yours', 'Make it yours'], ['live', `Live${messages.length ? ` (${messages.length})` : ''}`]] as const).map(([k, label]) => (
              <button key={k} role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`pane-${k}`} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          <div className="pane" role="tabpanel" id={`pane-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'shot' && (
              <>
                <section className="block">
                  <h2>Spot</h2>
                  <select value={session.spotId} onChange={e => setSessionSpot({ sessionId: sid, spotId: e.target.value }).catch(console.error)} aria-label="Spot for this shoot">
                    <option value="">{spots.length ? 'No spot yet' : 'No spots loaded yet'}</option>
                    {spots.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </section>
                <section className="block">
                  <h2>Photo</h2>
                  <PhotoDrop session={session} spotId={session.spotId} onUploaded={() => setSelected(null)} compact={!!photo} />
                  {photo && (
                    <div className="photo-row">
                      <img src={photo.thumb} alt="Selected photo" width={photo.width} height={photo.height} />
                      <span className="small muted">{photo.width} x {photo.height}{photo.exifF35 ? `, EXIF ${Math.round(photo.exifF35)} mm` : ''}{photo.source !== 'web' ? `, from ${photo.source}` : ''}</span>
                      {identity && photo.owner.isEqual(identity) && (
                        <button className="btn small danger" onClick={() => { deletePhoto({ photoId: photo.id }).catch(console.error); setSelected(null); }}>Remove photo</button>
                      )}
                    </div>
                  )}
                  {sortedPhotos.length > 1 && (
                    <ul className="contact" aria-label="Photos in this shoot">
                      {sortedPhotos.map((p, i) => (
                        <li key={String(p.id)}>
                          <button aria-pressed={p.id === photo?.id} onClick={() => setSelected(p.id)} aria-label={`Photo ${i + 1}`}>
                            <img src={p.thumb} alt="" width={p.width} height={p.height} />
                            <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                {photo && job && <section className="block"><h2>Solve</h2><JobStatus job={job} result={result} photo={photo} spots={spots} /></section>}
                {photo && !job && <section className="block"><h2>Solve</h2><JobStatus photo={photo} spots={spots} /></section>}
                {result && photo && solved && spot && <AnswerCard sessionId={sid} pose={solved} photo={photo} spot={spot} />}
                {photo && solved && (
                  <SimilarShots photoUrl={photo.url} starred={new Set(starred.keys())} onStar={toggleStar} looking={lookAt?.url}
                    onLook={s => look(s.url, s.pose, s.credit)} />
                )}
                {photo && solved && <RoutePanel sessionId={sid} starred={[...starred.keys()]} ownThumb={photo.thumb} onStops={st => { setRoute(st); setLookAt(null); setOverview(Date.now()); }} onStop={showStop} onOverview={() => { setLookAt(null); setOverview(Date.now()); }} />}
                {steps.length > 0 && <Trace steps={steps} />}
              </>
            )}
            {tab === 'yours' && (
              solved && photo ? (
                <>
                  <LensPanel lens={lens} solvedF35={solved.f35} photo={photo} onChange={changeLens} />
                  <PeoplePanel people={people} placing={placing} setPlacing={setPlacing} selected={selPerson} setSelected={setSelPerson} />
                  <LightPanel spotId={spotId} pose={solved} photo={photo} planTime={planTime} onChange={changePlan} shadows={shadows} setShadows={setShadows} sun={sunPos} />
                  <PreviewPanel sessionId={sid} photo={photo} lens={lens} people={people.length} sun={sunPos} previews={previews} />
                </>
              ) : <p className="empty">Once a photo is placed, change the lens, add people and pick the light here.</p>
            )}
            {tab === 'live' && <LivePanel sessionId={sid} parts={parts} scouts={scouts} messages={messages} ready={messagesReady} myName={myName} me={identity} solved={solved} />}
          </div>
        </aside>
      </div>
      <Footer />
      <Toasts sessionId={sid} />
      {shareOpen && <ShareDialog code={session.code} sessionId={sid} isOwner={!!identity && session.owner.isEqual(identity)} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
