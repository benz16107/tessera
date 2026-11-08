// Inspector. Each kind shows its essentials first (person: pose, height, facing; Cam A: lens, aperture, focus; light:
// type, colour, intensity) and keeps the rest in collapsed sections. Transform is in metres (X east, Y north, Z up).
// The camera page drives the session's shot_settings.
import { useRef, type ReactNode } from 'react';
import { Quaternion } from 'three';
import type { SceneObject } from '../../module_bindings/types.ts';
import { BODIES, bodyById, lensById, lensesFor, defaultBody } from '../catalog/index.ts';
import { maxApertureAt, minFocusAt, THIRD_STOPS } from '../catalog/lenses.ts';
import { profileFor } from '../catalog/profiles.ts';
import { SHUTTERS, ISOS, fmtShutter, handheld, diffraction, meterStops, settingsEv100, frameFraction } from '../optics.ts';
import { cameraHpr, cameraQuat, toEulerDeg, fromEulerDeg, yawQuat } from '../frame.ts';
import { parseParams, num, stateOf, withParams, POSES, type ObjState } from '../scene/objects.ts';
import type { Shot } from '../state/useShotSettings.ts';
import { kelvinHex } from '../world/SceneObjects.tsx';
import type { Optics } from '../camera/shot.ts';
import creditsRaw from '../catalog/props.credits.json?raw';
import { Ico, NumField, Switch, Dropdown, Seg, Disclosure, type IconName } from './ui.tsx';

const CREDITS = JSON.parse(creditsRaw) as Record<string, { title: string; author: string; license: string; page: string }>;
const fmtM = (m: number) => (!Number.isFinite(m) ? '∞' : m >= 100 ? `${m.toFixed(0)} m` : `${m.toFixed(1)} m`);
const MAIN_POSES = ['stand', 'walk', 'sit', 'lean', 'point', 'jump'];
const POSE_NAME: Record<string, string> = { stand: 'Stand', walk: 'Walk', sit: 'Sit', lean: 'Lean', point: 'Point', jump: 'Jump', talk: 'Talk', crouch: 'Crouch', push: 'Push' };
const KIND_ICON: Record<string, IconName> = { person: 'walk', light: 'bulb', camera: 'camera', model: 'cube', prop_generated: 'cube', text: 'cube' };

export interface InspectorProps {
  row: SceneObject | undefined;
  isShot: boolean;
  camName: string;
  lockedBy: string | null;
  placedBy: string;
  shot: Shot; setShot: (p: Partial<Shot>) => void; shotError: string;
  optics: Optics;
  sceneEv: number;
  vignette: boolean; setVignette: (v: boolean) => void;
  focusTarget: { name: string; distance: number } | null; // the selection (or nearest person) seen from the shot camera
  shotStats: (row: SceneObject) => { distance: number; heightM: number } | null;
  sizeOf: (row: SceneObject) => [number, number, number] | null;
  onChange: (row: SceneObject, s: ObjState, tag: string) => void;
  onMakeShot: (row: SceneObject) => void;
  onRegenerate: (row: SceneObject, photo?: File) => void;
  onFaceCamera: (row: SceneObject) => void;
  groundAt: (x: number, y: number) => number;
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="st-fieldset"><span>{label}</span>{children}</div>
);

