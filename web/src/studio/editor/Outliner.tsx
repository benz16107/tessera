// Outliner: the scene tree (Scene > shot cameras, sun, lights, people, props, original photo), as in Figma frame 26:12.
import { useState } from 'react';
import type { SceneObject } from '../../module_bindings/types.ts';
import { parseParams, num } from '../scene/objects.ts';
import { Ico, type IconName } from './ui.tsx';

export type WorldMode = 'splat' | 'tiles' | 'off';
const WORLD_LABEL: Record<WorldMode, string> = { splat: 'Splat', tiles: '3D Tiles', off: 'Hidden' };

interface Props {
  rows: SceneObject[];
  selected: bigint | null;
  shotId: bigint | null;
  camLabel: (r: SceneObject) => { name: string; sub: string };
  lockOwner: (r: SceneObject) => { name: string; color: string } | null;
  onSelect: (id: bigint) => void;
  onToggle: (r: SceneObject) => void;
  spotLabel: string;
  world: WorldMode; worlds: WorldMode[]; onWorld: (w: WorldMode) => void;
  sunTime: string;
  photo?: { width: number; height: number };
}

const lightLine = (r: SceneObject) => {
  const p = parseParams(r.params), k = num(p, 'k', 5500), size = num(p, 'size', 0.3);
  const t = { area: `area light ${size.toFixed(1)} m`, spot: 'spot', point: 'bulb', sun: 'directional' }[r.lightType] ?? r.lightType;
  return `${r.name} · ${t} ${k} K`;
};
const personLine = (r: SceneObject) => {
  const p = parseParams(r.params);
  const pose = p.pose ?? 'stand';
  const verb: Record<string, string> = { stand: 'standing', walk: 'walking', sit: 'sitting', lean: 'leaning', point: 'pointing', jump: 'jumping', talk: 'talking', crouch: 'crouching', push: 'pushing' };
  return `${r.name.replace(/ \(.*\)$/, '')} · ${num(p, 'height', 1.75).toFixed(2)} m · ${verb[pose] ?? pose}`;
};
const propIcon = (r: SceneObject): IconName => {
  const p = parseParams(r.params);
  if (p.type === 'image') return 'image';
  if (/bike|bicycle/i.test(r.assetId + r.name)) return 'bike';
  if (/car|taxi|suv/i.test(r.assetId)) return 'car';
  if (/parasol|umbrella/i.test(r.assetId + r.name)) return 'umbrella';
  return 'cube';
};

