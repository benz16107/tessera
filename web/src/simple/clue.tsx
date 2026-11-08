// The clue panel (anywhere2.md rule 3): three ways to say where a photo was taken. Search a place name (Nominatim), tap the
// exact spot (Pin), or circle the area and let Nemotron look inside it (Area, POST /api/locate with hint.area). Every way in
// calls onPlace, which moves the shoot's pin for everyone and records how it was placed.
import { Suspense, useState } from 'react';
import type { Photo } from '../module_bindings/types.ts';
import { metersBetween } from '../geo.ts';
import { searchPlaces, type Place } from '../studio/editor/PlaceSearch.tsx';
import { GeoPicker, type PickedArea, type PickedPoint } from '../layers/index.ts';
import { locate, type PlacedBy } from './lib.ts';

export type OnPlace = (lat: number, lon: number, by: PlacedBy, radiusM?: number) => Promise<void>;

type Tab = 'search' | 'pin' | 'area';
const TABS: [Tab, string][] = [['search', 'Search'], ['pin', 'Exact spot'], ['area', 'Area']];

export function CluePanel({ photo, near, onPlace, onClose }: { photo: Photo; near: PickedPoint; onPlace: OnPlace; onClose?: () => void }) {
  const [tab, setTab] = useState<Tab>('search');
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Place[] | null>(null);
  const [pt, setPt] = useState<PickedPoint | null>(null);
  const [area, setArea] = useState<PickedArea | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr('');
    try { await fn(); onClose?.(); } catch (x) { setErr(String((x as Error)?.message ?? x)); }
    setBusy('');
  };
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy('Searching'); setErr('');
    try { const r = await searchPlaces(q.trim()); setRes(r); if (!r.length) setErr('No place found. Try a street address or a landmark.'); }
    catch (x) { setErr((x as Error).message); }
    setBusy('');
  };
  // The crew answers inside the circle: a named match there, or the centre with confidence 'area'. Checked here too.
  const findInArea = () => run('Looking inside the circle', async () => {
    if (!area) return;
    const r = await locate(photo.url, undefined, { area });
    if (r && r.lat != null && r.lon != null && r.confidence !== 'area' && metersBetween(area.lat, area.lon, r.lat, r.lon) <= area.radiusM * 1.05) await onPlace(r.lat, r.lon, 'guess');
    else await onPlace(area.lat, area.lon, 'area', area.radiusM);
  });

  return (
    <div className="s-place s-clue">
      <div className="s-seg" role="group" aria-label="How to place it">
        {TABS.map(([t, label]) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => { setTab(t); setErr(''); }}>{label}</button>)}
      </div>
      {tab === 'search' && (
        <form className="s-place-form" onSubmit={search}>
          <label className="sr-only" htmlFor="s-place-q">Search for a place</label>
          <div className="s-invite-row">
            <input id="s-place-q" className="s-field" value={q} onChange={e => setQ(e.target.value)} placeholder="An address or a landmark" autoComplete="off" />
            <button className="s-btn" disabled={!!busy || !q.trim()}>{busy === 'Searching' ? 'Searching' : 'Search'}</button>
          </div>
          {res && res.length > 0 && (
            <ul className="s-place-results">
              {res.map(p => <li key={`${p.lat},${p.lon}`}><button type="button" disabled={!!busy} onClick={() => void run('Moving the shoot', () => onPlace(p.lat, p.lon, 'search'))}>{p.name}</button></li>)}
            </ul>
          )}
          <p className="s-place-credit">Search by Nominatim, data © OpenStreetMap contributors</p>
        </form>
      )}
      {tab !== 'search' && (
        <>
          <p className="s-muted small">{tab === 'pin' ? 'Tap where the photographer stood, or drag the pin.' : 'Drag the circle over where it was taken. Nemotron looks for the place inside it.'}</p>
          <div className="s-clue-map">
            <Suspense fallback={<span className="s-sk s-sk-fill" />}>
              {tab === 'pin'
                ? <GeoPicker key="pin" mode="pin" center={near} zoom={15} value={pt} onChange={setPt} height={320} />
                : <GeoPicker key="area" mode="area" center={near} zoom={12} value={area} onChange={setArea} height={320} />}
            </Suspense>
          </div>
          <div className="s-clue-actions">
            {tab === 'pin'
              ? <button type="button" className="s-btn primary" disabled={!pt || !!busy} onClick={() => pt && void run('Moving the shoot', () => onPlace(pt.lat, pt.lon, 'pin'))}>{busy || 'Stand here'}</button>
              : <button type="button" className="s-btn primary" disabled={!area || !!busy} onClick={() => void findInArea()}>{busy || 'Find it in this area'}</button>}
          </div>
        </>
      )}
      {onClose && <button type="button" className="s-textbtn" onClick={onClose}>Cancel</button>}
      {err && <p className="s-error" role="alert">{err}</p>}
    </div>
  );
}