export default function Inspector(p: InspectorProps) {
  const { row } = p;
  if (!row || row.kind === 'camera') return <CameraPage {...p} />;
  const s = stateOf(row);
  const prm = parseParams(row.params);
  const set = (patch: Partial<ObjState>, tag: string) => p.onChange(row, { ...s, ...patch }, tag);
  const setP = (patch: Record<string, string | number | boolean>, tag: string) => p.onChange(row, withParams(s, patch), tag);
  const q = new Quaternion(row.qx, row.qy, row.qz, row.qw).normalize();
  const setQ = (nq: Quaternion, tag: string) => set({ qx: nq.x, qy: nq.y, qz: nq.z, qw: nq.w }, tag);
  const e = toEulerDeg(q);
  const isImage = prm.type === 'image';
  const stats = p.shotStats(row);
  const size = p.sizeOf(row);
  const kindText = row.kind === 'prop_generated' ? (isImage ? 'Image' : 'Generated prop') : row.kind === 'model' ? 'Prop' : row.kind === 'light' ? 'Light' : row.kind === 'person' ? 'Person' : 'Text';
  const facing = (((-e.z) % 360) + 360) % 360;
  const pose = prm.pose ?? 'stand';
  const floor = p.groundAt(row.x, row.y);
  const inFocus = stats ? stats.distance >= p.optics.dof.nearM && stats.distance <= p.optics.dof.farM : false;
  const frac = stats ? frameFraction(stats.heightM, p.shot.focalMm, stats.distance, p.optics.sensorMm[1]) : 0;

  const transform = (
    <Disclosure title="Transform" meta="m · °">
      <Field label="Location">
        <div className="st-row3">
          <NumField axis="x" value={row.x} onChange={v => set({ x: v }, 'x')} />
          <NumField axis="y" value={row.y} onChange={v => set({ y: v }, 'y')} />
          <NumField axis="z" value={row.z} onChange={v => set({ z: v }, 'z')} />
        </div>
      </Field>
      <Field label="Rotation">
        <div className="st-row3">
          <NumField axis="x" value={e.x} digits={0} step={1} unit="°" onChange={v => setQ(fromEulerDeg(v, e.y, e.z), 'rot')} />
          <NumField axis="y" value={e.y} digits={0} step={1} unit="°" onChange={v => setQ(fromEulerDeg(e.x, v, e.z), 'rot')} />
          <NumField axis="z" value={e.z} digits={0} step={1} unit="°" onChange={v => setQ(fromEulerDeg(e.x, e.y, v), 'rot')} />
        </div>
      </Field>
      {row.kind !== 'light' && row.kind !== 'person' && (
        <Field label="Scale">
          <NumField value={row.scale} min={0.01} max={1000} step={0.05} unit="×" onChange={v => set({ scale: v }, 'scale')} label="Scale" />
        </Field>
      )}
      {row.kind !== 'light' && Math.abs(row.z - floor) > 0.02 && (
        <button className="st-btn small" onClick={() => set({ z: floor }, '')}>Drop to the street ({(row.z - floor).toFixed(2)} m up)</button>
      )}
    </Disclosure>
  );

  return (
    <div className="st-insp" aria-disabled={!!p.lockedBy}>
      <Header icon={isImage ? 'image' : KIND_ICON[row.kind] ?? 'cube'} name={row.name} sub={`${kindText} · placed by ${p.placedBy}`}
        onName={v => set({ name: v }, 'name')} visible={row.visible} onVisible={() => set({ visible: !row.visible }, '')} locked={p.lockedBy} />
      {p.lockedBy && <p className="st-note warn">{p.lockedBy} is moving this. Edits wait until they let go.</p>}

      {row.kind === 'person' && (
        <section className="st-sec">
          <Field label={`Pose · ${POSE_NAME[pose] ?? pose}`}>
            <div className="st-posepick" role="radiogroup" aria-label="Pose">
              {MAIN_POSES.map(x => (
                <button key={x} role="radio" aria-checked={pose === x} aria-pressed={pose === x} aria-label={POSE_NAME[x]} title={POSE_NAME[x]} onClick={() => setP({ pose: x }, '')}>
                  <img src={`/studio/ui/pose-${x}.png`} alt="" />
                </button>
              ))}
            </div>
            <select className="st-select" aria-label="More poses" value={MAIN_POSES.includes(pose) ? '' : pose} onChange={ev => ev.target.value && setP({ pose: ev.target.value }, '')}>
              <option value="">More poses: talk, crouch, push</option>
              {POSES.filter(x => !MAIN_POSES.includes(x)).map(x => <option key={x} value={x}>{POSE_NAME[x]}</option>)}
            </select>
          </Field>
          <Field label="Height">
            <div className="st-row">
              <NumField className="w80" value={num(prm, 'height', 1.75)} unit="m" min={0.5} max={2.3} step={0.01} onChange={v => setP({ height: v }, 'height')} label="Height" />
              <input className="st-slider" type="range" min={0.5} max={2.3} step={0.01} value={num(prm, 'height', 1.75)} onChange={ev => setP({ height: +ev.target.value }, 'height')} aria-label="Height" />
            </div>
          </Field>
          <Field label="Facing">
            <div className="st-row">
              <NumField className="w80" value={facing} unit="°" digits={0} step={5} onChange={v => setQ(yawQuat(v), 'rot')} label="Facing" />
              <Dial deg={facing} />
              <button className="st-target" onClick={() => p.onFaceCamera(row)}>Face {p.camName}</button>
            </div>
          </Field>
        </section>
      )}

      {row.kind === 'light' && (
        <section className="st-sec">
          <Dropdown label="Type" value={row.lightType || 'point'} onChange={v => set({ lightType: v }, '')} options={[
            { value: 'area', label: 'Area (softbox)' }, { value: 'spot', label: 'Spot' }, { value: 'point', label: 'Point (bare bulb)' }, { value: 'sun', label: 'Directional' },
          ]} />
          <Field label="Colour temperature">
            <div className="st-row">
              <NumField className="w80" value={num(prm, 'k', 5500)} unit="K" digits={0} step={100} min={1500} max={12000} onChange={v => setP({ k: Math.round(v) }, 'k')} label="Colour temperature" />
              <span style={{ width: 12, height: 12, borderRadius: 6, background: kelvinHex(num(prm, 'k', 5500)), flex: 'none' }} aria-hidden="true" />
              <input className="st-slider" type="range" min={1500} max={12000} step={50} value={num(prm, 'k', 5500)} onChange={ev => setP({ k: +ev.target.value }, 'k')} aria-label="Colour temperature" />
            </div>
          </Field>
          <Field label="Intensity">
            <NumField value={row.intensity} digits={0} step={50} min={0} max={1e6} unit={row.lightType === 'sun' ? 'lux' : row.lightType === 'area' ? 'nits' : 'cd'} onChange={v => set({ intensity: v }, 'intensity')} label="Intensity" />
          </Field>
        </section>
      )}

      {row.kind === 'prop_generated' && !isImage && (
        <section className="st-sec">
          {prm.concept && <img className="st-insp-img" src={prm.concept} alt="Concept image the model was built from" />}
          <p className="st-summary">{prm.prompt ? <>From the words <b>"{prm.prompt}"</b></> : prm.src === 'photo' ? 'From a photo' : 'Generated'}{size ? <> · <b>{size.map(v => v.toFixed(2)).join(' × ')} m</b></> : null}</p>
          <div className="st-actions">
            <button className="st-btn small" onClick={() => p.onRegenerate(row)} disabled={!prm.prompt}>Regenerate</button>
            <PhotoButton onFile={f => p.onRegenerate(row, f)} />
          </div>
        </section>
      )}
      {isImage && (
        <section className="st-sec">
          <img className="st-insp-img" src={row.assetId} alt="" />
          <Field label="Width">
            <div className="st-row">
              <NumField className="w80" value={num(prm, 'w', 1)} unit="m" min={0.05} max={50} onChange={v => setP({ w: v, h: +(v / num(prm, 'ar', 1)).toFixed(3) }, 'w')} label="Width" />
              <span className="st-meta">× {num(prm, 'h', 1).toFixed(2)} m tall</span>
            </div>
          </Field>
        </section>
      )}

      {stats && row.kind !== 'light' && (
        <p className="st-summary">
          <b>{fmtM(stats.distance)}</b> from {p.camName} · <b>{inFocus ? 'in focus' : 'out of focus'}</b> · <b>{Math.round(frac * 100)}%</b> of the frame height
        </p>
      )}

      <div className="st-disc-group">
        {transform}
        {row.kind !== 'light' && stats && (
          <Disclosure title={`Through ${p.camName}`}>
            <div className="st-stat"><span>Distance</span><b>{fmtM(stats.distance)}</b></div>
            <div className="st-stat"><span>Focus</span><i className={`dot${inFocus ? '' : ' off'}`} /><b>{inFocus ? 'in focus' : 'out of focus'}</b></div>
            <div className="st-stat"><span>Sharp from</span><b>{fmtM(p.optics.dof.nearM)} to {fmtM(p.optics.dof.farM)}</b></div>
            <div className="st-stat"><span>Frame height</span><b>{Math.round(frac * 100)}%</b></div>
            <button className="st-btn small" onClick={() => p.setShot({ focusM: Math.max(0.1, +stats.distance.toFixed(2)) })}>Focus {p.camName} here</button>
          </Disclosure>
        )}
        <Disclosure title="Advanced">
          {row.kind === 'person' && (
            <Field label="Gaze (for the AI render)">
              <Seg label="Gaze" flat value={prm.gaze ?? 'ahead'} onChange={v => setP({ gaze: v }, '')}
                options={[{ value: 'cam', label: p.camName }, { value: 'ahead', label: 'Ahead' }, { value: 'down', label: 'Down' }]} />
            </Field>
          )}
          {row.kind === 'light' && (
            <>
              <Field label="Size">
                <NumField value={num(prm, 'size', 0.3)} unit="m" min={0.01} max={10} step={0.05} onChange={v => setP({ size: v }, 'size')} label="Size" />
              </Field>
              <Switch label="Cast shadows" on={prm.shadows === '1'} onChange={v => setP({ shadows: v }, '')} disabled={row.lightType === 'area'}
                sub={row.lightType === 'area' ? 'Area lights cast no shadows in the viewport' : undefined} />
            </>
          )}
          {row.kind === 'prop_generated' && !isImage && <p className="st-note">Model: TRELLIS, hosted on NVIDIA{prm.ms ? `, ${(Number(prm.ms) / 1000).toFixed(0)} s` : ''}.</p>}
          {row.kind === 'model' && CREDITS[row.assetId] && (
            <p className="st-note">"{CREDITS[row.assetId].title}" by {CREDITS[row.assetId].author}, {CREDITS[row.assetId].license}, <a href={CREDITS[row.assetId].page} target="_blank" rel="noreferrer" style={{ color: 'var(--text-2)' }}>Poly Pizza</a>. Scaled to real size.</p>
          )}
          {row.kind === 'person' && <p className="st-note">Mannequin: Universal Animation Library by Quaternius, CC0. Scale follows height.</p>}
          <p className="st-note mono">Object {String(row.id)}</p>
        </Disclosure>
      </div>
    </div>
  );
}

