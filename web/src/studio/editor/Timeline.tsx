// Timeline (Figma 27:39): time of day at the spot. A window around the morning or evening light (or the whole day) with
// 15-minute ticks, blue and golden hour bands from the sun's altitude (light/sun.ts), the altitude curve against the
// horizon, a playhead that drives the set's sun, and saved shots as keyframes. Times read in the spot's time zone.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import SunCalc from 'suncalc';
import { bands, solarDay, sunPath } from '../light/sun.ts';
import { fmtTime, sunAt, angleDiff } from '../../geo.ts';
import { Ico, Seg } from './ui.tsx';

export interface Keyframe { id: string; label: string; at: Date; current: boolean; onPick: () => void }
type Win = 'morning' | 'evening' | 'day';

interface Props {
  at: Date; lat: number; lon: number; zone: string; camHeading: number | null; camName: string;
  onChange: (d: Date) => void; keyframes: Keyframe[]; sunControl?: ReactNode;
  open: boolean; pinned: boolean; onHover: (over: boolean) => void; onPin: () => void;
  extra?: (s: { x: (d: Date) => number; a: Date; b: Date; w: number; open: boolean }) => ReactNode; // the geo thread's weather and tide strip
}

const Q = 15 * 60_000;

export default function Timeline({ at, lat, lon, zone, camHeading, camName, onChange, keyframes, sunControl, open, pinned, onHover, onPin, extra }: Props) {
  const dayKey = Math.floor(at.getTime() / 3_600_000);
  const [d0, d1] = useMemo(() => solarDay(at, lat, lon), [dayKey, lat, lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => bands(d0, lat, lon), [d0, lat, lon]);
  const times = useMemo(() => SunCalc.getTimes(new Date((d0.getTime() + d1.getTime()) / 2), lat, lon), [d0, d1, lat, lon]);
  const [win, setWin] = useState<Win>(() => (at.getTime() < (d0.getTime() + d1.getTime()) / 2 ? 'morning' : 'evening'));

  // The window: blue hour start minus 20 min to golden hour end plus 30 min (mirrored at dusk), on 15-minute marks.
  const [a, b] = useMemo(() => {
    if (win === 'day') return [d0, d1];
    const mid = (d0.getTime() + d1.getTime()) / 2;
    const half = all.filter(x => (x.phase === 'blue' || x.phase === 'golden') && (win === 'morning' ? x.start.getTime() < mid : x.start.getTime() >= mid));
    if (!half.length) return [d0, d1];
    const s = Math.min(...half.map(x => x.start.getTime())), e = Math.max(...half.map(x => x.end.getTime()));
    const pre = win === 'morning' ? 20 : 30, post = win === 'morning' ? 30 : 20;
    return [new Date(Math.floor((s - pre * 60_000) / Q) * Q), new Date(Math.ceil((e + post * 60_000) / Q) * Q)];
  }, [win, all, d0, d1]);
  const span = b.getTime() - a.getTime();

  const track = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1000);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const L = 16, R = 48, x = (d: Date) => L + ((d.getTime() - a.getTime()) / span) * (w - L - R);
  const fromX = (px: number) => new Date(a.getTime() + Math.min(1, Math.max(0, (px - L) / (w - L - R))) * span);

  const [playing, setPlaying] = useState(false);
  const atRef = useRef(at);
  atRef.current = at;
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      let t = atRef.current.getTime() + span / 240;
      if (t > b.getTime()) t = a.getTime();
      onChange(new Date(t));
    }, 60);
    return () => clearInterval(id);
  }, [playing, a, b, span, onChange]);

  const step = win === 'day' ? 3 * 3_600_000 : Q;
  const ticks: Date[] = [];
  for (let t = Math.ceil(a.getTime() / (step / 3)) * (step / 3); t <= b.getTime(); t += step / 3) ticks.push(new Date(t));
  const path = useMemo(() => sunPath(a, lat, lon, win === 'day' ? 10 : 2).filter(s => s.t >= a && s.t <= b), [a, b, lat, lon, win]);
  const alts = path.map(s => s.altitude);
  const lo = Math.min(-8, ...alts), hi = Math.max(8, ...alts);
  const y = (alt: number) => 46 - ((alt - lo) / (hi - lo)) * 40; // inside the 52 px altitude strip
  const shown = all.filter(x => (x.phase === 'blue' || x.phase === 'golden') && x.end > a && x.start < b);
  const sun = sunAt(at, lat, lon);
  const rel = camHeading === null ? '' : (() => {
    const dd = angleDiff(sun.azimuth, camHeading);
    return sun.altitude < -1 ? 'below the horizon' : Math.abs(dd) < 25 ? `ahead of ${camName}` : Math.abs(dd) > 150 ? `behind ${camName}` : `from the ${dd > 0 ? 'right' : 'left'} of ${camName}`;
  })();
  const sunrise = win === 'evening' ? times.sunset : times.sunrise;
  const px = x(at);
  const zoneDay = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'short', day: 'numeric' }).format(at);

  return (
    <div className="st-time" aria-label="Time of day" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <div className="st-time-left">
        <div className="st-transport">
          <button className="st-play" onClick={() => setPlaying(v => !v)} aria-label={playing ? 'Pause the sun' : 'Play the sun'} aria-pressed={playing}>
            {playing ? <span style={{ width: 8, height: 10, borderLeft: '3px solid currentColor', borderRight: '3px solid currentColor' }} /> : <Ico n="play" s={12} />}
          </button>
          <b>{fmtTime(at, zone)}</b>
          <label style={{ position: 'relative', minWidth: 0 }}>
            <span>{zoneDay}</span>
            <input type="date" aria-label="Day" style={{ position: 'absolute', inset: 0, opacity: 0 }}
              value={new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(at)}
              onChange={e => { const [yy, mm, dd] = e.target.value.split('-').map(Number); if (yy) { const n = new Date(at); n.setFullYear(yy, mm - 1, dd); onChange(n); } }} />
          </label>
        </div>
        <div className="st-time-more" aria-hidden={!open}>
          <Seg label="Window" value={win} onChange={setWin} flat options={[{ value: 'morning', label: 'Dawn' }, { value: 'evening', label: 'Dusk' }, { value: 'day', label: 'Day' }]} />
          {sunControl}
          <span className="rowlab">Sun altitude and saved shots below</span>
        </div>
      </div>
      <div ref={track} className="st-track" role="slider" tabIndex={0} aria-label="Time of day" aria-valuetext={fmtTime(at, zone)}
        aria-valuemin={a.getTime()} aria-valuemax={b.getTime()} aria-valuenow={at.getTime()}
        onKeyDown={e => { const k = e.shiftKey ? 60 : 5; if (e.key === 'ArrowRight') onChange(new Date(at.getTime() + k * 60_000)); if (e.key === 'ArrowLeft') onChange(new Date(at.getTime() - k * 60_000)); }}
        onPointerDown={e => { if ((e.target as HTMLElement).closest('.st-key, .st-time-toggle')) return; e.currentTarget.setPointerCapture(e.pointerId); onChange(fromX(e.clientX - e.currentTarget.getBoundingClientRect().left)); }}
        onPointerMove={e => { if (e.buttons && !(e.target as HTMLElement).closest('.st-key, .st-time-toggle')) onChange(fromX(e.clientX - e.currentTarget.getBoundingClientRect().left)); }}>
        {ticks.map(t => {
          const major = t.getTime() % step === 0;
          return <span key={t.getTime()}>
            <i className={`tick${major ? ' major' : ''}`} style={{ left: x(t) }} />
            {major && <span className="tlab" style={{ left: x(t) }}>{fmtTime(t, zone).replace(/ [AP]M$/, '')}</span>}
          </span>;
        })}
        {shown.map((bd, i) => {
          const l = Math.max(L, x(bd.start)), r = Math.min(w - R, x(bd.end));
          const txt = bd.phase === 'blue' ? `Blue hour ${fmtTime(bd.start, zone).replace(/ [AP]M$/, '')}` : `Golden hour ${fmtTime(bd.start, zone).replace(/ [AP]M$/, '')} to ${fmtTime(bd.end, zone).replace(/ [AP]M$/, '')}`;
          return <span key={i} className={`st-band ${bd.phase}`} style={{ left: l, width: Math.max(4, r - l) }} title={txt}>{r - l > 90 ? txt : r - l > 40 ? (bd.phase === 'blue' ? 'Blue' : 'Golden') : ''}</span>;
        })}
        <svg className="alt" width={w} height={52} viewBox={`0 0 ${w} 52`} aria-hidden="true">
          <line x1={L} x2={w - R} y1={y(0)} y2={y(0)} stroke="var(--text-3)" strokeDasharray="2 3" strokeOpacity={0.6} />
          <polyline fill="none" stroke="var(--text-2)" strokeWidth={1.5} points={path.map(s2 => `${x(s2.t)},${y(s2.altitude)}`).join(' ')} />
          {at >= a && at <= b && <circle cx={px} cy={y(sun.altitude)} r={4} fill="var(--text)" stroke="var(--panel)" strokeWidth={1.5} />}
        </svg>
        <span className="horizon open-only" style={{ top: 60 + y(0) - 14 }}>Horizon</span>
        {sunrise instanceof Date && !isNaN(sunrise.getTime()) && sunrise > a && sunrise < b && (
          <span className="sunrise open-only" style={{ left: x(sunrise), top: 60 + y(0) + 2 }}>{win === 'evening' ? 'Sunset' : 'Sunrise'} {fmtTime(sunrise, zone).replace(/ [AP]M$/, '')}</span>
        )}
        {at >= a && at <= b && (
          <>
            <i className="st-playhead" style={{ left: px }} />
            <span className="st-sunread open-only" style={{ left: px + 10 > w - 180 ? px - 170 : px + 10 }}>
              <b>Sun {sun.altitude.toFixed(1)}° {sun.altitude >= 0 ? 'up' : 'down'}, {sun.azimuth.toFixed(0)}°</b>
              {rel && <span>{rel}</span>}
            </span>
          </>
        )}
        {keyframes.filter(k => k.at >= a && k.at <= b).map(k => (
          <button key={k.id} className="st-key open-only" aria-current={k.current} style={{ left: x(k.at) - 5 }} onClick={k.onPick} title={`${k.label}, ${fmtTime(k.at, zone)}`}>
            <i />{k.label}
          </button>
        ))}
        {extra?.({ x, a, b, w, open })}
        <button className="st-icon-btn st-time-toggle" onClick={onPin} aria-expanded={open} aria-pressed={pinned} aria-label={pinned ? 'Collapse the timeline' : 'Keep the timeline open'} title={pinned ? 'Collapse' : 'Keep open'}>
          <Ico n="down" s={12} style={{ rotate: open ? '0deg' : '180deg' }} />
        </button>
      </div>
    </div>
  );
}
