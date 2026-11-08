// /studio/:code: the virtual set editor (Figma round 3, "Darkroom"). The spot is the origin (frame.ts). The world is the
// spot's Gaussian splat when it exists, with Google tiles as zoomed-out context and fallback (display only). Every
// scene_object row is drawn and editable live; objects stand on the street geometry, cast soft sun shadows onto it and
// take image light from the photo. The shot camera looks through a real lens over the user's photo, and the render layers
// hold only the user's objects. Panels from web/src/nvidia and web/src/spacetime mount through slots.tsx.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, GizmoHelper, GizmoViewport, Grid, Html, Line, OrbitControls, OrthographicCamera, Sky, Stars, TransformControls, useTexture } from '@react-three/drei';
import { XR } from '@react-three/xr';
import { DirectionalLight, EquirectangularReflectionMapping, Euler, Group, Mesh, Object3D, PerspectiveCamera, Quaternion, Raycaster, SRGBColorSpace, Vector2, Vector3, type Camera } from 'three';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { Timestamp } from 'spacetimedb';
import { tables, reducers } from '../module_bindings/index.ts';
import type { SceneObject, Session } from '../module_bindings/types.ts';
import { useConfig, NAME_KEY } from '../config.ts';
import { navigate } from '../App.tsx';
import { sunAt, spotZone, fmtTime } from '../geo.ts';
import { ENU_TO_THREE, enuToThree, threeToEnu, llhToEnu, enuToLlh, cameraQuat, cameraHpr, yawQuat, type Origin } from './frame.ts';
import { useGeoLayers, GeoScene, GeoButton, GeoPanel, GeoBands, GeoOverview, GeoMapView, zoomForHeight, type MapCamera, type ShotTarget } from '../layers/index.ts';
import { sceneEv100, meterStops, whiteBalanceGains, fmtShutter, kelvinToRgb, shutterForScene, remainingMp, subjectLockedDistance, shakeBlurPx, tintGains } from './optics.ts';
import type { Histogram, PointLight, Walker } from './post/LookThrough.tsx';
import { daylight, lightColorK, previewGrade, sunPath, sunStrength, sunVector } from './light/sun.ts';
import { useScene } from './state/useScene.ts';
import { useShotSettings, defaultShot } from './state/useShotSettings.ts';
import { makeObject, newUid, parseParams, stateOf, withParams, fmtParams, type AddItem, type ObjState } from './scene/objects.ts';
import { optics as opticsOf, frameFromPhoto, fitFrame, type Fit } from './camera/shot.ts';
import { bodyById, lensById } from './catalog/index.ts';
import Tiles, { tilesRef, tileGroundAt, TILE_LIGHT } from './world/Tiles.tsx';
import Atmosphere, { POST_LIT_LAYER, atmosphereRender } from './world/Atmosphere.tsx';
import PlaceSearch, { type Place } from './editor/PlaceSearch.tsx';
import Splat, { useSplatUrl, sparkRef } from './world/Splat.tsx';
import Catchers from './world/Catchers.tsx';
import { geometryFor, groundZ, onStreet, SPLATS } from './world/geometry.ts';
import { ObjectNode, SelectionBox, objectSizes } from './world/SceneObjects.tsx';
import LookThrough from './post/LookThrough.tsx';
import Overlays from './editor/Overlays.tsx';
import Timeline from './editor/Timeline.tsx';
import Inspector from './editor/Inspector.tsx';
import Outliner, { WORLD_LABEL, type WorldMode } from './editor/Outliner.tsx';
import Clay, { type Projector } from './world/Clay.tsx';
import AddDrawer from './editor/Library.tsx';
import { generate, shrinkToDataUrl, type GenResult } from './editor/Generate.tsx';
import { Ico, Seg, Disclosure } from './editor/ui.tsx';
import RenderSection from './render/RenderSection.tsx';
import { NvidiaSlot, SpacetimeSlot, PhotonSlot } from './slots.tsx';
import { ViewSwitch } from '../simple/ViewSwitch.tsx';
import { xrStore, VrButton, VrOrigin } from './xr/VR.tsx';
import WalkControls, { WalkHud, newWalkInput, obstaclesFor } from './world/Walk.tsx';
import { SetEventsBridge, SetEventMarks, ViewBroadcaster, FollowCamera, PresenceBeat, CheckinBridge, CheckinMarksSlot, type SetEv } from './world/SetEvents.tsx';
import type { Layers } from './render/layers.ts';
import '@fontsource/martian-mono/400.css';
import '@fontsource/martian-mono/500.css';
import '@fontsource/martian-mono/600.css';
import './studio.css';

type View = 'persp' | 'shot' | 'top' | 'walk' | 'map';
type Tool = 'select' | 'translate' | 'rotate' | 'scale' | 'measure';
type Page = 'set' | 'shots' | 'renders';
type ViewCmd = { n: number; kind: 'focus'; point: Vector3; radius: number } | { n: number; kind: 'front' | 'right' | 'home' }
  | { n: number; kind: 'place'; point: Vector3; pos: Vector3 }; // ENU orbit target and eye (the map's hand-off into 3D)
interface Pick { enu: Vector3; normal: Vector3; wall: boolean }

export default function Studio({ code }: { code: string }) {
  const { identity, isActive } = useSpacetimeDB();
  const [rows, ready] = useTable(tables.session.where(r => r.code.eq(code)));
  const session = rows[0];
  const [parts] = useTable(tables.participant.where(r => r.sessionId.eq(session?.id ?? 0n)), { enabled: !!session });
  const joinSession = useReducer(reducers.joinSession);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [err, setErr] = useState('');
  const tried = useRef(false);
  const me = identity && parts.find(p => p.identity.isEqual(identity));

  const join = useCallback((n: string) => {
    localStorage.setItem(NAME_KEY, n);
    joinSession({ code, name: n, role: 'planner' }).catch(x => setErr(String(x?.message ?? x)));
  }, [code, joinSession]);
  // Join by code as soon as we have a name: works even when session rows are visible only to participants.
  useEffect(() => {
    if (isActive && !me && name && !tried.current && (ready || !session)) { tried.current = true; join(name); }
  }, [isActive, me, name, ready, session, join]);

  // Once in, stay in: a participant row that blinks during a presence update must not remount the whole set.
  const entered = useRef<{ session: Session; name: string } | null>(null);
  if (session && me) entered.current = { session, name: me.name };
  else if (entered.current && session) entered.current = { ...entered.current, session };
  if (entered.current) return <StudioView session={entered.current.session} myName={entered.current.name} />;
  const askName = !name || !!err;
  return (
    <div className="studio st-gate">
      <p className="st-logo">TESSERA</p>
      {askName ? (
        <form onSubmit={e => { e.preventDefault(); if (name.trim()) { setErr(''); tried.current = true; join(name.trim()); } }}>
          <h1>Join the set for <span className="mono">{code}</span></h1>
          <label className="st-textin">Your name<input value={name} onChange={e => setName(e.target.value)} maxLength={40} required autoFocus /></label>
          {err && <p className="st-note warn" role="alert">{err}</p>}
          <button className="st-btn primary" disabled={!isActive}>Open the set</button>
        </form>
      ) : <div className="st-skeleton" aria-busy="true" aria-label="Loading the set" />}
    </div>
  );
}

const gizmoBusy = { current: false };
const MADE_CAM = new Set<bigint>();
const NO_WALLS = { polys: [], segs: [] };
const FIXED_CAM = new Set<bigint>();
const camLetter = (i: number) => `Cam ${String.fromCharCode(65 + i)}`;
const compass = (az: number) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((((az % 360) + 360) % 360) / 45) % 8];
const GUIDES = { thirds: 'Thirds', golden: 'Golden', spiral: 'Spiral', off: 'Off' } as const;