function Header({ icon, name, sub, onName, visible, onVisible, locked }: {
  icon: IconName; name: string; sub: string; onName: (v: string) => void; visible: boolean; onVisible: () => void; locked: string | null;
}) {
  return (
    <header className="st-insp-head">
      <span className="st-kind"><Ico n={icon} s={16} /></span>
      <span className="t">
        <input value={name} maxLength={80} onChange={e => onName(e.target.value)} aria-label="Name" onKeyDown={e => e.stopPropagation()} />
        <span>{sub}</span>
      </span>
      {locked && <span title={`${locked} holds the gizmo`} style={{ color: 'var(--teal)', display: 'grid', placeItems: 'center', width: 24 }}><Ico n="lock" s={16} /></span>}
      <button className="st-eye" onClick={onVisible} aria-pressed={visible} aria-label={visible ? 'Hide' : 'Show'} title={visible ? 'Hide' : 'Show'}><Ico n={visible ? 'eye' : 'eye-slash'} s={16} /></button>
    </header>
  );
}

const Dial = ({ deg }: { deg: number }) => (
  <svg className="st-dial" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--line-2)" />
    <line x1="12" y1="12" x2={12 + 8 * Math.sin((deg * Math.PI) / 180)} y2={12 - 8 * Math.cos((deg * Math.PI) / 180)} stroke="var(--text)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

