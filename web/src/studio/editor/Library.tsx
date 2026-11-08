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
const TABS: (Tab | 'Generate')[] = ['People', 'Props', 'Vehicles', 'Lights', 'Cameras', 'Generate'];

/** The Add drawer: search, the asset library by tab, and Generate. Opened by + and Shift+A; Esc closes it. */
export default function AddDrawer({ onAdd, sessionId, onGenerated, genFile, onClose, startTab }: {
  onAdd: (i: AddItem) => void; sessionId: bigint; onGenerated: (r: GenResult) => void; genFile?: { file: File; n: number } | null;
  onClose: () => void; startTab?: Tab | 'Generate';
}) {
  const [tab, setTab] = useState<Tab | 'Generate'>(startTab ?? 'People');
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (genFile) setTab('Generate'); }, [genFile?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab !== 'Generate') input.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? ENTRIES.filter(e => `${e.tab} ${e.label}`.toLowerCase().includes(t)) : ENTRIES.filter(e => e.tab === tab);
  }, [q, tab]);
  const add = (i: AddItem) => { onAdd(i); onClose(); };
  return (
    <aside className="st-drawer-add" role="dialog" aria-label="Add to the set" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <header>
        <h2>Add to the set</h2>
        <button className="st-icon-btn" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)"><span aria-hidden="true" style={{ font: '400 18px/1 var(--sans)' }}>×</span></button>
      </header>
      <div className="st-library">
        <input ref={input} className="st-search" placeholder="Search people, props, lights" value={q} onChange={e => setQ(e.target.value)} aria-label="Search assets"
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && hits[0]) add(hits[0].item); }} />
        {!q && (
          <div className="st-libtabs" role="tablist">
            {TABS.map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}
          </div>
        )}
        {!q && tab === 'Generate' ? (
          <Generate sessionId={sessionId} onResult={onGenerated} external={genFile} />
        ) : !q && tab === 'People' ? (
          <div className="st-poses">
            {hits.filter(h => h.item.kind === 'person').map(h => {
              const pose = (h.item as { pose: string }).pose;
              return (
                <button key={h.key} className="st-pose" onClick={() => add(h.item)} title={`Add a person, ${h.label.toLowerCase()}`}>
                  {POSE_IMG.has(pose) ? <img src={`/studio/ui/pose-${pose}.png`} alt="" /> : <Ico n="walk" s={18} style={{ margin: '17px 0' }} />}{h.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="st-assets">
            {hits.map(h => (
              <button key={h.key} className="st-asset" onClick={() => add(h.item)} title={h.sub}>
                <Ico n={h.icon} /><span className="name">{h.tab === 'People' ? `Person, ${h.label.toLowerCase()}` : h.label}</span>
              </button>
            ))}
            {hits.length === 0 && (
              <p className="st-note">Nothing called "{q}" yet. <button className="st-btn small" onClick={() => { setQ(''); setTab('Generate'); }}>Generate it</button></p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

