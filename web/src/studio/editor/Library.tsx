// Asset library (Figma 26:138): tabs for People, Props, Vehicles, Lights and Cameras, pose tiles, and the Generate panel.
// The same entries are the Shift+A add menu (search, Enter adds the first match). Licenses: catalog/CREDITS.md.
import { useEffect, useMemo, useRef, useState } from 'react';
import { PROPS } from '../catalog/props.ts';
import { POSES, type AddItem } from '../scene/objects.ts';
import creditsRaw from '../catalog/props.credits.json?raw';
import { Ico, type IconName } from './ui.tsx';
import Generate, { type GenResult } from './Generate.tsx';

type Tab = 'People' | 'Props' | 'Vehicles' | 'Lights' | 'Cameras';
interface Entry { key: string; tab: Tab; label: string; sub: string; icon: IconName; item: AddItem }

const CREDITS = JSON.parse(creditsRaw) as Record<string, { author: string; license: string }>;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const POSE_IMG = new Set(['stand', 'walk', 'sit', 'lean', 'point', 'jump']);

export const ENTRIES: Entry[] = [
  ...POSES.map(p => ({ key: `person-${p}`, tab: 'People' as Tab, label: cap(p), sub: 'mannequin, CC0', icon: 'walk' as IconName, item: { kind: 'person', pose: p } as AddItem })),
  ...PROPS.map(p => ({
    key: `prop-${p.id}`, tab: (p.category === 'Vehicles' ? 'Vehicles' : 'Props') as Tab, label: p.name, sub: `${CREDITS[p.id]?.author ?? ''} · ${CREDITS[p.id]?.license ?? ''}`,
    icon: (p.id === 'bike' ? 'bike' : p.category === 'Vehicles' ? 'car' : p.id === 'parasol' ? 'umbrella' : 'cube') as IconName, item: { kind: 'model', propId: p.id } as AddItem,
  })),
  ...(['area', 'spot', 'point', 'sun'] as const).map(t => ({
    key: `light-${t}`, tab: 'Lights' as Tab, label: { spot: 'Spot light', area: 'Softbox (area light)', point: 'Bare bulb', sun: 'Directional key' }[t],
    sub: '3200 K', icon: (t === 'area' ? 'lamp' : 'bulb') as IconName, item: { kind: 'light', lightType: t } as AddItem,
  })),
  { key: 'camera', tab: 'Cameras', label: 'Camera', sub: 'shares the shot settings', icon: 'camera', item: { kind: 'camera' } },
];
const TABS: Tab[] = ['People', 'Props', 'Vehicles', 'Lights', 'Cameras'];

export default function Library({ onAdd, sessionId, onGenerated, genFile }: {
  onAdd: (i: AddItem) => void; sessionId: bigint; onGenerated: (r: GenResult) => void; genFile?: { file: File; n: number } | null;
}) {
  const [tab, setTab] = useState<Tab>('People');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [gen, setGen] = useState(true);
  useEffect(() => { if (genFile) setGen(true); }, [genFile?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? ENTRIES.filter(e => `${e.tab} ${e.label}`.toLowerCase().includes(t)) : ENTRIES.filter(e => e.tab === tab);
  }, [q, tab]);
  return (
    <div className="st-library" aria-label="Asset library">
      <div className="st-panel-head">
        <span className="st-label">Asset library</span>
        <button onClick={() => setSearching(s => !s)} aria-label="Search assets" aria-pressed={searching}><Ico n="search" /></button>
      </div>
      {searching && <input className="st-search" autoFocus placeholder="Search people, props, lights" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.stopPropagation()} aria-label="Search assets" />}
      {!q && (
        <div className="st-libtabs" role="tablist">
          {TABS.map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}
        </div>
      )}
      {!q && tab === 'People' ? (
        <div className="st-poses">
          {hits.filter(h => h.item.kind === 'person' && POSE_IMG.has(h.item.pose)).map(h => (
            <button key={h.key} className="st-pose" onClick={() => onAdd(h.item)} title={`Add a person, ${h.label.toLowerCase()}`}>
              <img src={`/studio/ui/pose-${(h.item as { pose: string }).pose}.png`} alt="" />{h.label}
            </button>
          ))}
          {hits.filter(h => h.item.kind === 'person' && !POSE_IMG.has(h.item.pose)).map(h => (
            <button key={h.key} className="st-pose" onClick={() => onAdd(h.item)}><Ico n="walk" s={18} style={{ margin: '17px 0' }} />{h.label}</button>
          ))}
        </div>
      ) : (
        <div className="st-assets">
          {hits.map(h => (
            <button key={h.key} className="st-asset" onClick={() => onAdd(h.item)}>
              <Ico n={h.icon} /><span className="name">{h.label}</span><span className="st-meta">{h.sub}</span>
            </button>
          ))}
          {hits.length === 0 && <p className="st-note">No asset matches "{q}". Generate it below.</p>}
        </div>
      )}
      <button className="st-genbtn" aria-expanded={gen} onClick={() => setGen(g => !g)}>
        <Ico n="cube" s={16} /> Generate a prop <span className="st-meta">TRELLIS · NVIDIA</span>
      </button>
      {gen && <Generate sessionId={sessionId} onResult={onGenerated} external={genFile} />}
    </div>
  );
}

/** Shift+A: the same entries with a search field. Enter adds the first match. */
export function AddMenu({ onAdd, onClose }: { onAdd: (i: AddItem) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const hits = ENTRIES.filter(e => `${e.tab} ${e.label}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="st-gen" role="dialog" aria-label="Add object" style={{ width: 340, maxHeight: '70vh', overflow: 'auto', background: 'var(--panel)' }}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <input ref={input} className="st-search" placeholder="Add: person, bike, softbox" value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && hits[0]) { onAdd(hits[0].item); onClose(); } }} aria-label="Search assets" />
      {hits.map(h => (
        <button key={h.key} className="st-asset" onClick={() => { onAdd(h.item); onClose(); }}>
          <Ico n={h.icon} /><span className="name">{h.tab === 'People' ? `Person, ${h.label.toLowerCase()}` : h.label}</span><span className="st-meta">{h.tab}</span>
        </button>
      ))}
    </div>
  );
}
