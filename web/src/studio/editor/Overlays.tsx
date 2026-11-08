// Look-through overlays in viewport pixels: letterbox outside the frame, the aspect crop mask, and composition guides
// (thirds, golden ratio grid, golden spiral, centre, horizon from the camera's pitch and roll, action and title safe).
interface Rect { x: number; y: number; w: number; h: number }
interface Props {
  vw: number; vh: number; rect: Rect;
  aspect: string; overlays: string[];
  pitchDeg: number; rollDeg: number; fpxView: number; // focal length in viewport pixels, for the horizon
  readout?: string;
  /** The photo's footprint in the viewport (px): outside it the frame shows the 3D world, "beyond your photo". */
  footprint?: [number, number][] | null;
}

const PHI = 0.6180339887;

/** The largest crop of the requested aspect inside the frame, turned to match the frame's orientation. */
function crop(r: Rect, aspect: string): Rect {
  const [a, b] = aspect.split(':').map(Number);
  if (!a || !b) return r;
  let ar = a / b;
  if ((r.w >= r.h) !== (ar >= 1)) ar = 1 / ar;
  const w = Math.min(r.w, r.h * ar), h = w / ar;
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/** Golden spiral: cut a square off the left, top, right, bottom in turn and draw a quarter arc in each. */
function spiral(r: Rect): string {
  let { x, y, w, h } = r;
  let d = '';
  for (let i = 0, k = w >= h ? 0 : 1; i < 10; i++, k = (k + 1) % 4) {
    const s = Math.min(w, h);
    if (s < 1) break;
    let p0: number[], p1: number[];
    if (k === 0) { p0 = [x, y + s]; p1 = [x + s, y]; x += s; w -= s; }
    else if (k === 1) { p0 = [x, y]; p1 = [x + s, y + s]; y += s; h -= s; }
    else if (k === 2) { p0 = [x + w, y]; p1 = [x + w - s, y + s]; w -= s; }
    else { p0 = [x + s, y + h]; p1 = [x, y + h - s]; h -= s; }
    d += `${d ? 'L' : 'M'}${p0[0]},${p0[1]} A${s},${s} 0 0 1 ${p1[0]},${p1[1]} `;
  }
  return d;
}

export default function Overlays({ vw, vh, rect, aspect, overlays, pitchDeg, rollDeg, fpxView, readout, footprint }: Props) {
  const c = crop(rect, aspect);
  const on = (k: string) => overlays.includes(k);
  const outside = (r: Rect) => `M0,0H${vw}V${vh}H0Z M${r.x},${r.y}V${r.y + r.h}H${r.x + r.w}V${r.y}Z`;
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const hy = cy + Math.tan((pitchDeg * Math.PI) / 180) * fpxView; // pitch up moves the horizon down the frame
  const lines: [number, number, number, number][] = [];
  if (on('thirds')) for (const f of [1 / 3, 2 / 3]) { lines.push([c.x + c.w * f, c.y, c.x + c.w * f, c.y + c.h], [c.x, c.y + c.h * f, c.x + c.w, c.y + c.h * f]); }
  if (on('grid')) for (const f of [0.25, 0.5, 0.75]) { lines.push([c.x + c.w * f, c.y, c.x + c.w * f, c.y + c.h], [c.x, c.y + c.h * f, c.x + c.w, c.y + c.h * f]); }
  const gold: [number, number, number, number][] = [];
  if (on('golden')) for (const f of [1 - PHI, PHI]) { gold.push([c.x + c.w * f, c.y, c.x + c.w * f, c.y + c.h], [c.x, c.y + c.h * f, c.x + c.w, c.y + c.h * f]); }
  const safe = (k: number): Rect => ({ x: c.x + (c.w * (1 - k)) / 2, y: c.y + (c.h * (1 - k)) / 2, w: c.w * k, h: c.h * k });
  return (
    <div className="st-overlays" aria-hidden="true">
      <svg width={vw} height={vh}>
        <defs><clipPath id="st-frame"><rect x={c.x} y={c.y} width={c.w} height={c.h} /></clipPath></defs>
        <path d={outside(rect)} fill="var(--bg)" fillOpacity={0.86} fillRule="evenodd" />
        {(c.w < rect.w - 1 || c.h < rect.h - 1) && <path d={`M${rect.x},${rect.y}H${rect.x + rect.w}V${rect.y + rect.h}H${rect.x}Z M${c.x},${c.y}V${c.y + c.h}H${c.x + c.w}V${c.y}Z`} fill="var(--bg)" fillOpacity={0.6} fillRule="evenodd" />}
        {footprint && footprint.length === 4 && (() => {
          const poly = `M${footprint.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}Z`;
          // Label inside the frame where the world shows: the widest band between the frame edge and the footprint.
          const top = Math.min(...footprint.map(p => p[1])), left = Math.min(...footprint.map(p => p[0]));
          const lx = left - rect.x > 120 ? rect.x + 8 : rect.x + 8, ly = top - rect.y > 30 ? rect.y + (top - rect.y) / 2 + 4 : rect.y + rect.h - 40;
          return (
            <g clipPath="url(#st-frame)">
              <path d={`M${rect.x},${rect.y}H${rect.x + rect.w}V${rect.y + rect.h}H${rect.x}Z ${poly}`} fill="var(--bg)" fillOpacity={0.28} fillRule="evenodd" />
              <path d={poly} fill="none" stroke="var(--text)" strokeOpacity={0.85} strokeDasharray="6 4" />
              {(top - rect.y > 20 || left - rect.x > 20) && <text x={lx} y={ly} className="st-ov-label" style={{ fill: 'var(--text)', paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 3 }}>Beyond your photo: the 3D world</text>}
            </g>
          );
        })()}
        <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="none" stroke="var(--text)" strokeOpacity={0.5} />
        {lines.map((l, i) => <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke="var(--text)" strokeOpacity={0.45} />)}
        {gold.map((l, i) => <line key={`g${i}`} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke="var(--amber)" strokeOpacity={0.55} strokeDasharray="4 4" />)}
        {on('spiral') && <path d={spiral(c)} fill="none" stroke="var(--amber)" strokeOpacity={0.7} clipPath="url(#st-frame)" />}
        {on('center') && <g stroke="var(--text)" strokeOpacity={0.6}><line x1={cx - 10} x2={cx + 10} y1={cy} y2={cy} /><line x1={cx} x2={cx} y1={cy - 10} y2={cy + 10} /></g>}
        {on('horizon') && (
          <g clipPath="url(#st-frame)" transform={`rotate(${-rollDeg} ${cx} ${hy})`}>
            <line x1={c.x - c.w} x2={c.x + 2 * c.w} y1={hy} y2={hy} stroke="var(--z)" strokeOpacity={0.75} strokeDasharray="10 6" />
          </g>
        )}
        {on('horizon') && (() => {
          // In the margin where the horizon leaves the frame's right edge, clear of anything in the picture.
          const ex = c.x + c.w, ey = hy - Math.tan((rollDeg * Math.PI) / 180) * (ex - cx), room = vw - ex > 110;
          return (
            <text x={room ? ex + 8 : ex - 8} y={ey + 4} textAnchor={room ? 'start' : 'end'} className="st-ov-label" style={{ paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: 3 }}>
              Horizon {rollDeg >= 0 ? '+' : ''}{rollDeg.toFixed(1)}°
            </text>
          );
        })()}
        {on('safe') && [0.93, 0.9].map(k => { const s = safe(k); return <rect key={k} x={s.x} y={s.y} width={s.w} height={s.h} fill="none" stroke="var(--text)" strokeOpacity={0.35} strokeDasharray={k === 0.9 ? '2 4' : undefined} />; })}
      </svg>
      {readout && <p className="st-readout" style={{ left: rect.x + 12, top: rect.y + 12 }}>{readout}</p>}
    </div>
  );
}
