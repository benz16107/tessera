// A strip for the studio's bottom timeline: cloud by layer and rain per hour (Open-Meteo), "street in shadow" bands from
// the real buildings, and high and low tides (NOAA). It takes the timeline's own time-to-x mapping, so it lines up.
import type { GeoLayers } from './useGeoLayers.ts';
import './layers.css';

interface Props { geo: GeoLayers; x: (d: Date) => number; a: Date; b: Date; w: number; top: number; zone: string }

const H = 60 * 60_000;

export default function GeoBands({ geo, x, a, b, top, zone }: Props) {
  const d = geo.data;
  if (!d) return null;
  const t = (s: string) => new Date(s);
  const inWin = (s: string) => { const v = Date.parse(s); return v >= a.getTime() - H && v <= b.getTime() + H; };
  const hours = geo.on('weather') ? (d.summary.weather?.hours ?? []).filter(h => inWin(h.t)) : [];
  const probe = d.summary.shadow?.probes.at(-1);
  const bands = geo.on('shadow') ? (probe?.bands ?? []).filter(s => Date.parse(s.end) >= a.getTime() && Date.parse(s.start) <= b.getTime()) : [];
  const tides = geo.on('tides') ? (d.summary.tides?.hilo ?? []).filter(h => Date.parse(h.t) >= a.getTime() && Date.parse(h.t) <= b.getTime()) : [];
  const fmt = (v: Date) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(v).replace(/ [AP]M$/, '');
  const cell = (h: { t: string }) => { const c = Date.parse(h.t); const l = x(new Date(c - H / 2)), r = x(new Date(c + H / 2)); return { left: l, width: Math.max(1, r - l - 1) }; };
  return (
    <div className="geo-bands" style={{ top }} aria-label="Clouds, rain, street shadow and tides">
      {hours.map(h => (
        <span key={h.t} className="geo-hour" style={cell(h)} title={`${fmt(t(h.t))}: cloud low ${h.low}% mid ${h.mid}% high ${h.high}%, rain ${h.rainPct}%, wind ${h.windMph} mph`}>
          <i style={{ opacity: h.high / 100 }} /><i style={{ opacity: h.mid / 100 }} /><i style={{ opacity: h.low / 100 }} />
          <em style={{ opacity: Math.min(1, h.rainPct / 80) }} />
        </span>
      ))}
      {bands.map((s, i) => {
        const l = Math.max(x(a), x(t(s.start))), r = Math.min(x(b), x(t(s.end)));
        return <span key={i} className="geo-shade" style={{ left: l, width: Math.max(3, r - l) }} title={`${probe?.label}: in building shadow ${fmt(t(s.start))} to ${fmt(t(s.end))}`}>{r - l > 110 ? 'Street in shadow' : ''}</span>;
      })}
      {tides.map(h => (
        <span key={h.t} className="geo-tide" data-type={h.type} style={{ left: x(t(h.t)) }} title={`${h.type === 'L' ? 'Low' : 'High'} tide ${fmt(t(h.t))}, ${h.ft.toFixed(1)} ft (${d.summary.tides?.station?.name})`}>
          {h.type === 'L' ? 'Low' : 'High'} {fmt(t(h.t))}
        </span>
      ))}
    </div>
  );
}
