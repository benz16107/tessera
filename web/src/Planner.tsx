import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { Identity, Timestamp } from 'spacetimedb';
import type { Viewer } from 'cesium';
import { tables, reducers } from './module_bindings/index.ts';
import type { Pose, Session } from './module_bindings/types.ts';
import { useConfig, NAME_KEY } from './config.ts';
import { navigate } from './App.tsx';
import SceneView, { type PlaceMode } from './SceneView.tsx';
import { readPose } from './cesium.ts';
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

  const [tab, setTab] = useState<Tab>('shot');
  const [selected, setSelected] = useState<bigint | null>(null);
  const [opacity, setOpacity] = useState(0.5);
  const [lensOverride, setLensOverride] = useState<number | null>(null);
  const [placing, setPlacing] = useState<PlaceMode>({ kind: 'none' });
  const [selPerson, setSelPerson] = useState<bigint | null>(null);
  const [shadows, setShadows] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const viewerRef = useRef<Viewer | null>(null);

  const sortedPhotos = useMemo(() => [...photos].sort((a, b) => Number(a.id - b.id)), [photos]);
  const photo = sortedPhotos.find(p => p.id === selected) ?? sortedPhotos[sortedPhotos.length - 1];
  const result = photo && results.find(r => r.photoId === photo.id);
  const job = photo && [...jobs].filter(j => j.photoId === photo.id).sort((a, b) => Number(b.id - a.id))[0];
  const solved = result && result.confidence !== 'none' ? result.pose : undefined;
  const spotId = job?.spotId || session.spotId;
  const spot = spots.find(s => s.id === spotId);
  const lens = lensOverride ?? solved?.f35 ?? photo?.exifF35 ?? 26;
  const camera = cams[0];

  // New photo or new result: lens back to the solved value.
  useEffect(() => { setLensOverride(null); }, [photo?.id, result?.jobId]);

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
    const v = viewerRef.current;
    if (v && !v.isDestroyed()) broadcast(readPose(v, f));
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
            <SceneView
              mapsKey={cfg.mapsKey}
              spot={spot}
              photo={solved ? photo : undefined}
              solved={solved}
              solveKey={`${photo?.id}:${result?.jobId}`}
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
              onReady={v => { viewerRef.current = v; }}
            />
          </PhotoDrop>
          <div className="stage-bar">
            {result && <ConfidenceBadge result={result} />}
            {solved && (
              <label className="slider inline">
                <span>3D</span>
                <input type="range" min={0} max={1} step={0.01} value={opacity} onChange={e => setOpacity(+e.target.value)} aria-label="Photo overlay opacity, 0 shows the 3D view, 1 shows your photo" />
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
                  <PhotoDrop session={session} spotId={session.spotId} onUploaded={() => setSelected(null)} />
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
                {result && photo && solved && spot && <AnswerCard pose={solved} photo={photo} spot={spot} />}
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
      {shareOpen && <ShareDialog code={session.code} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