function PhotoButton({ onFile }: { onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <button className="st-btn small" onClick={() => ref.current?.click()}>
      <Ico n="image" /> From a photo
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </button>
  );
}

/** Lens ring: ticks across the zoom range, a marker at the current focal; drag, or the arrow keys, on a zoom. */
function LensRing({ min, max, value, onChange }: { min: number; max: number; value: number; onChange: (v: number) => void }) {
  const W = 264, pad = 6;
  const x = (f: number) => (max === min ? W / 2 : pad + ((Math.log(f) - Math.log(min)) / (Math.log(max) - Math.log(min))) * (W - 2 * pad));
  const fromX = (px: number) => Math.exp(Math.log(min) + Math.min(1, Math.max(0, (px - pad) / (W - 2 * pad))) * (Math.log(max) - Math.log(min)));
  const ticks = Array.from({ length: 23 }, (_, i) => pad + (i * (W - 2 * pad)) / 22);
  const stops = [min, ...[24, 28, 35, 50, 85, 105, 135, 200, 300, 400].filter(f => f > min * 1.12 && f < max * 0.9), max].filter((f, i, a) => a.indexOf(f) === i);
  const drag = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onChange(Math.round(fromX(((e.clientX - r.left) / r.width) * W)));
  };
  return (
    <>
      <svg className="st-ring" viewBox={`0 0 ${W} 28`} preserveAspectRatio="none" role="slider" aria-label="Focal length" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0}
        onPointerDown={e => { if (min === max) return; e.currentTarget.setPointerCapture(e.pointerId); drag(e); }} onPointerMove={e => { if (e.buttons && min !== max) drag(e); }}
        onKeyDown={e => { if (e.key === 'ArrowRight') onChange(Math.min(max, value + 1)); if (e.key === 'ArrowLeft') onChange(Math.max(min, value - 1)); }}>
        {ticks.map((t, i) => <line key={i} x1={t} x2={t} y1={12} y2={22} stroke="var(--line-2)" vectorEffect="non-scaling-stroke" />)}
        {stops.map(f => <line key={f} x1={x(f)} x2={x(f)} y1={8} y2={22} stroke="var(--text-3)" vectorEffect="non-scaling-stroke" />)}
        <line x1={x(value)} x2={x(value)} y1={4} y2={24} stroke="var(--text)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="st-ring-labels">{stops.map(f => <span key={f} style={{ left: `${(x(f) / W) * 100}%` }}>{Math.round(f)}</span>)}</div>
    </>
  );
}

