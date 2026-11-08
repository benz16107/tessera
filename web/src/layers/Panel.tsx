// The Conditions drawer: the same paragraph the agents read, the facts that change the shot as chips, the 2D map,
// layer switches (shared with everyone on the set when the module has `layer_toggle`), and where each fact came from.
import { lazy, Suspense } from 'react';
import { LAYERS, type GeoLayers, type LayerId } from './useGeoLayers.ts';
import type { CameraCone } from './Map2D.tsx';
import './layers.css';

const Map2D = lazy(() => import('./Map2D.tsx'));
const NYC_ONLY: LayerId[] = ['film', 'closures', 'construction'];

const fmt = (iso: string | null | undefined, zone: string) => (iso ? new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '');

function count(geo: GeoLayers, id: LayerId): string {
  const d = geo.data!;
  const s = d.summary;
  if (id === 'weather') return s.weather?.now ? `${s.weather.now.tempF}°F, ${s.weather.sky}` : '';
  if (id === 'tides') return s.tides?.station ? s.tides.station.name : 'no station';
  if (id === 'moon') return s.moon ? `${s.moon.illumination}% lit` : '';
  if (id === 'film') return s.film ? `${s.film.active} live, ${s.film.history} past` : '';
  if (id === 'shadow') return `${s.shadow?.casters ?? 0} buildings`;
  const n = d.layers[id]?.features.length;
  return n === undefined ? '' : String(n);
}

export default function GeoPanel({ geo, zone, center, camera, onClose }: {
  geo: GeoLayers; zone: string; center: { lat: number; lon: number }; camera?: CameraCone | null; onClose: () => void;
}) {
  const d = geo.data, c = d?.conditions, s = d?.summary;
  const nextTide = s?.tides?.hilo.find(h => d && Date.parse(h.t) >= Date.parse(d.at) - 30 * 60_000);
  const probe = s?.shadow?.probes.at(-1);
  const snap = geo.snapshots.find(x => x.layer === 'weather');
  const updated = d?.sources.map(x => x.fetchedAt ?? 0).filter(Boolean);
  return (
    <div className="st-drawer geo-drawer" role="dialog" aria-label="Conditions and map layers">
      <header>
        <h2>Conditions</h2>
        {d && <span className="st-meta">{new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(d.at))}</span>}
        <button className="st-btn small" onClick={onClose}>Close</button>
      </header>
      {!d && !geo.error && <div className="geo-skel" aria-busy="true" aria-label="Loading conditions"><i /><i /><i /></div>}
      {geo.error && !d && <p className="st-note warn" role="alert">Layers did not load: {geo.error}</p>}
      {c && <p className="geo-text">{c.text}</p>}
      {s && (
        <div className="geo-chips">
          {c?.colorChance && <span className="geo-chip" data-tone={c.colorChance.label} title={c.colorChance.why}><b>{c.colorChance.kind === 'sunset' ? 'Sunset' : 'Sunrise'} colour</b>{c.colorChance.label} · {c.colorChance.score}</span>}
          {nextTide && <span className="geo-chip" title={s.tides?.note}><b>{nextTide.type === 'L' ? 'Low tide' : 'High tide'}</b>{fmt(nextTide.t, zone)} · {nextTide.ft.toFixed(1)} ft</span>}
          {probe && <span className="geo-chip" title={probe.readout}><b>Street</b>{probe.readout.replace(/^.*? is /, '')}</span>}
          {s.weather?.now && <span className="geo-chip"><b>Wind</b>{s.weather.now.windMph} mph{s.weather.now.gustMph > s.weather.now.windMph + 7 ? `, gusts ${s.weather.now.gustMph}` : ''}</span>}
          {s.weather?.haze && <span className="geo-chip" title={s.weather.haze.detail}><b>Haze</b>{s.weather.haze.label}</span>}
          {s.moon && <span className="geo-chip"><b>Moon</b>{s.moon.phaseName}, {s.moon.illumination}%{s.moon.rise ? `, up ${fmt(s.moon.rise, zone)}` : ''}</span>}
          {(s.alerts?.count ?? 0) > 0 && <span className="geo-chip" data-tone="poor"><b>NWS</b>{s.alerts!.count} active alert{s.alerts!.count > 1 ? 's' : ''}</span>}
        </div>
      )}
      {d && (
        <Suspense fallback={<div className="geo-map geo-skel-map" aria-busy="true" />}>
          <Map2D geo={geo} center={center} camera={camera} height={300} />
        </Suspense>
      )}
      {d && (
        <ul className="geo-toggles" aria-label="Layers">
          {LAYERS.map(l => {
            const off = NYC_ONLY.includes(l.id) && !d.nyc, err = d.errors[l.id];
            return (
              <li key={l.id}>
                <button aria-pressed={geo.on(l.id) && !off} disabled={off} onClick={() => geo.toggle(l.id)} title={l.note}>
                  <i style={{ background: l.color }} />
                  <span>{l.name}</span>
                  <small>{off ? 'NYC only' : err ? (err.startsWith('still') ? 'loading' : 'unavailable') : count(geo, l.id)}</small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {d && (
        <p className="geo-sources">
          {geo.shared ? 'Layer switches are shared with everyone on this set. ' : ''}
          {snap ? `SpacetimeDB's scheduled procedure refreshed the weather at ${fmt(snap.fetchedAt.toISOString(), zone)}. ` : ''}
          {s?.film?.note ? `${s.film.note} ` : ''}
          Data: {[...new Set(d.sources.map(x => x.name.replace(/ \(.*\)$/, '')))].join(', ')}.
          {updated?.length ? ` Updated ${fmt(new Date(Math.max(...updated)).toISOString(), zone)}.` : ''} <a href="/credits#geodata">Sources and licenses</a>
        </p>
      )}
    </div>
  );
}

/** The top-bar button that opens the drawer; the dot turns amber when something nearby is in force. */
export function GeoButton({ geo, open, onClick }: { geo: GeoLayers; open: boolean; onClick: () => void }) {
  const blockers = geo.data?.conditions?.lines.length ? (geo.data.layers.closures?.features.length ?? 0) + (geo.data.summary.alerts?.count ?? 0) + (geo.data.summary.film?.active ?? 0) : 0;
  return (
    <button className="st-btn geo-btn" aria-pressed={open} onClick={onClick} title="Weather, tides, permits, shadows and the 2D map">
      Conditions{blockers > 0 && <i className="geo-dot" aria-label={`${blockers} things nearby`} />}
    </button>
  );
}