export default function Outliner(p: Props) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (g: string) => setClosed(s => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const Row = ({ r, depth, icon, name, sub, meta }: { r: SceneObject; depth: number; icon: IconName; name: string; sub?: string; meta?: React.ReactNode }) => {
    const lock = p.lockOwner(r);
    const sel = r.id === p.selected;
    return (
      <li role="treeitem" aria-selected={sel}>
        <div className={`st-ol-row${sub ? ' tall' : ''}`} aria-selected={sel} data-hidden={!r.visible} style={{ ['--d' as string]: depth }}>
          <span className="chev" />
          <button style={{ display: 'contents' }} onClick={() => p.onSelect(r.id)} aria-label={`Select ${name}`}>
            <Ico n={icon} />
            <span style={{ width: 2 }} />
            <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span className="name">{name}</span>
              {sub && <span className="sub">{sub}</span>}
            </span>
          </button>
          <span className="spacer" />
          {lock && <span className="st-who" style={{ ['--c' as string]: lock.color }} title={`${lock.name} is moving this`}>{lock.name.slice(0, 1).toUpperCase()}</span>}
          {meta}
          {!r.visible && <span className="st-meta">hidden</span>}
          {(sel || !r.visible) && (
            <button className="st-eye" aria-pressed={r.visible} onClick={() => p.onToggle(r)} aria-label={`${r.visible ? 'Hide' : 'Show'} ${name}`}>
              <Ico n={r.visible ? 'eye' : 'eye-slash'} />
            </button>
          )}
        </div>
      </li>
    );
  };
  const Group = ({ id, icon, label, rows, children }: { id: string; icon: IconName; label: string; rows: SceneObject[]; children: React.ReactNode }) => {
    if (!rows.length) return null;
    const open = !closed.has(id);
    return (
      <li role="treeitem" aria-expanded={open} aria-selected={false}>
        <button className="st-ol-row" style={{ ['--d' as string]: 1 }} onClick={() => toggle(id)}>
          <Ico n="down" s={10} style={{ rotate: open ? '0deg' : '-90deg' }} />
          <Ico n={icon} />
          <span style={{ width: 2 }} />
          <span className="name group">{label}</span>
          <span className="spacer" />
          <span className="st-meta">{rows.length}</span>
        </button>
        {open && <ul className="st-ol" role="group">{children}</ul>}
      </li>
    );
  };
  const cams = p.rows.filter(r => r.kind === 'camera');
  const lights = p.rows.filter(r => r.kind === 'light');
  const people = p.rows.filter(r => r.kind === 'person');
  const props = p.rows.filter(r => r.kind === 'model' || r.kind === 'prop_generated' || r.kind === 'text');
  const nextWorld = p.worlds[(p.worlds.indexOf(p.world) + 1) % p.worlds.length];

  return (
    <nav className="st-outliner" aria-label="Outliner">
      <div className="st-panel-head"><span className="st-label">Outliner</span></div>
      <ul className="st-ol" role="tree">
        <li role="treeitem" aria-expanded aria-selected={false}>
          <div className="st-ol-row">
            <Ico n="down" s={10} />
            <Ico n="globe" />
            <span style={{ width: 2 }} />
            <span className="name group">Scene</span>
            <span className="spacer" />
            <button className="st-meta" onClick={() => p.onWorld(nextWorld)} title={`World: ${WORLD_LABEL[p.world]}. Click for ${WORLD_LABEL[nextWorld]}.`}
              style={{ textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>{p.spotLabel} · {WORLD_LABEL[p.world]}</button>
          </div>
          <ul className="st-ol" role="group">
            {cams.map(r => {
              const l = p.camLabel(r);
              return <Row key={String(r.id)} r={r} depth={1} icon="camera" name={l.name} sub={l.sub}
                meta={r.id === p.shotId ? <span className="st-tag">SHOT</span> : undefined} />;
            })}
            <li role="treeitem" aria-selected={false}>
              <div className="st-ol-row" style={{ ['--d' as string]: 1 }}>
                <span className="chev" /><Ico n="sun" /><span style={{ width: 2 }} />
                <span className="name">Sun</span><span className="spacer" /><span className="st-meta">{p.sunTime}</span>
              </div>
            </li>
            <Group id="lights" icon="bulb" label="Lights" rows={lights}>
              {lights.map(r => <Row key={String(r.id)} r={r} depth={2} icon={r.lightType === 'area' ? 'lamp' : 'bulb'} name={lightLine(r)} />)}
            </Group>
            <Group id="people" icon="walk" label="People" rows={people}>
              {people.map(r => <Row key={String(r.id)} r={r} depth={2} icon="walk" name={personLine(r)} />)}
            </Group>
            <Group id="props" icon="cube" label="Props" rows={props}>
              {props.map(r => {
                const prm = parseParams(r.params);
                const tag = r.kind === 'prop_generated'
                  ? <span className="st-tag">{prm.type === 'image' ? 'image' : 'generated · TRELLIS'}</span> : undefined;
                return <Row key={String(r.id)} r={r} depth={2} icon={propIcon(r)} name={r.name} meta={tag} />;
              })}
            </Group>
            {p.photo && (
              <li role="treeitem" aria-selected={false}>
                <div className="st-ol-row" style={{ ['--d' as string]: 1 }}>
                  <span className="chev" /><Ico n="image" /><span style={{ width: 2 }} />
                  <span className="name">Original photo</span><span className="spacer" />
                  <span className="st-meta">{p.photo.width} × {p.photo.height}</span>
                </div>
              </li>
            )}
          </ul>
        </li>
      </ul>
      {p.rows.length <= 1 && <p className="st-note" style={{ padding: '8px 16px 0' }}>Shift+A adds an object. Drop an image on the view to place it or make it 3D.</p>}
    </nav>
  );
}