/** Depth of field bar: sharp from near to far on a 0 to N m scale, the focus line and the hyperfocal mark. Click to focus. */
function DofDiagram({ near, far, focus, hyper, onFocus }: { near: number; far: number; focus: number; hyper: number; onFocus: (m: number) => void }) {
  const span = [20, 40, 80, 160, 320].find(s => s >= Math.min(focus * 2.2, 320)) ?? 320;
  const W = 264, x = (m: number) => 4 + (Math.min(m, span) / span) * (W - 8);
  return (
    <>
      <svg className="st-dofsvg" viewBox={`0 0 ${W} 36`} preserveAspectRatio="none" aria-label={`Sharp from ${fmtM(near)} to ${fmtM(far)}`}
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onFocus(Math.max(0.3, +(((e.clientX - r.left) / r.width * W - 4) / (W - 8) * span).toFixed(1))); }}>
        <line x1={4} x2={W - 4} y1={18} y2={18} stroke="var(--line-2)" vectorEffect="non-scaling-stroke" />
        <rect x={x(near)} y={11} width={Math.max(2, x(far) - x(near))} height={14} rx={3} fill="var(--line-2)" />
        <line x1={x(focus)} x2={x(focus)} y1={6} y2={30} stroke="var(--text)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {hyper < span && <line x1={x(hyper)} x2={x(hyper)} y1={10} y2={26} stroke="var(--text-3)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="st-dofscale">{[0, 0.5, 1].map(f => <span key={f} style={{ left: `${(4 + f * (W - 8)) / W * 100}%` }}>{Math.round(f * span)} m</span>)}</div>
    </>
  );
}

