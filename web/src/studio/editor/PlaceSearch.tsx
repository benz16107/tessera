// Go anywhere: place search through OpenStreetMap's Nominatim (usage policy: at most one request a second, searches only on
// Enter, attribution shown with the results). A browser can't set User-Agent; the page's Referer identifies ShotMatch,
// which the policy accepts for web apps.
import { useEffect, useRef, useState } from 'react';
import { Ico } from './ui.tsx';

export interface Place { lat: number; lon: number; name: string }

let lastAt = 0;
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export async function searchPlaces(q: string): Promise<Place[]> {
  const wait = lastAt + 1100 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastAt = Date.now();
  const r = await fetch(`${NOMINATIM}?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': navigator.language || 'en' } });
  if (!r.ok) throw new Error(`place search HTTP ${r.status}`);
  const j = (await r.json()) as { lat: string; lon: string; display_name: string }[];
  return j.map(x => ({ lat: +x.lat, lon: +x.lon, name: x.display_name }));
}

export default function PlaceSearch({ onPick }: { onPick: (p: Place) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const go = async () => {
    if (!q.trim() || busy) return;
    setBusy(true); setErr('');
    try { const p = await searchPlaces(q.trim()); setRes(p); if (!p.length) setErr('No place found. Try a street address or a landmark.'); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <span style={{ position: 'relative' }}>
      <button className="st-btn small" aria-expanded={open} onClick={() => setOpen(v => !v)} title="Go to a place" aria-label="Go to a place"><Ico n="search" s={16} /></button>
      {open && (
        <div className="st-menu st-search" style={{ left: 0, top: 40 }} role="dialog" aria-label="Go to a place">
          <form onSubmit={e => { e.preventDefault(); void go(); }}>
            <input ref={input} className="st-input" value={q} onChange={e => setQ(e.target.value)} placeholder="An address or a landmark: Eiffel Tower"
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false); }} aria-label="Place" />
          </form>
          {busy && <p className="st-note">Searching</p>}
          {err && <p className="st-note">{err}</p>}
          {res?.map(p => (
            <button key={`${p.lat},${p.lon}`} onClick={() => { onPick(p); setOpen(false); }}>{p.name}</button>
          ))}
          <p className="st-search-credit">Search by <a href="https://nominatim.org" target="_blank" rel="noreferrer">Nominatim</a>, data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></p>
        </div>
      )}
    </span>
  );
}