function StudioView({ session, myName }: { session: Session; myName: string }) {
  const cfg = useConfig();
  const { identity } = useSpacetimeDB();
  const sid = session.id;
  const [spots] = useTable(tables.spot);
  const [photos] = useTable(tables.photo.where(r => r.sessionId.eq(sid)));
  const [results] = useTable(tables.solveResult.where(r => r.sessionId.eq(sid)));
  const [parts] = useTable(tables.participant.where(r => r.sessionId.eq(sid)));
  const [presence] = useTable(tables.presence.where(r => r.sessionId.eq(sid)));
  const [previews] = useTable(tables.previewJob.where(r => r.sessionId.eq(sid)));
  const [versions] = useTable(tables.shotVersion.where(r => r.sessionId.eq(sid)));
  const setPlanTime = useReducer(reducers.setPlanTime);
  const scene = useScene(sid);

  const spot = spots.find(s => s.id === session.spotId);
  const geo = useMemo(() => geometryFor(session.spotId), [session.spotId]);
  const gz = useCallback((x: number, y: number) => groundZ(geo, x, y), [geo]);
  const solved = [...results].filter(r => r.confidence !== 'none').sort((a, b) => Number(b.photoId - a.photoId))[0];
  const photo = photos.find(p => p.id === solved?.photoId) ?? [...photos].sort((a, b) => Number(b.id - a.id))[0];
  // A free location (Earth: "Plan here" or "New shoot here"): spot id 'geo:<lat>,<lon>,<ground height above the ellipsoid>'.
  const geoSpot = useMemo(() => {
    const m = session.spotId.match(/^geo:(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/);
    return m ? { lat: +m[1], lon: +m[2], height: +m[3] } : null;
  }, [session.spotId]);
  const origin: Origin | null = spot ? { lat: spot.lat, lon: spot.lon, height: 0 } : geoSpot ?? (solved ? { lat: solved.pose.lat, lon: solved.pose.lon, height: 0 } : null);
  // Exploring: the World view is flown to a searched place. The frame moves there (tiles only); the set stays home, hidden.
  const [explore, setExplore] = useState<Place | null>(null);
  const here: Origin | null = explore ? { lat: explore.lat, lon: explore.lon, height: 0 } : origin;
  // shortcut: a free location's zone is its longitude's whole-hour offset (no daylight saving); use a time zone lookup when one ships.
  const lonZone = (lon: number) => { const h = Math.round(lon / 15); return h === 0 ? 'UTC' : `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}`; };
  const zone = explore ? lonZone(explore.lon) : geoSpot ? lonZone(geoSpot.lon) : spotZone(session.spotId, origin?.lon ?? 0);
  const [splatFull, setSplatFull] = useState(false);
  const [splatSkip, setSplatSkip] = useState<string[]>([]);
  // The splat is hidden (Ben: "very unclear"): only ?splat=1 (or ?splat=<file>) probes for it and offers it in the menu.
  const splatTest = useMemo(() => new URLSearchParams(location.search).has('splat'), []);
  const splatUrl = useSplatUrl(splatTest ? session.spotId : '', splatFull, splatSkip);
  // Earth (Google Photorealistic 3D Tiles) by default; a person's own pick is remembered in this browser. The key moved to
  // v2 when Earth replaced Clay + photo as the default, so the old remembered default doesn't stick.
  const [world, setWorldState] = useState<WorldMode>(() => {
    try { const w = localStorage.getItem('studio/world-v2') as WorldMode | null; if (w && w in WORLD_LABEL && w !== 'splat') return w; } catch { /* private mode */ }
    return 'tiles';
  });
  const setWorld = (w: WorldMode) => { setWorldState(w); try { localStorage.setItem('studio/world-v2', w); } catch { /* private mode */ } };
  const [splatState, setSplatState] = useState<{ loaded: boolean; progress: number }>({ loaded: false, progress: 0 });
  const worlds: WorldMode[] = ['tiles', 'clayPhoto', 'clay', ...(splatUrl ? ['splat' as const] : []), 'off'];
  const [worldMenu, setWorldMenu] = useState(false);

  // Time of day: shared through session.planTime (and the spacetime sun clock), local while dragging.
  const [planLocal, setPlanLocal] = useState<Date | null>(null);
  const planTime = planLocal ?? session.planTime?.toDate() ?? new Date();
  const commit = useRef<number | undefined>(undefined);
  const changeTime = useCallback((d: Date) => {
    setPlanLocal(d);
    clearTimeout(commit.current);
    commit.current = window.setTimeout(() => setPlanTime({ sessionId: sid, at: Timestamp.fromDate(d) }).then(() => setPlanLocal(null)).catch(console.error), 300);
  }, [setPlanTime, sid]);
  const layers = useGeoLayers(sid, session.spotId, planTime); // weather, tides, permits, building shadows (web/src/layers)
  const [geoOpen, setGeoOpen] = useState(false);
  const sun = here ? sunAt(planTime, here.lat, here.lon) : { azimuth: 180, altitude: 45 };
  const sceneEv = sceneEv100(sun.altitude, 'clear', 'street');
  const expo = 3 / (2.5 * Math.pow(2, sceneEv)); // the viewport meters the ambient: incident light E = 2.5 * 2^EV100 lux maps to 3

  const photoAspect = photo && photo.height ? photo.width / photo.height : 1.5;
  const defaults = useMemo(() => {
    const d = defaultShot(solved?.pose.f35 ?? 35, 8, sceneEv);
    const r = Math.max(photoAspect, 1 / photoAspect);
    const aspect = ['3:2', '4:3', '4:5', '1:1', '16:9'].reduce((b, a) => {
      const [x, y] = a.split(':').map(Number), [bx, by] = b.split(':').map(Number);
      return Math.abs(Math.log(x / y / r)) < Math.abs(Math.log(bx / by / r)) ? a : b;
    }, '3:2');
    return { ...d, aspect };
  }, [solved?.pose.f35, Math.round(sceneEv * 3), photoAspect]); // eslint-disable-line react-hooks/exhaustive-deps
  const { shot, set: setShot, error: shotError } = useShotSettings(sid, defaults);
  const frame = useMemo(() => frameFromPhoto(photo), [photo?.width, photo?.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const o = useMemo(() => opticsOf(shot, frame), [shot, frame]);
  const [vignette, setVignette] = useState(true);

  const cams = scene.rows.filter(r => r.kind === 'camera');
  const shotRow = cams.find(r => parseParams(r.params).shot === '1') ?? cams[0];
  const camName = (r?: SceneObject) => {
    if (!r) return 'Cam A';
    const i = cams.findIndex(c => c.id === r.id);
    return r.name && !/^(Shot camera|Camera)$/.test(r.name) ? r.name : camLetter(Math.max(0, i));
  };
  const shotName = camName(shotRow);
  const isMe = (id?: { isEqual(x: unknown): boolean }) => !!(identity && id?.isEqual(identity));
  const colorOf = useCallback((idHex: string) => presence.find(p => p.identity.toHexString() === idHex)?.color, [presence]);
  const lockOwner = useCallback((r: SceneObject) => {
    if (!r.lockedBy || isMe(r.lockedBy)) return null;
    const hex = r.lockedBy.toHexString();
    return { name: parts.find(p => p.identity.toHexString() === hex)?.name ?? 'Someone', color: colorOf(hex) ?? 'var(--teal)' };
  }, [parts, identity, colorOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (id: { toHexString(): string }) => parts.find(p => p.identity.toHexString() === id.toHexString())?.name ?? 'the crew';

  // The first planner in creates the shot camera at the solved pose: CONTRACTS.md alt is metres above the ground there.
  const camsRef = useRef(cams.length);
  camsRef.current = cams.length;
  useEffect(() => {
    if (!scene.ready || cams.length || MADE_CAM.has(sid) || !solved || !origin) return;
    const t = window.setTimeout(() => {
      if (camsRef.current || MADE_CAM.has(sid)) return;
      MADE_CAM.add(sid);
      const p = llhToEnu(origin, solved.pose.lat, solved.pose.lon, 0);
      const q = cameraQuat(solved.pose.heading, solved.pose.pitch, solved.pose.roll);
      scene.addObject({
        kind: 'camera', assetId: '', name: 'Cam A', x: p.x, y: p.y, z: gz(p.x, p.y) + solved.pose.alt, qx: q.x, qy: q.y, qz: q.z, qw: q.w, scale: 1,
        color: '', intensity: 0, lightType: '', params: `uid=${newUid()};shot=1;photo=${solved.photoId};alt=${solved.pose.alt}`, visible: true,
      });
    }, 2500);
    return () => clearTimeout(t);
  }, [scene.ready, cams.length, solved, origin]); // eslint-disable-line react-hooks/exhaustive-deps
  // A shot camera made before the street geometry existed sits at alt above z = 0: lift it onto the real ground once.
  useEffect(() => {
    if (!geo || !shotRow || !solved || FIXED_CAM.has(shotRow.id)) return;
    const prm = parseParams(shotRow.params);
    if (prm.alt || prm.photo !== String(solved.photoId) || Math.abs(shotRow.z - solved.pose.alt) > 1e-6) return;
    FIXED_CAM.add(shotRow.id);
    scene.setObject(shotRow, withParams({ ...stateOf(shotRow), z: gz(shotRow.x, shotRow.y) + solved.pose.alt, name: shotRow.name === 'Shot camera' ? 'Cam A' : shotRow.name }, { alt: solved.pose.alt }));
  }, [geo, shotRow?.id, solved?.photoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [page, setPage] = useState<Page>('set');
  const [view, setView] = useState<View>('persp');
  // With a solved shot camera, open looking through it: the splat is sharpest from the photos' positions. World is one click away.
  const autoShot = useRef(false);
  useEffect(() => {
    if (autoShot.current || !shotRow || !solved) return;
    autoShot.current = true;
    setView(v => (v === 'persp' ? 'shot' : v));
  }, [shotRow, solved]);
  const [tool, setTool] = useState<Tool>('translate');
  const [selected, setSelected] = useState<bigint | null>(null);
  const [snap, setSnap] = useState(true);
  const [gridOn, setGridOn] = useState(false);
  const [dofOn] = useState(true);
  const [backplate, setBackplate] = useState<'photo' | 'world'>('photo');
  const [overlay, setOverlay] = useState<'thirds' | 'golden' | 'spiral' | 'off'>('thirds');
  const [extraOv, setExtraOv] = useState<string[]>(['horizon']);
  const [addOpen, setAddOpen] = useState(false);
  const [timeHover, setTimeHover] = useState(false);
  const [timePinned, setTimePinned] = useState(false);
  const [focus, setFocus] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdOpts, setCmdOpts] = useState(false);
  const [focusHint, setFocusHint] = useState(() => { try { return !localStorage.getItem('studio/hint-focus'); } catch { return false; } });
  const timeT = useRef<number | undefined>(undefined);
  const hoverTime = (over: boolean) => { clearTimeout(timeT.current); timeT.current = window.setTimeout(() => setTimeHover(over), over ? 150 : 350); };
  useEffect(() => {
    if (!focusHint) return;
    const t = setTimeout(() => { setFocusHint(false); try { localStorage.setItem('studio/hint-focus', '1'); } catch { /* private mode */ } }, 9000);
    return () => clearTimeout(t);
  }, [focusHint]);
  const [renderOpen, setRenderOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [attribution, setAttribution] = useState('');
  const [groundOffset, setGroundOffset] = useState<number | null>(null); // the tiles' display alignment (street height above the ellipsoid)
  const [cmd, setCmd] = useState<ViewCmd | null>(null);
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [vrOrigin, setVrOrigin] = useState<Vector3 | null>(null);
  // Walk view: eye height and flying are per person; the input object is shared by the 3D controls and the touch overlay.
  const [buildShown, setBuildShown] = useState(false);
  const [walkEye, setWalkEye] = useState(1.6);
  const [walkFly, setWalkFly] = useState(false);
  const walkInput = useRef(newWalkInput());
  const [laser, setLaser] = useState(false);
  const [ev, setEv] = useState<SetEv | null>(null);
  // Following someone shows their view in World (the free camera), whatever view this person was in.
  useEffect(() => { if (ev?.following) setView('persp'); }, [ev?.following]); // eslint-disable-line react-hooks/exhaustive-deps
  // History preview (spacetime HistoryScrubber): the whole set as it was at that point, shown read-only instead of the live rows.
  const [ghost, setGhost] = useState<Map<bigint, Record<string, unknown>> | null>(null);
  const shownRows: SceneObject[] = useMemo(() => !ghost ? scene.rows
    : [...ghost.entries()].map(([id, f]) => ({ ...(scene.rows.find(r => r.id === id) ?? {}), ...f, id, sessionId: sid } as unknown as SceneObject)),
  [ghost, scene.rows, sid]);
  useEffect(() => { if (ghost) setSelected(null); }, [ghost]);
  const [checkins, setCheckins] = useState<unknown[]>([]);
  const [measure, setMeasure] = useState<Vector3[]>([]);
  const [dropAsk, setDropAsk] = useState<{ file: File; x: number; y: number; at: Pick | null } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [genFile, setGenFile] = useState<{ file: File; n: number } | null>(null);
  const [toast, setToast] = useState('');
  const [camHeight, setCamHeight] = useState(0);
  const lastPoint = useRef<Vector3 | null>(null);
  const pickRef = useRef<((cx: number, cy: number) => Pick | null) | null>(null);
  const groups = useRef(new Map<bigint, Group>());
  const [, setTick] = useState(0);
  const register = useCallback((id: bigint, g: Group | null) => {
    if (g) groups.current.set(id, g); else groups.current.delete(id);
    setTick(t => t + 1);
  }, []);
  const shotCam = useMemo(() => new PerspectiveCamera(40, 1, 0.1, 20000), []);
  const selRow = scene.rows.find(r => r.id === selected);
  const selGroup = selected !== null ? groups.current.get(selected) ?? null : null;
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  // Select a just-added object once its row arrives, with the move gizmo ready.
  useEffect(() => {
    if (!pendingUid) return;
    const r = scene.rows.find(x => parseParams(x.params).uid === pendingUid);
    if (r) { setSelected(r.id); setPendingUid(null); setTool('translate'); }
  }, [scene.rows, pendingUid]);

  const shotPose = useMemo(() => {
    if (!shotRow) return null;
    const q = new Quaternion(shotRow.qx, shotRow.qy, shotRow.qz, shotRow.qw).normalize();
    const fwd = new Vector3(0, 0, -1).applyQuaternion(q);
    return { pos: new Vector3(shotRow.x, shotRow.y, shotRow.z), q, fwd, hpr: cameraHpr(q) };
  }, [shotRow?.x, shotRow?.y, shotRow?.z, shotRow?.qx, shotRow?.qy, shotRow?.qz, shotRow?.qw]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Where new things go: where the user last pointed, else on the ground in front of the shot camera at the focus distance. */
  const orbitTarget = useRef(new Vector3());
  const orbitCamPos = useRef(new Vector3()); // three-world eye of the World view's orbit camera
  const placePoint = (): Vector3 => {
    if (lastPoint.current) { const p = lastPoint.current.clone(); lastPoint.current = null; return p.setZ(gz(p.x, p.y)); }
    if (shotPose && view !== 'top') {
      const flat = new Vector3(shotPose.fwd.x, shotPose.fwd.y, 0).normalize();
      const p = shotPose.pos.clone().add(flat.multiplyScalar(Math.min(Math.max(shot.focusM, 3), 25)));
      return p.setZ(gz(p.x, p.y));
    }
    const p = orbitTarget.current.clone();
    return p.setZ(gz(p.x, p.y));
  };
  const faceCamFrom = (at: Vector3) => {
    const cam = shotPose?.pos ?? at.clone().add(new Vector3(0, -8, 0));
    return (Math.atan2(cam.x - at.x, cam.y - at.y) * 180) / Math.PI;
  };
  const addItem = (item: AddItem, atIn?: Vector3) => {
    const at = atIn ?? placePoint();
    const cam = shotPose?.pos ?? at.clone().add(new Vector3(0, -8, 1.6));
    const across = new Vector3(cam.y - at.y, at.x - cam.x, 0).normalize();
    for (let i = 1; i < 12 && scene.rows.some(r => r.kind !== 'camera' && r.kind !== 'light' && Math.hypot(r.x - at.x, r.y - at.y) < 0.9); i++) {
      at.addScaledVector(across, (i % 2 ? 1 : -1) * i * 1.1);
      at.z = gz(at.x, at.y);
    }
    const uid = newUid();
    let s = makeObject(item, at, faceCamFrom(at), at, uid);
    if (item.kind === 'camera') {
      const from = at.clone().add(new Vector3(cam.x - at.x, cam.y - at.y, 0).normalize().multiplyScalar(6));
      from.z = gz(from.x, from.y);
      s = makeObject(item, from, 0, at.clone().setZ(at.z + 1.2), uid);
      s.name = camLetter(cams.length);
    }
    if (item.kind === 'light') {
      const toCam = new Vector3(cam.x - at.x, cam.y - at.y, 0).normalize();
      const side = at.clone().add(toCam.applyAxisAngle(new Vector3(0, 0, 1), Math.PI / 4).multiplyScalar(3));
      side.z = gz(side.x, side.y);
      s = makeObject(item, side, 0, at.clone().setZ(at.z + 0.6), uid);
    }
    setPendingUid(uid);
    scene.addObject(s);
  };

  // Generation lands where the user pointed (or where the crew placed it), selected with the gizmo ready.
  const onGenerated = (res: GenResult) => {
    if (res.objectId) { setSelected(BigInt(res.objectId)); setTool('translate'); return; }
    const at = placePoint();
    const uid = newUid();
    const isImage = /\.(png|jpe?g|webp)(\?|$)/i.test(res.url);
    const params = fmtParams({
      uid, src: res.source, prompt: res.prompt?.slice(0, 160), concept: res.conceptUrl, ms: res.ms,
      ...(isImage ? { type: 'image', w: 1.2, h: 1.6, ar: 0.75 } : { h: res.heightM ?? 1 }),
    });
    setPendingUid(uid);
    scene.addObject({
      ...makeObject({ kind: 'prop_generated', url: res.url, name: res.name }, at, faceCamFrom(at), at, uid), params,
    });
    setToast(`Generated "${res.name}"${res.fallback ? ' as a flat cut-out (the 3D model service failed)' : ''}. Drag the gizmo to place it.`);
  };
  const regenerate = async (row: SceneObject, file?: File) => {
    const prm = parseParams(row.params);
    try {
      setToast(file ? 'Making a 3D model from the photo' : 'Regenerating with a new seed');
      const j = await generate(sid, file ? { image: await shrinkToDataUrl(file), name: row.name, mode: '3d' } : { prompt: prm.prompt ?? row.name, name: row.name, mode: '3d', seed: Math.floor(Math.random() * 1e6) });
      scene.setObject(row, withParams({ ...stateOf(row), assetId: String(j.url) }, { src: file ? 'photo' : prm.src, ms: Number(j.ms) || undefined }));
      setToast('Replaced the model.');
    } catch (e) { setToast(`Generate failed: ${(e as Error).message}`); }
  };

  // Drop an image on the viewport: place it as a flat print, or send it to the generator.
  const placeImage = async (file: File, at: Pick | null) => {
    try {
      setToast('Uploading the image');
      const r = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': file.type }, body: file });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `upload HTTP ${r.status}`);
      const ar = j.width && j.height ? j.width / j.height : 1;
      const w = at?.wall ? 1.2 : 1.0, h = +(w / ar).toFixed(3);
      const uid = newUid();
      let pos = at?.enu.clone() ?? placePoint(), yaw = faceCamFrom(pos);
      if (at?.wall) {
        pos = at.enu.clone().addScaledVector(at.normal, 0.04);
        pos.z = Math.max(gz(pos.x, pos.y) + 0.6, at.enu.z - h / 2);
        yaw = (Math.atan2(at.normal.x, at.normal.y) * 180) / Math.PI;
      } else pos.z = gz(pos.x, pos.y);
      setPendingUid(uid);
      const s = makeObject({ kind: 'prop_generated', url: j.url, name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Image' }, pos, yaw, pos, uid);
      scene.addObject({ ...s, params: fmtParams({ uid, type: 'image', w, h, ar: +ar.toFixed(4), src: 'drop' }) });
      setToast(at?.wall ? 'Placed on the wall, facing the street.' : 'Placed standing, facing the camera.');
    } catch (e) { setToast(`Could not place the image: ${(e as Error).message}`); }
  };

  const editRow = useCallback((row: SceneObject, s: ObjState, tag: string) => {
    if (lockOwner(row)) return;
    scene.setObject(row, s, tag);
  }, [scene, lockOwner]);
  const deleteSelected = () => {
    if (!selRow || lockOwner(selRow)) return;
    scene.deleteObject(selRow);
    setSelected(null);
  };
  const makeShot = (row: SceneObject) => {
    for (const c of cams) if (c.id !== row.id && parseParams(c.params).shot === '1') scene.setObject(c, withParams(stateOf(c), { shot: '' }));
    scene.setObject(row, withParams(stateOf(row), { shot: 1 }));
  };
  const focusSelection = () => {
    if (!selGroup) return;
    setCmd({ n: Date.now(), kind: 'focus', point: selGroup.getWorldPosition(new Vector3()), radius: selRow?.kind === 'model' ? 4 : 3 });
    if (view === 'shot') setView('persp');
  };
  const shotStats = (row: SceneObject) => {
    if (!shotPose) return null;
    const size = objectSizes.get(row.id);
    const h = size?.[2] ?? 1;
    return { distance: shotPose.pos.distanceTo(new Vector3(row.x, row.y, row.z + h * 0.55)), heightM: h };
  };
  const focusTarget = (() => {
    const r = selRow && selRow.kind !== 'camera' && selRow.kind !== 'light' ? selRow
      : scene.rows.filter(x => x.kind === 'person').sort((a, b) => (shotStats(a)?.distance ?? 1e9) - (shotStats(b)?.distance ?? 1e9))[0];
    const st = r && shotStats(r);
    return r && st ? { id: r.id, name: r.name.replace(/ \(.*\)$/, ''), distance: st.distance } : null;
  })();
  // "On Person" follows that person: dragging them keeps them sharp. Any typed focus change stops following.
  const [focusFollow, setFocusFollow] = useState<bigint | null>(null);
  const followRow = focusFollow === null ? undefined : scene.rows.find(r => r.id === focusFollow);
  const followDist = followRow ? shotStats(followRow)?.distance.toFixed(2) : undefined;
  useEffect(() => {
    if (followDist !== undefined && Math.abs(+followDist - shot.focusM) > 0.05) setShot({ focusM: Math.max(0.1, +followDist) });
  }, [followDist]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (id: bigint | null, point: Vector3, alt: boolean) => {
    if (document.pointerLockElement) return; // walking with the mouse captured: Walk picks at the crosshair
    if (ghost) return; // a history preview is read-only
    if (view === 'walk' && id === null && tool !== 'measure' && !laser) { walkInput.current.lock?.(); return; }
    const p = threeToEnu(point);
    if ((laser || alt) && ev) { ev.ping({ x: p.x, y: p.y, z: p.z }, id ?? 0n).catch(() => {}); return; }
    if (tool === 'measure') { setMeasure(m => (m.length >= 2 ? [p] : [...m, p])); return; }
    if (id !== null) { setSelected(id); return; }
    lastPoint.current = p;
    if (!gizmoBusy.current) setSelected(null);
  };

  // Blender-like shortcuts. Ignored while typing.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea, [contenteditable]')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) scene.redo(); else scene.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); scene.redo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); setCmdOpen(true); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.shiftKey && k === 'a') { e.preventDefault(); setAddOpen(true); return; }
      if (k === '`' || (e.shiftKey && k === 'f')) { e.preventDefault(); setView(v => (v === 'walk' ? 'persp' : 'walk')); return; }
      // In Walk, WASD QE move (Walk.tsx) unless an object is selected and the mouse is free; then they are tool keys.
      if (view === 'walk' && 'wasdqe '.includes(k) && (document.pointerLockElement || selected === null)) return;
      if (k === 'tab') { e.preventDefault(); setFocus(f => !f); setFocusHint(false); try { localStorage.setItem('studio/hint-focus', '1'); } catch { /* private mode */ } return; }
      if (k === 'g') setTool('translate');
      else if (k === 'r') setTool('rotate');
      else if (k === 's') setTool('scale');
      else if (k === 'w' || k === 'q') setTool('select');
      else if (k === 'm') setTool(v => (v === 'measure' ? 'select' : 'measure'));
      else if (k === 'x' || k === 'delete') deleteSelected();
      else if (k === 'f') focusSelection();
      else if (k === 'l') setLaser(v => !v);
      else if (k === 'h' && selRow) editRow(selRow, { ...stateOf(selRow), visible: !selRow.visible }, '');
      else if (k === '0') setView('shot');
      else if (k === '7') setView('top');
      else if (k === '1') { setView('persp'); setCmd({ n: Date.now(), kind: 'front' }); }
      else if (k === '3') { setView('persp'); setCmd({ n: Date.now(), kind: 'right' }); }
      else if (k === '5' || k === 'home') { setView('persp'); setCmd({ n: Date.now(), kind: 'home' }); }
      else if (k === 'escape') {
        if (addOpen) setAddOpen(false); else if (worldMenu) setWorldMenu(false); else if (viewMenu) setViewMenu(false); else if (cmdOpen) setCmdOpen(false); else if (focus) setFocus(false);
        else if (view === 'walk' && selected === null) setView('persp');
        else { setSelected(null); setDropAsk(null); setMeasure([]); }
      }
      else if (k === 'k' && (e.metaKey || e.ctrlKey)) setCmdOpen(true);
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });

  // Viewport size for the camera page and the picture-in-picture.
  const vpRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 900, h: 700 });
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setVp({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [compareOn, setCompareOn] = useState(false);
  const latestRender = [...previews].filter(p => p.state === 'done' && p.imageUrl).sort((a, b) => Number(b.id - a.id))[0];
  const split = view === 'shot' && renderOpen && !!latestRender;
  const fitFn = useCallback((vw: number, vh: number): Fit => fitFrame(o, vw, vh, {
    top: vw < 1150 ? 104 : 56, bottom: 72, left: compareOn ? vw / 2 + 8 : 24, right: split && !compareOn ? vw / 2 + 8 : 24, // camera bar wraps under 1150
  }), [o, split, compareOn]);
  const fit = fitFn(vp.w, vp.h);
  const portrait = frame.h > frame.w;
  const aspectLabel = (a: string) => { const [x, y] = a.split(':'); return portrait && +x > +y ? `${y}:${x}` : a; };

  const capture = useRef<(() => Promise<Layers>) | null>(null);
  const getLayers = useCallback(() => (capture.current ? capture.current() : Promise.reject(new Error('the 3D view is not ready'))), []);

  const probes = useMemo(() => (explore ? [{ x: 0, y: 0 }] : [{ x: 0, y: 0 }, ...(shotPose ? [{ x: shotPose.pos.x, y: shotPose.pos.y }] : [])]), [shotPose?.pos.x, shotPose?.pos.y, explore]); // eslint-disable-line react-hooks/exhaustive-deps
  const earth = world === 'tiles' || !!explore;
  const startCam = useMemo(() => {
    // Earth opens like Google Earth: 300 m out and 35 degrees down, looking along `bearing` at `t`.
    const aerial = (t: Vector3, bearing: number) => {
      const el = (35 * Math.PI) / 180, back = new Vector3(Math.sin(bearing), Math.cos(bearing), 0).multiplyScalar(-300 * Math.cos(el));
      return { pos: t.clone().add(back).add(new Vector3(0, 0, 300 * Math.sin(el))), target: t };
    };
    if (explore) return aerial(new Vector3(), 0);
    if (!shotPose) return earth ? aerial(new Vector3(), 0) : { pos: new Vector3(0, -20, 10), target: new Vector3(0, 0, 0) };
    const flat = new Vector3(shotPose.fwd.x, shotPose.fwd.y, 0).normalize();
    if (earth) { const t = shotPose.pos.clone().add(flat.clone().multiplyScalar(20)); t.z = gz(t.x, t.y); return aerial(t, Math.atan2(flat.x, flat.y)); }
    const target = shotPose.pos.clone().add(flat.clone().multiplyScalar(12));
    target.z = gz(target.x, target.y) + 1;
    // Just behind Cam A at nearly its height: the splat's walls smear when seen far from the photos' viewpoints.
    const pos = shotPose.pos.clone().add(flat.clone().multiplyScalar(-3)).add(new Vector3(0, 0, 0.3));
    return { pos, target };
  }, [!!shotPose, geo, earth, explore?.lat, explore?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  // The splat's street smear near Cam A fades in the World view: a box 26 m wide, 62 m along the street (from 17 m behind Cam A), 3.6 m tall, on the slope.
  const streetFade = useMemo(() => {
    if (!shotPose) return null;
    const flat = new Vector3(shotPose.fwd.x, shotPose.fwd.y, 0).normalize();
    const c = shotPose.pos.clone().add(flat.multiplyScalar(14));
    c.z = gz(c.x, c.y) + 1.2;
    const n = geo ? new Vector3(...geo.ground.plane.normal) : new Vector3(0, 0, 1);
    const heading = geo?.street ? geo.street.heading_deg : (Math.atan2(flat.x, flat.y) * 180) / Math.PI;
    const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (-heading * Math.PI) / 180));
    return { center: c, quat, half: [26, 62, 3.6] as [number, number, number] }; // Spark's box scale is the full size
  }, [shotPose, geo, gz]);
  // Walk's ground: our street plane on the measured street, else the tile surface under the eye (navigation only, never
  // stored or used for placement, export, render or AI; Map Tiles API terms), cached per half metre for a second.
  const tileGround = useRef(new Map<string, { z: number; t: number }>());
  const walkGround = useCallback((x: number, y: number, fromZ = 400) => {
    if (!explore && onStreet(geo, x, y)) return gz(x, y);
    const key = `${Math.round(x * 2)},${Math.round(y * 2)}`, now = performance.now(), c = tileGround.current.get(key);
    if (c && now - c.t < 1000) return c.z;
    const z = tileGroundAt(x, y, fromZ + 2);
    if (z === null) return explore ? 0 : gz(x, y);
    if (tileGround.current.size > 400) tileGround.current.clear();
    tileGround.current.set(key, { z, t: now });
    return z;
  }, [explore, geo, gz]);
  const walkObstacles = useMemo(() => obstaclesFor(layers.data?.layers.buildings, origin, geo), [layers.data?.layers.buildings, origin?.lat, origin?.lon, geo]); // eslint-disable-line react-hooks/exhaustive-deps
  // Earth: make the explored place the set's location (unsolved sets), or start a new shoot there. The ground height is the
  // tiles' display alignment at the place, stored once as the flat ground plane objects stand on (never tile geometry).
  const setSessionSpot = useReducer(reducers.setSessionSpot);
  const createSession = useReducer(reducers.createSession);
  const [pendingSpot, setPendingSpot] = useState('');
  const geoId = () => explore && groundOffset !== null ? `geo:${explore.lat.toFixed(6)},${explore.lon.toFixed(6)},${groundOffset.toFixed(1)}` : '';
  const planHere = async () => {
    const id = geoId();
    if (!id) return;
    await setSessionSpot({ sessionId: sid, spotId: id });
    setExplore(null);
    setToast('This set is here now. Add a camera and people from the + menu; the sun is this place\'s sun.');
  };
  const newShootHere = async () => {
    const id = geoId();
    if (!id || !explore) return;
    setPendingSpot(id);
    await createSession({ spotId: id, title: explore.name.split(',')[0].slice(0, 120), name: myName });
  };
  const camNear = !!shotPose && orbitTarget.current.distanceTo(shotPose.pos) < 250 && camHeight < 120;
  /** Walk: move Cam A to the eye, looking where you look, so walking around finds the shot. */
  const standHere = () => {
    const p = walkInput.current.pose?.();
    if (!p || !shotRow) return;
    const q = new Quaternion().setFromEuler(new Euler(...ENU_TO_THREE)).invert().multiply(p.quat);
    editRow(shotRow, withParams({ ...stateOf(shotRow), x: p.pos.x, y: p.pos.y, z: p.pos.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w }, { alt: +(p.pos.z - gz(p.pos.x, p.pos.y)).toFixed(2) }), `${shotName} moved to where you stood`);
    setToast(`${shotName} is where you are standing. Press 0 to look through it.`);
  };
  // Map <-> 3D hand-off (the geo thread's Map view): past zoom 18.6 the map hands the 3D set a centre and heading (about
  // 400 m up, the map's scale there); past 2,000 m of orbit height the World view hands back to the map.
  const [mapCam, setMapCam] = useState<MapCamera | null>(null);
  const mapCamRef = useRef<MapCamera | null>(null);
  const enter3D = (c: { lat: number; lon: number }, heading: number) => {
    if (!here) return;
    const t = llhToEnu(here, c.lat, c.lon, 0);
    t.z = gz(t.x, t.y);
    const b = (heading * Math.PI) / 180, el = (55 * Math.PI) / 180, d = 400 / Math.sin(el);
    const pos = t.clone().add(new Vector3(-Math.sin(b), -Math.cos(b), 0).multiplyScalar(d * Math.cos(el))).add(new Vector3(0, 0, 400));
    // Coming back to the Map (the view switch) opens where it was, just below the hand-off zoom.
    const m = mapCamRef.current;
    setMapCam(m ? { ...m, zoom: Math.min(m.zoom, 17.5) } : null);
    setView('persp');
    setCmd({ n: Date.now(), kind: 'place', point: t, pos });
  };
  const toMap = useRef(false);
  useEffect(() => {
    if (view !== 'persp' || !here || camHeight < 2000) { toMap.current = false; return; }
    if (toMap.current) return;
    toMap.current = true;
    const t = orbitTarget.current, eye = threeToEnu(orbitCamPos.current);
    const ll = enuToLlh(here, t);
    setMapCam({ lat: ll.lat, lon: ll.lon, zoom: zoomForHeight(camHeight, here.lat, vp.w), bearing: (Math.atan2(t.x - eye.x, t.y - eye.y) * 180) / Math.PI, pitch: 0 });
    setView('map');
  }, [camHeight, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const openShot = (t: ShotTarget, mode: 'world' | 'shot') => {
    const row = t.objectId !== null ? scene.rows.find(r => r.id === t.objectId) : undefined;
    if (row) {
      setSelected(row.id);
      if (mode === 'shot') { if (parseParams(row.params).shot !== '1') makeShot(row); setView('shot'); return; }
      setView('persp');
      setCmd({ n: Date.now(), kind: 'focus', point: enuToThree({ x: row.x, y: row.y, z: row.z }), radius: 6 });
      return;
    }
    enter3D({ lat: t.lat, lon: t.lon }, t.heading); // a check-in or a scout: just the place
  };
  // Subject-locked zoom: as the focal length changes, Cam A walks along its view axis so the subject keeps its size
  // (optics.ts subjectLockedDistance), and the background really grows behind it.
  const [subjectLock, setSubjectLock] = useState(false);
  const setShotPhysical = (pt: Partial<typeof shot>, lock = subjectLock) => {
    if (pt.focusM !== undefined) setFocusFollow(null);
    if (lock && pt.focalMm !== undefined && shotRow && shotPose && focusTarget && Math.abs(pt.focalMm - shot.focalMm) > 0.01) {
      const d1 = focusTarget.distance, d2 = subjectLockedDistance(d1, shot.focalMm, pt.focalMm);
      const flat = new Vector3(shotPose.fwd.x, shotPose.fwd.y, 0).normalize();
      const pos = shotPose.pos.clone().addScaledVector(flat, -(d2 - d1));
      pos.z = gz(pos.x, pos.y) + (shotPose.pos.z - gz(shotPose.pos.x, shotPose.pos.y));
      editRow(shotRow, { ...stateOf(shotRow), x: pos.x, y: pos.y, z: pos.z }, 'subject-locked zoom');
      setShot({ ...pt, focusM: +d2.toFixed(2) });
      setToast(`${shotName} ${d2 > d1 ? 'stepped back' : 'stepped in'} ${Math.abs(d2 - d1).toFixed(1)} m: ${focusTarget.name} stays the same size`);
      return;
    }
    setShot(pt);
  };
  const walkers = useCallback((): Walker[] => scene.rows.filter(r => r.kind === 'person' && r.visible && (parseParams(r.params).pose ?? 'stand') === 'walk').flatMap(r => {
    const g = groups.current.get(r.id);
    if (!g) return [];
    const f = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(r.qx, r.qy, r.qz, r.qw).normalize()).setZ(0).normalize().multiplyScalar(1.4); // walking pace
    return [{ root: g, velocity: enuToThree(f) }];
  }), [scene.rows]);
  /** Point lights in the photo's frame pixels (the shot camera's pinhole model; camera looks down -Z in its own frame). */
  const framedLights = () => {
    if (!shotPose) return [];
    const inv = shotPose.q.clone().invert();
    return scene.rows.filter(r => r.kind === 'light' && r.visible).flatMap(r => {
      const v = new Vector3(r.x, r.y, r.z).sub(shotPose.pos).applyQuaternion(inv);
      if (v.z > -0.2) return [];
      const x = frame.w / 2 + (o.fpx * v.x) / -v.z, y = frame.h / 2 - (o.fpx * v.y) / -v.z;
      return x < -0.1 * frame.w || x > 1.1 * frame.w || y < -0.1 * frame.h || y > 1.1 * frame.h ? [] : [{ x: Math.round(x), y: Math.round(y), strength: 1 }];
    });
  };
  const pointLights = useCallback((): PointLight[] => scene.rows.filter(r => r.kind === 'light' && r.visible).map(r => ({ pos: enuToThree({ x: r.x, y: r.y, z: r.z }), strength: 1 })), [scene.rows]);
  const cone = origin && shotPose ? { ...enuToLlh(origin, shotPose.pos), heading: shotPose.hpr.heading, hfovDeg: o.hfovDeg } : null;
  const sunDir = sunVector(sun.azimuth, sun.altitude);
  // Nemotron's read of the photo's light (docs/NVIDIA.md, GET /api/set/light): its sun drives the render layers' shadows,
  // because they composite onto the photo. Overcast (sun null) puts the sun overhead: soft contact shade the crew blurs.
  // 'plan' uses the planned time's sun instead (the override, and after a render check's sun fix moves the plan time).
  const [lightRead, setLightRead] = useState<{ sun: { azimuth: number; altitude: number } | null; light?: { time_look?: string; sky?: string } } | null>(null);
  const [sunSource, setSunSource] = useState<'photo' | 'plan'>('photo');
  const [fixNote, setFixNote] = useState('');
  useEffect(() => {
    let live = true;
    fetch(`/api/set/light?session=${sid}`).then(r => (r.ok ? r.json() : null)).then(j => { if (live && j) setLightRead(j); }).catch(() => {});
    return () => { live = false; };
  }, [sid, photo?.id]);
  const photoSun = lightRead && sunSource === 'photo' ? (lightRead.sun ?? { azimuth: sun.azimuth, altitude: 90 }) : null;
  const renderSun = useMemo(() => {
    if (!photoSun) return null;
    const v = sunVector(photoSun.azimuth, photoSun.altitude);
    return enuToThree({ x: v[0], y: v[1], z: v[2] }).normalize();
  }, [photoSun?.azimuth, photoSun?.altitude]); // eslint-disable-line react-hooks/exhaustive-deps
  const sunMatch = !lightRead ? null : sunSource === 'photo'
    ? `Sun matched to your photo (${lightRead.sun ? `${compass(lightRead.sun.azimuth)}, ${Math.round(lightRead.sun.altitude)}° up` : lightRead.light?.time_look ?? 'overcast'})`
    : `Sun from the planned time, ${fmtTime(planTime, zone)}`;
  /** A render check's sun fix: move the plan time to when the sun is nearest that direction today, and use that sun. */
  const applySunFix = (azimuth: number, altitude: number) => {
    if (!origin) return;
    const want = sunVector(azimuth, altitude);
    const best = sunPath(planTime, origin.lat, origin.lon, 2).reduce((b, x) => {
      const v = sunVector(x.azimuth, x.altitude), d = v[0] * want[0] + v[1] * want[1] + v[2] * want[2];
      return d > b.d ? { x, d } : b;
    }, { x: null as null | { t: Date; azimuth: number; altitude: number }, d: -2 });
    if (!best.x) return;
    changeTime(best.x.t); setSunSource('plan');
    setFixNote(`Sun moved to ${fmtTime(best.x.t, zone)} (${Math.round(best.x.altitude)}° up, from the ${compass(best.x.azimuth)}) to match the render check.`);
  };
  const sunColor = kelvinToRgb(lightColorK(sun.altitude, 'clear'));
  // Live sun: the World and Through Cam A are lit by the planned time's sun and sky, dark at night (light/sun.ts daylight).
  // Through Cam A the camera's exposure applies on top, so a night shot metered for the dark still reads as night.
  const [lightMode, setLightModeState] = useState<'live' | 'captured'>(() => { try { return localStorage.getItem('studio/light') === 'captured' ? 'captured' : 'live'; } catch { return 'live'; } });
  const setLightMode = (m: 'live' | 'captured') => { setLightModeState(m); try { localStorage.setItem('studio/light', m); } catch { /* private mode */ } };
  const day = daylight(sun.altitude);
  const lvl = day.level;
  const skyLit: [number, number, number] = [day.tint[0] * lvl, day.tint[1] * lvl, day.tint[2] * lvl];
  TILE_LIGHT.tileSky.value.setRGB(0.62 * skyLit[0], 0.62 * skyLit[1], 0.62 * skyLit[2]);
  const grade = previewGrade(sun.altitude);
  // Takram's atmosphere (world/Atmosphere.tsx): switched off until it beats the interim relight; ?atmosphere=1 tries it.
  const takram = useMemo(() => new URLSearchParams(location.search).has('atmosphere'), []);
  const graded = lvl < 0.97 || Math.abs(grade.rgb[0] - 1) > 0.02 || Math.abs(grade.rgb[2] - 1) > 0.02 || grade.desat > 0.02;
  const objectsForLayers = () => scene.rows.filter(r => r.visible && r.kind !== 'camera' && r.kind !== 'light' && groups.current.get(r.id))
    .map(r => ({ id: r.id, name: r.name, kind: r.kind, root: groups.current.get(r.id)! }));
  const photoBack = view === 'shot' && backplate === 'photo' && !!photo;
  // The meter reads the planned time's light, which the default settings were metered for: at those settings the photo
  // shows as shot, and every change of aperture, shutter or ISO moves it by real stops.
  const meterEv = sceneEv;
  const meter = meterStops(meterEv, shot.aperture, shot.shutterS, shot.iso);
  const gain = Math.pow(2, Math.max(-6, Math.min(6, meter)));
  const [tint, setTint] = useState(0);
  const wb = (() => { const a = whiteBalanceGains(5500, shot.whiteBalanceK), t = tintGains(tint); return [a[0] * t[0], a[1] * t[1], a[2] * t[2]] as [number, number, number]; })();
  // What a longer lens leaves of the photo from the same spot, and the handheld shake during the shutter.
  const photoF35 = solved?.pose.f35 ?? null;
  const mpLeft = photoF35 ? remainingMp(frame.w, frame.h, photoF35, o.f35) : null;
  const cropNote = photoF35 && mpLeft !== null && o.f35 > photoF35 * 1.03 ? `${mpLeft.toFixed(1)} MP of your photo left at ${Math.round(shot.focalMm)} mm (it was ${Math.round(photoF35)} mm)`
    : photoF35 && o.f35 < photoF35 * 0.97 ? `Wider than your photo (${Math.round(photoF35)} mm): the edges show the 3D world` : null;
  const shakePx = shakeBlurPx(shot.shutterS, shot.focalMm, o.crop, Math.max(o.ibisStops, o.ois ? 4 : 0), o.cocMm, o.fpx);
  const [hist, setHist] = useState<Histogram | null>(null);
  const [plateReady, setPlateReady] = useState(false);
  const [footprint, setFootprint] = useState<[number, number][] | null>(null);
  // Compare: hold this frame as A, then change settings for B beside it. The preset is the classic lens choice:
  // 24 mm at f/8 from close, against 85 mm at f/1.4 from further back with the subject the same size.
  const latestCam = useRef<{ setShotPhysical: (pt: Partial<typeof shot>, lock?: boolean) => void } | null>(null);
  const holdA = (label = settingsLabel) => new Promise<void>(res => { grabRef.current = url => { setCompare({ url, label }); setCompareOn(true); res(); }; });
  const beforeCompare = useRef<{ shot: typeof shot; cam: ReturnType<typeof stateOf> | null } | null>(null);
  const endCompare = () => {
    setCompareOn(false); setCompare(null);
    const b = beforeCompare.current;
    beforeCompare.current = null;
    if (!b) return;
    setSubjectLock(false);
    setShot(b.shot);
    if (b.cam && shotRow) editRow(shotRow, b.cam, 'compare ended');
  };
  const comparePreset = async () => {
    beforeCompare.current = { shot: { ...shot }, cam: shotRow ? stateOf(shotRow) : null };
    setSubjectLock(true);
    // Each side metered like a photographer would (aperture priority at ISO 100), so only the lens and aperture differ.
    latestCam.current?.setShotPhysical({ bodyId: 'sony-a7iv', lensId: 'sony-fe-24-f14-gm', focalMm: 24, aperture: 8, iso: 100, shutterS: shutterForScene(sceneEv, 8, 100) }, true);
    await new Promise(r => setTimeout(r, 2500));
    await holdA('24 mm f/8, close');
    latestCam.current?.setShotPhysical({ lensId: 'sony-fe-85-f14-gm', focalMm: 85, aperture: 1.4, iso: 100, shutterS: shutterForScene(sceneEv, 1.4, 100) }, true);
  };
  latestCam.current = { setShotPhysical };
  if (import.meta.env.DEV) (window as unknown as { __cam: unknown }).__cam = { set: setShotPhysical, lock: setSubjectLock, shot, preset: comparePreset, endCompare, // test hook
    time: (iso: string | null) => setPlanLocal(iso ? new Date(iso) : null), planTime: planTime.toISOString(), shared: session.planTime?.toDate().toISOString() ?? null, // local only: never commits
    restorePose: () => {
      if (!shotRow || !solved || !origin) return 'no camera';
      const p = llhToEnu(origin, solved.pose.lat, solved.pose.lon, 0), q = cameraQuat(solved.pose.heading, solved.pose.pitch, solved.pose.roll);
      editRow(shotRow, { ...stateOf(shotRow), x: p.x, y: p.y, z: gz(p.x, p.y) + solved.pose.alt, qx: q.x, qy: q.y, qz: q.z, qw: q.w }, 'restored');
      return [p.x, p.y, gz(p.x, p.y) + solved.pose.alt].map(v => +v.toFixed(2));
    } };
  const grabRef = useRef<((url: string) => void) | null>(null);
  const [compare, setCompare] = useState<{ url: string; label: string } | null>(null);
  const settingsLabel = `${Math.round(shot.focalMm)} mm f/${shot.aperture} ${fmtShutter(shot.shutterS)} ISO ${shot.iso}`;
  const showSplat = !explore && world === 'splat' && !!splatUrl && !photoBack;
  const showTiles = (!!explore || world === 'tiles' || (world === 'splat' && !splatState.loaded)) && !photoBack;
  const showClay = !explore && (world === 'clay' || world === 'clayPhoto') && !photoBack;
  const atmo = takram && lightMode === 'live' && showTiles && (view === 'persp' || view === 'walk');
  // Clay + photo projects the user's photo from its solved pose (not Cam A's current one: the photo was taken there).
  const projector = useMemo((): Projector | null => {
    if (!solved || !origin || !photo || !frame) return null;
    const p = llhToEnu(origin, solved.pose.lat, solved.pose.lon, 0);
    p.z = gz(p.x, p.y) + solved.pose.alt;
    const fpx = (solved.pose.f35 * Math.hypot(frame.w, frame.h)) / 43.27;
    return { url: photo.url || photo.thumb, pos: p, quat: cameraQuat(solved.pose.heading, solved.pose.pitch, solved.pose.roll), vfovDeg: (2 * Math.atan(frame.h / 2 / fpx) * 180) / Math.PI, aspect: frame.w / frame.h };
  }, [solved?.photoId, origin?.lat, photo?.id, frame, gz]); // eslint-disable-line react-hooks/exhaustive-deps
  const pipSize = portrait ? { w: Math.round(160 * frame.w / frame.h), h: 160 } : { w: 200, h: Math.round(200 * frame.h / frame.w) };
  const pip = { x: vp.w - 16 - pipSize.w, y: vp.h - 36 - pipSize.h, ...pipSize };
  const online = presence.length ? presence : parts.filter(p => p.online).map(p => ({ name: p.name, color: '', identity: p.identity, status: 'active' }));
  const camSub = (r: SceneObject) => {
    const b = bodyById(shot.bodyId), l = lensById(shot.lensId);
    void b; void l;
    return { name: camName(r), sub: `${Math.round(shot.focalMm)} mm · f/${shot.aperture}` };
  };
  const keyframes = versions.flatMap(v => {
    const m = v.label.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (!m) return [];
    const d = new Date(planTime);
    const parts2 = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hour12: false, minute: 'numeric' }).formatToParts(d);
    const hNow = +parts2.find(x => x.type === 'hour')!.value, mNow = +parts2.find(x => x.type === 'minute')!.value;
    const h = (+m[1] % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
    const at = new Date(d.getTime() + ((h - hNow) * 60 + (+m[2] - mNow)) * 60_000);
    return [{ id: String(v.id), label: v.label.replace(m[0], '').replace(/[·,\s]+$/, '') || `Shot ${v.id}`, at, current: Math.abs(at.getTime() - planTime.getTime()) < 60_000, onPick: () => changeTime(at) }];
  });

  const viewSwitch = (
    <Seg label="View" value={view} onChange={setView} options={[{ value: 'map', label: 'Map' }, { value: 'persp', label: 'World' }, { value: 'walk', label: 'Walk' }, { value: 'shot', label: `Through ${shotName}` }, { value: 'top', label: 'Top' }].filter(x => x.value !== 'map' || !!origin) as { value: View; label: string }[]} />
  );
  let credits: ReactNode[] = [];
  if (showTiles && attribution) credits.push(<img key="g" src="/studio/attribution/google-maps-logo.svg" alt="Google Maps" />, <span key="gc" className="gcred">{attribution}</span>);
  if (showSplat && splatState.loaded) credits.push(<span key="s" className="gcred">{SPLATS[session.spotId]?.credit}</span>);
  if (explore) credits.push(<span key="o" className="gcred">Place search © OpenStreetMap contributors</span>);
  if (showClay) credits.push(<span key="c" className="gcred">Clay massing from NYC building footprints (NYC Open Data){world === 'clayPhoto' ? ", with your photo projected from where it was taken" : ''}</span>);
  if (!credits.length) credits = [<span key="n" className="gcred">{photoBack ? 'Your photo as the backplate; no map content in this view' : 'World hidden'}</span>];

  return (
    <div className="studio" data-time={timeHover || timePinned ? 'open' : 'slim'} data-focus={focus} data-view={view}>
      <header className="st-top">
        <a className="st-logo" href={`/p/${session.code}`} onClick={e => { e.preventDefault(); navigate(`/p/${session.code}`); }} title="Back to the planner">TESSERA</a>
        <ViewSwitch code={session.code} current="studio" selected={selected} onArrive={h => { if (h.selected !== null) setSelected(h.selected); if (h.first) setView('shot'); }} />
        <div className="st-setname"><span>{spot?.name ?? session.title}</span><span className="saved">Saved live</span></div>
        {/* Simple | Studio toggle: the "simple" thread owns this one spot. */}
        <div className="st-modeslot" />
        <nav className="st-tabs-top" role="tablist" aria-label="Pages">
          {([['set', 'Set', 0], ['shots', 'Shots', versions.length], ['renders', 'Renders', previews.filter(p => p.state === 'done' && p.imageUrl).length]] as const).map(([k, l, n]) => (
            <button key={k} role="tab" aria-selected={page === k} onClick={() => setPage(k)}>{l}{k !== 'set' && <small>{n}</small>}</button>
          ))}
        </nav>
        <div className="st-session">
          <div className="st-avatars" aria-label="People on the set">
            {online.slice(0, 6).map(p => <span key={p.identity.toHexString()} title={`${p.name}${isMe(p.identity) ? ' (you)' : ''}, ${p.status}`} data-idle={p.status !== 'active'} style={{ ['--c' as string]: p.color || undefined }}>{p.name.slice(0, 1).toUpperCase()}</span>)}
          </div>
          <GeoButton geo={layers} open={geoOpen} onClick={() => { setGeoOpen(v => !v); setLiveOpen(false); }} />
          <button className="st-btn ghost" aria-pressed={liveOpen} onClick={() => { setLiveOpen(v => !v); setGeoOpen(false); }} title="People on iMessage, SMS and the web; SpacetimeDB live data and history">People</button>
          <button className="st-btn ghost" title={`Session ${session.code}`} onClick={() => { navigator.clipboard?.writeText(`${location.origin}/studio/${session.code}`).then(() => setToast('Link copied. Anyone with it joins this set live.')).catch(() => setToast(`${location.origin}/studio/${session.code}`)); }}>Share</button>
          <VrButton />
          <button className="st-btn primary" onClick={() => { setPage('set'); setView('shot'); setRenderOpen(true); setSelected(shotRow?.id ?? null); }}><Ico n="camera" s={16} /> Render</button>
        </div>
      </header>

      <aside className="st-left" aria-label="Scene">
        <Outliner rows={shownRows} selected={selected} shotId={shotRow?.id ?? null} camLabel={camSub} lockOwner={lockOwner}
          onSelect={id => setSelected(id)} onToggle={r => editRow(r, { ...stateOf(r), visible: !r.visible }, '')}
          spotLabel={spot?.name.split(',')[0].replace(/^.* from /, '') ?? 'Spot'} world={world}
          worlds={worlds} onWorld={setWorld} sunTime={fmtTime(planTime, zone)} photo={photo}
          onAdd={() => setAddOpen(v => !v)} addOpen={addOpen} />
      </aside>

      <main className="st-viewport" ref={vpRef} aria-label="3D viewport"
        onDragOver={e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (!f || !/^image\/(png|jpeg|webp)$/.test(f.type)) { setToast('Drop a PNG, JPEG or WebP image.'); return; }
          const r = e.currentTarget.getBoundingClientRect();
          const at = pickRef.current?.(e.clientX, e.clientY) ?? null;
          setDropAsk({ file: f, x: e.clientX - r.left, y: e.clientY - r.top, at });
        }}>
        {photoBack && photo && !plateReady && (() => {
          // No projected plate (no solved camera yet, or still loading): the photo is a plain image under the canvas, so
          // the same exposure, daylight level and preview grade go on as a CSS filter and a multiply tint.
          const lin = gain * lvl, m = Math.max(...grade.rgb), r = { left: fit.rect.x, top: fit.rect.y, width: fit.rect.w, height: fit.rect.h };
          return (
            <>
              <img className="st-backplate" src={photo.url || photo.thumb} alt=""
                style={{ ...r, filter: `brightness(${Math.pow(lin * m, 1 / 2.2).toFixed(3)}) saturate(${(1 - grade.desat).toFixed(2)})` }} />
              <div className="st-backplate" aria-hidden="true"
                style={{ ...r, mixBlendMode: 'multiply', background: `rgb(${grade.rgb.map(v => Math.round(255 * Math.pow(v / m, 1 / 2.2))).join(',')})` }} />
            </>
          );
        })()}
        {view !== 'shot' && photo && shotRow && <img className="st-backplate" src={photo.thumb} alt="" style={{ left: pip.x, top: pip.y, width: pip.w, height: pip.h, borderRadius: 4 }} />}
        <div className="st-canvas">
          <Canvas shadows="percentage" gl={{ antialias: true, alpha: true }} frameloop={view === 'map' ? 'never' : 'always'} camera={{ fov: 50, near: 0.1, far: 20000, position: enuToThree(startCam.pos).toArray() }}
            onPointerMissed={e => {
              if (e.type !== 'click' || gizmoBusy.current || tool === 'measure' || document.pointerLockElement) return;
              if (view === 'walk') walkInput.current.lock?.(); else setSelected(null);
            }}>
            <XR store={xrStore}>
              {photoBack && plateReady && <group userData={{ plate: true }}><Sky sunPosition={enuToThree({ x: sunDir[0], y: sunDir[1], z: sunDir[2] }).multiplyScalar(1000).toArray()} distance={4500} /></group>}
              {!photoBack && !atmo && <group userData={{ helper: true }}><Sky sunPosition={enuToThree({ x: sunDir[0], y: sunDir[1], z: sunDir[2] }).multiplyScalar(1000).toArray()} distance={4500} /></group>}
              {!atmo && <hemisphereLight args={['#bcd3ff', '#3b342b', (photo ? 0.45 : 0.9) * lvl]} />}
              {atmo && here && <Atmosphere date={planTime} origin={here} groundOffset={groundOffset}
                nightFill={[day.tint[0] * 0.02 * day.stars, day.tint[1] * 0.02 * day.stars, day.tint[2] * 0.02 * day.stars]} />}
              {photo && !atmo && <PhotoEnv url={photo.url || photo.thumb} intensity={0.55 * lvl} />}
              {!photoBack && !atmo && day.stars > 0.05 && <group userData={{ helper: true }}><Stars radius={3000} depth={400} count={4000} factor={60 * day.stars} saturation={0} fade /></group>}
              {!atmo && <SunLight dir={sunDir} color={sunColor} strength={sunStrength(sun.altitude) * 3} />}
              <group rotation={ENU_TO_THREE} name="enu">
                {here && view !== 'map' && ( // unmounted under the map: two big WebGL scenes at once lose the GPU on laptops
                  <Tiles apiKey={cfg.mapsKey} origin={here} probes={probes} visible={showTiles} extraCamera={view === 'shot' ? shotCam : null}
                    contextOnly={showSplat && splatState.loaded} groundAt={explore ? undefined : gz} onAttribution={setAttribution} onGround={setGroundOffset} light={atmo ? 'captured' : lightMode} postLitLayer={atmo ? POST_LIT_LAYER : undefined} />
                )}
                <group visible={!explore} name="set">
                {splatUrl && world === 'splat' && (
                  <Splat spotId={session.spotId} url={splatUrl} visible={showSplat} fade={view !== 'shot' ? streetFade : null}
                    onProgress={f => setSplatState(s => ({ ...s, progress: f }))} onLoaded={() => setSplatState({ loaded: true, progress: 1 })}
                    onError={e => { console.warn('splat failed, trying the next file', splatUrl, e); setSplatState({ loaded: false, progress: 0 }); setSplatSkip(k => [...k, splatUrl]); }} />
                )}
                {origin && photoBack && projector && <Clay plate buildings={layers.data?.layers.buildings ?? null} geo={geo} origin={origin} gz={gz} projector={projector} grade={grade} level={lvl} skyDim={day.skyDim} onReady={setPlateReady} />}
                {origin && photoBack && projector && <PlateFootprint camera={shotCam} projector={projector} onChange={setFootprint} />}
                {origin && showClay && <Clay buildings={layers.data?.layers.buildings ?? null} geo={geo} origin={origin} gz={gz} projector={world === 'clayPhoto' ? projector : null} level={lvl} sky={skyLit} skyDim={day.skyDim} />}
                {origin && <GeoScene geo={layers} origin={origin} groundAt={gz} labels={geoOpen && view !== 'shot'} overlays={!photoBack} />}
                <Catchers geo={geo} occlude={view === 'shot'} shadowOpacity={showClay || (showTiles && lightMode === 'live') ? 0 : 0.5} onTeleport={p => setVrOrigin(p)}
                  onPointerMove={e => { if (ev) { const p = threeToEnu(e.point); ev.cursor({ x: p.x, y: p.y, z: p.z }); } }}
                  onClick={e => { e.stopPropagation(); pick(null, e.point, e.nativeEvent.altKey); }} />
                {shownRows.map(r => {
                  const lk = lockOwner(r);
                  return (
                    <ObjectNode key={String(r.id)} row={r} selected={r.id === selected} lockedBy={lk?.name ?? null} lockColor={lk?.color} dragging={scene.draggingId() === r.id}
                      expo={expo * lvl} optics={o} isShot={r.id === shotRow?.id} lookingThrough={view === 'shot'} focusM={shot.focusM} camName={camName(r)}
                      showLabels={view !== 'shot' && view !== 'map' && !explore} onSelect={(id, pt, alt) => pick(id, pt, alt)} register={register} />
                  );
                })}
                <SetEventMarks ev={ev} />
                <CheckinMarksSlot rows={checkins} />
                {measure.length > 0 && <Measure pts={measure} />}
                </group>
              </group>
              {gridOn && <group userData={{ helper: true }} position={[0, 0.03, 0]}>
                <Grid args={[400, 400]} cellSize={1} sectionSize={10} cellColor="#3a3833" sectionColor="#8a867e" infiniteGrid fadeDistance={160} fadeStrength={1.5} cellThickness={0.6} sectionThickness={1} />
              </group>}
              <SelectionBox target={view === 'shot' && selRow?.kind === 'camera' ? null : selGroup} />
              {selGroup && selRow && !lockOwner(selRow) && (tool === 'translate' || tool === 'rotate' || tool === 'scale') && (
                <Gizmo key={String(selRow.id)} object={selGroup} row={selRow} mode={selRow.kind === 'camera' || selRow.kind === 'light' ? (tool === 'scale' ? 'translate' : tool) : tool}
                  snap={snap} scene={scene} busy={gizmoBusy} gz={gz}
                  solids={except => scene.rows.filter(r => r.id !== except && r.visible && (r.kind === 'person' || r.kind === 'model' || r.kind === 'prop_generated')).map(r => groups.current.get(r.id)).filter((g): g is Group => !!g)} />
              )}
              <ShotCameraSync camera={shotCam} group={shotRow ? groups.current.get(shotRow.id) ?? null : null} />
              {view === 'persp' && <EditorControls start={startCam} cmd={cmd} target={orbitTarget} eye={orbitCamPos} onHeight={setCamHeight} gz={gz} />}
              {view === 'top' && <TopView center={shotPose?.pos ?? new Vector3()} target={orbitTarget} />}
              {view === 'walk' && <WalkControls gz={walkGround} eye={walkEye} fly={walkFly} input={walkInput.current} obstacles={explore ? NO_WALLS : walkObstacles} editing={selected !== null}
                pickables={() => [...groups.current.entries()]} onPick={id => setSelected(id)} onFly={() => setWalkFly(true)} />}
              {view === 'shot' && shotRow && <LookThrough camera={shotCam} o={o} shot={shot} gain={gain} wb={wb} dofOn={dofOn} vignette={vignette} fit={fitFn} photoOnly={photoBack}
                walkers={walkers} lights={pointLights} shakePx={shakePx} onHistogram={setHist} grab={grabRef} />}
              {view !== 'shot' && shotRow && <PipRenderer shotCam={shotCam} o={o} rect={pip} inset={vp.w >= 720 && !explore} overPhoto={!!photo} />}
              {view !== 'shot' && (
                <GizmoHelper alignment="top-right" margin={[52, 52]} renderPriority={2}>
                  <GizmoViewport axisColors={['#e8675e', '#7fc96f', '#5f9cf0']} labelColor="#0c0c0b" />
                </GizmoHelper>
              )}
              <VrOrigin position={vrOrigin ?? enuToThree({ x: shotPose?.pos.x ?? 0, y: shotPose?.pos.y ?? 0, z: shotPose ? gz(shotPose.pos.x, shotPose.pos.y) : 0 })} />
              <ViewBroadcaster ev={ev} />
              {view === 'persp' && <FollowCamera ev={ev} />}
              <Picker pickRef={pickRef} />
              <Capture capture={capture} camera={shotCam} vfovDeg={o.vfovDeg} frame={frame} objects={objectsForLayers} renderSun={renderSun} />
            </XR>
          </Canvas>
        </div>

        {view === 'shot' && shotPose && (
          <>
            <Overlays vw={vp.w} vh={vp.h} rect={fit.rect} aspect={shot.aspect} overlays={[overlay, ...extraOv]}
              pitchDeg={shotPose.hpr.pitch} rollDeg={shotPose.hpr.roll} fpxView={o.fpx * fit.pxPerFramePx}
              footprint={photoBack && plateReady && footprint && photoF35 && (o.f35 < photoF35 * 0.97 || (projector && shotPose.pos.distanceTo(projector.pos) > 0.3)) ? footprint : null} />
            {hist && (
              <svg className="st-hist" style={{ left: fit.rect.x + fit.rect.w - 140, top: fit.rect.y + fit.rect.h - 56 }} width={128} height={44} viewBox="0 0 128 44" aria-label="Histogram">
                <rect width={128} height={44} rx={4} fill="var(--glass)" />
                <path d={`M4,40 ${hist.bins.map((b, i) => `L${4 + i * 3.87},${40 - Math.min(1, b * 9) * 34}`).join(' ')} L124,40Z`} fill="var(--text)" fillOpacity={0.7} />
                {hist.clipHi > 0.01 && <rect x={120} y={4} width={4} height={36} fill="var(--red)" />}
                {hist.clipLo > 0.03 && <rect x={4} y={4} width={4} height={36} fill="#5f9cf0" />}
              </svg>
            )}
            {hist && (hist.clipHi > 0.01 || hist.clipLo > 0.03 || o.diffractionWarn || shakePx > 3) && (
              <p className="st-camwarn" style={{ left: fit.rect.x + fit.rect.w - 12, top: fit.rect.y + fit.rect.h - 64 }}>
                {[hist.clipHi > 0.01 && `Highlights clipped ${Math.round(hist.clipHi * 100)}%`, hist.clipLo > 0.03 && `Shadows crushed ${Math.round(hist.clipLo * 100)}%`,
                  o.diffractionWarn && `Diffraction past f/${o.limitN.toFixed(1)}`, shakePx > 3 && `Handheld shake ${shakePx.toFixed(0)} px`].filter(Boolean).map(t => <span key={String(t)}>{t}</span>)}
              </p>
            )}
            {compare && (() => {
              const a = fitFrame(o, vp.w, vp.h, { top: 56, bottom: 72, left: 24, right: vp.w / 2 + 8 }).rect;
              return (
                <>
                  <img className="st-render-img" src={compare.url} alt={`The same shot at ${compare.label}`} style={{ left: a.x, top: a.y, width: a.w, height: a.h }} />
                  <div className="st-caption" style={{ left: a.x, top: a.y + a.h + 12, width: a.w }}><b>A · {compare.label}</b><span>Held for comparison</span></div>
                </>
              );
            })()}
            <p className="st-readout" style={{ left: fit.rect.x + 12, top: fit.rect.y + 12 }}>
              <b>{shotName.toUpperCase()}</b><span>{Math.round(shot.focalMm)} mm</span><span>f/{shot.aperture}</span><span>{fmtShutter(shot.shutterS)}{shot.shutterS < 0.3 ? ' s' : ''}</span><span>ISO {shot.iso}</span>
              <span style={{ color: Math.abs(meter) > 1 ? 'var(--amber)' : undefined }}>{meter >= 0 ? '+' : ''}{meter.toFixed(1)} EV</span>
            </p>
            {Math.abs(meter) > 1.5 && (
              <button className="st-btn small st-expose" style={{ left: fit.rect.x + 12, top: fit.rect.y + 44 }}
                onClick={() => setShotPhysical({ shutterS: shutterForScene(meterEv, shot.aperture, shot.iso) })}
                title="Keep the aperture and ISO, and set the shutter the meter suggests for the light at this time">
                Expose for this light ({meter > 0 ? 'too bright' : 'too dark'} by {Math.abs(meter).toFixed(1)} stops)
              </button>
            )}
            {focusTarget && <p className="st-focuslabel" style={{ left: fit.rect.x + fit.rect.w / 2, top: fit.rect.y + fit.rect.h * 0.62 }}>Focus {shot.focusM.toFixed(1)} m{Math.abs(focusTarget.distance - shot.focusM) < 0.5 ? ` · ${focusTarget.name}` : ''}</p>}
            {photoBack && <p className="st-photocredit" style={{ left: fit.rect.x + 10, top: fit.rect.y + fit.rect.h - 28 }}>Your photo · {frame.w} × {frame.h}</p>}
            <div className="st-caption" style={{ left: fit.rect.x, top: fit.rect.y + fit.rect.h + 12, width: fit.rect.w }}>
              <b>{compare ? `B · ${settingsLabel}` : `Through ${shotName}: ${photoBack ? 'your photo with your objects and lights' : 'the 3D world with your objects'}`}</b>
              <span>{photoBack && graded ? `Preview grade. Render relights the photo${cropNote ? ` · ${cropNote}` : ''}` : cropNote ?? 'Lens, aperture, shutter and ISO behave like the real camera'}</span>
            </div>
            {split && latestRender && (() => {
              const r = { x: vp.w / 2 + 8, y: fit.rect.y, w: Math.min(vp.w / 2 - 32, fit.rect.w), h: fit.rect.h };
              return (
                <>
                  <img className="st-render-img" src={latestRender.imageUrl} alt="AI render of your shot" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
                  <span className="st-ai-label" style={{ left: r.x + 12, top: r.y + 12 }}>AI interpretation</span>
                  <div className="st-caption" style={{ left: r.x, top: r.y + r.h + 12, width: r.w }}>
                    <b>Render {String(latestRender.id)} · {latestRender.kind === 'render' ? 'AI pass on NVIDIA' : 'AI preview'}</b>
                    <span>Made from your photo and your objects only. Map tiles never enter a render.</span>
                  </div>
                </>
              );
            })()}
            <div className={`st-camctl${vp.w < 1150 ? ' wrap' : ''}`}>
              {viewSwitch}
              <div className="st-camgroup st-float" role="toolbar" aria-label="Camera">
              {vp.w > 1100 && <span>Backplate</span>}
              <Seg label="Backplate" value={backplate} onChange={setBackplate} options={[{ value: 'photo', label: 'Your photo' }, { value: 'world', label: WORLD_LABEL[world === 'off' ? 'tiles' : world] }]} />
              {vp.w > 1100 && <span>Aspect</span>}
              <Seg label="Aspect" value={shot.aspect} onChange={v => setShot({ aspect: v })} options={['4:3', '4:5', '3:2', '16:9'].map(a => ({ value: a, label: aspectLabel(a) }))} />
              <span style={{ position: 'relative' }}>
                <button className="st-btn small ghost" aria-expanded={viewMenu} onClick={() => setViewMenu(v => !v)}>Guides: {GUIDES[overlay as keyof typeof GUIDES] ?? 'Off'}</button>
                {viewMenu && (
                  <div className="st-menu" style={{ left: 0, top: 40 }} role="menu" aria-label="Guides">
                    {Object.entries(GUIDES).map(([k, l]) => <button key={k} role="menuitemradio" aria-checked={overlay === k} onClick={() => setOverlay(k as typeof overlay)}>{l}</button>)}
                    <hr />
                    {(['horizon', 'safe', 'grid'] as const).map(k => <button key={k} role="menuitemcheckbox" aria-checked={extraOv.includes(k)} onClick={() => setExtraOv(v => (v.includes(k) ? v.filter(x => x !== k) : [...v, k]))}>{{ horizon: 'Horizon line', safe: 'Safe area', grid: 'Grid' }[k]}</button>)}
                  </div>
                )}
              </span>
              <span style={{ position: 'relative' }}>
                <button className="st-btn small" aria-pressed={compareOn} onClick={() => { if (compareOn) endCompare(); else void holdA(); }}
                  title="Hold this frame as A, then change the camera for B beside it">{compareOn ? 'End compare' : 'Compare'}</button>
              </span>
              {!compareOn && vp.w >= 1000 && <button className="st-btn small ghost" onClick={() => void comparePreset()} title="24 mm f/8 from close against 85 mm f/1.4 from further back, subject the same size">24 vs 85 mm</button>}
              {latestRender && <button className="st-btn small" aria-pressed={renderOpen} onClick={() => setRenderOpen(v => !v)}>{renderOpen ? 'Hide render' : 'Show render'}</button>}
              </div>
            </div>
          </>
        )}

        {view !== 'shot' && (
          <div className="st-chrome">
            {/* First, so the touch look pad sits under every other control. */}
            {view === 'walk' && !focus && (
              <WalkHud input={walkInput.current} eye={walkEye} setEye={setWalkEye} fly={walkFly} setFly={setWalkFly}
                canStand={!!shotRow} onStandHere={standHere} onExit={() => setView('persp')} />
            )}
            {!focus && (
              <div className="st-viewswitch">
                {viewSwitch}
                {view !== 'map' && (
                  <>
                <span style={{ position: 'relative' }}>
                  <button className="st-btn small" aria-expanded={worldMenu} onClick={() => setWorldMenu(v => !v)} title="World style">{WORLD_LABEL[world]}</button>
                  {worldMenu && (
                    <div className="st-menu" style={{ left: 0, top: 40 }} role="menu" aria-label="World style">
                      {worlds.map(w => <button key={w} role="menuitemradio" aria-checked={world === w} onClick={() => { setWorld(w); setWorldMenu(false); }}>{WORLD_LABEL[w]}</button>)}
                    </div>
                  )}
                </span>
                <PlaceSearch onPick={p => { setExplore(p); setGroundOffset(null); setSelected(null); if (view !== 'walk') setView('persp'); }} />
                  </>
                )}
              </div>
            )}
            {pendingSpot && <NewShootWatcher spotId={pendingSpot} />}
            {explore && !focus && (
              <div className="st-explore st-float" role="status">
                <span title={explore.name}>{explore.name.split(',')[0]}</span>
                {!solved && <button className="st-btn small primary" disabled={groundOffset === null} onClick={() => void planHere()} title="Move this set here: plan with the real sun at this place">Plan here</button>}
                <button className="st-btn small" disabled={groundOffset === null || !!pendingSpot} onClick={() => void newShootHere()}>{pendingSpot ? 'Creating' : 'New shoot here'}</button>
                <button className="st-btn small ghost" onClick={() => setExplore(null)}>Back to the set</button>
              </div>
            )}
            {!explore && earth && shotRow && solved && (view === 'persp' || view === 'walk') && camNear && (
              <button className="st-btn small st-float st-sharper" onClick={() => setWorld('clayPhoto')} title="Switch to Clay + photo, sharp at street level near the shot">Sharper here</button>
            )}
            {!focus && view !== 'map' && (
              <div className="st-rail st-float" role="toolbar" aria-label="Tools">
                {([['select', 'cursor', 'Select (W)'], ['translate', 'move', 'Move (G)'], ['rotate', 'rotate', 'Rotate (R)'], ['scale', 'scale', 'Scale (S)']] as const).map(([t, i, l]) => (
                  <button key={t} aria-pressed={tool === t} onClick={() => setTool(t)} title={l} aria-label={l}><Ico n={i} s={16} /></button>
                ))}
                <hr />
                <button aria-expanded={addOpen} onClick={() => setAddOpen(v => !v)} title="Add (Shift+A)" aria-label="Add people, props and lights"><Ico n="plus" s={16} /></button>
                <hr />
                <button aria-pressed={tool === 'measure'} onClick={() => { setTool(t => (t === 'measure' ? 'select' : 'measure')); setMeasure([]); }} title="Measure (M)" aria-label="Measure"><Ico n="ruler" s={16} /></button>
                <button aria-pressed={laser} onClick={() => setLaser(v => !v)} title="Laser pointer for everyone (L, or Alt+click)" aria-label="Laser pointer"><Ico n="crosshair" s={16} /></button>
                <button aria-expanded={viewMenu} onClick={() => setViewMenu(v => !v)} title="View options" aria-label="View options"><Ico n="dots" s={16} /></button>
              </div>
            )}
            {viewMenu && !focus && (
              <div className="st-menu" style={{ left: 60, top: 300 }} role="menu" aria-label="View options">
                <button role="menuitemcheckbox" aria-checked={snap} onClick={() => setSnap(v => !v)}>Snap to the street</button>
                <button role="menuitemcheckbox" aria-checked={gridOn} onClick={() => setGridOn(v => !v)}>Grid</button>
                {splatUrl && <button role="menuitemcheckbox" aria-checked={splatFull} onClick={() => { setSplatFull(v => !v); setSplatState({ loaded: false, progress: 0 }); }}>Full-quality set (155 MB)</button>}
                <button role="menuitem" onClick={() => { setFocus(true); setViewMenu(false); }}>Focus mode <span className="st-meta" style={{ marginLeft: 'auto' }}>Tab</span></button>
              </div>
            )}
            {!focus && !liveOpen && !geoOpen && view !== 'map' && (
              <div className={`st-cmd${vp.w < 900 && !cmdOpen ? ' compact' : ''}`}>
                <div className={`st-float${cmdOpen ? ' st-cmd-open' : ''}`} data-opts={cmdOpts}>
                  {!cmdOpen && (
                    <button className="st-cmd-pill" onClick={() => setCmdOpen(true)}><span className="st-cmd-text">Describe a change</span><span className="st-meta st-cmd-who">Nemotron</span><span className="st-meta">⌘K</span></button>
                  )}
                  <div style={{ display: cmdOpen ? 'block' : 'none' }}>
                    <NvidiaSlot name="CommandBar" props={{ sessionId: sid, photoId: photo?.id }} fallbackText="" />
                    <div className="st-cmd-tools">
                      <button className="st-btn small ghost" aria-pressed={cmdOpts} onClick={() => setCmdOpts(v => !v)}>Options</button>
                      <button className="st-btn small ghost" onClick={() => setCmdOpen(false)}>Close</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {focus && (
              <div className="st-minibar st-float" role="toolbar" aria-label="Focus mode tools">
                {viewSwitch}
                <hr />
                {([['select', 'cursor', 'Select (W)'], ['translate', 'move', 'Move (G)'], ['rotate', 'rotate', 'Rotate (R)'], ['scale', 'scale', 'Scale (S)']] as const).map(([t, i, l]) => (
                  <button key={t} aria-pressed={tool === t} onClick={() => setTool(t)} title={l} aria-label={l}><Ico n={i} s={16} /></button>
                ))}
                <button onClick={() => setAddOpen(v => !v)} title="Add (Shift+A)" aria-label="Add"><Ico n="plus" s={16} /></button>
                <hr />
                <button className="st-btn small" onClick={() => setFocus(false)}>Exit focus <span className="st-meta">Tab</span></button>
              </div>
            )}
            {shotRow && !explore && view !== 'map' && (
              <>
                <button className="st-pip" style={{ left: pip.x, top: pip.y, width: pip.w, height: pip.h }} onClick={() => setView('shot')} aria-label={`Look through ${shotName}`} title={`Look through ${shotName} (0)`} />
                <span className="st-pip-label" style={{ left: pip.x + 6, top: pip.y + pip.h - 22 }}>{shotName} · {Math.round(o.f35)} mm</span>
              </>
            )}
            {view !== 'walk' && view !== 'map' && scene.rows.filter(r => r.kind !== 'camera').length === 0 && scene.ready && !addOpen && (
              <div className="st-hint st-float" role="note">
                <span>Press <kbd>+</kbd> to add people, props and lights, or describe a change.</span>
                <button className="st-btn small" onClick={() => setAddOpen(true)}>Add</button>
              </div>
            )}
          </div>
        )}
        {view === 'persp' && origin && <GeoOverview geo={layers} center={origin} camera={cone} heightM={camHeight} widthPx={vp.w} from={1400} to={2000} />}
        {view === 'map' && origin && (
          <Suspense fallback={null}>
            <GeoMapView geo={layers} sessionId={sid} origin={origin} at={planTime} zone={zone} camera={mapCam}
              onCamera={c => { mapCamRef.current = c; }} onEnter3D={(c, heading) => enter3D(c, heading)} onOpenShot={openShot} />
          </Suspense>
        )}
        <div className="st-corner" aria-live="polite">
          {showTiles && view !== 'shot' && !focus && (
            <div className="st-seg st-float st-lightsw" role="group" aria-label="Light"
              title="Live sun relights Google's 3D tiles for the time on the timeline. Their photos were taken in daylight, so faint shadows from the capture still show.">
              <button aria-pressed={lightMode === 'live'} onClick={() => setLightMode('live')}>Live sun</button>
              <button aria-pressed={lightMode === 'captured'} onClick={() => setLightMode('captured')}>As captured</button>
            </div>
          )}
          {ghost && <span className="st-chip">Previewing the set at that point. Read-only: Restore makes it real.</span>}
          {focusHint && !focus && !buildShown && <span className="st-chip">Press Tab for focus mode: just the view and a small toolbar</span>}
          {!shotRow && <span className="st-chip">{solved ? `Placing ${shotName} where the photo was taken` : 'No solved photo yet: place objects freely'}</span>}
          {world === 'splat' && splatUrl && !splatState.loaded && <span className="st-chip">Loading the photoreal set {Math.round(splatState.progress * 100)}%</span>}
          {tool === 'measure' && <span className="st-chip">Measure: click two points on the street</span>}
          {laser && <span className="st-chip">Laser on: click to show everyone a spot</span>}
          {view === 'persp' && <span className="st-chip mono">Eye {camHeight.toFixed(1)} m</span>}
          {(scene.error || toast) && <button className={`st-chip ${scene.error ? 'err' : 'toast'}`} onClick={() => { scene.clearError(); setToast(''); }}>{scene.error || toast}</button>}
        </div>
        {view !== 'map' && <div className="st-credits">{credits}{photo && <span className="right">Photo: {nameOf(photo.owner)}'s upload</span>}</div>}
        {dragOver && <div className="st-dropzone-hint">Drop the image where it should go</div>}
        {dropAsk && (
          <div className="st-dropask" style={{ left: dropAsk.x, top: dropAsk.y }} role="dialog" aria-label="Use the dropped image">
            <p>{dropAsk.file.name}{dropAsk.at?.wall ? ', on the wall' : ''}</p>
            <button className="st-btn small" onClick={() => { void placeImage(dropAsk.file, dropAsk.at); setDropAsk(null); }}><Ico n="image" /> Place as image</button>
            <button className="st-btn small" onClick={() => { lastPoint.current = dropAsk.at?.enu ?? null; setGenFile({ file: dropAsk.file, n: Date.now() }); setAddOpen(true); setDropAsk(null); }}><Ico n="cube" /> Make it 3D</button>
            <button className="st-btn small ghost" onClick={() => setDropAsk(null)}>Cancel</button>
          </div>
        )}
        {addOpen && <AddDrawer onAdd={i => addItem(i)} sessionId={sid} onGenerated={onGenerated} genFile={genFile} onClose={() => setAddOpen(false)} startTab={genFile ? 'Generate' : undefined} />}
        {!focus && view !== 'map' && <BuildCard onShown={setBuildShown} spotName={spot?.name} solved={solved ? { f35: solved.pose.f35, heading: solved.pose.heading, inliers: solved.inliers, alt: solved.pose.alt, pitch: solved.pose.pitch, secs: solved.secs } : null}
          hasCam={!!shotRow} worldReady={plateReady || (world === 'clay' || world === 'clayPhoto' ? !!layers.data?.layers.buildings : splatState.loaded || attribution !== '')}
          worldNote={world === 'clay' || world === 'clayPhoto' ? `Clay massing from ${layers.data?.layers.buildings?.features.length ?? 'the'} building footprints${world === 'clayPhoto' ? ', your photo projected on it' : ''}` : undefined}
          splat={world === 'splat' && !!splatUrl} progress={splatState.progress} />}
        {page !== 'set' && (
          <div className="st-page">
            <button className="st-btn small" onClick={() => setPage('set')} style={{ marginBottom: 16 }}>Back to the set</button>
            {page === 'shots' ? (
              <>
                <h2>Shots</h2><p className="st-page-note">Versions of this set, recorded by the crew from texts and renders.</p>
                <div className="st-gallery">
                  {[...versions].sort((a, b) => Number(b.id - a.id)).map(v => (
                    <figure key={String(v.id)}>{v.imageUrl ? <img src={v.imageUrl} alt="" /> : <div className="st-concept" />}<figcaption>{v.label} · {v.channel || 'web'} · change {String(v.sceneChangeId)}</figcaption></figure>
                  ))}
                  {versions.length === 0 && <p className="st-note">No shots yet. Each render and each texted change becomes a shot version.</p>}
                </div>
              </>
            ) : (
              <>
                <h2>Renders</h2><p className="st-page-note">AI interpretation, made from your photo and your objects only.</p>
                <div className="st-gallery">
                  {[...previews].filter(p => p.state === 'done' && p.imageUrl).sort((a, b) => Number(b.id - a.id)).map(p => (
                    <figure key={String(p.id)}><img src={p.imageUrl} alt="" /><span className="st-ai-label" style={{ left: 8, top: 8 }}>AI interpretation</span><figcaption>{p.kind || 'preview'} {String(p.id)} · {p.instruction.slice(0, 80)}</figcaption></figure>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      <aside className="st-right" aria-label="Inspector">
        {renderOpen && view === 'shot' && (
          <div className="st-insp" style={{ paddingBottom: 0, gap: 16 }}>
            <RenderSection getLayers={getLayers} sessionId={sid} photoId={photo?.id} shot={shot} f35={o.f35}
              time={`${fmtTime(planTime, zone)} (${sun.altitude.toFixed(0)}° sun)`} sun={photoSun ?? sun}
              sunMatch={sunMatch} sunSource={sunSource} onSunSource={setSunSource} onSunFix={applySunFix} fixNote={fixNote} onFixDone={() => setFixNote('')}
              camera={{ exposureStops: +meter.toFixed(2), wbGains: wb.map(v => +v.toFixed(4)), tint, noiseSigma: +o.noise.toFixed(4), sensorMm: o.sensorMm.map(v => +v.toFixed(2)),
                cocMm: o.cocMm, blades: o.blades, airyPx: +o.airyPx.toFixed(2), vignette, tca: o.tca ?? null, distortionPoly: o.poly, unitMm: o.unitMm,
                shakePx: +shakePx.toFixed(2), photoF35, note: 'apply exposureStops, wbGains, depth of field (sceneDepth), vignetting and noise to the composite so it matches the viewport',
                // lensfun "pa" vignetting when measured (radius unit vigUnitMm), else cos^4 times (1 - optVig toward the corner)
                vig: o.vig ?? null, vigUnitMm: +o.vigUnitMm.toFixed(3), optVig: +o.optVig.toFixed(3),
                // the viewport's shake runs along (0.8, 0.6) in image pixels, sampled symmetrically, so its sign doesn't matter
                shakeDir: [0.8, 0.6],
                // bokeh: blend from round to the blade polygon over two stops down; cat-eye clipping wide open (0.5 at the widest)
                polyAmt: +Math.max(0, Math.min(1, o.stopsDown / 2)).toFixed(3), catEye: +(0.5 * Math.max(0, Math.min(1, 1 - o.stopsDown / 2))).toFixed(3),
                // starbursts from f/8 (full at f/16): point lights in frame pixels, `spikes` per light, length 2.2 x N screen px
                spikes: o.spikes, starAmt: +Math.max(0, Math.min(1, (shot.aperture - 8) / 8)).toFixed(3), lights: framedLights() }} />
            <NvidiaSlot name="ArtDirector" props={{ sessionId: sid, photoId: photo?.id, getLayers }} fallbackText="" />
            <div className="st-div" />
          </div>
        )}
        <Inspector row={selRow} isShot={!selRow || selRow.id === shotRow?.id} camName={shotName} lockedBy={selRow ? lockOwner(selRow)?.name ?? null : null}
          placedBy={selRow ? (isMe(selRow.updatedBy) ? 'you' : nameOf(selRow.updatedBy)) : ''}
          shot={shot} setShot={setShotPhysical} shotError={shotError} optics={o} sceneEv={meterEv} vignette={vignette} setVignette={setVignette}
          subjectLock={subjectLock} onSubjectLock={setSubjectLock} tint={tint} onTint={setTint} cropNote={view === 'shot' ? cropNote : null} shakePx={shakePx}
          focusTarget={focusTarget} onFocusOn={setFocusFollow} shotStats={shotStats} sizeOf={r => objectSizes.get(r.id) ?? null}
          onChange={editRow} onMakeShot={makeShot} onRegenerate={(r, f) => void regenerate(r, f)}
          groundAt={gz}
          onFaceCamera={r => { const yaw = faceCamFrom(new Vector3(r.x, r.y, r.z)); const q = yawQuat(yaw); editRow(r, { ...stateOf(r), qx: q.x, qy: q.y, qz: q.z, qw: q.w }, ''); }} />
        {!selRow && (
          <div className="st-panel-extra">
            <Disclosure title="Call sheet and models">
              <NvidiaSlot name="CallSheet" props={{ sessionId: sid }} fallbackText="" />
              <NvidiaSlot name="PoweredBy" props={{}} fallbackText="" />
            </Disclosure>
          </div>
        )}
      </aside>

      {origin && <Timeline at={planTime} lat={origin.lat} lon={origin.lon} zone={zone} camHeading={shotPose?.hpr.heading ?? null} camName={shotName}
        onChange={changeTime} keyframes={keyframes} sunControl={<SpacetimeSlot name="SunClock" props={{ sessionId: sid }} />}
        open={timeHover || timePinned} pinned={timePinned} onHover={hoverTime} onPin={() => setTimePinned(v => !v)}
        extra={st => (st.open ? <GeoBands geo={layers} {...st} top={116} zone={zone} /> : null)} />}

      <SetEventsBridge sessionId={sid} me={identity ?? undefined} onChange={setEv} />
      <PresenceBeat sessionId={sid} focus={selected} />
      <CheckinBridge sessionId={sid} onChange={setCheckins} />
      {geoOpen && origin && <GeoPanel geo={layers} zone={zone} center={origin} camera={cone} onClose={() => setGeoOpen(false)} />}
      {liveOpen && (
        <div className="st-drawer" role="dialog" aria-label="Live data">
          <header><h2>People and live data</h2><button className="st-btn small" onClick={() => setLiveOpen(false)}>Close</button></header>
          <PhotonSlot name="PhotonPanel" props={{ sessionId: sid, code: session.code, myName }} />
          <SpacetimeSlot name="Presence" props={{ sessionId: sid, focusObjectId: selected }} />
          <SpacetimeSlot name="LiveInspector" props={{ sessionId: sid, myName, defaultOpen: true }} fallbackText="The SpacetimeDB live inspector mounts here once web/src/spacetime exports it." />
          <SpacetimeSlot name="HistoryScrubber" props={{ sessionId: sid, onPreview: setGhost }} />
          <SpacetimeSlot name="SharedLibrary" props={{ sessionId: sid, onAdd: (url: string, name: string) => addItem({ kind: 'prop_generated', url, name }) }} />
        </div>
      )}
    </div>
  );
}

/** V-1 "Building your set": shown while the shot camera and the world come in, then it gets out of the way. */
function BuildCard({ spotName, solved, hasCam, worldReady, worldNote, splat, progress, onShown }: {
  spotName?: string; solved: { f35: number; heading: number; inliers: number; alt: number; pitch: number; secs: number } | null;
  hasCam: boolean; worldReady: boolean; worldNote?: string; splat: boolean; progress: number; onShown?: (v: boolean) => void;
}) {
  const [closed, setClosed] = useState(false);
  useEffect(() => { onShown?.(!closed); return () => onShown?.(false); }, [closed]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = hasCam && worldReady;
  useEffect(() => { if (done) { const t = setTimeout(() => setClosed(true), 2500); return () => clearTimeout(t); } }, [done]);
  if (closed) return null;
  const step = (s: string, title: string, sub: string, bar?: number) => (
    <li data-s={s}><b aria-label={s === 'done' ? 'Done' : s === 'now' ? 'In progress' : 'Next'} /><span>{title}</span><small>{sub}</small>
      {bar !== undefined && s === 'now' && <div className="bar"><i style={{ width: `${Math.max(4, bar * 100)}%` }} /></div>}</li>
  );
  const n = [!!spotName, !!solved, worldReady, hasCam].filter(Boolean).length;
  return (
    <section className="st-build st-float" aria-live="polite">
      <header style={{ display: 'flex', alignItems: 'baseline' }}><span style={{ flex: 1, font: '500 13px var(--sans)' }}>Building your set</span><span className="st-meta">{n} of 4</span></header>
      <ol>
        {step(spotName ? 'done' : 'now', 'Found the spot', spotName ?? 'Looking up the spot')}
        {step(solved ? 'done' : 'now', 'Solved the camera', solved ? `${Math.round(solved.f35)} mm, facing ${Math.round(solved.heading)}°. ${solved.inliers} matches in ${Math.round(solved.secs)} s` : 'Waiting for the solve')}
        {step(worldReady ? 'done' : 'now', 'Building the world', worldNote ?? (splat ? 'Photoreal splat of the spot, then 3D tiles around it' : 'Google Photorealistic 3D Tiles around the mark'), splat ? progress : undefined)}
        {step(hasCam ? 'done' : solved ? 'now' : 'next', 'Placing Cam A where you stood', solved ? `${solved.alt.toFixed(1)} m above the ground, tilted ${solved.pitch.toFixed(0)}° ${solved.pitch >= 0 ? 'up' : 'down'}` : 'After the solve')}
      </ol>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ flex: 1 }} />
        <button className="st-btn small ghost" onClick={() => setClosed(true)}>{done ? 'Done' : 'Hide'}</button>
      </div>
    </section>
  );
}

/** After "New shoot here": open the new session once its row arrives (createSession returns nothing). */
function NewShootWatcher({ spotId }: { spotId: string }) {
  const [rows] = useTable(tables.session.where(r => r.spotId.eq(spotId)));
  useEffect(() => { const r = rows[rows.length - 1]; if (r) location.assign(`/studio/${r.code}`); }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Image-based light from the user's photo: an equirect env so objects pick up the scene's colours (not a reflection). */
function PhotoEnv({ url, intensity = 0.55 }: { url: string; intensity?: number }) {
  const tex = useTexture(url);
  useMemo(() => { tex.mapping = EquirectangularReflectionMapping; tex.colorSpace = SRGBColorSpace; tex.needsUpdate = true; }, [tex]);
  return <Environment map={tex} environmentIntensity={intensity} />;
}

/** The sun. Its 300 m shadow box follows the active camera: centred where the view meets the street (up to 200 m ahead),
 *  snapped to a 2 m grid so shadows don't crawl as you move, so the shadows stay sharp near you and cheap to draw. */
function SunLight({ dir, color, strength }: { dir: [number, number, number]; color: [number, number, number]; strength: number }) {
  const d = useMemo(() => enuToThree({ x: dir[0], y: dir[1], z: dir[2] }).normalize(), [dir[0], dir[1], dir[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = useMemo(() => new Object3D(), []);
  const light = useRef<DirectionalLight>(null);
  const fwd = useMemo(() => new Vector3(), []);
  useFrame(({ camera }) => {
    const l = light.current;
    if (!l) return;
    camera.getWorldDirection(fwd);
    const c = camera.position.clone();
    const h = Math.hypot(fwd.x, fwd.z); // horizontal part of the view; the view ray meets the street (y = 0) at y / -fwd.y
    const dist = fwd.y < -0.05 ? Math.min(200, (Math.max(0, camera.position.y) / -fwd.y) * h) : 100;
    if (h > 1e-3) c.add(new Vector3(fwd.x / h, 0, fwd.z / h).multiplyScalar(dist));
    c.set(Math.round(c.x / 2) * 2, 0, Math.round(c.z / 2) * 2);
    if (target.position.distanceToSquared(c) > 0.01) { target.position.copy(c); target.updateMatrixWorld(); }
    l.position.copy(c).addScaledVector(d, 400);
  });
  return (
    <>
      <primitive object={target} />
      <directionalLight ref={light} name="sun" target={target} color={color} intensity={strength} castShadow={strength > 0}
        shadow-mapSize={[4096, 4096]} shadow-radius={4} shadow-blurSamples={16} shadow-camera-left={-150} shadow-camera-right={150} shadow-camera-top={150}
        shadow-camera-bottom={-150} shadow-camera-near={1} shadow-camera-far={900} shadow-bias={-0.0006} shadow-normalBias={0.05} />
    </>
  );
}

function ShotCameraSync({ camera, group }: { camera: PerspectiveCamera; group: Group | null }) {
  useFrame(() => {
    if (!group) return;
    group.updateWorldMatrix(true, false);
    group.matrixWorld.decompose(camera.position, camera.quaternion, new Vector3());
    camera.updateMatrixWorld();
  }, -2);
  return null;
}

/** Editor view render: the main scene, then the shot camera's view into the picture-in-picture box with the world hidden
 *  (the photo sits under the transparent canvas there). Priority 1 takes over R3F's render; the axis gizmo draws at 2. */
function PipRenderer({ shotCam, o, rect, inset = true, overPhoto = true }: { shotCam: PerspectiveCamera; o: { frame: { w: number; h: number }; vfovDeg: number }; rect: { x: number; y: number; w: number; h: number }; inset?: boolean; overPhoto?: boolean }) {
  const { gl, scene, camera, size } = useThree();
  const pipCam = useMemo(() => new PerspectiveCamera(), []);
  useFrame((_, dt) => {
    gl.autoClear = true;
    const atmo = atmosphereRender.current && !gl.xr.isPresenting ? atmosphereRender.current : null;
    if (atmo) atmo(dt); else gl.render(scene, camera);
    if (gl.xr.isPresenting || !inset) return; // phones: no room for the inset, the main view still renders here
    pipCam.position.copy(shotCam.position); pipCam.quaternion.copy(shotCam.quaternion);
    pipCam.fov = o.vfovDeg; pipCam.aspect = o.frame.w / o.frame.h; pipCam.near = 0.1; pipCam.far = 5000;
    pipCam.updateProjectionMatrix(); pipCam.updateMatrixWorld();
    const hide: Object3D[] = [];
    scene.traverse(x => { if ((x.userData.helper || (x as { isTransformControlsRoot?: boolean; isTransformControls?: boolean }).isTransformControlsRoot || (x as { isTransformControls?: boolean }).isTransformControls) && x.visible) hide.push(x); });
    // Over the photo the inset shows only our objects; a shoot without a photo shows the world it is planned in (display only).
    if (overPhoto && tilesRef.current?.group.visible) hide.push(tilesRef.current.group);
    if (sparkRef.current?.visible) hide.push(sparkRef.current);
    hide.forEach(x => (x.visible = false));
    const bg = scene.background;
    scene.background = null;
    const y = size.height - rect.y - rect.h;
    gl.setScissorTest(true);
    gl.setScissor(rect.x, y, rect.w, rect.h); gl.setViewport(rect.x, y, rect.w, rect.h);
    gl.setClearColor(0x000000, 0); gl.clear();
    // Under the atmosphere, objects are lit in physical units: give the inset the same exposure as the main view.
    const ex = gl.toneMappingExposure;
    if (atmo) gl.toneMappingExposure = atmosphereRender.exposure;
    gl.render(scene, pipCam);
    gl.toneMappingExposure = ex;
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    scene.background = bg;
    hide.forEach(x => (x.visible = true));
  }, 1);
  return null;
}

let appliedCmd = 0; // a view command applies once, even when the controls remount (switching views) or arrive late
function EditorControls({ start, cmd, target, eye, onHeight, gz }: {
  start: { pos: Vector3; target: Vector3 }; cmd: ViewCmd | null; target: React.MutableRefObject<Vector3>; eye: React.MutableRefObject<Vector3>;
  onHeight: (m: number) => void; gz: (x: number, y: number) => number;
}) {
  const { camera, controls } = useThree();
  const t0 = useMemo(() => enuToThree(start.target), [start]);
  useEffect(() => {
    const c = controls as unknown as { target: Vector3; update(): void } | null;
    camera.position.copy(enuToThree(start.pos));
    if (c) { c.target.copy(t0); c.update(); } else camera.lookAt(t0);
  }, [start, controls]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cmd || cmd.n === appliedCmd) return;
    const c = controls as unknown as { target: Vector3; update(): void } | null;
    if (!c) return;
    appliedCmd = cmd.n;
    if (cmd.kind === 'place') {
      c.target.copy(enuToThree(cmd.point)); camera.position.copy(enuToThree(cmd.pos)); c.update();
      target.current.copy(cmd.point);
      return;
    }
    const tgt = cmd.kind === 'focus' ? cmd.point : c.target.clone();
    const dist = cmd.kind === 'focus' ? cmd.radius * 2.5 : camera.position.distanceTo(c.target);
    const dir = cmd.kind === 'front' ? new Vector3(0, 0.25, 1) : cmd.kind === 'right' ? new Vector3(1, 0.25, 0) : camera.position.clone().sub(c.target);
    if (cmd.kind === 'home') { c.target.copy(t0); camera.position.copy(enuToThree(start.pos)); }
    else { c.target.copy(tgt); camera.position.copy(tgt.clone().add(dir.normalize().multiplyScalar(dist))); }
    c.update();
  }, [cmd, controls]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = useRef(0);
  useFrame(() => {
    const now = performance.now();
    if (now - last.current < 300) return;
    last.current = now;
    eye.current.copy(camera.position);
    const p = threeToEnu(camera.position);
    onHeight(p.z - gz(p.x, p.y));
  });
  return <OrbitControls makeDefault target={t0} maxPolarAngle={Math.PI * 0.495} enableDamping={false}
    onChange={e => { const c = e?.target as unknown as { target: Vector3 }; if (c?.target) target.current.copy(threeToEnu(c.target)); }} />;
}

function TopView({ center, target }: { center: Vector3; target: React.MutableRefObject<Vector3> }) {
  const c = enuToThree(center).setY(0);
  return (
    <>
      <OrthographicCamera makeDefault position={[c.x, 600, c.z]} zoom={9} near={1} far={5000} up={[0, 0, -1]} onUpdate={cam => cam.lookAt(c)} />
      <OrbitControls makeDefault target={c} enableRotate={false} screenSpacePanning
        onChange={e => { const t = (e?.target as unknown as { target: Vector3 })?.target; if (t) target.current.copy(threeToEnu(t)); }} />
    </>
  );
}

/** Raycasts screen points against our street geometry only (catchers), for drops and placement. Never the tiles. */
function Picker({ pickRef }: { pickRef: React.MutableRefObject<((cx: number, cy: number) => Pick | null) | null> }) {
  const { camera, scene, gl } = useThree();
  useEffect(() => {
    const ray = new Raycaster();
    pickRef.current = (cx, cy) => {
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera as Camera);
      const targets: Object3D[] = [];
      scene.traverse(o => { if (o.userData.catcher) targets.push(o); });
      const hit = ray.intersectObjects(targets, false)[0];
      if (!hit) return null;
      const enu = threeToEnu(hit.point);
      const n = hit.face ? hit.face.normal.clone() : new Vector3(0, 0, 1); // geometry is built in the ENU frame
      return { enu, normal: new Vector3(n.x, n.y, 0).lengthSq() > 0.5 ? new Vector3(n.x, n.y, 0).normalize() : new Vector3(0, 0, 1), wall: !!hit.object.userData.wall };
    };
    return () => { pickRef.current = null; };
  }, [camera, scene, gl, pickRef]);
  return null;
}

function Measure({ pts }: { pts: Vector3[] }) {
  return (
    <group userData={{ helper: true }}>
      {pts.map((p, i) => <mesh key={i} position={[p.x, p.y, p.z + 0.03]}><sphereGeometry args={[0.08, 12, 8]} /><meshBasicMaterial color="#f2a33a" toneMapped={false} /></mesh>)}
      {pts.length === 2 && (
        <>
          <Line points={pts.map(p => [p.x, p.y, p.z + 0.05] as [number, number, number])} color="#f2a33a" lineWidth={2} />
          <Html position={[(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, (pts[0].z + pts[1].z) / 2 + 0.4]} center>
            <span className="st-obj-label cam">{pts[0].distanceTo(pts[1]).toFixed(2)} m</span>
          </Html>
        </>
      )}
    </group>
  );
}

/** The transform gizmo: lock on grab, 10 Hz updates while dragging, snap to the street plane and our objects, unlock on drop. */
function Gizmo({ object, row, mode, snap, scene, solids, busy, gz }: {
  object: Group; row: SceneObject; mode: 'translate' | 'rotate' | 'scale'; snap: boolean; scene: ReturnType<typeof useScene>;
  solids: (except: bigint) => Group[]; busy: { current: boolean }; gz: (x: number, y: number) => number;
}) {
  const ref = useRef<{ axis: string | null; dragging: boolean } | null>(null);
  const ray = useMemo(() => new Raycaster(), []);
  const camera = useThree(st => st.camera);
  const read = (): ObjState => {
    const g = object;
    if (mode === 'scale') { const s = (g.scale.x + g.scale.y + g.scale.z) / 3; g.scale.setScalar(Math.max(0.01, s)); }
    if (snap && mode === 'translate' && row.kind !== 'camera' && row.kind !== 'light' && ref.current?.axis && !ref.current.axis.includes('Y')) {
      // Highest surface of our own objects under this one, else the street plane. Never the tiles.
      try {
        const meshes: Object3D[] = [];
        for (const gr of solids(row.id)) gr.traverse(o => { if ((o as Mesh).isMesh && !isHelper(o) && !o.userData.contact) meshes.push(o); });
        const from = new Vector3(g.position.x, g.position.y, g.position.z + 30).applyMatrix4(g.parent!.matrixWorld);
        ray.set(from, new Vector3(0, -1, 0));
        ray.camera = camera;
        const floor = gz(g.position.x, g.position.y);
        const hit = ray.intersectObjects(meshes, false).find(h => threeToEnu(h.point).z <= g.position.z + 1.2);
        g.position.z = hit ? Math.max(floor, threeToEnu(hit.point).z) : floor;
      } catch (e) { console.warn('snap skipped', e); } // a failed snap must never leave the object locked
    }
    return { ...stateOf(row), x: g.position.x, y: g.position.y, z: g.position.z, qx: g.quaternion.x, qy: g.quaternion.y, qz: g.quaternion.z, qw: g.quaternion.w, scale: g.scale.x };
  };
  return (
    <TransformControls ref={ref as never} object={object} mode={mode} size={0.85}
      onMouseDown={() => { busy.current = true; scene.beginDrag(row); }}
      onMouseUp={() => { scene.endDrag(read()); window.setTimeout(() => { busy.current = false; }, 50); }} // endDrag always unlocks
      onObjectChange={() => { if (ref.current?.dragging) scene.moveDrag(read()); }} />
  );
}

function isHelper(o: Object3D | null): boolean {
  for (let p = o; p; p = p.parent) if (p.userData.helper) return true;
  return false;
}

function Capture({ capture, camera, vfovDeg, frame, objects, renderSun }: {
  capture: React.MutableRefObject<(() => Promise<Layers>) | null>; camera: PerspectiveCamera; vfovDeg: number;
  frame: { w: number; h: number }; objects: () => { id: bigint; name: string; kind: string; root: Object3D }[];
  renderSun: Vector3 | null; // three-world direction toward the photo's sun (Nemotron's light read), for the composite
}) {
  const { gl, scene } = useThree();
  const get = useThree(s => s.get);
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __studio: unknown }).__studio = { get, scene, gl, capture }; // test hook
    capture.current = async () => {
      const { renderLayers } = await import('./render/layers.ts');
      const hide: Object3D[] = [];
      if (tilesRef.current) hide.push(tilesRef.current.group);
      if (sparkRef.current) hide.push(sparkRef.current); // our own data, but the layers carry only the user's objects
      // The layers composite onto the user's photo, so their shadows follow the photo's light, not the planned time.
      const sun = scene.getObjectByName('sun') as (Object3D & { target: Object3D }) | undefined;
      const was = sun?.position.clone();
      if (sun && renderSun) { sun.position.copy(sun.target.position).addScaledVector(renderSun, 400); sun.updateMatrixWorld(); }
      try { return await renderLayers({ gl, scene, camera, vfovDeg, width: frame.w, height: frame.h, hide, objects: objects() }); }
      finally { if (sun && was) { sun.position.copy(was); sun.updateMatrixWorld(); } }
    };
  });
  return null;
}

/** Where the user's photo lands in the viewport: the projector's frustum corners (on the far matte) seen by the shot
 *  camera. Outside it the frame shows the 3D world, outlined as "beyond your photo". */
function PlateFootprint({ camera, projector, onChange }: { camera: PerspectiveCamera; projector: Projector; onChange: (p: [number, number][] | null) => void }) {
  const { size } = useThree();
  const corners = useMemo(() => {
    const h = Math.tan((projector.vfovDeg * Math.PI) / 360) * 900, w = h * projector.aspect;
    return [[-w, h], [w, h], [w, -h], [-w, -h]].map(([x, y]) => enuToThree(new Vector3(x, y, -900).applyQuaternion(projector.quat).add(projector.pos)));
  }, [projector]);
  const last = useRef({ t: 0, key: '' });
  useFrame(() => {
    const now = performance.now();
    if (now - last.current.t < 150) return;
    last.current.t = now;
    camera.updateMatrixWorld();
    const pts = corners.map(c => c.clone().project(camera));
    const out = pts.some(p => p.z > 1) ? null : pts.map(p => [((p.x + 1) / 2) * size.width, ((1 - p.y) / 2) * size.height] as [number, number]);
    const key = out ? out.map(p => p.map(Math.round).join(',')).join(';') : '';
    if (key !== last.current.key) { last.current.key = key; onChange(out); }
  });
  return null;
}