function CameraPage(p: InspectorProps) {
  const { shot, setShot, optics: o, row } = p;
  const body = bodyById(shot.bodyId) ?? defaultBody();
  const lens = lensById(shot.lensId);
  const widest = lens ? maxApertureAt(lens, shot.focalMm) : 1;
  const mfd = lens ? minFocusAt(lens, shot.focalMm) : undefined;
  const meter = meterStops(p.sceneEv, shot.aperture, shot.shutterS, shot.iso);
  const hh = handheld(shot.shutterS, shot.focalMm, body.crop, body.ibisStops);
  const dif = diffraction(shot.aperture, body.pitchUm);
  const prof = lens ? profileFor(lens.id) : undefined;
  const s = row ? stateOf(row) : null;
  const hpr = row ? cameraHpr(new Quaternion(row.qx, row.qy, row.qz, row.qw).normalize()) : null;
  const setQ = (h: number, pi: number, ro: number) => { if (row && s) { const q = cameraQuat(h, pi, ro); p.onChange(row, { ...s, qx: q.x, qy: q.y, qz: q.z, qw: q.w }, 'rot'); } };
  const ev = (m: number) => `${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(1)} EV`;
  const tile = (label: string, shown: ReactNode, value: number, options: { value: number; label: string }[], on: (v: number) => void) => (
    <label className="st-tile"><span>{label}</span><b>{shown}</b>
      <select aria-label={label} value={String(value)} onChange={e => on(Number(e.target.value))}>{options.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
    </label>
  );
  return (
    <div className="st-insp">
      <Header icon="camera" name={row?.name ?? p.camName} sub={`${p.isShot || !row ? 'Shot camera' : 'Camera'} · ${Math.round(shot.focalMm)} mm · f/${shot.aperture}`}
        onName={v => { if (row && s) p.onChange(row, { ...s, name: v }, 'name'); }} visible={row?.visible ?? true}
        onVisible={() => { if (row && s) p.onChange(row, { ...s, visible: !row.visible }, ''); }} locked={p.lockedBy} />
      {row && !p.isShot && <button className="st-btn small" onClick={() => p.onMakeShot(row)}>Make this the shot camera</button>}

      <section className="st-sec">
        <Dropdown label="Lens" value={shot.lensId} onChange={v => setShot({ lensId: v })} options={lensesFor(body).map(l => ({ value: l.id, label: l.name }))} />
        <div className="st-focal"><b>{Math.round(shot.focalMm)} mm</b>
          <span className="st-meta">{body.crop !== 1 ? `${Math.round(o.f35)} equiv · ` : ''}{o.hfovDeg.toFixed(1)}° × {o.vfovDeg.toFixed(1)}°</span></div>
        {lens && lens.focal[0] !== lens.focal[1] && <LensRing min={lens.focal[0]} max={lens.focal[1]} value={shot.focalMm} onChange={v => setShot({ focalMm: v })} />}
      </section>

      <section className="st-sec">
        <div className="st-tiles">
          {tile('Aperture', `f/${shot.aperture}`, shot.aperture, THIRD_STOPS.filter(n => n >= widest - 1e-6 && n <= 22).map(n => ({ value: n, label: `f/${n}` })), v => setShot({ aperture: v }))}
          {tile('Shutter', fmtShutter(shot.shutterS), shot.shutterS, SHUTTERS.map(t => ({ value: t, label: fmtShutter(t) })), v => setShot({ shutterS: v }))}
          {tile('ISO', shot.iso, shot.iso, ISOS.map(n => ({ value: n, label: String(n) })), v => setShot({ iso: v }))}
        </div>
        <p className="st-summary">Meter <b>{ev(meter)}</b> for the light now{Math.abs(meter) > 1 ? (meter > 0 ? ', too bright' : ', too dark') : ''}</p>
      </section>

      <section className="st-sec">
        <Field label="Focus">
          <div className="st-row">
            <NumField className="w80" value={shot.focusM} unit="m" digits={1} step={0.1} min={mfd ?? 0.05} max={10000} onChange={v => setShot({ focusM: v })} label="Focus distance" />
            {p.focusTarget && <button className="st-target" onClick={() => setShot({ focusM: Math.max(mfd ?? 0.1, +p.focusTarget!.distance.toFixed(1)) })}><Ico n="crosshair" s={12} /> On {p.focusTarget.name}</button>}
          </div>
        </Field>
        <DofDiagram near={o.dof.nearM} far={o.dof.farM} focus={shot.focusM} hyper={o.dof.hyperfocalM} onFocus={m => setShot({ focusM: Math.max(mfd ?? 0.1, m) })} />
        <p className="st-summary">Sharp from <b>{fmtM(o.dof.nearM)}</b> to <b>{fmtM(o.dof.farM)}</b></p>
      </section>

      <div className="st-disc-group">
        <Disclosure title="Exposure" meta={`EV ${settingsEv100(shot.aperture, shot.shutterS, shot.iso).toFixed(1)}`}>
          <Field label="White balance">
            <div className="st-row">
              <NumField className="w80" value={shot.whiteBalanceK} unit="K" digits={0} step={100} min={2000} max={10000} onChange={v => setShot({ whiteBalanceK: Math.round(v) })} label="White balance" />
              <input className="st-slider" type="range" min={2000} max={10000} step={100} value={shot.whiteBalanceK} onChange={e => setShot({ whiteBalanceK: +e.target.value })} aria-label="White balance" />
            </div>
          </Field>
          <p className="st-note">Scene about EV {p.sceneEv.toFixed(1)} from the sun and sky. Handheld {hh.risk === 'ok' ? 'is fine' : `risk is ${hh.risk}`} down to {fmtShutter(hh.safeS)}.{dif.warn ? ` Diffraction softens past f/${dif.limitN.toFixed(1)}.` : ''}</p>
        </Disclosure>
        <Disclosure title="Lens profile" meta={shot.distortion ? 'On' : 'Off'}>
          <Switch label="Distortion" on={shot.distortion} onChange={v => setShot({ distortion: v })} disabled={!prof?.distortion.length}
            sub={prof?.distortion.length ? `lensfun, measured · ${Math.abs(o.distortionPct) < 0.3 ? 'nearly none' : o.distortionPct < 0 ? 'barrel' : 'pincushion'} ${o.distortionPct >= 0 ? '+' : '−'}${Math.abs(o.distortionPct).toFixed(1)}% at the corner` : 'No measured profile for this lens'} />
          <Switch label="Vignetting" on={p.vignette} onChange={p.setVignette} sub={prof?.vignetting.length ? `lensfun, measured at f/${shot.aperture}` : 'Natural cos⁴ falloff'} />
        </Disclosure>
        <Disclosure title="Advanced">
          <Dropdown label="Body" value={shot.bodyId} meta={`${body.sensorMm[0]} × ${body.sensorMm[1]} mm`} onChange={v => setShot({ bodyId: v })}
            options={BODIES.map(b => ({ value: b.id, label: b.name }))} />
          <div className="st-dofnums">
            <div className="st-stat"><span>Hyperfocal</span><b>{fmtM(o.dof.hyperfocalM)}</b></div>
            <div className="st-stat"><span>Depth</span><b>{fmtM(o.dof.totalM)}</b></div>
          </div>
          <p className="st-note">Circle of confusion {o.cocMm.toFixed(3)} mm{mfd ? `, closest focus ${mfd.toFixed(2)} m` : ''}.</p>
          {row && s && hpr && (
            <>
              <Field label="Location (m)">
                <div className="st-row3">
                  <NumField axis="x" value={row.x} onChange={v => p.onChange(row, { ...s, x: v }, 'x')} />
                  <NumField axis="y" value={row.y} onChange={v => p.onChange(row, { ...s, y: v }, 'y')} />
                  <NumField axis="z" value={row.z} onChange={v => p.onChange(row, { ...s, z: v }, 'z')} />
                </div>
              </Field>
              <Field label="Heading, pitch, roll (°)">
                <div className="st-row3">
                  <NumField value={hpr.heading} digits={1} step={1} onChange={v => setQ(v, hpr.pitch, hpr.roll)} label="Heading" />
                  <NumField value={hpr.pitch} digits={1} step={0.5} min={-89} max={89} onChange={v => setQ(hpr.heading, v, hpr.roll)} label="Pitch" />
                  <NumField value={hpr.roll} digits={1} step={0.5} onChange={v => setQ(hpr.heading, hpr.pitch, v)} label="Roll" />
                </div>
              </Field>
            </>
          )}
        </Disclosure>
      </div>
      {p.shotError && <p className="st-note warn" role="alert">{p.shotError}</p>}
    </div>
  );
}
