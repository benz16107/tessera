// Small shared controls in the round 3 look: icons, numeric fields, sections, switches and dropdowns.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

export type IconName = 'search' | 'down' | 'globe' | 'camera' | 'sun' | 'bulb' | 'lamp' | 'walk' | 'eye' | 'eye-slash' | 'cube' | 'bike'
  | 'umbrella' | 'image' | 'cursor' | 'move' | 'rotate' | 'scale' | 'ruler' | 'play' | 'crosshair' | 'lock' | 'car';

export const Ico = ({ n, s, style }: { n: IconName; s?: 10 | 12 | 16 | 18; style?: CSSProperties }) =>
  <i className={`ico${s ? ` s${s}` : ''}`} aria-hidden="true" style={{ ['--i' as string]: `url(/studio/ui/${n}.svg)`, ...style }} />;

const r = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '');

/** A numeric field that edits on every valid keystroke, steps with the arrow keys (Shift = 10x), and shows `axis` in colour. */
export function NumField({ value, onChange, axis, unit, digits = 2, step = 0.1, min, max, className, label, disabled }: {
  value: number; onChange: (v: number) => void; axis?: 'x' | 'y' | 'z'; unit?: string; digits?: number; step?: number; min?: number; max?: number;
  className?: string; label?: string; disabled?: boolean;
}) {
  const [text, setText] = useState(r(value, digits));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(r(value, digits)); }, [value, focus, digits]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  return (
    <label className={`st-field ${className ?? ''}`}>
      {axis && <b className={axis}>{axis.toUpperCase()}</b>}
      <input inputMode="decimal" value={text} disabled={disabled} aria-label={label ?? axis}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onChange={e => { setText(e.target.value); const v = parseFloat(e.target.value.replace('−', '-')); if (Number.isFinite(v)) onChange(clamp(v)); }}
        onKeyDown={e => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          onChange(clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
        }} />
      {unit && <i>{unit}</i>}
    </label>
  );
}

export const Section = ({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) => (
  <section className="st-sec">
    <header className="st-sec-head"><span className="st-label">{title}</span>{meta && <span className="st-meta">{meta}</span>}</header>
    {children}
  </section>
);

export const Switch = ({ on, onChange, label, sub, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string; disabled?: boolean }) => (
  <button className="st-switch" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}>
    <span className="l"><span>{label}</span>{sub && <small>{sub}</small>}</span>
    <span className="sw" aria-hidden="true" />
  </button>
);

/** A styled dropdown: the native select sits invisibly on top, so keyboard and screen readers get the real control. */
export function Dropdown<T extends string | number>({ label, value, options, onChange, meta }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; meta?: string;
}) {
  const cur = options.find(o => o.value === value);
  return (
    <div className="st-pick">
      <span>{label}</span>
      <div className="st-dropdown">
        <span className="v">{cur?.label ?? String(value)}</span>
        {meta && <span className="st-meta">{meta}</span>}
        <Ico n="down" s={12} />
        <select aria-label={label} value={String(value)} onChange={e => { const o = options.find(x => String(x.value) === e.target.value); if (o) onChange(o.value); }}>
          {options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}

export const Seg = <T extends string>({ value, options, onChange, flat, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; flat?: boolean; label: string;
}) => (
  <div className={`st-seg${flat ? ' flat' : ''}`} role="group" aria-label={label}>
    {options.map(o => <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
  </div>
);

/** A collapsed-by-default section ("Exposure", "Lens profile", "Advanced"). Open state is remembered per name in this browser. */
export function Disclosure({ title, meta, children, defaultOpen = false }: { title: string; meta?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const key = `studio/open/${title}`;
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1'; } catch { return defaultOpen; }
  });
  const toggle = () => setOpen(o => { try { localStorage.setItem(key, o ? '0' : '1'); } catch { /* private mode */ } return !o; });
  return (
    <section className="st-disc">
      <button aria-expanded={open} onClick={toggle}>
        <Ico n="down" s={12} /><span>{title}</span>{meta && <span className="st-meta">{meta}</span>}
      </button>
      {open && children}
    </section>
  );
}
