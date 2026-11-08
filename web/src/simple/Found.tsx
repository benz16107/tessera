// A-2 Found it: the answer in plain words. Where to stand, which way to face, the lens as an iPhone zoom, the next good
// light and "Take me there".
import { useMemo } from 'react';
import type { Photo, SolveResult, Spot } from '../module_bindings/types.ts';
import { angleDiff, compassWord, fmtTime, hfovDeg, lightWindows } from '../geo.ts';
import { CONFIDENCE, iphoneZoom, photoCredit, resultLine } from './lib.ts';
import { Arrow } from './icons.tsx';

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
          <p className="s-mid">{pose.lat.toFixed(6)}, {pose.lon.toFixed(6).replace('-', '−')}</p>
          <p className="s-muted">Stand here and face {face} to match the photo</p>
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
